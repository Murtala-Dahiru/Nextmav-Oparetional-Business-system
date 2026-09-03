import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { PAY_COMPONENT_KINDS } from '@/lib/hr';

const SELECT =
  '*, member:organization_members!compensation_components_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/**
 * Recurring allowances and deductions attached to a person.
 *
 * Separate from the base salary because they change independently of it: a
 * transport allowance is granted and withdrawn without anybody's salary moving,
 * and folding it into `base_amount` loses both the reason and the ability to
 * stop it.
 *
 * Two shapes only - a fixed amount or a percentage of base. Anything more
 * elaborate is a ruleset step, which applies to everybody, rather than a
 * per-person component.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('compensation_components').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);

  /* In force today, which is what a payroll run reads and what a profile
     shows. The history is `?include=all`. */
  if (searchParams.get('include') !== 'all') {
    const today = new Date().toISOString().slice(0, 10);
    q = q.lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`);
  }

  const { data, error: e } = await q
    .order('effective_from', { ascending: false }).limit(500);

  if (e) return pgError(e);
  return success(data ?? []);
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.member_id) return error('An employee is required', 422, 'VALIDATION_ERROR');

    const label = String(b.label ?? '').trim();
    if (!label) return error('A label is required', 422, 'VALIDATION_ERROR');

    /**
     * The code is what a payslip line is keyed on and what a ruleset step can
     * name as its basis, so it is normalised rather than taken as typed:
     * "Transport allowance" and "transport_allowance" must not be two things.
     */
    const code = String(b.code ?? label).trim().toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
    if (!code) return error('A code is required', 422, 'VALIDATION_ERROR');

    const kind = String(b.kind ?? 'earning');
    if (!(PAY_COMPONENT_KINDS as readonly string[]).includes(kind)) {
      return error(`Kind must be one of: ${PAY_COMPONENT_KINDS.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const calculation = String(b.calculation ?? 'fixed');
    if (!['fixed', 'percent_of_base'].includes(calculation)) {
      return error('A component is either a fixed amount or a percentage of base.', 422, 'VALIDATION_ERROR');
    }

    const amount = calculation === 'fixed' ? Number(b.amount) : null;
    const rate = calculation === 'percent_of_base' ? Number(b.rate) : null;

    if (calculation === 'fixed' && (!Number.isFinite(amount!) || amount! < 0)) {
      return error('A fixed component needs an amount of zero or more.', 422, 'VALIDATION_ERROR');
    }
    if (calculation === 'percent_of_base' && (!Number.isFinite(rate!) || rate! < 0 || rate! > 10)) {
      return error(
        'A percentage is a fraction: 0.25 for 25%. The column refuses anything above 10.',
        422, 'VALIDATION_ERROR',
      );
    }

    const { data, error: e } = await ctx.supabase
      .from('compensation_components')
      .insert({
        organization_id: ctx.org.organizationId,
        member_id: b.member_id,
        code,
        label,
        kind,
        calculation,
        amount,
        rate,
        is_taxable: b.is_taxable !== false,
        effective_from: b.effective_from || undefined,
        effective_to: b.effective_to || null,
        note: b.note ?? '',
        recorded_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the component');
  }
}
