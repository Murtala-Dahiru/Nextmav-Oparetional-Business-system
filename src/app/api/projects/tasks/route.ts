import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createTaskSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize, scopeWhere } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('projects', 'view');
  if (guard instanceof Response) return guard;
  const scoped = scopeWhere(guard, { ownerField: 'assigneeId' });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('projectTask', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const projectId = searchParams.get('projectId');
  const assigneeId = searchParams.get('assigneeId');

  const where: any = { ...scoped };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (projectId) where.projectId = projectId;
  if (assigneeId) where.assigneeId = assigneeId;

  const [data, total] = await Promise.all([
    db.projectTask.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    db.projectTask.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('projects', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createTaskSchema.parse(body);
    const data: any = { ...validated };
    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    const record = await db.projectTask.create({ data });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}