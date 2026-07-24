import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createPageSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('workspace', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('workspacePage', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const parentId = searchParams.get('parentId');
  const isFolder = searchParams.get('isFolder');

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (parentId !== null && parentId !== undefined && parentId !== '') {
    where.parentId = parentId;
  }
  if (isFolder !== null && isFolder !== undefined && isFolder !== '') {
    where.isFolder = isFolder === 'true';
  }

  const [data, total] = await Promise.all([
    db.workspacePage.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.workspacePage.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('workspace', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createPageSchema.parse(body);
    const record = await db.workspacePage.create({ data: validated });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}