import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { bulkMarkReadSchema } from '@/lib/validations';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const userId = searchParams.get('userId') || 'u1';
  const isRead = searchParams.get('isRead');

  const where: any = { userId };
  if (isRead !== null && isRead !== undefined && isRead !== '') {
    where.isRead = isRead === 'true';
  }

  const [data, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.notification.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const validated = bulkMarkReadSchema.parse(body);
    const userId = validated.ids ? undefined : 'u1';

    if (validated.markAll) {
      await db.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });
      return success({ markedRead: true });
    }

    if (validated.ids && validated.ids.length > 0) {
      await db.notification.updateMany({
        where: { id: { in: validated.ids } },
        data: { isRead: true },
      });
      return success({ markedRead: true, count: validated.ids.length });
    }

    return error('Provide ids or markAll', 400);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Update failed', 500);
  }
}