import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { updateUserSchema } from '@/lib/validations';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const record = await db.user.findUnique({
      where: { id },
      include: {
        role: true,
        _count: { select: { assignedTickets: true, ownedProjects: true, assignedTasks: true, leaveRequests: true, auditLogs: true, notifications: true } },
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
    const validated = updateUserSchema.parse(body);
    const record = await db.user.update({
      where: { id },
      data: validated,
      select: {
        id: true, email: true, firstName: true, lastName: true, avatar: true,
        jobTitle: true, phone: true, department: true, roleId: true,
        isActive: true, lastSeen: true, createdAt: true, updatedAt: true,
      },
    });
    return success(record);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    if (e.code === 'P2025') return error('Not found', 404);
    if (e.code === 'P2002') return error('Email already exists', 409);
    return error(e.message || 'Update failed', 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await db.user.delete({ where: { id } });
    return success({ deleted: true });
  } catch (e: any) {
    if (e.code === 'P2025') return error('Not found', 404);
    return error(e.message || 'Delete failed', 500);
  }
}