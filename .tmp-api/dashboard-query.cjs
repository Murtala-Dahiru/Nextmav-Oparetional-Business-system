const { PrismaClient } = require('/home/z/my-project/.next/standalone/node_modules/@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } });

(async () => {
  try {
    const [
      totalLeads, activeLeads, totalDeals, wonDealsValue, totalRevenue,
      openTickets, activeProjects, totalEmployees, pendingInvoices,
      recentActivity, topDeals, leadByStatus, dealsByStage, revenueByMonth
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { status: { notIn: ['won', 'lost'] } } }),
      prisma.deal.count(),
      prisma.deal.aggregate({ where: { stage: 'closed-won' }, _sum: { value: true } }),
      prisma.invoice.aggregate({ where: { status: 'paid' }, _sum: { total: true } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in-progress'] } } }),
      prisma.project.count({ where: { status: 'active' } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.invoice.count({ where: { status: { in: ['sent', 'overdue'] } } }),
      prisma.auditLog.findMany({
        take: 8, orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
      }),
      prisma.deal.findMany({
        where: { stage: { not: 'closed-lost' } },
        orderBy: { value: 'desc' }, take: 5,
        include: { owner: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.lead.groupBy({ by: ['status'], _count: true }),
      prisma.deal.groupBy({ by: ['stage'], _sum: { value: true }, _count: true }),
      prisma.$queryRaw`
        SELECT strftime('%Y-%m', "paidAt") as month, SUM("total") as total
        FROM "Invoice"
        WHERE "status" = 'paid' AND "paidAt" IS NOT NULL
        GROUP BY strftime('%Y-%m', "paidAt")
        ORDER BY month DESC LIMIT 6
      `,
    ]);

    const revenue = totalRevenue._sum.total ?? 0;
    const wonValue = wonDealsValue._sum.value ?? 0;

    console.log(JSON.stringify({
      data: {
        stats: { totalLeads, activeLeads, totalDeals, wonDealsValue: wonValue, revenue, openTickets, activeProjects, totalEmployees, pendingInvoices },
        recentActivity,
        topDeals,
        leadByStatus: leadByStatus.map(s => ({ status: s.status, count: s._count })),
        dealsByStage: dealsByStage.map(s => ({ stage: s.stage, count: s._count, value: s._sum.value ?? 0 })),
        revenueByMonth: (revenueByMonth).map(r => ({ month: r.month, total: Number(r.total) })).reverse(),
      },
    }));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
  }
  await prisma.$disconnect();
})();