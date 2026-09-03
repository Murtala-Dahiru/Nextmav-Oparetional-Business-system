import { authorize, pgError } from '@/lib/auth-context';
import { paginated } from '@/lib/api-response';
import { isFilterValue } from '@/lib/filters';

/**
 * What was changed on the register, and why.
 *
 * ── Why this is a read of its own ────────────────────────────────────────
 *
 * A corrected attendance record used to carry three columns saying *that* it
 * had been corrected — `adjusted_by`, `adjusted_at`, `adjustment_reason` —
 * while the times it replaced were overwritten in place. So the register could
 * say "this Tuesday was changed by Ada, because 'forgot to clock out'", and
 * nothing anywhere could say what it had been before. `attendance_adjustments`
 * (0046) keeps both sides, and this is how a screen reads them.
 *
 * ── Who may see it ──────────────────────────────────────────────────────
 *
 * Nothing here filters by person, deliberately. The table's SELECT policy is
 * `member_id = ANY (auth_visible_member_ids(organization_id))` — the same
 * function that bounds the register itself — so an employee resolves their own
 * corrections, a manager their department's, HR the organisation's. Repeating
 * that as a `.eq()` here would be a second copy of the rule, and the copy is
 * the one that goes stale.
 *
 * That an employee can read their own is the point rather than a side effect:
 * a correction history only management can see is a management convenience,
 * not an assurance to the person whose day was rewritten.
 */

const SELECT = `
  id, attendance_id, member_id, work_date, reason, created_at,
  previous_status, previous_checked_in_at, previous_checked_out_at, previous_worked_minutes,
  new_status, new_checked_in_at, new_checked_out_at, new_worked_minutes,
  adjusted_by,
  adjuster:organization_members!attendance_adjustments_adjusted_by_fkey(
    id, profiles!organization_members_user_id_fkey(full_name, avatar_url)
  ),
  member:organization_members!attendance_adjustments_member_id_fkey(
    id, profiles!organization_members_user_id_fkey(full_name, avatar_url)
  )
`;

export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize')) || 50));

  let q = ctx.supabase
    .from('attendance_adjustments')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  /* Narrowing, not authorising — RLS has already decided what is reachable. */
  const recordId = searchParams.get('attendanceId');
  if (isFilterValue(recordId)) q = q.eq('attendance_id', recordId);
  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);
  const from = searchParams.get('from');
  if (isFilterValue(from)) q = q.gte('work_date', from);
  const to = searchParams.get('to');
  if (isFilterValue(to)) q = q.lte('work_date', to);

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}
