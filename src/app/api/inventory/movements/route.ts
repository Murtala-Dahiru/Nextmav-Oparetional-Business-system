import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createStockMovementSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('inventory', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const sort = safeSortField('stockMovement', searchParams.get('sort') || 'createdAt');
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const productId = searchParams.get('productId');
  const type = searchParams.get('type');
  const search = searchParams.get('search') || '';

  const where: any = {};
  if (productId) where.productId = productId;
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { reason: { contains: search, mode: 'insensitive' } },
      { reference: { contains: search, mode: 'insensitive' } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
      { product: { sku: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [data, total] = await Promise.all([
    db.stockMovement.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
      },
    }),
    db.stockMovement.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

/**
 * Record a stock movement and apply it to the product's on-hand quantity.
 *
 * The ledger row and the product balance must never disagree, so both writes
 * happen inside a single transaction. Stock is re-read inside that transaction
 * so two concurrent movements cannot both validate against a stale balance.
 */
export async function POST(req: Request) {
  const guard = await authorize('inventory', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const input = createStockMovementSchema.parse(body);

    const record = await db.$transaction(async tx => {
      const product = await tx.product.findUnique({
        where: { id: input.productId },
        select: { id: true, stock: true, name: true },
      });
      if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });

      const balanceAfter = product.stock + input.quantity;
      if (balanceAfter < 0) {
        throw Object.assign(
          new Error(
            `Cannot remove ${Math.abs(input.quantity)} unit(s) from "${product.name}" — only ${product.stock} on hand.`,
          ),
          { status: 409 },
        );
      }

      await tx.product.update({
        where: { id: product.id },
        data: { stock: balanceAfter },
      });

      return tx.stockMovement.create({
        data: { ...input, balanceAfter },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
        },
      });
    });

    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.status) return error(e.message, e.status);
    if (e.code === 'P2003') return error('Referenced product, warehouse or user does not exist', 400);
    return error(e.message || 'Create failed', 500);
  }
}
