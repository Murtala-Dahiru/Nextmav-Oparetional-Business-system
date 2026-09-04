import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What an approved pay run owes — the seam Finance reads
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The contract ─────────────────────────────────────────────────────────
 *
 *  This is the only payroll endpoint a finance role can usefully call, and it
 *  is deliberately the only one they need. It returns a run split three ways —
 *  net pay owed to employees, deductions withheld and owed to third parties,
 *  and the employer's own contributions — optionally broken down by cost
 *  centre, and **aggregated so that no individual's pay is derivable from it**.
 *
 *  Everything else in payroll stays behind `can_see_compensation()`. That is
 *  the boundary migration 0042 drew and 0049 kept: Finance learns what the
 *  month costs and what it owes to whom, and learns nothing about any
 *  particular person.
 *
 *  ── What this endpoint does not do ───────────────────────────────────────
 *
 *  It does not write anything, anywhere. It does not create journal entries,
 *  it does not touch the Finance module's tables, and it does not know what an
 *  account is. Payroll states what it owes; accounting for that is Finance's
 *  and is not being rebuilt here.
 *
 *  The one row Finance already receives — a single approved expense carrying
 *  the total, created when a run is marked paid (0042) — is untouched. This
 *  explains that row; it does not replace it, and `expenseId` is returned so a
 *  reader can tell the two are about the same run.
 *
 *  ── Reconciliation is returned, not assumed ──────────────────────────────
 *
 *  `reconciles` compares the posting against the period's own stored totals.
 *  Both are derived from the same items, so they agree — until something has
 *  gone wrong, and the moment that matters is the moment somebody is filing a
 *  return from these numbers. A boundary that cannot say whether it balances
 *  is one that gets trusted right up until it should not have been.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const orgId = ctx.org.organizationId;

  const [{ data: period, error: pe }, { data: lines, error: le }] = await Promise.all([
    ctx.supabase
      .from('payroll_periods')
      .select('id, name, period_start, period_end, pay_date, status, currency, '
        + 'total_gross, total_deductions, total_net, total_employer_cost, '
        + 'employee_count, approved_at, paid_at, expense_id')
      .eq('organization_id', orgId).eq('id', id).maybeSingle(),

    ctx.supabase
      .from('payroll_postings')
      .select('category, owed_to, department_id, department_name, amount, currency, employee_count')
      .eq('organization_id', orgId).eq('period_id', id),
  ]);

  if (pe) return pgError(pe);
  if (le) return pgError(le);

  /**
   * A period this reader cannot see is reported as absent.
   *
   * `payroll_periods` is behind `can_see_compensation()`, so an employee
   * asking gets nothing back rather than a 403 — and being told "that pay run
   * exists but is not for you" is itself information about the company's
   * payroll calendar.
   */
  if (!period) return error('No such pay run.', 404, 'NOT_FOUND');

  /**
   * A run before approval has no posting, and that is not an error.
   *
   * It is answered with an explicit state so the screen can say "this run has
   * not been approved yet" rather than rendering an empty table, which reads
   * as a run that owes nothing.
   */
  if (!['approved', 'paid'].includes(period.status)) {
    return success({
      period: {
        id: period.id, name: period.name, status: period.status,
        payDate: period.pay_date, currency: period.currency,
      },
      posted: false,
      reason: period.status === 'cancelled'
        ? 'This run was cancelled, so it owes nothing.'
        : 'A run states what it owes once it has been approved.',
      categories: [], byDepartment: [], reconciles: null,
    });
  }

  const rows = (lines ?? []) as any[];
  const sum = (cat: string) => rows
    .filter(r => r.category === cat)
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);

  const netPay = sum('net_pay');
  const deductions = sum('employee_deductions');
  const employer = sum('employer_contributions');

  /**
   * Rounded to the currency's minor unit before comparing.
   *
   * Both sides are `numeric(14,2)` in Postgres and arrive as strings, so this
   * is guarding the JavaScript rather than the database — `0.1 + 0.2` is the
   * reason a comparison of two exact decimals can fail after they have been
   * through `Number()`.
   */
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

  const gross = Number(period.total_gross ?? 0);
  const storedNet = Number(period.total_net ?? 0);
  const storedDeductions = Number(period.total_deductions ?? 0);
  const storedEmployer = Number(period.total_employer_cost ?? 0);

  const departments = [...new Map(
    rows.map(r => [r.department_id ?? 'none', r.department_name]),
  )].map(([key, name]) => ({
    departmentId: key === 'none' ? null : key,
    department: name,
    netPay: rows.filter(r => (r.department_id ?? 'none') === key && r.category === 'net_pay')
      .reduce((s, r) => s + Number(r.amount ?? 0), 0),
    deductions: rows.filter(r => (r.department_id ?? 'none') === key && r.category === 'employee_deductions')
      .reduce((s, r) => s + Number(r.amount ?? 0), 0),
    employerContributions: rows.filter(r => (r.department_id ?? 'none') === key && r.category === 'employer_contributions')
      .reduce((s, r) => s + Number(r.amount ?? 0), 0),
    employees: Math.max(0, ...rows
      .filter(r => (r.department_id ?? 'none') === key)
      .map(r => Number(r.employee_count ?? 0))),
  })).sort((a, b) => a.department.localeCompare(b.department));

  return success({
    period: {
      id: period.id,
      name: period.name,
      status: period.status,
      periodStart: period.period_start,
      periodEnd: period.period_end,
      payDate: period.pay_date,
      currency: period.currency,
      employeeCount: period.employee_count,
      approvedAt: period.approved_at,
      paidAt: period.paid_at,
      /** The single row Finance already has for this run, if it has been paid. */
      expenseId: period.expense_id,
    },
    posted: true,

    /**
     * The three obligations, each with who ends up holding the money.
     *
     * Ordered by when they are usually settled rather than by size: net pay
     * leaves on the pay date, the rest is held and remitted later, and that
     * ordering is the one a person doing the paying reads down.
     */
    categories: [
      {
        category: 'net_pay',
        label: 'Net pay',
        owedTo: 'employees',
        amount: netPay,
        note: 'Leaves the account on the pay date.',
      },
      {
        category: 'employee_deductions',
        label: 'Withheld from pay',
        owedTo: 'third_parties',
        amount: deductions,
        note: 'Deducted from employees and owed onward — usually remitted after the pay date.',
      },
      {
        category: 'employer_contributions',
        label: 'Employer contributions',
        owedTo: 'third_parties',
        amount: employer,
        note: 'The company’s own cost, over and above gross pay.',
      },
    ],

    totals: {
      gross,
      netPay,
      deductions,
      employerContributions: employer,
      /** What the run costs the company in total: gross plus employer cost. */
      totalCost: gross + employer,
      /** What actually has to be moved: net now, the rest when it is due. */
      dueToEmployees: netPay,
      dueToThirdParties: deductions + employer,
      currency: period.currency,
    },

    byDepartment: departments,

    /**
     * Whether the split adds up to the run it came from.
     *
     * `grossHolds` is the arithmetic identity payroll rests on — net plus what
     * was withheld is the gross. If that ever fails, the posting is wrong and
     * so is the payslip, and a finance team must not find out by filing it.
     */
    reconciles: {
      netMatchesPeriod: near(netPay, storedNet),
      deductionsMatchPeriod: near(deductions, storedDeductions),
      employerMatchesPeriod: near(employer, storedEmployer),
      grossHolds: near(netPay + deductions, gross),
      /**
       * Held people are excluded from the posting but counted by the period,
       * so the two legitimately disagree when somebody is on hold. Saying so
       * here stops that reading as a fault.
       */
      note: 'Held items are excluded from the posting and included in the period totals, '
        + 'so a run with anybody on hold will not reconcile until they are paid.',
    },
  });
}
