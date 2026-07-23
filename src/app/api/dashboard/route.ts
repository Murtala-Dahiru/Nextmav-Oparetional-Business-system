import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { DEFAULT_USER_ID } from '@/lib/validations';

/**
 * Executive command-centre aggregation.
 *
 * Every widget on the dashboard is served from this single endpoint. The
 * alternative — one request per widget — would mean ~15 round trips before the
 * page is usable. Aggregates are computed here rather than shipping raw rows to
 * the browser, so the payload stays small and the numbers are consistent with
 * each other (all read within the same request).
 */

const MS_DAY = 86_400_000;

/** Open (unwon, unlost) pipeline stages. */
const CLOSED_STAGES = ['closed-won', 'closed-lost', 'won', 'lost'];

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/** Percentage change from `previous` to `current`, null when there is no base. */
function trend(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') || DEFAULT_USER_ID;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + MS_DAY);
    const in7Days = new Date(now.getTime() + 7 * MS_DAY);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      users, leads, deals, projects, tasks, tickets, invoices, expenses,
      leaveRequests, events, notifications, activities, pages, products,
      myTasks, warehouses,
    ] = await Promise.all([
      db.user.findMany({
        select: {
          id: true, firstName: true, lastName: true, email: true, avatar: true,
          jobTitle: true, department: true, isActive: true, lastSeen: true, createdAt: true,
        },
      }),
      db.lead.findMany({ select: { id: true, status: true, value: true, score: true, createdAt: true } }),
      db.deal.findMany({
        select: { id: true, name: true, stage: true, value: true, probability: true, closeDate: true, companyName: true, createdAt: true },
      }),
      db.project.findMany({
        select: { id: true, name: true, status: true, priority: true, budget: true, endDate: true },
      }),
      db.projectTask.findMany({ select: { id: true, status: true, projectId: true, dueDate: true, estimatedHours: true, loggedHours: true } }),
      db.supportTicket.findMany({
        select: { id: true, ticketNumber: true, subject: true, status: true, priority: true, category: true, dueDate: true, createdAt: true },
      }),
      db.invoice.findMany({ select: { id: true, invoiceNumber: true, companyName: true, status: true, total: true, dueDate: true, paidAt: true, createdAt: true } }),
      db.expense.findMany({ select: { id: true, amount: true, category: true, status: true, date: true } }),
      db.leaveRequest.findMany({
        where: { status: 'pending' },
        take: 6,
        orderBy: { startDate: 'asc' },
        include: { requester: { select: { id: true, firstName: true, lastName: true, avatar: true, department: true } } },
      }),
      db.calendarEvent.findMany({
        where: { startDate: { gte: startOfToday, lte: in7Days } },
        orderBy: { startDate: 'asc' },
        take: 8,
        include: { creator: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
      }),
      db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      db.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
      }),
      db.workspacePage.findMany({
        where: { isFolder: false },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select: { id: true, title: true, icon: true, color: true, updatedAt: true, isStarred: true, lastEditedBy: true },
      }),
      db.product.findMany({ select: { id: true, name: true, sku: true, stock: true, reorderLevel: true, cost: true, unit: true, isActive: true } }),
      db.projectTask.findMany({
        where: { assigneeId: userId, status: { not: 'done' } },
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
        take: 8,
        include: { project: { select: { id: true, name: true } } },
      }),
      db.warehouse.count(),
    ]);

    // ── CRM pipeline ──────────────────────────────────────────────────────
    const openDeals = deals.filter(d => !CLOSED_STAGES.includes(d.stage));
    const wonDeals = deals.filter(d => d.stage === 'closed-won' || d.stage === 'won');
    const pipelineValue = openDeals.reduce((s, d) => s + d.value, 0);
    // Weighting by probability is what makes a pipeline forecastable rather
    // than just a sum of wishful thinking.
    const weightedPipeline = openDeals.reduce((s, d) => s + d.value * (d.probability / 100), 0);
    const wonValue = wonDeals.reduce((s, d) => s + d.value, 0);

    const stageOrder = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won'];
    const dealsByStage = stageOrder.map(stage => {
      const rows = deals.filter(d => d.stage === stage);
      return { stage, count: rows.length, value: rows.reduce((s, d) => s + d.value, 0) };
    }).filter(s => s.count > 0 || stageOrder.indexOf(s.stage) < 5);

    const leadsByStatus = Object.entries(
      leads.reduce<Record<string, number>>((acc, l) => {
        acc[l.status] = (acc[l.status] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([status, count]) => ({ status, count }));

    // ── Finance ───────────────────────────────────────────────────────────
    const paidInvoices = invoices.filter(i => i.status === 'paid');
    const revenue = paidInvoices.reduce((s, i) => s + i.total, 0);
    const revenueThisMonth = paidInvoices
      .filter(i => i.paidAt && new Date(i.paidAt) >= startOfMonth)
      .reduce((s, i) => s + i.total, 0);
    const revenuePrevMonth = paidInvoices
      .filter(i => i.paidAt && new Date(i.paidAt) >= startOfPrevMonth && new Date(i.paidAt) < startOfMonth)
      .reduce((s, i) => s + i.total, 0);

    const outstanding = invoices
      .filter(i => i.status === 'sent' || i.status === 'overdue')
      .reduce((s, i) => s + i.total, 0);
    const overdueInvoices = invoices.filter(
      i => i.status !== 'paid' && i.status !== 'draft' && new Date(i.dueDate) < now,
    );

    const approvedExpenses = expenses.filter(e => e.status === 'approved');
    const totalExpenses = approvedExpenses.reduce((s, e) => s + e.amount, 0);
    const expensesThisMonth = approvedExpenses
      .filter(e => new Date(e.date) >= startOfMonth)
      .reduce((s, e) => s + e.amount, 0);
    const pendingExpenses = expenses.filter(e => e.status === 'pending');

    // Trailing 6 months of revenue vs spend, oldest first.
    const revenueByMonth: { month: string; revenue: number; expenses: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const from = new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth() + i, 1);
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      revenueByMonth.push({
        month: from.toLocaleString('en-US', { month: 'short' }),
        revenue: paidInvoices
          .filter(inv => inv.paidAt && new Date(inv.paidAt) >= from && new Date(inv.paidAt) < to)
          .reduce((s, inv) => s + inv.total, 0),
        expenses: approvedExpenses
          .filter(e => new Date(e.date) >= from && new Date(e.date) < to)
          .reduce((s, e) => s + e.amount, 0),
      });
    }

    // ── Projects ──────────────────────────────────────────────────────────
    const tasksByProject = tasks.reduce<Record<string, { total: number; done: number }>>((acc, t) => {
      const bucket = (acc[t.projectId] ??= { total: 0, done: 0 });
      bucket.total++;
      if (t.status === 'done') bucket.done++;
      return acc;
    }, {});

    const projectProgress = projects
      .filter(p => p.status !== 'completed' && p.status !== 'cancelled')
      .map(p => {
        const counts = tasksByProject[p.id] ?? { total: 0, done: 0 };
        const daysLeft = p.endDate
          ? Math.ceil((new Date(p.endDate).getTime() - now.getTime()) / MS_DAY)
          : null;
        const progress = pct(counts.done, counts.total);
        return {
          id: p.id, name: p.name, status: p.status, priority: p.priority,
          budget: p.budget, totalTasks: counts.total, doneTasks: counts.done,
          progress, daysLeft,
          // A project is "at risk" when the deadline is closer than the work
          // remaining suggests it should be.
          atRisk: daysLeft !== null && daysLeft <= 14 && progress < 75,
        };
      })
      .sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999))
      .slice(0, 6);

    const overdueTasks = tasks.filter(t => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now).length;
    const tasksDueThisWeek = tasks.filter(
      t => t.status !== 'done' && t.dueDate && new Date(t.dueDate) >= startOfToday && new Date(t.dueDate) <= in7Days,
    ).length;

    // ── Support ───────────────────────────────────────────────────────────
    const openTickets = tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed');
    const breachedTickets = openTickets.filter(t => t.dueDate && new Date(t.dueDate) < now);
    const ticketsByPriority = ['critical', 'high', 'medium', 'low'].map(priority => ({
      priority,
      count: openTickets.filter(t => t.priority === priority).length,
    }));

    // ── Inventory ─────────────────────────────────────────────────────────
    const activeProducts = products.filter(p => p.isActive);
    const lowStock = activeProducts.filter(p => p.stock <= p.reorderLevel);
    const stockValue = activeProducts.reduce((s, p) => s + p.stock * p.cost, 0);

    // ── HR ────────────────────────────────────────────────────────────────
    const activeUsers = users.filter(u => u.isActive);
    const departments = [...new Set(activeUsers.map(u => u.department).filter(Boolean))];
    const newHires = activeUsers.filter(u => new Date(u.createdAt) >= startOfPrevMonth).length;
    const onlineNow = users.filter(u => new Date(u.lastSeen).getTime() > now.getTime() - 15 * 60_000).length;

    return success({
      generatedAt: now.toISOString(),

      company: {
        headcount: activeUsers.length,
        departments: departments.length,
        onlineNow,
        newHires,
        revenue,
        revenueThisMonth,
        revenueTrend: trend(revenueThisMonth, revenuePrevMonth),
        pipelineValue,
        weightedPipeline,
        openDeals: openDeals.length,
        activeProjects: projects.filter(p => p.status === 'active').length,
        openTickets: openTickets.length,
        warehouses,
      },

      crm: {
        totalLeads: leads.length,
        newLeads: leads.filter(l => new Date(l.createdAt) >= startOfMonth).length,
        qualifiedLeads: leads.filter(l => l.status === 'qualified').length,
        pipelineValue,
        weightedPipeline,
        wonValue,
        winRate: pct(wonDeals.length, deals.filter(d => CLOSED_STAGES.includes(d.stage)).length),
        dealsByStage,
        leadsByStatus,
        topDeals: [...openDeals].sort((a, b) => b.value - a.value).slice(0, 5),
      },

      finance: {
        revenue,
        revenueThisMonth,
        revenueTrend: trend(revenueThisMonth, revenuePrevMonth),
        outstanding,
        overdueCount: overdueInvoices.length,
        overdueValue: overdueInvoices.reduce((s, i) => s + i.total, 0),
        totalExpenses,
        expensesThisMonth,
        pendingExpenseCount: pendingExpenses.length,
        pendingExpenseValue: pendingExpenses.reduce((s, e) => s + e.amount, 0),
        netPosition: revenue - totalExpenses,
        revenueByMonth,
        recentInvoices: invoices
          .slice()
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5),
      },

      projects: {
        total: projects.length,
        active: projects.filter(p => p.status === 'active').length,
        atRisk: projectProgress.filter(p => p.atRisk).length,
        totalBudget: projects.reduce((s, p) => s + p.budget, 0),
        overdueTasks,
        tasksDueThisWeek,
        progress: projectProgress,
      },

      myWork: {
        userId,
        openTasks: tasks.filter(t => t.status !== 'done').length,
        tasks: myTasks.map(t => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          dueDate: t.dueDate, projectName: t.project?.name ?? null,
          overdue: !!t.dueDate && new Date(t.dueDate) < now,
        })),
      },

      support: {
        open: openTickets.length,
        breached: breachedTickets.length,
        critical: openTickets.filter(t => t.priority === 'critical').length,
        resolvedThisMonth: tickets.filter(
          t => (t.status === 'resolved' || t.status === 'closed') && new Date(t.createdAt) >= startOfMonth,
        ).length,
        byPriority: ticketsByPriority,
        recent: openTickets
          .slice()
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5),
      },

      hr: {
        headcount: activeUsers.length,
        departments: departments.length,
        newHires,
        pendingLeave: leaveRequests.length,
        leaveRequests,
        team: activeUsers.slice(0, 8),
      },

      inventory: {
        products: activeProducts.length,
        lowStockCount: lowStock.length,
        outOfStockCount: activeProducts.filter(p => p.stock <= 0).length,
        stockValue,
        alerts: lowStock
          .sort((a, b) => a.stock - b.stock)
          .slice(0, 5)
          .map(p => ({
            id: p.id, name: p.name, sku: p.sku, stock: p.stock,
            reorderLevel: p.reorderLevel, unit: p.unit,
            severity: p.stock <= 0 ? 'out_of_stock' : 'low',
          })),
      },

      calendar: {
        todayCount: events.filter(e => new Date(e.startDate) < endOfToday).length,
        upcoming: events,
      },

      notifications: {
        unread: notifications.filter(n => !n.isRead).length,
        items: notifications,
      },

      activity: activities,
      recentFiles: pages,
    });
  } catch (e: any) {
    return error(e.message || 'Dashboard fetch failed', 500);
  }
}
