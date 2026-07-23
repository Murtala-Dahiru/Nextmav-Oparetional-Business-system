import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { updateSupplierSchema } from '@/lib/validations';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const record = await db.supplier.findUnique({
      where: { id },
      include: {
        products: { select: { id: true, name: true, sku: true, stock: true, reorderLevel: true } },
        purchaseOrders: {
          select: { id: true, orderNumber: true, status: true, total: true, orderDate: true },
          orderBy: { orderDate: 'desc' },
          take: 10,
        },
      },
    });
    if (!record) return error('Not found', 404);
    return success(record);
  } catch (e: any) {
    return error(e.message || 'Get failed', 500);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const validated = updateSupplierSchema.parse(body);
    const record = await db.supplier.update({ where: { id }, data: validated });
    return success(record);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Update failed', 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // Products and purchase orders reference the supplier. Rather than cascade
    // and destroy purchasing history, deactivate suppliers that are still in use.
    const [productCount, orderCount] = await Promise.all([
      db.product.count({ where: { supplierId: id } }),
      db.purchaseOrder.count({ where: { supplierId: id } }),
    ]);

    if (productCount > 0 || orderCount > 0) {
      const record = await db.supplier.update({ where: { id }, data: { isActive: false } });
      return success({
        deleted: false,
        deactivated: true,
        record,
        message: `Supplier is linked to ${productCount} product(s) and ${orderCount} order(s), so it was deactivated instead of deleted.`,
      });
    }

    await db.supplier.delete({ where: { id } });
    return success({ deleted: true, deactivated: false });
  } catch (e: any) {
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Delete failed', 500);
  }
}
