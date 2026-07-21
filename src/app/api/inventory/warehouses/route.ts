import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createWarehouseSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('warehouse', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { location: { contains: search } },
    ];
  }

  const [data, total] = await Promise.all([
    db.warehouse.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.warehouse.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validated = createWarehouseSchema.parse(body);
    const record = await db.warehouse.create({ data: validated });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}