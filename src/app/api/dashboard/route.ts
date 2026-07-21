import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';

export async function GET() {
  try {
    const [
      totalLeads,
      activeLeads,
      totalDeals,
      wonDealsValue,
      totalRevenue,
      openTickets,
      activeProjects,
      totalEmployees,
      pendingInvoices,
      recentActivity,
      topDeals,
      leadByStatus,
      dealsByStage,
      revenueByMonth,
    ] = await Promise.all([
      // KPIs
      db.lead.count(),
      db.lead.count({ where: { status: { notIn: ['won', 'lost'] } } }),
      db.deal.count(),
      db.deal.aggregate({ where: { stage: 'closed-won' }, _sum: { value: true } }),
      db.invoice.aggregate({ where: { status: 'paid' }, _sum: { total: true } }),
      db.supportTicket.count({ where: { status: { in: ['open', 'in-progress'] } } }),
      db.project.count({ where: { status: 'active' } }),
      db.user.count({ where: { isActive: true } }),
      db.invoice.count({ where: { status: { in: ['sent', 'overdue'] } } }),
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

    const revenue = totalRevenue._sum.total ?? 0;
    const wonValue = wonDealsValue._sum.value ?? 0;

    return success({
      stats: {
        totalLeads,
        activeLeads,
        totalDeals,
        wonDealsValue: wonValue,
        revenue,
        openTickets,
        activeProjects,
        totalEmployees,
        pendingInvoices,
      },
      recentActivity,
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