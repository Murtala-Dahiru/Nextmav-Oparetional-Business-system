import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { can } from '@/lib/permissions';

const SELECT =
  '*, member:organization_members!leave_requests_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), approver:organization_members!leave_requests_approved_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))';

const DECISIONS = ['approved', 'rejected', 'cancelled'];

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('leave_requests').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  // Hidden-by-RLS and does-not-exist are the same answer by design.
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Amend or decide a leave request.
 *
 * Two different responsibilities share this endpoint and must not be
 * conflated: correcting the details of your own pending request, and deciding
 * someone else's. Deciding requires the `approve` capability, which employees
 * do not have.
 *
 * Self-approval is blocked by a database trigger as well, so the rule holds
 * even for a caller who reaches the table another way. This check exists to
 * produce a clear 403 rather than a raw constraint violation.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = await req.json();

    const { data: existing } = await ctx.supabase
      .from('leave_requests')
      .select('id, member_id, status')
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .maybeSingle();

    if (!existing) return error('Not found', 404, 'NOT_FOUND');

    const isOwn = existing.member_id === ctx.org.memberId;
    const isDecision =
      typeof b.status === 'string' && DECISIONS.includes(b.status) && b.status !== existing.status;

    const update: Record<string, any> = {};

    if (isDecision) {
      if (!can(ctx.org.role, 'hr', 'approve')) {
        return error('You are not permitted to decide leave requests.', 403, 'FORBIDDEN_ACTION');
      }
      if (isOwn && b.status === 'approved') {
        return error(
          'You cannot approve your own leave request. It must be decided by someone else.',
          403, 'SELF_APPROVAL',
        );
      }
      update.status = b.status;
      update.approved_by = ctx.org.memberId;
      update.decided_at = new Date().toISOString();
      if (b.decision_note) update.decision_note = b.decision_note;
    } else {
      if (!isOwn && !can(ctx.org.role, 'hr', 'edit')) {
        return error('You are not permitted to edit this request.', 403, 'FORBIDDEN_ACTION');
      }
      // A decided request is the record of what was authorised; reopening it
      // would erase the decision trail.
      if (existing.status !== 'pending') {
        return error(
          `This request has already been ${existing.status} and can no longer be edited.`,
          409, 'ALREADY_DECIDED',
        );
      }
      for (const k of ['type', 'start_date', 'end_date', 'is_half_day', 'reason']) {
        if (k in b) update[k] = b[k];
      }
      if (update.start_date && update.end_date && update.end_date < update.start_date) {
        return error('End date cannot be before the start date', 422, 'VALIDATION_ERROR');
      }
    }

    const { data, error: e } = await ctx.supabase
      .from('leave_requests').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

export { PATCH as PUT };

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: existing } = await ctx.supabase
    .from('leave_requests').select('member_id, status')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');

  const isOwn = existing.member_id === ctx.org.memberId;
  if (!isOwn && !can(ctx.org.role, 'hr', 'delete')) {
    return error('You are not permitted to delete this request.', 403, 'FORBIDDEN_ACTION');
  }
  // Withdrawing a pending request is fine; removing an approved one would
  // delete an authorised absence from the record.
  if (existing.status !== 'pending' && !can(ctx.org.role, 'hr', 'manage')) {
    return error(
      `This request has already been ${existing.status} and cannot be deleted.`,
      409, 'ALREADY_DECIDED',
    );
  }

  const { error: e } = await ctx.supabase
    .from('leave_requests').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
