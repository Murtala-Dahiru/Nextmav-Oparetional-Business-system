import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isSupportedCurrency, CURRENCY_CODES } from '@/lib/locale';
import {
  SETTING_KEYS, validateSetting, DEFAULT_SETTINGS, type SettingKey,
} from '@/lib/org-settings';

/**
 * Organization settings.
 *
 * Returns the organization row (working hours, timezone, currency, branding)
 * together with the key/value policy documents that do not warrant their own
 * columns, and the department list the same screen edits.
 *
 * The working-hours fields are not cosmetic: `work_start`, `grace_minutes`,
 * `break_minutes` and `work_days` are what the attendance functions classify
 * late arrivals and compute worked time against, and what
 * `working_days_between()` counts an expected month from. Changing them
 * changes the register on the next request.
 */
export async function GET() {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const [orgRes, settingsRes, deptRes, membersRes] = await Promise.all([
    ctx.supabase.from('organizations').select('*').eq('id', ctx.org.organizationId).maybeSingle(),
    ctx.supabase.from('org_settings').select('key, value').eq('organization_id', ctx.org.organizationId),
    ctx.supabase.from('departments')
      .select('id, name, description, parent_id, head_id')
      .eq('organization_id', ctx.org.organizationId).is('deleted_at', null).order('name'),
    // Headcount and manager names, so the department table is readable without
    // the screen making a second request and joining in the browser.
    ctx.supabase.from('v_assignable_members')
      .select('member_id, full_name, department_id')
      .eq('organization_id', ctx.org.organizationId),
  ]);

  if (orgRes.error) return pgError(orgRes.error);
  if (!orgRes.data) return error('Not found', 404, 'NOT_FOUND');

  const stored = (settingsRes.data ?? []).reduce<Record<string, any>>((acc, row: any) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  /**
   * Defaults are merged under whatever is stored.
   *
   * An organisation created before a policy key existed has no row for it, and
   * a settings screen that renders empty controls in that case looks broken and
   * — worse — saves the blanks back over a working default. Migration 0017
   * backfills existing organisations; this covers the gap for any key added
   * after a backfill has already run.
   */
  const settings: Record<string, any> = { ...stored };
  for (const key of SETTING_KEYS) {
    settings[key] = { ...DEFAULT_SETTINGS[key], ...(stored[key] ?? {}) };
  }

  const people = membersRes.data ?? [];
  const departments = (deptRes.data ?? []).map((d: any) => ({
    ...d,
    head_name: people.find((p: any) => p.member_id === d.head_id)?.full_name ?? null,
    member_count: people.filter((p: any) => p.department_id === d.id).length,
  }));

  return success({ organization: orgRes.data, settings, departments });
}

/**
 * Update settings.
 *
 * Organization columns and policy documents are updated in one call because
 * they appear as one form. Restricted to admins by RLS; the explicit role
 * check turns a silent no-op into a clear 403.
 */
export async function PATCH(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    /**
     * Currency is checked before it is stored.
     *
     * The column is char(3), so it will take any three characters — "XYZ" is
     * saved happily and then reaches `Intl.NumberFormat`, which throws inside
     * render and takes the whole module down through the error boundary. It is
     * also the one setting that changes what every other module displays, so a
     * bad value is felt everywhere at once.
     */
    if ('currency' in b && !isSupportedCurrency(b.currency)) {
      return error(
        `"${b.currency}" is not a supported currency. Expected one of: ${CURRENCY_CODES.join(', ')}.`,
        422, 'UNSUPPORTED_CURRENCY',
      );
    }

    /**
     * The timezone is checked too, for the same reason.
     *
     * The column is free text, and every date-bounded query in the product now
     * resolves "today" through it. An unrecognised zone would silently fall
     * back to UTC on every request — attendance filed against one day and read
     * back on another, with nothing on any screen to explain it.
     */
    if ('timezone' in b && b.timezone) {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: String(b.timezone) }).format(new Date());
      } catch {
        return error(
          `"${b.timezone}" is not a recognised time zone. Use an IANA name such as Africa/Lagos or Europe/London.`,
          422, 'UNSUPPORTED_TIMEZONE',
        );
      }
    }

    /**
     * Working hours have to make sense as an interval.
     *
     * `work_end` before `work_start` produces a negative expected day, which
     * the attendance summary then divides by — the register showed a nonsense
     * attendance rate rather than the setting being refused.
     */
    if (b.work_start && b.work_end && String(b.work_end) <= String(b.work_start)) {
      return error('The working day has to end after it starts.', 422, 'INVALID_WORK_HOURS');
    }

    if ('work_days' in b) {
      const days = Array.isArray(b.work_days) ? b.work_days.map(Number) : [];
      if (!days.length) {
        return error('Choose at least one working day.', 422, 'VALIDATION_ERROR');
      }
      if (days.some((d: number) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return error('Working days are 0 (Sunday) to 6 (Saturday).', 422, 'VALIDATION_ERROR');
      }
      b.work_days = [...new Set<number>(days)].sort((x, y) => x - y);
    }

    /** Whether anything was actually written. See the check at the end. */
    let touched = false;

    const orgUpdate: Record<string, any> = {};
    for (const k of [
      'name', 'logo_url', 'website', 'industry', 'timezone',
      'work_start', 'work_end', 'work_days', 'grace_minutes', 'break_minutes', 'currency',
      // Added in 0013. The form has always collected these; until the columns
      // existed the handler simply dropped them.
      'phone', 'country', 'address_line', 'state', 'city',
    ]) {
      if (k in b) orgUpdate[k] = b[k];
    }
    if (orgUpdate.currency) orgUpdate.currency = String(orgUpdate.currency).toUpperCase().trim();
    for (const k of ['grace_minutes', 'break_minutes']) {
      if (k in orgUpdate) orgUpdate[k] = Math.max(0, Number(orgUpdate[k]) || 0);
    }

    if (Object.keys(orgUpdate).length) {
      const { error: e } = await ctx.supabase
        .from('organizations').update(orgUpdate).eq('id', ctx.org.organizationId);
      if (e) return pgError(e);
      touched = true;
    }

    /**
     * Policy documents are validated before they are stored.
     *
     * `org_settings.value` is jsonb, so anything at all can be written into it
     * — and the readers are the leave form, the project form and the
     * attendance rules, which behave oddly rather than failing loudly. A leave
     * type that is not a member of the `leave_type` enum, for instance, renders
     * as an option and then produces 22P02 when somebody picks it, several
     * screens away from the setting that caused it. This is the only place that
     * can say why.
     */
    if (b.settings && typeof b.settings === 'object') {
      const rows: { organization_id: string; key: string; value: unknown; updated_at: string }[] = [];

      for (const [key, value] of Object.entries(b.settings)) {
        if ((SETTING_KEYS as readonly string[]).includes(key)) {
          const problem = validateSetting(key as SettingKey, value);
          if (problem) return error(problem, 422, 'INVALID_SETTING');
        }
        rows.push({
          organization_id: ctx.org.organizationId,
          key,
          value: value as unknown,
          updated_at: new Date().toISOString(),
        });
      }

      if (rows.length) {
        const { error: e } = await ctx.supabase
          .from('org_settings').upsert(rows, { onConflict: 'organization_id,key' });
        if (e) return pgError(e);
        touched = true;
      }
    }

    /**
     * A request that changed nothing is refused rather than reported as saved.
     *
     * ── The failure this closes ───────────────────────────────────────────────
     *
     * Policy documents have to arrive wrapped: `{ settings: { leave_policy: … } }`.
     * A body that names one at the top level instead — `{ projectDefaults: … }`,
     * which is the obvious shape to reach for and what the verification harness
     * itself sent on its first attempt — matched no organization column and no
     * policy key, so nothing was written and this returned 200 with the
     * organization row attached. The caller saw a success, the screen showed a
     * success toast, and the setting was silently discarded.
     *
     * That is precisely the class of silent failure this pass exists to remove,
     * and it is worse here than elsewhere: settings are the thing an
     * administrator changes once and then trusts for months.
     *
     * `touched` is set by each of the branches above that actually wrote
     * something, so this cannot drift from what they do.
     */
    if (!touched) {
      return error(
        'Nothing in that request could be saved. Organization fields go at the ' +
        'top level; policy documents go inside "settings".',
        422, 'NOTHING_TO_UPDATE',
      );
    }

    const { data } = await ctx.supabase
      .from('organizations').select('*').eq('id', ctx.org.organizationId).maybeSingle();

    return success({ organization: data });
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

// The settings screen sends PUT for a partial update of the settings list.
export { PATCH as PUT };
