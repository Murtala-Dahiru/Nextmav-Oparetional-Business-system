import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { updateLeaveSchema } from '@/lib/validations';
import { authorize } from '@/lib/auth-context';
import { can } from '@/lib/permissions';

const REQUESTER = {
  requester: { select: { id: true, firstName: true, lastName: true, avatar: true, department: true } },
} as const;

/** Statuses that represent an approval decision rather than an edit. */
const DECISION_STATUSES = ['approved', 'rejected', 'cancelled'];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await authorize('hr', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    const record = await db.leaveRequest.findUnique({ where: { id }, include: REQUESTER });
    if (!record) return error('Not found', 404);

    // Someone with `own` scope may only open their own request. Returning 404
    // rather than 403 avoids confirming that another person's record exists.
    if (guard.scope === 'own' && record.requesterId !== guard.user.id) {
      return error('Not found', 404);
    }
    return success(record);
  } catch (e: any) {
    return error(e.message || 'Get failed', 500);
  }
}

/**
 * Update a leave request.
 *
 * Two different responsibilities share this endpoint and must not be
 * conflated: amending the details of your own pending request, and deciding
 * someone else's. Approval requires the `approve` capability, which employees
 * do not have — previously any caller could set `status: "approved"` on their
 * own request and self-authorise their leave.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await authorize('hr', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    const body = await req.json();
    const validated = updateLeaveSchema.parse(body);

    const existing = await db.leaveRequest.findUnique({
      where: { id },
      select: { id: true, requesterId: true, status: true },
    });
    if (!existing) return error('Not found', 404);

    const isOwnRequest = existing.requesterId === guard.user.id;
    const isDecision =
      typeof validated.status === 'string' &&
      DECISION_STATUSES.includes(validated.status) &&
      validated.status !== existing.status;

    if (isDecision) {
      if (!can(guard.user.role, 'hr', 'approve')) {
        return error('You are not permitted to approve leave requests.', 403, 'FORBIDDEN_ACTION');
      }
      // Approving your own leave is a separation-of-duties failure even for a
      // manager; it has to be decided by someone else.
      if (isOwnRequest && validated.status === 'approved') {
        return error(
          'You cannot approve your own leave request. It must be decided by another approver.',
          403,
          'SELF_APPROVAL',
        );
      }
    } else if (guard.scope === 'own' && !isOwnRequest) {
      return error('Not found', 404);
    } else if (!isOwnRequest && !can(guard.user.role, 'hr', 'edit')) {
      return error('You are not permitted to edit this request.', 403, 'FORBIDDEN_ACTION');
    }

    // A decided request is the record of what was authorised; reopening it
    // would erase the decision trail.
    if (!isDecision && existing.status !== 'pending') {
      return error(
        `This request has already been ${existing.status} and can no longer be edited.`,
        409,
        'ALREADY_DECIDED',
      );
    }

    const data: any = { ...validated };
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);
    if (isDecision) data.approverId = guard.user.id;
    // Never let a requester reassign a request to someone else.
    if (guard.scope === 'own') delete data.requesterId;

    const record = await db.leaveRequest.update({ where: { id }, data, include: REQUESTER });
    return success(record);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Update failed', 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await authorize('hr', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    const existing = await db.leaveRequest.findUnique({
      where: { id },
      select: { requesterId: true, status: true },
    });
    if (!existing) return error('Not found', 404);

    const isOwnRequest = existing.requesterId === guard.user.id;
    if (!isOwnRequest && !can(guard.user.role, 'hr', 'delete')) {
      return error('You are not permitted to delete this request.', 403, 'FORBIDDEN_ACTION');
    }
    // Withdrawing a pending request is fine; deleting an approved one would
    // remove an authorised absence from the record.
    if (existing.status !== 'pending' && !can(guard.user.role, 'hr', 'manage')) {
      return error(
        `This request has already been ${existing.status} and cannot be deleted.`,
        409,
        'ALREADY_DECIDED',
      );
    }

    await db.leaveRequest.delete({ where: { id } });
    return success({ deleted: true });
  } catch (e: any) {
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Delete failed', 500);
  }
}
