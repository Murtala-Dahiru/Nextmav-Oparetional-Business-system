import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * Organization settings.
 *
 * Returns the organization row (working hours, timezone, currency, branding)
 * together with the key/value settings that do not warrant their own columns.
 * The working-hours fields are not cosmetic: `work_start`, `grace_minutes` and
 * `break_minutes` are what the attendance functions classify late arrivals and
 * compute worked time against, so changing them changes the register.
 */
export async function GET() {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const [orgRes, settingsRes, deptRes] = await Promise.all([
    ctx.supabase.from('organizations').select('*').eq('id', ctx.org.organizationId).maybeSingle(),
    ctx.supabase.from('org_settings').select('key, value').eq('organization_id', ctx.org.organizationId),
    ctx.supabase.from('departments').select('id, name, description, parent_id, head_id')
      .eq('organization_id', ctx.org.organizationId).is('deleted_at', null).order('name'),
  ]);

  if (orgRes.error) return pgError(orgRes.error);
  if (!orgRes.data) return error('Not found', 404, 'NOT_FOUND');

  const settings = (settingsRes.data ?? []).reduce<Record<string, any>>((acc, row: any) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  return success({
    organization: orgRes.data,
    settings,
    departments: deptRes.data ?? [],
  });
}

/**
 * Update settings.
 *
 * Organization columns and key/value settings are updated in one call because
 * they appear as one form. Restricted to admins by RLS; the explicit role
 * check turns a silent no-op into a clear 403.
 */
export async function PATCH(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const orgUpdate: Record<string, any> = {};
    for (const k of [
      'name', 'logo_url', 'website', 'industry', 'timezone',
      'work_start', 'work_end', 'work_days', 'grace_minutes', 'break_minutes', 'currency',
    ]) {
      if (k in b) orgUpdate[k] = b[k];
    }

    if (Object.keys(orgUpdate).length) {
      const { error: e } = await ctx.supabase
        .from('organizations').update(orgUpdate).eq('id', ctx.org.organizationId);
      if (e) return pgError(e);
    }

    if (b.settings && typeof b.settings === 'object') {
      const rows = Object.entries(b.settings).map(([key, value]) => ({
        organization_id: ctx.org.organizationId,
        key,
        value,
        updated_at: new Date().toISOString(),
      }));
      if (rows.length) {
        const { error: e } = await ctx.supabase
          .from('org_settings').upsert(rows, { onConflict: 'organization_id,key' });
        if (e) return pgError(e);
      }
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
