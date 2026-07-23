import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createPurchaseOrderSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';

const ORDER_INCLUDE = {
  supplier: { select: { id: true, name: true, leadTimeDays: true } },
  warehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
  },
} as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const sort = safeSortField('purchaseOrder', searchParams.get('sort') || 'createdAt');
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const status = searchParams.get('status');
  const supplierId = searchParams.get('supplierId');
  const search = searchParams.get('search') || '';

  const where: any = {};
  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (search) {
    where.OR = [
      { orderNumber: { contains: search } },
      { notes: { contains: search } },
      { supplier: { name: { contains: search } } },
    ];
  }

  const [data, total] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: ORDER_INCLUDE,
    }),
    db.purchaseOrder.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

/** Sequential, human-readable order number: PO-0001, PO-0002, ... */
async function nextOrderNumber(tx: any): Promise<string> {
  const last = await tx.purchaseOrder.findFirst({
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  const n = last ? Number(String(last.orderNumber).replace(/\D/g, '')) + 1 : 1;
  return `PO-${String(n).padStart(4, '0')}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { items, taxRate, expectedDate, ...header } = createPurchaseOrderSchema.parse(body);

    const record = await db.$transaction(async tx => {
      // Totals are computed server-side; a client-supplied total must never be
      // trusted, since it determines what the business believes it owes.
      const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
      const tax = Number(((subtotal * taxRate) / 100).toFixed(2));

      return tx.purchaseOrder.create({
        data: {
          ...header,
          orderNumber: await nextOrderNumber(tx),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          subtotal,
          tax,
          total: Number((subtotal + tax).toFixed(2)),
          items: {
            create: items.map(i => ({
              productId: i.productId,
              quantity: i.quantity,
              unitCost: i.unitCost,
            })),
          },
        },
        include: ORDER_INCLUDE,
      });
    });

    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.code === 'P2002') return error('Order number already exists, please retry', 409);
    if (e.code === 'P2003') return error('Referenced supplier, warehouse or product does not exist', 400);
    return error(e.message || 'Create failed', 500);
  }
}
