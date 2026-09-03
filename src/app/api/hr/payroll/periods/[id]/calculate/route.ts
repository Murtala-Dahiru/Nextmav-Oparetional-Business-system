import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { computePayroll, amountForPeriod, describeRuleset } from '@/lib/payroll';

type Params = { params: Promise<{ id: string }> };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Run the payroll.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reads every employee who should be in this period, resolves the compensation
 * and allowances that were in force *on the pay date*, evaluates the ruleset,
 * and writes an item and its lines for each of them.
 *
 * ── The three things this is careful about ───────────────────────────────
 *
 * **It reads the compensation in force at the time, not the current one.** A
 * run for March, calculated in April, must use what the person was earning in
 * March - which is exactly what an effective-dated table is for, and exactly
 * what a `SELECT ... ORDER BY created_at DESC LIMIT 1` would get wrong.
 *
 * **It freezes its workings.** `payroll_items.workings` records the inputs and
 * the totals as they were. The compensation row can be superseded, the ruleset
 * can be edited and the allowances can be withdrawn, and the payslip still
 * explains itself a year later.
 *
 * **It refuses to touch an approved run.** The database refuses too - the
 * `guard_frozen_payroll_rows` trigger - and this check exists to say so in a
 * sentence rather than as a constraint violation.
 *
 * ── Who is in a run ──────────────────────────────────────────────────────
 *
 * Everybody active on the pay date who has a compensation record covering it.
 * Somebody with no compensation recorded is *excluded and reported*, not paid
 * zero: a payslip for nothing is worse than an absence, because it looks like
 * a decision.
 */
export async function POST(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const org = ctx.org.organizationId;

    const { data: period, error: pe } = await ctx.supabase
      .from('payroll_periods')
      .select('*, ruleset:payroll_rulesets(id, name, country_code, currency, rules, is_statutory_complete, statutory_note)')
      .eq('organization_id', org).eq('id', id)
      .maybeSingle();

    if (pe) return pgError(pe);
    if (!period) return error('Not found', 404, 'NOT_FOUND');

    if (['approved', 'paid'].includes(period.status)) {
      return error(
        'This run has been approved and its figures are final. Cancel it and create a new run to change anything.',
        409, 'PAYROLL_FROZEN',
      );
    }

    const asOf: string = period.pay_date;

    /**
     * Who is paid.
     *
     * `former` is excluded, but `notice_period` and `offboarding` are not -
     * somebody working their notice is owed their salary, and a payroll that
     * drops them the day they resign is the most consequential bug this module
     * could have.
     */
    const { data: people, error: me } = await ctx.supabase
      .from('v_hr_people')
      .select('member_id, full_name, employment_type, lifecycle_stage, hired_on, terminated_on')
      .eq('organization_id', org)
      .neq('lifecycle_stage', 'former')
      .eq('is_active', true);

    if (me) return pgError(me);

    const [compRes, componentRes] = await Promise.all([
      ctx.supabase.from('compensation_records')
        .select('member_id, base_amount, currency, pay_period, effective_from, effective_to')
        .eq('organization_id', org)
        .lte('effective_from', asOf)
        .or(`effective_to.is.null,effective_to.gte.${asOf}`),
      ctx.supabase.from('compensation_components')
        .select('member_id, code, label, kind, calculation, amount, rate, is_taxable, effective_from, effective_to')
        .eq('organization_id', org)
        .lte('effective_from', asOf)
        .or(`effective_to.is.null,effective_to.gte.${asOf}`),
    ]);

    if (compRes.error) return pgError(compRes.error);

    const compByMember = new Map<string, any>();
    for (const c of compRes.data ?? []) {
      /* One row per person after the date filter, unless history overlaps -
         which the closing trigger prevents. Latest start wins if it ever does. */
      const held = compByMember.get(c.member_id);
      if (!held || c.effective_from > held.effective_from) compByMember.set(c.member_id, c);
    }

    const componentsByMember = new Map<string, any[]>();
    for (const c of componentRes.data ?? []) {
      const list = componentsByMember.get(c.member_id);
      if (list) list.push(c);
      else componentsByMember.set(c.member_id, [c]);
    }

    const rules = (period.ruleset?.rules ?? { steps: [] }) as any;
    const periodsPerYear = period.periods_per_year ?? 12;

    /* A recalculation replaces the previous attempt rather than adding to it.
       The delete cascades to `payroll_lines`. */
    const { error: de } = await ctx.supabase
      .from('payroll_items').delete().eq('period_id', id);
    if (de) return pgError(de);

    const excluded: Array<{ memberId: string; name: string; reason: string }> = [];
    let written = 0;

    for (const person of people ?? []) {
      const comp = compByMember.get(person.member_id);

      if (!comp) {
        excluded.push({
          memberId: person.member_id,
          name: person.full_name,
          reason: 'No compensation recorded covering the pay date',
        });
        continue;
      }

      /**
       * A different currency is an exclusion, not a conversion.
       *
       * Converting would need a rate, a source and a date, none of which this
       * product has. Paying somebody in the run's currency at a number computed
       * from another one is the kind of silent error that reaches a bank.
       */
      if (comp.currency && period.currency && comp.currency !== period.currency) {
        excluded.push({
          memberId: person.member_id,
          name: person.full_name,
          reason: `Paid in ${comp.currency}, and this run is in ${period.currency}`,
        });
        continue;
      }

      const basePerPeriod = amountForPeriod(
        Number(comp.base_amount), comp.pay_period, periodsPerYear,
      );

      const components = (componentsByMember.get(person.member_id) ?? []).map((c: any) => ({
        code: c.code,
        label: c.label,
        kind: c.kind,
        calculation: c.calculation,
        amount: c.amount === null ? null : Number(c.amount),
        rate: c.rate === null ? null : Number(c.rate),
        isTaxable: c.is_taxable,
      }));

      const result = computePayroll({
        basePerPeriod,
        employmentType: person.employment_type,
        components,
        periodsPerYear,
        rules,
      });

      const { data: item, error: ie } = await ctx.supabase
        .from('payroll_items')
        .insert({
          organization_id: org,
          period_id: id,
          member_id: person.member_id,
          base_amount: result.base,
          gross: result.gross,
          taxable_gross: result.taxableGross,
          total_deductions: result.totalDeductions,
          net: result.net,
          employer_cost: result.employerCost,
          currency: period.currency,
          workings: {
            /* Everything the calculation was given, frozen beside what it
               decided. This is what makes the payslip defensible later. */
            asOf,
            contract: {
              amount: Number(comp.base_amount),
              payPeriod: comp.pay_period,
              currency: comp.currency,
              effectiveFrom: comp.effective_from,
            },
            periodsPerYear,
            rulesetId: period.ruleset?.id ?? null,
            rulesetName: period.ruleset?.name ?? null,
            isStatutoryComplete: period.ruleset?.is_statutory_complete ?? false,
            components,
            skipped: result.skipped,
          },
        })
        .select('id')
        .single();

      if (ie) return pgError(ie);

      const lines = result.lines.map(l => ({
        organization_id: org,
        item_id: item.id,
        code: l.code,
        label: l.label,
        kind: l.kind,
        amount: l.amount,
        source: l.source,
        explanation: l.explanation,
        sequence: l.sequence,
      }));

      if (lines.length) {
        const { error: le } = await ctx.supabase.from('payroll_lines').insert(lines);
        if (le) return pgError(le);
      }
      written++;
    }

    const { data: updated, error: ue } = await ctx.supabase
      .from('payroll_periods')
      .update({ status: 'calculated' })
      .eq('organization_id', org).eq('id', id)
      .select('*, ruleset:payroll_rulesets(id, name, country_code, currency, rules, is_statutory_complete, statutory_note)')
      .maybeSingle();

    if (ue) return pgError(ue);

    return success({
      period: updated,
      calculated: written,
      /**
       * Reported rather than hidden.
       *
       * Somebody with no compensation record is almost always the finding that
       * matters most in a pay run, and a screen that shows "37 employees" with
       * no mention of the two who were dropped is how a person misses a
       * payslip.
       */
      excluded,
      verdict: period.ruleset
        ? describeRuleset({
            id: period.ruleset.id, name: period.ruleset.name,
            countryCode: period.ruleset.country_code, currency: period.ruleset.currency,
            isStatutoryComplete: period.ruleset.is_statutory_complete,
            statutoryNote: period.ruleset.statutory_note ?? '',
            rules: period.ruleset.rules ?? { steps: [] },
          })
        : describeRuleset(null),
    });
  } catch (e: any) {
    return serverError(e, 'Could not calculate the pay run');
  }
}
