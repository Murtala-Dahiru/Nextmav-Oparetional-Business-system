import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { validateRules, describeRuleset } from '@/lib/payroll';

const SELECT = '*';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('payroll_rulesets').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');

  return success({
    ...data,
    verdict: describeRuleset({
      id: data.id, name: data.name, countryCode: data.country_code,
      currency: data.currency, isStatutoryComplete: data.is_statutory_complete,
      statutoryNote: data.statutory_note ?? '', rules: data.rules ?? { steps: [] },
    }),
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('name' in b) {
      const name = String(b.name ?? '').trim();
      if (!name) return error('A ruleset needs a name', 422, 'VALIDATION_ERROR');
      update.name = name;
    }
    if ('country_code' in b) {
      update.country_code = String(b.country_code).toUpperCase().slice(0, 2);
    }
    if ('currency' in b && b.currency) update.currency = b.currency;
    if ('statutory_note' in b) update.statutory_note = b.statutory_note ?? '';
    if ('is_active' in b) update.is_active = b.is_active === true;

    if ('rules' in b) {
      const problems = validateRules(b.rules);
      if (problems.length) return error(problems.join(' '), 422, 'INVALID_RULES');
      update.rules = b.rules;
    }

    /**
     * Marking a ruleset statutory-complete.
     *
     * The one field in HR that changes what a screen is allowed to claim, so it
     * asks for something in return: a note saying against what. "Confirmed
     * against the Finance Act 2023" is a sentence somebody has to be willing to
     * write, and requiring it is the difference between a considered assertion
     * and a toggle that got flicked while tidying up.
     *
     * A ruleset with no steps can never be complete - it computes nothing, and
     * "these are the full statutory rules" would then be a claim that this
     * jurisdiction has none.
     */
    if ('is_statutory_complete' in b) {
      const claiming = b.is_statutory_complete === true;
      if (claiming) {
        const rules = update.rules ?? (await ctx.supabase
          .from('payroll_rulesets').select('rules')
          .eq('organization_id', ctx.org.organizationId).eq('id', id)
          .maybeSingle()).data?.rules;

        if (!rules?.steps?.length) {
          return error(
            'A ruleset with no steps applies no deductions, so it cannot be the full statutory rules for anywhere.',
            422, 'NO_STEPS',
          );
        }
        const note = String(b.statutory_note ?? update.statutory_note ?? '').trim();
        if (note.length < 10) {
          return error(
            'Say what these rules were checked against - the act, the circular or the date. ' +
            'That note is what every payroll screen shows beside the figures.',
            422, 'NOTE_REQUIRED',
          );
        }
        update.statutory_note = note;
      }
      update.is_statutory_complete = claiming;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('payroll_rulesets').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');

    return success({
      ...data,
      verdict: describeRuleset({
        id: data.id, name: data.name, countryCode: data.country_code,
        currency: data.currency, isStatutoryComplete: data.is_statutory_complete,
        statutoryNote: data.statutory_note ?? '', rules: data.rules ?? { steps: [] },
      }),
    });
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

/**
 * A ruleset a pay run has used cannot be removed.
 *
 * `payroll_periods.ruleset_id` is `ON DELETE RESTRICT`, deliberately: deleting
 * it would erase the stated reason a payslip said what it said. Deactivating is
 * the action, and it keeps the row.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { count } = await ctx.supabase
    .from('payroll_periods')
    .select('id', { count: 'exact', head: true })
    .eq('ruleset_id', id);

  if ((count ?? 0) > 0) {
    return error(
      'A pay run has been calculated with this ruleset, so it is the reason those payslips say what they say. Deactivate it instead.',
      409, 'RULESET_IN_USE',
    );
  }

  const { error: e } = await ctx.supabase
    .from('payroll_rulesets').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
