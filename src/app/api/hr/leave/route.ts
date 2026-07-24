import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createLeaveSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize, scopeWhere } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('hr', 'view');
  if (guard instanceof Response) return guard;

  // Leave is personal data. An employee sees only their own requests; a
  // manager sees their department's; HR sees everything.
  const scoped = scopeWhere(guard, { ownerField: 'requesterId', departmentField: null });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('leaveRequest', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const status = searchParams.get('status');
  const type = searchParams.get('type');
  const requesterId = searchParams.get('requesterId');

  const where: any = { ...scoped };
  if (search) {
    where.OR = [
      { reason: { contains: search } },
      { type: { contains: search } },
    ];
  }
  if (status) where.status = status;
  if (type) where.type = type;
  // A caller may narrow to a requester, but never widen beyond their scope:
  // the scoped clause above already pinned `requesterId` for `own` scope.
  if (requesterId && guard.scope !== 'own') where.requesterId = requesterId;

  const [data, total] = await Promise.all([
    db.leaveRequest.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, avatar: true, department: true } },
      },
    }),
    db.leaveRequest.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('hr', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createLeaveSchema.parse(body);
    const data: any = { ...validated };
    data.startDate = new Date(data.startDate);
    data.endDate = new Date(data.endDate);

    // A request is always raised on behalf of the signed-in person unless the
    // caller has organisation-wide HR rights (HR filing on someone's behalf).
    if (guard.scope !== 'organization') data.requesterId = guard.user.id;
    // New requests always enter the workflow as pending — a requester must
    // never be able to submit something pre-approved.
    data.status = 'pending';
    const record = await db.leaveRequest.create({ data });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}