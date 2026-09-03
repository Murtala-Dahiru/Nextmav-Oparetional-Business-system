import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { describeRuleset } from '@/lib/payroll';

const SELECT =
  '*, ruleset:payroll_rulesets(id, name, country_code, currency, rules, ' +
  'is_statutory_complete, statutory_note), ' +
  'approver:organization_members!payroll_periods_approved_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name))';

/**
 * Pay runs.
 *
 * HR sees every period. An employee sees only the paid ones they are in, which
 * is the header on their own payslip - `payroll_periods_select` decides that,
 * not this handler.
 *
 * Each row carries the ruleset's `verdict`: whether these figures can be
 * printed without a caveat. It travels with the period rather than being
 * fetched separately, because a screen that has to remember to ask is a screen
 * that will one day render a total with no warning attached.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('payroll_periods').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const status = searchParams.get('status');
  if (isFilterValue(status)) q = q.eq('status', status);

  const { data, error: e } = await q
    .order('period_start', { ascending: false }).limit(60);

  if (e) return pgError(e);

  return success((data ?? []).map((p: any) => ({
    ...p,
    verdict: p.ruleset
      ? describeRuleset({
          id: p.ruleset.id, name: p.ruleset.name, countryCode: p.ruleset.country_code,
          currency: p.ruleset.currency, isStatutoryComplete: p.ruleset.is_statutory_complete,
          statutoryNote: p.ruleset.statutory_note ?? '', rules: p.ruleset.rules ?? { steps: [] },
        })
      : describeRuleset(null),
  })));
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const name = String(b.name ?? '').trim();
    if (!name) return error('A pay run needs a name, such as "March 2026".', 422, 'VALIDATION_ERROR');

    if (!b.period_start || !b.period_end) {
      return error('A pay run covers a period, so it needs a start and an end.', 422, 'VALIDATION_ERROR');
    }
    if (b.period_end < b.period_start) {
      return error('A period cannot end before it starts.', 422, 'VALIDATION_ERROR');
    }

    const periodsPerYear = Number(b.periods_per_year ?? 12);
    if (!Number.isInteger(periodsPerYear) || periodsPerYear < 1 || periodsPerYear > 366) {
      return error(
        'How many pay periods there are in a year - 12 for monthly, 52 for weekly. ' +
        'Annualised tax bands are divided by it, so it is not decoration.',
        422, 'VALIDATION_ERROR',
      );
    }

    /**
     * The ruleset defaults to the organisation's only active one.
     *
     * Not to "the first one alphabetically": an organisation with two active
     * rulesets is one that operates in two jurisdictions, and silently picking
     * either would be the single most expensive default in this module.
     */
    let rulesetId = b.ruleset_id || null;
    if (!rulesetId) {
      const { data: active } = await ctx.supabase
        .from('payroll_rulesets').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('is_active', true);

      if ((active ?? []).length === 1) rulesetId = active![0].id;
      else if ((active ?? []).length > 1) {
        return error(
          'This organisation has more than one active payroll ruleset. Say which one this run uses.',
          422, 'RULESET_AMBIGUOUS',
        );
      }
    }

    const { data, error: e } = await ctx.supabase
      .from('payroll_periods')
      .insert({
        organization_id: ctx.org.organizationId,
        name,
        period_start: b.period_start,
        period_end: b.period_end,
        pay_date: b.pay_date || b.period_end,
        ruleset_id: rulesetId,
        currency: b.currency || ctx.org.currency,
        periods_per_year: periodsPerYear,
        notes: b.notes ?? '',
        created_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not create the pay run');
  }
}
