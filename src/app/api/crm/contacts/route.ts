import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createContactSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('crm', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('contact', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const isActive = searchParams.get('isActive');

  const where: any = {};
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { company: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (isActive !== null && isActive !== undefined && isActive !== '') {
    where.isActive = isActive === 'true';
  }

  const [data, total] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.contact.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('crm', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createContactSchema.parse(body);
    const record = await db.contact.create({ data: validated });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}