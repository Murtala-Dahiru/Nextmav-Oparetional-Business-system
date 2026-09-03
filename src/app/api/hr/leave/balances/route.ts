import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { LEAVE_TYPES } from '@/lib/constants';
import { todayIn } from '@/lib/org-time';

const SELECT =
  '*, member:organization_members!leave_balances_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url), ' +
  'department:departments(id, name))';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Leave balances.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `leave_balances` has existed since migration 0003 with entitlement, days
 * used and days carried over, and until now **no endpoint has ever read or
 * written it**. The leave screen offered a request form with no indication of
 * whether the person had any days left, and HR had no way to say how many they
 * were entitled to. That is this repository's dominant defect - complete
 * machinery nothing calls - in the place an employee notices first.
 *
 * Visibility is the table's own policy, which resolves through
 * `auth_visible_member_ids()`: your own, your department's if you manage it,
 * everybody's if you are HR.
 *
 * ── `used_days` is a stored figure, and that is a decision ───────────────
 *
 * It could be derived by summing approved requests, and derivation is the rule
 * this codebase follows for performance figures. Leave is the exception on
 * purpose: an entitlement year opens with a carried-over balance that is not
 * derivable from any request, half-days and public holidays make the
 * arithmetic policy rather than counting, and a company that corrects somebody
 * mid-year needs the correction to stick. So the column is authoritative and
 * this endpoint reports what approved leave *implies* beside it, rather than
 * silently overwriting - two numbers that disagree are a conversation, and one
 * number quietly recomputed is a dispute.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get('year')) || Number(todayIn(ctx.org.timezone).slice(0, 4));

  let q = ctx.supabase
    .from('leave_balances').select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .eq('year', year);

  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);

  const { data, error: e } = await q.order('type');
  if (e) return pgError(e);

  /**
   * What approved leave in this year adds up to, per person and type.
   *
   * Reported beside `used_days` rather than instead of it. Where they differ
   * the screen says so - a mid-year correction, a request approved before the
   * balance was set up, or a genuine bookkeeping error, and HR is the one who
   * can tell which.
   */
  const { data: taken } = await ctx.supabase
    .from('leave_requests')
    .select('member_id, type, days_requested, start_date, is_half_day, end_date')
    .eq('organization_id', ctx.org.organizationId)
    .eq('status', 'approved')
    .gte('start_date', `${year}-01-01`)
    .lte('start_date', `${year}-12-31`);

  const impliedBy = new Map<string, number>();
  for (const r of taken ?? []) {
    const key = `${r.member_id}:${r.type}`;
    /**
     * `days_requested` defaults to zero and nothing has ever written it, so
     * the span is counted from the dates when it is missing. Both columns are
     * `date`, so parsing them as UTC midnight is exact - this is a difference
     * between two calendar days, not an instant.
     */
    const stored = Number(r.days_requested ?? 0);
    const span = stored > 0
      ? stored
      : (r.is_half_day
          ? 0.5
          : Math.round(
              (Date.parse(`${r.end_date}T00:00:00Z`) - Date.parse(`${r.start_date}T00:00:00Z`))
              / 86_400_000,
            ) + 1);
    impliedBy.set(key, (impliedBy.get(key) ?? 0) + span);
  }

  return success({
    year,
    balances: (data ?? []).map((b: any) => {
      const entitled = Number(b.entitled_days) + Number(b.carried_days);
      const used = Number(b.used_days);
      const implied = impliedBy.get(`${b.member_id}:${b.type}`) ?? 0;
      return {
        ...b,
        total_days: entitled,
        remaining_days: Math.max(0, entitled - used),
        implied_used_days: implied,
        /* True when the record and the approved requests disagree - which is
           information, not an error, and is drawn as a note rather than a
           warning triangle. */
        needs_reconciliation: Math.abs(implied - used) > 0.001,
      };
    }),
  });
}

/**
 * Set or adjust an entitlement.
 *
 * An upsert on (member, type, year), which is the table's own unique key: a
 * balance is one fact per person per type per year, and "create or update" is
 * the only operation HR ever performs on it.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.member_id) return error('An employee is required', 422, 'VALIDATION_ERROR');

    const type = String(b.type ?? '');
    if (!(LEAVE_TYPES as readonly string[]).includes(type)) {
      return error(`Leave type must be one of: ${LEAVE_TYPES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const year = Number(b.year) || Number(todayIn(ctx.org.timezone).slice(0, 4));

    const numeric = (v: unknown, label: string) => {
      const n = Number(v ?? 0);
      if (!Number.isFinite(n) || n < 0) return { error: `${label} cannot be negative.` };
      return { value: Math.round(n * 100) / 100 };
    };

    const entitled = numeric(b.entitled_days, 'Entitled days');
    const used = numeric(b.used_days, 'Used days');
    const carried = numeric(b.carried_days, 'Carried days');
    for (const f of [entitled, used, carried]) {
      if ('error' in f && f.error) return error(f.error, 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('leave_balances')
      .upsert(
        {
          organization_id: ctx.org.organizationId,
          member_id: b.member_id,
          type,
          year,
          entitled_days: entitled.value,
          used_days: used.value,
          carried_days: carried.value,
        },
        { onConflict: 'member_id,type,year' },
      )
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not save the balance');
  }
}
