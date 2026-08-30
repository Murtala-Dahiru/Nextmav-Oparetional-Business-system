import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

/**
 * Moving one incentive entry along the chain.
 *
 * ── Why this is not `recordHandlers` ─────────────────────────────────────
 *
 * The generic update handler writes whatever the update schema admits, and
 * what this route admits is exactly one field: the status. An entry's amount,
 * basis, rule and workings are what the entry *is*, and a system where they
 * can be patched cannot answer "why was I paid this" a month later.
 *
 * `guard_incentive_entry()` refuses those columns in the database too, so
 * this route is the readable message rather than the guarantee.
 *
 * ── Two approvals, two roles ─────────────────────────────────────────────
 *
 * A manager approves the performance claim; Finance approves the payment.
 * `approve` is the capability for the first, and it is already distinct from
 * `edit` in the capability model, which is exactly the distinction this
 * needs. Marking something paid additionally requires Finance or an
 * administrator, because it asserts that money left the building.
 *
 * Nobody signs off their own: `prevent_incentive_self_approval()` enforces it
 * for every writer, including one that skips this route.
 */

const NEXT: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['paid', 'rejected'],
  rejected: ['pending'],
  paid: [],
  reversed: [],
};

const PAY_ROLES = ['owner', 'administrator', 'finance_staff'];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authorize('performance', 'approve');
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const { supabase, org } = ctx;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return error('That request had no body.', 422, 'VALIDATION_ERROR');
  }

  const status = String(body?.status ?? '');
  if (!['approved', 'rejected', 'paid', 'pending'].includes(status)) {
    return error('Choose approved, rejected, paid or pending.', 422, 'VALIDATION_ERROR');
  }

  const current = await supabase
    .from('incentive_entries')
    .select('id, status, member_id, amount')
    .eq('organization_id', org.organizationId)
    .eq('id', id)
    .maybeSingle();

  if (current.error) return pgError(current.error);
  if (!current.data) return error('That entry no longer exists.', 404, 'NOT_FOUND');

  const from = current.data.status as string;
  if (!NEXT[from]?.includes(status)) {
    return error(
      from === 'paid'
        ? 'That has already been paid.'
        : from === 'reversed'
          ? 'That entry was reversed, so it cannot move.'
          : `An entry that is ${from} cannot become ${status}.`,
      409, 'INVALID_TRANSITION',
    );
  }

  if (status === 'paid' && !PAY_ROLES.includes(org.role)) {
    return error('Only Finance or an administrator can mark an incentive paid.', 403);
  }

  /* The database says this too, but the message here is the readable one. */
  if (['approved', 'paid'].includes(status) && current.data.member_id === org.memberId) {
    return error('You cannot approve your own incentive.', 403);
  }

  const patch: Record<string, unknown> = { status };
  if (typeof body?.note === 'string') patch.note = body.note;
  if (status === 'paid' && typeof body?.paidReference === 'string') {
    patch.paid_reference = body.paidReference;
  }

  const { data, error: e } = await supabase
    .from('incentive_entries')
    .update(patch)
    .eq('organization_id', org.organizationId)
    .eq('id', id)
    .select('id, status, amount, approved_at, paid_at, paid_reference, note')
    .single();

  if (e) return pgError(e);
  return success(data);
}
