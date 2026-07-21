import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';

export async function GET() {
  try {
    const [
      leads,
      deals,
      projects,
      tasks,
      tickets,
      invoices,
      recentActivity,
      topDeals,
      leadByStatus,
      dealsByStage,
      revenueByMonth,
    ] = await Promise.all([
      db.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      db.deal.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { owner: { select: { id: true, firstName: true, lastName: true } } },
      }),
      db.project.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { _count: { select: { tasks: true } } },
      }),
      db.projectTask.findMany({ orderBy: { sortOrder: 'asc' }, take: 100 }),
      db.supportTicket.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      // Recent activity
      db.auditLog.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
      }),
      // Top deals
      db.deal.findMany({
        where: { stage: { not: 'closed-lost' } },
        orderBy: { value: 'desc' },
        take: 5,
        include: { owner: { select: { id: true, firstName: true, lastName: true } } },
      }),
      // Lead distribution by status
      db.lead.groupBy({ by: ['status'], _count: true }),
      // Deal pipeline by stage
      db.deal.groupBy({ by: ['stage'], _sum: { value: true }, _count: true }),
      // Revenue by month (last 6 months)
      db.$queryRaw`
        SELECT
          strftime('%Y-%m', "paidAt") as month,
          SUM("total") as total
        FROM "Invoice"
        WHERE "status" = 'paid' AND "paidAt" IS NOT NULL
        GROUP BY strftime('%Y-%m', "paidAt")
        ORDER BY month DESC
        LIMIT 6
      `,
    ]);

    return success({
      leads,
      deals,
      projects,
      tasks,
      tickets,
      invoices,
      activities: recentActivity,
      topDeals,
      leadByStatus: leadByStatus.map((s) => ({ status: s.status, count: s._count })),
      dealsByStage: dealsByStage.map((s) => ({
        stage: s.stage,
        count: s._count,
        value: s._sum.value ?? 0,
      })),
      revenueByMonth: (revenueByMonth as any[]).map((r) => ({
        month: r.month,
        total: Number(r.total),
      })).reverse(),
    });
  } catch (e: any) {
    return error(e.message || 'Dashboard fetch failed', 500);
  }
}