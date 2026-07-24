import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createLeadSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize, scopeWhere } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('crm', 'view');
  if (guard instanceof Response) return guard;
  const scoped = scopeWhere(guard, { ownerField: 'ownerId' });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('lead', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const status = searchParams.get('status');

  const where: any = { ...scoped };
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { company: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { owner: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
    db.lead.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('crm', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createLeadSchema.parse(body);
    const record = await db.lead.create({ data: validated });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}