import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createMessageSchema } from '@/lib/validations';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));
  const channelId = searchParams.get('channelId');

  const where: any = {};
  if (channelId) where.channelId = channelId;

  const [data, total] = await Promise.all([
    db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    }),
    db.message.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validated = createMessageSchema.parse(body);
    const record = await db.message.create({
      data: validated,
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Create failed', 500);
  }
}