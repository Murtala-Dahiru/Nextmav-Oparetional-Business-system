import { db } from '@/lib/db';
import { success, error, paginated } from '@/lib/api-response';
import { createInvoiceSchema } from '@/lib/validations';
import { safeSortField } from '@/lib/sort-whitelist';
import { authorize, scopeWhere } from '@/lib/auth-context';

export async function GET(req: Request) {
  const guard = await authorize('finance', 'view');
  if (guard instanceof Response) return guard;
  // Sales staff and employees never reach finance at all; a manager sees only
  // what they own, finance staff and above see the whole organisation.
  const scoped = scopeWhere(guard, { ownerField: 'ownerId' });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));
  const search = searchParams.get('search') || '';
  const rawSort = searchParams.get('sort') || 'createdAt';
  const sort = safeSortField('invoice', rawSort);
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const status = searchParams.get('status');

  const where: any = { ...scoped };
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search } },
      { contactName: { contains: search } },
      { companyName: { contains: search } },
    ];
  }
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: { [sort]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    db.invoice.count({ where }),
  ]);

  return paginated(data, total, page, pageSize);
}

export async function POST(req: Request) {
  const guard = await authorize('finance', 'create');
  if (guard instanceof Response) return guard;

  try {
    const body = await req.json();
    const validated = createInvoiceSchema.parse(body);
    const data: any = { ...validated };
    data.dueDate = new Date(data.dueDate);
    if (data.paidAt) data.paidAt = new Date(data.paidAt);
    const record = await db.invoice.create({ data });
    return success(record, undefined, 201);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.code === 'P2002') return error('Invoice number already exists', 409);
    return error(e.message || 'Create failed', 500);
  }
}