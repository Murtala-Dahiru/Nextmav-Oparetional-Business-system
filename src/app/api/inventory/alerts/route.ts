import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';

/**
 * Operational health of the inventory: what needs reordering, what it will
 * cost, and what is already on the way.
 *
 * Severity is deliberately based on the product's own reorderLevel rather than
 * a fixed threshold, because a reorder point is per-product by nature.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));

    const [products, incomingItems] = await Promise.all([
      db.product.findMany({
        where: {
          isActive: true,
          // Compare stock against each row's own reorder level.
          stock: { lte: db.product.fields.reorderLevel },
        },
        include: {
          warehouse: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true, leadTimeDays: true } },
        },
        orderBy: { stock: 'asc' },
        take: limit,
      }),
      // Quantities already ordered but not yet received.
      db.purchaseOrderItem.findMany({
        where: { order: { status: { in: ['submitted', 'approved'] } } },
        select: { productId: true, quantity: true, receivedQuantity: true },
      }),
    ]);

    const incomingByProduct = new Map<string, number>();
    for (const item of incomingItems) {
      const outstanding = item.quantity - item.receivedQuantity;
      if (outstanding > 0) {
        incomingByProduct.set(item.productId, (incomingByProduct.get(item.productId) ?? 0) + outstanding);
      }
    }

    const alerts = products.map(p => {
      const incoming = incomingByProduct.get(p.id) ?? 0;
      const shortfall = Math.max(0, p.reorderLevel - p.stock);
      const suggestedOrderQty = Math.max(0, shortfall - incoming);

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        unit: p.unit,
        stock: p.stock,
        reorderLevel: p.reorderLevel,
        cost: p.cost,
        warehouse: p.warehouse,
        supplier: p.supplier,
        incoming,
        shortfall,
        suggestedOrderQty,
        estimatedCost: Number((suggestedOrderQty * p.cost).toFixed(2)),
        // Out of stock is an active outage; at-or-below reorder point is a warning,
        // and it is downgraded to "covered" when enough stock is already inbound.
        severity:
          p.stock <= 0 ? 'out_of_stock' : incoming >= shortfall ? 'covered' : 'low',
      };
    });

    const summary = {
      totalAlerts: alerts.length,
      outOfStock: alerts.filter(a => a.severity === 'out_of_stock').length,
      low: alerts.filter(a => a.severity === 'low').length,
      covered: alerts.filter(a => a.severity === 'covered').length,
      unassignedSupplier: alerts.filter(a => !a.supplier).length,
      estimatedReorderCost: Number(
        alerts.reduce((sum, a) => sum + a.estimatedCost, 0).toFixed(2),
      ),
    };

    return success(alerts, summary as any);
  } catch (e: any) {
    return error(e.message || 'Failed to load alerts', 500);
  }
}
