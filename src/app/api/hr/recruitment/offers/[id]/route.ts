import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { OFFER_STATUSES, EMPLOYMENT_TYPES, PAY_PERIODS } from '@/lib/hr';

const SELECT =
  '*, application:job_applications(id, stage, status, ' +
  'candidate:candidates(id, full_name, email), ' +
  'opening:job_openings(id, title, reference)), ' +
  'department:departments(id, name), ' +
  'manager:organization_members!job_offers_manager_id_fkey(id, profiles!organization_members_user_id_fkey(full_name)), ' +
  'approver:organization_members!job_offers_approved_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))';

type Params = { params: Promise<{ id: string }> };

/**
 * `accepted` is deliberately not settable here.
 *
 * An offer becomes accepted when the hire completes, because accepting one
 * without creating the colleague leaves a pipeline that says somebody joined
 * and a directory that has never heard of them. `complete_hire()` sets it, in
 * the same transaction that closes the application.
 */
const SETTABLE: readonly string[] = OFFER_STATUSES.filter(s => s !== 'accepted');

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('job_offers').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of [
      'job_title', 'department_id', 'manager_id', 'start_on',
      'notes', 'expires_on', 'document_file_id', 'decline_reason',
    ]) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if ('job_title' in update && !String(update.job_title ?? '').trim()) {
      return error('An offer must name the job', 422, 'VALIDATION_ERROR');
    }
    for (const k of ['notes', 'decline_reason']) {
      if (k in update && update[k] === null) update[k] = '';
    }

    if ('employment_type' in b) {
      if (!(EMPLOYMENT_TYPES as readonly string[]).includes(String(b.employment_type))) {
        return error(`Employment type must be one of: ${EMPLOYMENT_TYPES.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.employment_type = b.employment_type;
    }
    if ('pay_period' in b) {
      if (!(PAY_PERIODS as readonly string[]).includes(String(b.pay_period))) {
        return error(`Pay period must be one of: ${PAY_PERIODS.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.pay_period = b.pay_period;
    }
    if ('base_amount' in b) {
      const amount = b.base_amount === '' || b.base_amount === null ? null : Number(b.base_amount);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        return error('A salary cannot be negative.', 422, 'VALIDATION_ERROR');
      }
      update.base_amount = amount;
    }
    if ('probation_months' in b) {
      update.probation_months = b.probation_months === '' || b.probation_months === null
        ? null : Number(b.probation_months);
    }
    if ('currency' in b && b.currency) update.currency = b.currency;

    if ('status' in b) {
      const status = String(b.status);
      if (!SETTABLE.includes(status)) {
        return error(
          status === 'accepted'
            ? 'An offer is accepted by completing the hire, which also creates the account.'
            : `Status must be one of: ${SETTABLE.join(', ')}.`,
          422, 'VALIDATION_ERROR',
        );
      }
      /* A declined offer with no reason tells the next person reading this
         pipeline nothing, and "why did they say no" is the question a hiring
         post-mortem is entirely made of. */
      if (status === 'declined' && !String(b.decline_reason ?? '').trim()) {
        return error('Say why the offer was declined.', 422, 'REASON_REQUIRED');
      }
      update.status = status;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('job_offers').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    /* `stamp_offer()` raises when an offer is sent before it is approved; the
       message it carries is written for the person reading it. */
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

  const { data: existing } = await ctx.supabase
    .from('job_offers').select('status')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');

  /* An offer somebody was shown is a commitment the company made, and deleting
     it removes the only record of what was on the table. Withdrawing is the
     action, and it keeps the row. */
  if (existing.status !== 'draft') {
    return error(
      'This offer has left draft, so it is part of the record. Withdraw it instead.',
      409, 'OFFER_ISSUED',
    );
  }

  const { error: e } = await ctx.supabase
    .from('job_offers').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
