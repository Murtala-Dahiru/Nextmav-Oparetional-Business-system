import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createEventSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize, scopeWhere } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('calendar', 'view');
  if (guard instanceof Response) return guard;
  const scoped = scopeWhere(guard, { ownerField: 'creatorId' });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'startDate';
  const sort = safeSortField('calendarEvent', rawSort);
  const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
  const startDateAfter = searchParams.get('startDateAfter');
  const startDateBefore = searchParams.get('startDateBefore');

  const where: any = { ...scoped };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (startDateAfter) {
    where.startDate = { ...(where.startDate || {}), gte: new Date(startDateAfter) };
  }
  if (startDateBefore) {
    where.startDate = { ...(where.startDate || {}), lte: new Date(startDateBefore) };
  }

  const [data, total] = await Promise.all([
    db.calendarEvent.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    }),
    db.calendarEvent.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('calendar', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createEventSchema.parse(body);
    const data: any = { ...validated };
    data.startDate = new Date(data.startDate);
    data.endDate = new Date(data.endDate);
    const record = await db.calendarEvent.create({ data });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}