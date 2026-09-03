import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { PAY_PERIODS, COMP_CHANGE_REASONS } from '@/lib/hr';

const SELECT =
  '*, member:organization_members!compensation_records_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url), ' +
  'department:departments!organization_members_department_id_fkey(id, name)), ' +
  'approver:organization_members!compensation_records_approved_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name))';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Compensation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Effective-dated and never overwritten: a pay rise is a new row with a start
 * date, and `close_previous_compensation()` closes the one it supersedes. "What
 * was she earning in March" is the question a payroll dispute turns on, and a
 * mutable `salary` column cannot answer it.
 *
 * ── Who reads this ───────────────────────────────────────────────────────
 *
 * `compensation_records_select` is owner, administrator and HR - plus you, for
 * your own. Deliberately *not* `auth_visible_member_ids()`, which would hand a
 * department head their whole team's salaries: that function answers "whose
 * records may I see", and a manager's answer is right for attendance and wrong
 * for pay.
 *
 * The endpoint asks for `hr.view` because an employee reading their own is the
 * ordinary case. Every write below asks for `manage`, which no manager holds.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('compensation_records').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);

  /* The current picture is one row per person; the history is every row. */
  if (searchParams.get('current') === 'true') q = q.is('effective_to', null);

  const { data, error: e } = await q
    .order('effective_from', { ascending: false }).limit(500);

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Record a pay decision.
 *
 * Not an edit of the previous one. The trigger closes the predecessor the day
 * before this one starts and writes a `compensation_change` employment event -
 * which carries the date and the reason and deliberately *not* the amount,
 * because that event is readable by anybody who can see the person's records,
 * including their manager.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.member_id) return error('An employee is required', 422, 'VALIDATION_ERROR');

    const amount = Number(b.base_amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return error('A base amount is required and cannot be negative.', 422, 'VALIDATION_ERROR');
    }

    const payPeriod = String(b.pay_period ?? 'monthly');
    if (!(PAY_PERIODS as readonly string[]).includes(payPeriod)) {
      return error(`Pay period must be one of: ${PAY_PERIODS.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const reason = String(b.change_reason ?? 'other');
    if (!(COMP_CHANGE_REASONS as readonly string[]).includes(reason)) {
      return error(`Reason must be one of: ${COMP_CHANGE_REASONS.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('compensation_records')
      .insert({
        organization_id: ctx.org.organizationId,
        member_id: b.member_id,
        effective_from: b.effective_from || undefined,
        base_amount: amount,
        currency: b.currency || ctx.org.currency,
        pay_period: payPeriod,
        change_reason: reason,
        note: b.note ?? '',
        approved_by: b.approved_by || ctx.org.memberId,
        recorded_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    /* The unique key on (member, effective_from) is what refuses two decisions
       on the same day - which is a correction, not two facts. */
    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not record the compensation');
  }
}
