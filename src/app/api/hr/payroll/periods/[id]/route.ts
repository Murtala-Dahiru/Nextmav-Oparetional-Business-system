import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { describeRuleset } from '@/lib/payroll';
import { PAYROLL_NEXT, type PayrollRunStatus } from '@/lib/hr';

const SELECT =
  '*, ruleset:payroll_rulesets(id, name, country_code, currency, rules, ' +
  'is_statutory_complete, statutory_note), ' +
  'approver:organization_members!payroll_periods_approved_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name))';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('payroll_periods').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  const period = data as any;

  const { data: items } = await ctx.supabase
    .from('payroll_items')
    .select(
      '*, member:organization_members!payroll_items_member_id_fkey(id, employment_type, ' +
      'profiles!organization_members_user_id_fkey(full_name, avatar_url), ' +
      'department:departments(id, name)), ' +
      'lines:payroll_lines(*)',
    )
    .eq('period_id', id)
    .order('created_at', { ascending: true });

  return success({
    ...period,
    items: ((items ?? []) as any[]).map((i: any) => ({
      ...i,
      lines: (i.lines ?? []).sort((a: any, b: any) => a.sequence - b.sequence),
    })),
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
}

/**
 * Move a run along, or edit one that has not been approved.
 *
 * The status ladder is `PAYROLL_NEXT` in `lib/hr` - the same rule the screen
 * reads to decide which buttons to draw, so a control that cannot work is not
 * offered. The database is still the boundary: `guard_frozen_payroll_period()`
 * refuses a write to an approved run whatever this file allows, and
 * `settle_payroll_period()` refuses `paid` before `approved`.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    const { data: existing } = await ctx.supabase
      .from('payroll_periods').select('status, employee_count')
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .maybeSingle();

    if (!existing) return error('Not found', 404, 'NOT_FOUND');

    const update: Record<string, any> = {};

    if ('status' in b) {
      const next = String(b.status) as PayrollRunStatus;
      const from = existing.status as PayrollRunStatus;

      if (!PAYROLL_NEXT[from]?.includes(next)) {
        return error(
          PAYROLL_NEXT[from]?.length
            ? `A ${from} run can move to: ${PAYROLL_NEXT[from].join(', ')}.`
            : `A ${from} run is final.`,
          409, 'INVALID_TRANSITION',
        );
      }

      /**
       * Approving an empty run.
       *
       * The totals would all be zero and the trigger would happily write a
       * zero expense into Finance. Refusing here because "approved, nobody
       * paid" is indistinguishable on a screen from "approved, everybody
       * paid nothing", and one of those is a bug worth catching.
       */
      if (next === 'approved' && (existing.employee_count ?? 0) === 0) {
        return error(
          'This run has nobody in it. Calculate it first, or check that anybody has compensation recorded.',
          409, 'EMPTY_RUN',
        );
      }

      update.status = next;
    }

    /* Editing the run itself is only possible before approval, and the
       database enforces that; these are the fields worth changing. */
    for (const k of ['name', 'pay_date', 'notes', 'ruleset_id', 'periods_per_year']) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if ('notes' in update && update.notes === null) update.notes = '';

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('payroll_periods').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  /* The delete policy already refuses an approved or paid run; this is the
     readable version of that refusal. */
  const { data: existing } = await ctx.supabase
    .from('payroll_periods').select('status')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');
  if (['approved', 'paid'].includes(existing.status)) {
    return error(
      'An approved pay run is a record of what people were paid and cannot be deleted. Cancel it instead.',
      409, 'PAYROLL_FROZEN',
    );
  }

  const { error: e } = await ctx.supabase
    .from('payroll_periods').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
