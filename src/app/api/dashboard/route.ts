import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { can, scopeFor } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';

/**
 * Role-composed dashboard.
 *
 * Sections the caller's role cannot view are absent from the payload entirely
 * rather than sent and hidden — an employee's response contains no revenue
 * figure at all, so there is nothing to read in the network tab.
 *
 * The field names here match what the dashboard component already reads. The
 * headline aggregates come from `v_dashboard_stats`, a `security_invoker`
 * view, so the same RLS that governs the tables governs the rollup; detail
 * lists are fetched in parallel and individually tenant-filtered.
 */
export async function GET() {
  const ctx = await authorize('dashboard', 'view');
  if (ctx instanceof Response) return ctx;

  const { supabase, org, user } = ctx;
  const role = org.role;
  const orgId = org.organizationId;

  const sees = (m: ModuleId) => can(role, m, 'view');
  const orgWide = (m: ModuleId) => scopeFor(role, m) === 'organization';

  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().slice(0, 10);

  const none = Promise.resolve({ data: null, error: null } as any);

  const [
    statsRes, myTasksRes, notifsRes, eventsRes, activityRes, projectsRes,
    pipelineRes, financeRes, alertsRes, leaveRes, ticketsRes, teamRes,
    leadsRes, dealsRes, productsRes, attendanceRes,
  ] = await Promise.all([
    supabase.from('v_dashboard_stats').select('*').eq('organization_id', orgId).maybeSingle(),

    supabase.from('tasks')
      .select('id, title, status, priority, due_date, project:projects(id, name)')
      .eq('organization_id', orgId).eq('assignee_id', org.memberId)
      .neq('status', 'done').is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false }).limit(8),

    supabase.from('notifications').select('*')
      .eq('recipient_id', org.memberId)
      .order('created_at', { ascending: false }).limit(8),

    supabase.from('calendar_events')
      .select('id, title, starts_at, ends_at, all_day, location, colour')
      .eq('organization_id', orgId).gte('starts_at', today).lte('starts_at', in7)
      .order('starts_at', { ascending: true }).limit(6),

    sees('communication')
      ? supabase.from('activity_log')
          .select('id, module, action, title, created_at, member:organization_members!activity_log_member_id_fkey(profiles!organization_members_user_id_fkey(full_name, avatar_url))')
          .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(8)
      : none,

    sees('projects')
      ? supabase.from('v_project_health').select('*').eq('organization_id', orgId)
          .order('days_remaining', { ascending: true, nullsFirst: false }).limit(6)
      : none,

    sees('crm')
      ? supabase.from('v_pipeline_summary').select('*').eq('organization_id', orgId)
      : none,

    sees('finance')
      ? supabase.from('v_finance_monthly').select('*').eq('organization_id', orgId)
          .order('period', { ascending: true }).limit(6)
      : none,

    sees('inventory')
      ? supabase.from('v_inventory_alerts').select('*').eq('organization_id', orgId).limit(6)
      : none,

    can(role, 'hr', 'approve')
      ? supabase.from('leave_requests')
          .select('id, type, start_date, end_date, member:organization_members!leave_requests_member_id_fkey(profiles!organization_members_user_id_fkey(full_name))')
          .eq('organization_id', orgId).eq('status', 'pending')
          .order('start_date', { ascending: true }).limit(6)
      : none,

    sees('support')
      ? supabase.from('support_tickets')
          .select('id, ticket_number, subject, status, priority, due_at, created_at, resolved_at')
          .eq('organization_id', orgId).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(50)
      : none,

    sees('hr') && orgWide('hr')
      ? supabase.from('v_org_directory')
          .select('member_id, full_name, avatar_url, job_title, department_name')
          .eq('organization_id', orgId).eq('is_active', true).limit(8)
      : none,

    sees('crm')
      ? supabase.from('leads').select('id, created_at, status')
          .eq('organization_id', orgId).is('deleted_at', null)
      : none,

    sees('crm')
      ? supabase.from('deals').select('id, stage, value, probability')
          .eq('organization_id', orgId).is('deleted_at', null)
      : none,

    sees('inventory')
      ? supabase.from('products').select('id, stock, cost, reorder_level, is_active')
          .eq('organization_id', orgId).is('deleted_at', null)
      : none,

    supabase.from('attendance_records').select('*')
      .eq('member_id', org.memberId).eq('work_date', today).maybeSingle(),
  ]);

  if (statsRes.error) return pgError(statsRes.error);
  const s: any = statsRes.data ?? {};

  // ── derived figures ──────────────────────────────────────────────────────

  const monthly = (financeRes.data ?? []) as any[];
  const thisMonth = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2];
  const revenueThisMonth = Number(thisMonth?.revenue ?? 0);
  const revenuePrev = Number(prevMonth?.revenue ?? 0);
  // Null rather than 0 when there is no prior month: "no comparison" and
  // "flat" are different statements and the tile renders them differently.
  const revenueTrend = revenuePrev
    ? Math.round(((revenueThisMonth - revenuePrev) / revenuePrev) * 1000) / 10
    : null;

  const deals = (dealsRes.data ?? []) as any[];
  const closed = deals.filter(d => d.stage === 'closed_won' || d.stage === 'closed_lost');
  const won = deals.filter(d => d.stage === 'closed_won');

  const tickets = (ticketsRes.data ?? []) as any[];
  const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));

  const products = (productsRes.data ?? []) as any[];
  const activeProducts = products.filter(p => p.is_active);

  const payload: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    viewer: {
      id: user.id,
      firstName: user.firstName,
      fullName: user.fullName,
      role,
      jobTitle: user.jobTitle,
      department: null,
      organizationName: org.organizationName,
    },
    // Orientation strip. Financial figures are added below only for roles
    // entitled to them.
    company: {
      headcount: s.headcount ?? 0,
      departments: s.department_count ?? 0,
      onlineNow: s.online_now ?? 0,
      newHires: 0,
      activeProjects: s.active_projects ?? 0,
      openTickets: s.open_tickets ?? 0,
      warehouses: 0,
      revenue: 0,
      revenueThisMonth: 0,
      revenueTrend: null,
      pipelineValue: 0,
      weightedPipeline: 0,
      openDeals: 0,
    },
    myWork: {
      userId: org.memberId,
      openTasks: s.open_tasks ?? 0,
      attendanceToday: attendanceRes.data ?? null,
      tasks: ((myTasksRes.data ?? []) as any[]).map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date,
        projectName: t.project?.name ?? null,
        overdue: !!t.due_date && t.due_date < today,
      })),
    },
    notifications: {
      unread: ((notifsRes.data ?? []) as any[]).filter(n => !n.is_read).length,
      items: notifsRes.data ?? [],
    },
    calendar: {
      todayCount: ((eventsRes.data ?? []) as any[])
        .filter(e => String(e.starts_at).slice(0, 10) === today).length,
      upcoming: eventsRes.data ?? [],
    },
  };

  if (activityRes.data) payload.activity = activityRes.data;

  if (sees('crm')) {
    const leads = (leadsRes.data ?? []) as any[];
    const open = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage));
    const pipelineValue = open.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
    const weighted = open.reduce((sum, d) => sum + Number(d.value ?? 0) * (d.probability ?? 0) / 100, 0);

    payload.crm = {
      totalLeads: leads.length,
      newLeads: leads.filter(l => String(l.created_at).slice(0, 10) >= monthStart).length,
      qualifiedLeads: leads.filter(l => l.status === 'qualified').length,
      pipelineValue,
      weightedPipeline: weighted,
      wonValue: won.reduce((sum, d) => sum + Number(d.value ?? 0), 0),
      winRate: closed.length ? Math.round((won.length / closed.length) * 1000) / 10 : 0,
      dealsByStage: ((pipelineRes.data ?? []) as any[]).map(r => ({
        stage: r.stage,
        count: Number(r.deal_count ?? 0),
        value: Number(r.total_value ?? 0),
      })),
      leadsByStatus: [],
      topDeals: [],
    };

    (payload.company as any).pipelineValue = pipelineValue;
    (payload.company as any).weightedPipeline = weighted;
    (payload.company as any).openDeals = open.length;
  }

  // Revenue is limited to roles with organisation-wide sight of finance.
  if (sees('finance') && orgWide('finance')) {
    const revenue = monthly.reduce((sum, m) => sum + Number(m.revenue ?? 0), 0);
    const expenses = monthly.reduce((sum, m) => sum + Number(m.expenses ?? 0), 0);

    payload.finance = {
      revenue,
      revenueThisMonth,
      revenueTrend,
      outstanding: Number(s.receivables ?? 0),
      overdueCount: 0,
      overdueValue: 0,
      totalExpenses: expenses,
      expensesThisMonth: Number(thisMonth?.expenses ?? 0),
      pendingExpenseCount: s.pending_expenses ?? 0,
      pendingExpenseValue: 0,
      netPosition: revenue - expenses,
      revenueByMonth: monthly.map(m => ({
        month: new Date(m.period).toLocaleString('en-US', { month: 'short' }),
        revenue: Number(m.revenue ?? 0),
        expenses: Number(m.expenses ?? 0),
      })),
      recentInvoices: [],
    };

    (payload.company as any).revenue = revenue;
    (payload.company as any).revenueThisMonth = revenueThisMonth;
    (payload.company as any).revenueTrend = revenueTrend;
  }

  if (sees('projects')) {
    const progress = ((projectsRes.data ?? []) as any[]).map(p => ({
      id: p.project_id,
      name: p.name,
      status: p.status,
      priority: p.priority,
      totalTasks: Number(p.total_tasks ?? 0),
      doneTasks: Number(p.completed_tasks ?? 0),
      progress: Number(p.progress_pct ?? 0),
      daysLeft: p.days_remaining === null ? null : Number(p.days_remaining),
      atRisk: !!p.is_at_risk,
    }));

    payload.projects = {
      total: progress.length,
      active: s.active_projects ?? 0,
      atRisk: progress.filter(p => p.atRisk).length,
      totalBudget: 0,
      overdueTasks: s.overdue_tasks ?? 0,
      tasksDueThisWeek: 0,
      progress,
    };
  }

  if (sees('support')) {
    payload.support = {
      open: openTickets.length,
      breached: openTickets.filter(t => t.due_at && new Date(t.due_at) < new Date()).length,
      critical: openTickets.filter(t => t.priority === 'critical').length,
      resolvedThisMonth: tickets.filter(
        t => t.resolved_at && String(t.resolved_at).slice(0, 10) >= monthStart,
      ).length,
      byPriority: ['critical', 'high', 'medium', 'low'].map(priority => ({
        priority,
        count: openTickets.filter(t => t.priority === priority).length,
      })),
      recent: openTickets.slice(0, 5).map(t => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_at,
      })),
    };
  }

  if (sees('inventory')) {
    payload.inventory = {
      products: activeProducts.length,
      lowStockCount: activeProducts.filter(p => p.stock <= p.reorder_level).length,
      outOfStockCount: activeProducts.filter(p => p.stock <= 0).length,
      stockValue: activeProducts.reduce((sum, p) => sum + Number(p.stock) * Number(p.cost ?? 0), 0),
      alerts: ((alertsRes.data ?? []) as any[]).map(a => ({
        id: a.product_id,
        name: a.name,
        sku: a.sku,
        stock: Number(a.stock ?? 0),
        reorderLevel: Number(a.reorder_level ?? 0),
        unit: a.unit,
        severity: a.severity,
      })),
    };
  }

  if (sees('hr')) {
    payload.hr = {
      headcount: orgWide('hr') ? s.headcount ?? 0 : 0,
      departments: s.department_count ?? 0,
      newHires: 0,
      pendingLeave: s.pending_leave ?? 0,
      leaveRequests: ((leaveRes.data ?? []) as any[]).map(l => ({
        id: l.id,
        type: l.type,
        startDate: l.start_date,
        endDate: l.end_date,
        requester: l.member?.profiles
          ? {
              firstName: String(l.member.profiles.full_name ?? '').split(' ')[0] ?? '',
              lastName: String(l.member.profiles.full_name ?? '').split(' ').slice(1).join(' '),
              avatar: '',
              department: '',
            }
          : undefined,
      })),
      team: ((teamRes.data ?? []) as any[]).map(m => ({
        id: m.member_id,
        firstName: String(m.full_name ?? '').split(' ')[0] ?? '',
        lastName: String(m.full_name ?? '').split(' ').slice(1).join(' '),
        jobTitle: m.job_title ?? '',
        department: m.department_name ?? '',
        avatar: m.avatar_url ?? '',
        lastSeen: '',
      })),
    };
  }

  if (sees('workspace')) {
    const { data: pages } = await supabase
      .from('workspace_pages')
      .select('id, title, icon, updated_at, is_starred:is_template')
      .eq('organization_id', orgId).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(6);
    payload.recentFiles = (pages ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      icon: p.icon ?? 'file-text',
      color: '#10b981',
      updatedAt: p.updated_at,
      isStarred: false,
    }));
  }

  return success(payload);
}
