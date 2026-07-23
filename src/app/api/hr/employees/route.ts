import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createEmployeeSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('user', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const department = searchParams.get('department');
  const isActive = searchParams.get('isActive');

  const where: any = {};
  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { email: { contains: search } },
      { jobTitle: { contains: search } },
    ];
  }
  if (department) where.department = department;
  if (isActive !== null && isActive !== undefined && isActive !== '') {
    where.isActive = isActive === 'true';
  }

  const [data, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        jobTitle: true,
        phone: true,
        department: true,
        roleId: true,
        isActive: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { id: true, name: true } },
        _count: { select: { assignedTickets: true, ownedProjects: true, assignedTasks: true, leaveRequests: true } },
      },
    }),
    db.user.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validated = createEmployeeSchema.parse(body);
    const record = await db.user.create({
      data: validated,
      select: {
        id: true, email: true, firstName: true, lastName: true, avatar: true,
        jobTitle: true, phone: true, department: true, roleId: true,
        isActive: true, lastSeen: true, createdAt: true, updatedAt: true,
      },
    });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.code === 'P2002') return error('Email already exists', 409);
    return error(e.message || 'Create failed', 500);
  }
}