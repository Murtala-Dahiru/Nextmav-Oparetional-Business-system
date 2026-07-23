import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { updatePurchaseOrderSchema, DEFAULT_USER_ID } from '@/lib/validations';

const ORDER_INCLUDE = {
  supplier: { select: { id: true, name: true, leadTimeDays: true } },
  warehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
  },
} as const;

/** Which status changes are legal. A received order is terminal. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'draft', 'cancelled'],
  approved: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const record = await db.purchaseOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!record) return error('Not found', 404);
    return success(record);
  } catch (e: any) {
    return error(e.message || 'Get failed', 500);
  }
}

/**
 * Update an order, including status transitions.
 *
 * Moving an order to `received` is what actually brings stock into the
 * building, so it writes a StockMovement per line item inside the same
 * transaction as the status change. Receiving is therefore auditable and
 * cannot leave the ledger and the on-hand quantity disagreeing.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { status, expectedDate, ...rest } = updatePurchaseOrderSchema.parse(body);

    const record = await db.$transaction(async tx => {
      const existing = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!existing) throw Object.assign(new Error('Not found'), { status: 404 });

      if (status && status !== existing.status) {
        const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
        if (!allowed.includes(status)) {
          throw Object.assign(
            new Error(`Cannot change status from "${existing.status}" to "${status}".`),
            { status: 409 },
          );
        }
      }

      const receiving = status === 'received' && existing.status !== 'received';

      if (receiving) {
        for (const item of existing.items) {
          const outstanding = item.quantity - item.receivedQuantity;
          if (outstanding <= 0) continue;

          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { stock: true },
          });
          if (!product) continue;

          const balanceAfter = product.stock + outstanding;

          await tx.product.update({
            where: { id: item.productId },
            data: { stock: balanceAfter },
          });
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { receivedQuantity: item.quantity },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              type: 'receipt',
              quantity: outstanding,
              balanceAfter,
              reason: `Received against ${existing.orderNumber}`,
              reference: existing.orderNumber,
              toWarehouseId: existing.warehouseId,
              userId: existing.createdById || DEFAULT_USER_ID,
            },
          });
        }
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...rest,
          ...(status ? { status } : {}),
          ...(expectedDate !== undefined
            ? { expectedDate: expectedDate ? new Date(expectedDate) : null }
            : {}),
          ...(receiving ? { receivedAt: new Date() } : {}),
        },
        include: ORDER_INCLUDE,
      });
    });

    return success(record);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.status) return error(e.message, e.status);
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Update failed', 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.purchaseOrder.findUnique({
      where: { id },
      select: { status: true, orderNumber: true },
    });
    if (!existing) return error('Not found', 404);

    // A received order has moved real stock and is part of the audit trail.
    if (existing.status === 'received') {
      return error(
        `${existing.orderNumber} has already been received and cannot be deleted. Cancel a replacement order instead.`,
        409,
      );
    }

    await db.purchaseOrder.delete({ where: { id } });
    return success({ deleted: true });
  } catch (e: any) {
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Delete failed', 500);
  }
}
