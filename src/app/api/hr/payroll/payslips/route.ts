import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { isFilterValue } from '@/lib/filters';

/**
 * Payslips - a person's own pay, in the one place they may read it.
 *
 * `payroll_items_select` admits an employee to their own item, and only once
 * the run is `paid`. A draft run is a working document in which somebody's pay
 * may be wrong for an afternoon, and the person seeing that figure cannot
 * unsee it.
 *
 * ── Why this exists beside the period endpoint ───────────────────────────
 *
 * `/api/hr/payroll/periods/[id]` returns a run and everybody in it, which an
 * employee's client would be refused for wholesale. This asks the question an
 * employee actually has - what have I been paid - and the same policy answers
 * it. HR can ask it about somebody else with `?memberId=`, which is how a pay
 * query at the case desk gets resolved without opening the whole run.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get('memberId');
  const memberId = isFilterValue(requested) ? requested : ctx.org.memberId;

  const { data, error: e } = await ctx.supabase
    .from('payroll_items')
    .select(
      '*, lines:payroll_lines(*), ' +
      'period:payroll_periods!inner(id, name, period_start, period_end, pay_date, status, currency)',
    )
    .eq('organization_id', ctx.org.organizationId)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(36);

  if (e) return pgError(e);

  return success((data ?? []).map((i: any) => ({
    ...i,
    lines: (i.lines ?? []).sort((a: any, b: any) => a.sequence - b.sequence),
  })));
}
