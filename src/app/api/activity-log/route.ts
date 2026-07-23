import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const module_ = searchParams.get('module');
  const userId = searchParams.get('userId');

  const where: any = {};
  if (module_) where.module = module_;
  if (userId) where.userId = userId;

  const [data, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    }),
    db.activityLog.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}