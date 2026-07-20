import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createExpenseSchema } from '@/lib/validations';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const sort = searchParams.get('sort') || 'createdAt';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const category = searchParams.get('category');
  const status = searchParams.get('status');

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { vendor: { contains: search } },
      { notes: { contains: search } },
    ];
  }
  if (category) where.category = category;
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    db.expense.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    db.expense.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validated = createExpenseSchema.parse(body);
    const data: any = { ...validated };
    data.date = new Date(data.date);
    const record = await db.expense.create({ data });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}