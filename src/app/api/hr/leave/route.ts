import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createLeaveSchema } from '@/lib/validations';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const sort = searchParams.get('sort') || 'createdAt';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const status = searchParams.get('status');
  const type = searchParams.get('type');
  const requesterId = searchParams.get('requesterId');

  const where: any = {};
  if (search) {
    where.OR = [
      { reason: { contains: search } },
      { type: { contains: search } },
    ];
  }
  if (status) where.status = status;
  if (type) where.type = type;
  if (requesterId) where.requesterId = requesterId;

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
  try {
    const body = await req.json();
    const validated = createLeaveSchema.parse(body);
    const data: any = { ...validated };
    data.startDate = new Date(data.startDate);
    data.endDate = new Date(data.endDate);
    const record = await db.leaveRequest.create({ data });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}