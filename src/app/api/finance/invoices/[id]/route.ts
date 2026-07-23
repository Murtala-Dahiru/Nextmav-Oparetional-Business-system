import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { updateInvoiceSchema } from '@/lib/validations';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const record = await db.invoice.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!record) return error('Not found', 404);
    return success(record);
  } catch (e: any) {
    return error(e.message || 'Get failed', 500);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const validated = updateInvoiceSchema.parse(body);
    const data: any = { ...validated };
    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    if (data.paidAt) data.paidAt = new Date(data.paidAt);
    const record = await db.invoice.update({ where: { id }, data });
    return success(record);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.code === 'P2025') return error('Not found', 404);
    if (e.code === 'P2002') return error('Invoice number already exists', 409);
    return error(e.message || 'Update failed', 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await db.invoice.delete({ where: { id } });
    return success({ deleted: true });
  } catch (e: any) {
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Delete failed', 500);
  }
}