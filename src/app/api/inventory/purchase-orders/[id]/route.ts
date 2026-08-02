import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT =
  '*, supplier:suppliers(id, name, lead_time_days), warehouse:warehouses(id, name), items:purchase_order_items(*, product:products(id, name, sku, unit))';

/** Legal status transitions. A received order is terminal. */
const NEXT: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'draft', 'cancelled'],
  approved: ['received', 'partially_received', 'cancelled'],
  partially_received: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('inventory', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('purchase_orders').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Update an order, including status transitions.
 *
 * Receiving is the consequential one: it is what actually brings stock into
 * the building, so it walks every outstanding line through
 * record_stock_movement(). That keeps the ledger, the on-hand quantity and the
 * order's received quantities in agreement, and makes the receipt auditable —
 * setting `status = received` without moving stock would leave the warehouse
 * and the system disagreeing about what is on the shelf.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('inventory', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    const { data: existing } = await ctx.supabase
      .from('purchase_orders')
      .select('id, status, order_number, warehouse_id, items:purchase_order_items(id, product_id, quantity, received_quantity)')
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .maybeSingle();

    if (!existing) return error('Not found', 404, 'NOT_FOUND');

    const status = b.status as string | undefined;

    if (status && status !== existing.status) {
      const allowed = NEXT[existing.status] ?? [];
      if (!allowed.includes(status)) {
        return error(
          `Cannot change status from "${existing.status}" to "${status}".`,
          409, 'INVALID_TRANSITION',
        );
      }
      // Approving and receiving commit money and stock respectively.
      if (['approved', 'received', 'partially_received'].includes(status)) {
        const { data: canApprove } = await ctx.supabase.rpc('can_approve', {
          org: ctx.org.organizationId, domain: 'purchase',
        });
        if (canApprove === false) {
          return error('You are not permitted to approve or receive purchase orders.', 403, 'FORBIDDEN_ACTION');
        }
      }
    }

    const receiving = status === 'received' && existing.status !== 'received';

    if (receiving) {
      for (const item of (existing.items ?? []) as any[]) {
        const outstanding = item.quantity - item.received_quantity;
        if (outstanding <= 0) continue;

        const { error: mvErr } = await ctx.supabase.rpc('record_stock_movement', {
          org: ctx.org.organizationId,
          product: item.product_id,
          qty: outstanding,
          movement_type: 'receipt',
          reason: `Received against ${existing.order_number}`,
          reference: existing.order_number,
        });
        // Stop on the first failure rather than continuing: a partially
        // applied receipt is worse than one that clearly did not complete.
        if (mvErr) return pgError(mvErr);

        await ctx.supabase
          .from('purchase_order_items')
          .update({ received_quantity: item.quantity })
          .eq('id', item.id);
      }
    }

    const update: Record<string, any> = {};
    for (const k of ['warehouse_id', 'expected_date', 'notes']) {
      if (k in b) update[k] = b[k] || null;
    }
    if (status) update.status = status;
    if (receiving) update.received_at = new Date().toISOString();
    if (status === 'approved') {
      update.approved_by = ctx.org.memberId;
      update.approved_at = new Date().toISOString();
    }

    const { data, error: e } = await ctx.supabase
      .from('purchase_orders').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

export { PATCH as PUT };

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('inventory', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: existing } = await ctx.supabase
    .from('purchase_orders').select('status, order_number')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');

  // A received order has moved real stock and is part of the audit trail.
  if (existing.status === 'received') {
    return error(
      `${existing.order_number} has already been received and cannot be deleted. Raise a return instead.`,
      409, 'ALREADY_RECEIVED',
    );
  }

  const { error: e } = await ctx.supabase
    .from('purchase_orders').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
