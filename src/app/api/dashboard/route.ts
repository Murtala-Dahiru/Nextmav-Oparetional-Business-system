import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { can, scopeFor } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';

/**
 * Role-composed dashboard.
 *
 * Sections a role cannot view are absent from the payload entirely rather than
 * sent and hidden in the UI — an employee's response contains no revenue
 * figure at all, so there is nothing to leak in the network tab.
 *
 * Headline aggregates come from `v_dashboard_stats`, a `security_invoker` view,
 * so the same RLS that governs the tables governs the rollup. Detail lists are
 * fetched in parallel and are individually tenant-filtered.
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
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [
    statsRes, myTasksRes, notifsRes, eventsRes, activityRes,
    projectsRes, pipelineRes, alertsRes, leaveRes, ticketsRes, financeRes, attendanceRes,
  ] = await Promise.all([
    supabase.from('v_dashboard_stats').select('*').eq('organization_id', orgId).maybeSingle(),

    // Always personal, for every role including external clients.
    supabase.from('tasks')
      .select('id, title, status, priority, due_date, project:projects(id, name)')
      .eq('organization_id', orgId).eq('assignee_id', org.memberId)
      .neq('status', 'done').is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false }).limit(8),

    supabase.from('notifications')
      .select('*').eq('recipient_id', org.memberId)
      .order('created_at', { ascending: false }).limit(8),

    supabase.from('calendar_events')
      .select('id, title, starts_at, ends_at, all_day, location, colour')
      .eq('organization_id', orgId)
      .gte('starts_at', today).lte('starts_at', in7)
      .order('starts_at', { ascending: true }).limit(6),

    sees('communication')
      ? supabase.from('activity_log')
          .select('id, module, action, title, created_at, member:organization_members(profiles!organization_members_user_id_fkey(full_name, avatar_url))')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false }).limit(8)
      : Promise.resolve({ data: null, error: null } as any),

    sees('projects')
      ? supabase.from('v_project_health').select('*').eq('organization_id', orgId)
          .order('days_remaining', { ascending: true, nullsFirst: false }).limit(6)
      : Promise.resolve({ data: null, error: null } as any),

    sees('crm')
      ? supabase.from('v_pipeline_summary').select('*').eq('organization_id', orgId)
      : Promise.resolve({ data: null, error: null } as any),

    sees('inventory')
      ? supabase.from('v_inventory_alerts').select('*').eq('organization_id', orgId).limit(6)
      : Promise.resolve({ data: null, error: null } as any),

    // Pending approvals are only actionable by someone who can approve.
    can(role, 'hr', 'approve')
      ? supabase.from('leave_requests')
          .select('id, type, start_date, end_date, member:organization_members(profiles!organization_members_user_id_fkey(full_name))')
          .eq('organization_id', orgId).eq('status', 'pending')
          .order('start_date', { ascending: true }).limit(6)
      : Promise.resolve({ data: null, error: null } as any),

    sees('support')
      ? supabase.from('support_tickets')
          .select('id, ticket_number, subject, status, priority, due_at')
          .eq('organization_id', orgId).not('status', 'in', '("resolved","closed")')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(5)
      : Promise.resolve({ data: null, error: null } as any),

    sees('finance')
      ? supabase.from('v_finance_monthly').select('*').eq('organization_id', orgId)
          .order('period', { ascending: true }).limit(6)
      : Promise.resolve({ data: null, error: null } as any),

    // Own attendance for today — drives the clock widget.
    supabase.from('attendance_records')
      .select('*').eq('member_id', org.memberId).eq('work_date', today).maybeSingle(),
  ]);

  if (statsRes.error) return pgError(statsRes.error);

  const stats: any = statsRes.data ?? {};

  const payload: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    viewer: {
      id: user.id,
      firstName: user.firstName,
      fullName: user.fullName,
      role,
      jobTitle: user.jobTitle,
      organizationName: org.organizationName,
    },
    // Orientation figures that carry no financial detail.
    company: {
      headcount: stats.headcount ?? 0,
      departments: stats.department_count ?? 0,
      onlineNow: stats.online_now ?? 0,
      activeProjects: stats.active_projects ?? 0,
    },
    myWork: {
      tasks: (myTasksRes.data ?? []).map((t: any) => ({
        ...t,
        overdue: !!t.due_date && t.due_date < today,
      })),
      openTasks: stats.open_tasks ?? 0,
      attendanceToday: attendanceRes.data ?? null,
    },
    notifications: {
      items: notifsRes.data ?? [],
      unread: (notifsRes.data ?? []).filter((n: any) => !n.is_read).length,
    },
    calendar: { upcoming: eventsRes.data ?? [] },
  };

  if (activityRes.data) payload.activity = activityRes.data;

  if (sees('projects')) {
    payload.projects = {
      active: stats.active_projects ?? 0,
      overdueTasks: stats.overdue_tasks ?? 0,
      progress: projectsRes.data ?? [],
      atRisk: (projectsRes.data ?? []).filter((p: any) => p.is_at_risk).length,
    };
  }

  if (sees('crm')) {
    payload.crm = {
      weightedPipeline: Number(stats.weighted_pipeline ?? 0),
      openPipeline: Number(stats.open_pipeline ?? 0),
      byStage: pipelineRes.data ?? [],
    };
  }

  // Revenue is limited to roles with organisation-wide sight of finance.
  if (sees('finance') && orgWide('finance')) {
    payload.finance = {
      revenueCollected: Number(stats.revenue_collected ?? 0),
      receivables: Number(stats.receivables ?? 0),
      pendingExpenses: stats.pending_expenses ?? 0,
      monthly: financeRes.data ?? [],
    };
  }

  if (sees('support')) {
    payload.support = {
      open: stats.open_tickets ?? 0,
      breached: stats.breached_tickets ?? 0,
      recent: ticketsRes.data ?? [],
    };
  }

  if (sees('inventory')) {
    payload.inventory = {
      lowStockCount: stats.low_stock_products ?? 0,
      alerts: alertsRes.data ?? [],
    };
  }

  if (sees('hr')) {
    payload.hr = {
      headcount: orgWide('hr') ? stats.headcount ?? 0 : 0,
      pendingLeave: stats.pending_leave ?? 0,
      approvals: leaveRes.data ?? [],
    };
  }

  return success(payload);
}
