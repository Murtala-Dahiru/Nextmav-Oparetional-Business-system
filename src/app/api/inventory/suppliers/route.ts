import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createSupplierSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('inventory', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const sort = safeSortField('supplier', searchParams.get('sort') || 'createdAt');
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const isActive = searchParams.get('isActive');

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { contactName: { contains: search } },
      { email: { contains: search } },
      { city: { contains: search } },
    ];
  }
  if (isActive === 'true' || isActive === 'false') where.isActive = isActive === 'true';

  const [data, total] = await Promise.all([
    db.supplier.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { products: true, purchaseOrders: true } } },
    }),
    db.supplier.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('inventory', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createSupplierSchema.parse(body);
    const record = await db.supplier.create({ data: validated });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}
