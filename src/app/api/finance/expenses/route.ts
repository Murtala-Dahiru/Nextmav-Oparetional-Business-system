import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createExpenseSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize, scopeWhere } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('finance', 'view');
  if (guard instanceof Response) return guard;
  // Sales staff and employees never reach finance at all; a manager sees only
  // what they own, finance staff and above see the whole organisation.
  const scoped = scopeWhere(guard, { ownerField: 'ownerId' });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('expense', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const category = searchParams.get('category');
  const status = searchParams.get('status');

  const where: any = { ...scoped };
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
  const guard = await authorize('finance', 'create');
  if (guard instanceof Response) return guard;

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