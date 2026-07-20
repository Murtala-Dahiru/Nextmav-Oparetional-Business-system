import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const sort = searchParams.get('sort') || 'createdAt';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const module = searchParams.get('module');
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');

  const where: any = {};
  if (module) where.module = module;
  if (action) where.action = action;
  if (userId) where.userId = userId;

  const [data, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { [sort]: sortDir === 'asc' ? 'asc' : 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}