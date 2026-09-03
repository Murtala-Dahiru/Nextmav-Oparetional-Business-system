import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { EMPLOYMENT_TYPES, PAY_PERIODS } from '@/lib/hr';

const SELECT =
  '*, application:job_applications(id, stage, status, ' +
  'candidate:candidates(id, full_name, email), ' +
  'opening:job_openings(id, title, reference)), ' +
  'department:departments(id, name), ' +
  'manager:organization_members!job_offers_manager_id_fkey(id, profiles!organization_members_user_id_fkey(full_name)), ' +
  'approver:organization_members!job_offers_approved_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))';

/**
 * Offers.
 *
 * The only recruitment table carrying money, and therefore the only one whose
 * policy is a role list rather than involvement in the opening. A hiring
 * manager runs the interviews, reads the feedback and makes the
 * recommendation, and does not see what the company decided to pay - which is
 * why this lives in its own table rather than as four more columns on the
 * application.
 *
 * The endpoint does not restate that rule. `job_offers_select` refuses, and a
 * manager calling this gets an empty list, which is the correct answer to
 * "which offers may I see".
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('job_offers').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const applicationId = searchParams.get('applicationId');
  if (isFilterValue(applicationId)) q = q.eq('application_id', applicationId);
  const status = searchParams.get('status');
  if (isFilterValue(status)) q = q.eq('status', status);

  const { data, error: e } = await q.order('created_at', { ascending: false }).limit(200);
  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Draft an offer.
 *
 * `manage` rather than `create`: an offer is a financial commitment, and the
 * `hr` grant's `create` is what every employee holds so they can file their own
 * leave. Managers hold `view` and `approve` and not `manage`, so this is HR,
 * administrators and the owner.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.application_id) return error('An application is required', 422, 'VALIDATION_ERROR');

    const jobTitle = String(b.job_title ?? '').trim();
    if (!jobTitle) return error('An offer must name the job', 422, 'VALIDATION_ERROR');

    const employmentType = String(b.employment_type ?? 'full_time');
    if (!(EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)) {
      return error(`Employment type must be one of: ${EMPLOYMENT_TYPES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const payPeriod = String(b.pay_period ?? 'annual');
    if (!(PAY_PERIODS as readonly string[]).includes(payPeriod)) {
      return error(`Pay period must be one of: ${PAY_PERIODS.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const amount = b.base_amount === '' || b.base_amount === null || b.base_amount === undefined
      ? null : Number(b.base_amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return error('A salary cannot be negative.', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('job_offers')
      .insert({
        organization_id: ctx.org.organizationId,
        application_id: b.application_id,
        job_title: jobTitle,
        department_id: b.department_id || null,
        manager_id: b.manager_id || null,
        employment_type: employmentType,
        start_on: b.start_on || null,
        probation_months: b.probation_months === '' || b.probation_months == null
          ? null : Number(b.probation_months),
        base_amount: amount,
        /* The organisation's own currency unless the offer says otherwise -
           a number with no currency is the second-fastest way to pay somebody
           the wrong amount. */
        currency: b.currency || ctx.org.currency,
        pay_period: payPeriod,
        notes: b.notes ?? '',
        expires_on: b.expires_on || null,
        created_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not draft the offer');
  }
}
