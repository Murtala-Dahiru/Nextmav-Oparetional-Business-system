import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { todayIn, startOfMonthIn, daysFromTodayIn } from '@/lib/org-time';
import { can, scopeFor } from '@/lib/permissions';
import { visibleModuleFilter } from '@/lib/activity';
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

  /**
   * Every bound here is the organisation's calendar day, not UTC's.
   *
   * `work_date`, `due_date` and `expense_date` are all written as local dates
   * by the database. Comparing them against a UTC day meant that, in any
   * workspace east of UTC, "today's attendance" and "due this week" were both
   * off by a day for part of every day — and month-to-date revenue reset at the
   * wrong hour on the first of the month.
   */
  const today = todayIn(ctx.org.timezone);
  const in7 = daysFromTodayIn(ctx.org.timezone, 7);
  const monthStart = startOfMonthIn(ctx.org.timezone);
  /**
   * The last calendar day of the organisation's current month.
   *
   * Built from `monthStart` rather than from `new Date()` so it lands in the
   * same month the rest of this handler is reasoning about — on the 1st, in a
   * workspace east of UTC, those are not always the same month. Day 0 of the
   * following month is the last day of this one, and `Date` normalises the
   * December rollover on its own.
   */
  const monthEnd = (() => {
    const [y, m] = monthStart.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();

  const none = Promise.resolve({ data: null, error: null } as any);

  const [
    statsRes, myTasksRes, notifsRes, eventsRes, activityRes, projectsRes,
    pipelineRes, financeRes, alertsRes, leaveRes, ticketsRes, teamRes,
    leadsRes, dealsRes, productsRes, attendanceRes, ageingRes, doneTasksRes,
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
      .order('starts_at', { ascending: true }).limit(10),

    /**
     * The activity feed, scoped to the modules this role may open.
     *
     * `.in('module', …)` is the access boundary, not a preference: RLS keeps
     * these rows inside the tenant but knows nothing about module grants, so
     * without it this panel narrates Finance and HR to everyone who can see a
     * dashboard. See `visibleModuleFilter` for the full reasoning.
     */
    sees('communication')
      ? supabase.from('activity_log')
          .select('id, module, action, title, entity_type, entity_id, created_at, member:organization_members!activity_log_member_id_fkey(profiles!organization_members_user_id_fkey(first_name, last_name, avatar_url))')
          .eq('organization_id', orgId)
          .in('module', visibleModuleFilter(ctx))
          .order('created_at', { ascending: false }).limit(18)
      : none,

    /**
     * Project health, over projects that are actually being delivered.
     *
     * `v_project_health` has no status filter — it is `FROM projects WHERE
     * deleted_at IS NULL`, deliberately, because the projects module and the
     * reports both read it and both want every project. This handler did not
     * filter either, and ordered the result by `days_remaining` ascending,
     * which is the one ordering that puts *finished* work at the top: a
     * project completed in March has a `days_remaining` of about -150, so it
     * outranked everything genuinely late.
     *
     * Two things followed from that, both visible on the screen:
     *
     *   · the table listed planning, completed, cancelled and archived
     *     projects under the heading "Project health", and
     *   · `delayed` below is computed as `days_remaining < 0` with no status
     *     test, so every completed project with a past end date was counted
     *     as past deadline and drawn with a red severity rail. The view's own
     *     `is_at_risk` excludes those states; this handler's arithmetic did
     *     not.
     *
     * The count beside the heading is `active_projects` from
     * `v_dashboard_stats`, which is `status = 'active'`. Matching that here is
     * what makes the section's count, its strip, its bar and its rows all
     * describe one population.
     */
    sees('projects')
      ? supabase.from('v_project_health').select('*').eq('organization_id', orgId)
          .eq('status', 'active')
          .order('days_remaining', { ascending: true, nullsFirst: false }).limit(8)
      : none,

    sees('crm')
      ? supabase.from('v_pipeline_summary').select('*').eq('organization_id', orgId)
      : none,

    /**
     * The most recent twelve months — descending, then reversed below.
     *
     * This was `.order('period', ascending: true).limit(6)`, which takes the
     * six OLDEST months on record and then treats the last of them as "this
     * month". Every figure downstream inherits that: `revenueThisMonth`, the
     * month-on-month trend, the plate's headline and the whole chart. A
     * workspace with two years of invoices was being shown its first six
     * months, labelled as now, with no indication anything was wrong.
     *
     * It went unnoticed because it is invisible for exactly the first six
     * months of a workspace's life, which is how long a demo dataset tends to
     * be. Ascending + limit is the wrong shape for "latest N" in every case;
     * descending + limit + reverse is the right one.
     *
     * Twelve rather than six because the chart's range control offers the
     * ladder the data can fill, and a year is the span an executive view is
     * actually asked for.
     */
    sees('finance')
      ? supabase.from('v_finance_monthly').select('*').eq('organization_id', orgId)
          .order('period', { ascending: false }).limit(12)
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

    /**
     * Extra columns, same query.
     *
     * `updated_at` is what makes "stalled" a measurement rather than a guess:
     * a deal nobody has touched in thirty days is a fact the table already
     * records. `expected_close` and `closed_at` answer "what lands this month"
     * and "what did we win this month" from rows that were already being read
     * for their stage and value.
     */
    sees('crm')
      ? supabase.from('deals')
          .select('id, name, stage, value, probability, updated_at, expected_close, closed_at')
          .eq('organization_id', orgId).is('deleted_at', null)
      : none,

    sees('inventory')
      ? supabase.from('products').select('id, stock, cost, reorder_level, is_active')
          .eq('organization_id', orgId).is('deleted_at', null)
      : none,

    supabase.from('attendance_records').select('*')
      .eq('member_id', org.memberId).eq('work_date', today).maybeSingle(),

    /**
     * Receivables ageing.
     *
     * `v_receivables_ageing` has existed since 0007 and nothing has ever read
     * it. It already excludes paid, cancelled and draft invoices and buckets
     * the rest by how late they are, so "how much are we waiting to collect,
     * and how overdue is it" needs no computation here — only a SELECT.
     *
     * This is also what retires `finance.overdueCount` and `overdueValue`,
     * which have been hard-coded zeros telling every organisation on the
     * platform that it had nothing overdue.
     */
    sees('finance') && orgWide('finance')
      ? supabase.from('v_receivables_ageing')
          .select('invoice_id, invoice_number, company_name, balance, due_date, days_overdue, ageing_bucket')
          .eq('organization_id', orgId)
          .order('days_overdue', { ascending: false })
      : none,

    /**
     * Eight weeks of completions, and nothing else.
     *
     * Bounded by `completed_at` rather than by fetching the task table and
     * counting in memory: an organisation with twenty thousand tasks would
     * otherwise ship all of them over the wire to draw a bar chart. The status
     * totals this sits beside come from `v_dashboard_stats`, which already
     * aggregates them in the database.
     */
    sees('projects')
      ? supabase.from('tasks').select('completed_at')
          .eq('organization_id', orgId).is('deleted_at', null)
          .not('completed_at', 'is', null)
          .gte('completed_at', daysFromTodayIn(ctx.org.timezone, -56))
      : none,
  ]);

  if (statsRes.error) return pgError(statsRes.error);
  const s: any = statsRes.data ?? {};

  // ── derived figures ──────────────────────────────────────────────────────

  /**
   * Back into chronological order.
   *
   * The query asks for the *latest* twelve months, which means it has to sort
   * descending — but every consumer below, and the chart itself, reads this
   * array left to right as time moving forwards. `.reverse()` on the copy the
   * client already owns is the whole cost of that.
   *
   * `slice()` first: `financeRes.data` is the response object's own array and
   * reversing it in place would mutate what other readers see.
   */
  const monthly = ((financeRes.data ?? []) as any[]).slice().reverse();
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

  /**
   * Flattened to the `user: { firstName, lastName, avatar }` the panel reads.
   *
   * The panel has always declared that shape while the query returned
   * `member.profiles.full_name`, so its avatar initials could only ever have
   * rendered the em-dash fallback. Invisible until now for the reason the rest
   * of this change exists: the list was permanently empty, so nothing rendered.
   */
  if (activityRes.data) {
    payload.activity = (activityRes.data as any[]).map(a => {
      const p = a.member?.profiles ?? null;
      return {
        id: a.id, module: a.module, action: a.action, title: a.title,
        description: '', entityType: a.entity_type, entityId: a.entity_id,
        createdAt: a.created_at,
        user: p
          ? { firstName: p.first_name ?? '', lastName: p.last_name ?? '', avatar: p.avatar_url ?? '' }
          : undefined,
      };
    });
  }

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

      /**
       * Momentum, all of it derived from columns on the rows above.
       *
       * "Stalled" is deliberately defined as *nobody has touched this record in
       * thirty days*, not as some judgement about the deal's quality — that is
       * what `updated_at` actually means, and it is the only claim these rows
       * support. A deal can be perfectly healthy and stalled by this
       * definition, which is why the label says "no change in 30 days" rather
       * than "at risk".
       */
      stalled: open.filter(d => {
        const touched = d.updated_at ? new Date(d.updated_at).getTime() : null;
        return touched !== null && Date.now() - touched > 30 * 86_400_000;
      }).length,
      closingThisMonth: open.filter(
        d => d.expected_close && String(d.expected_close).slice(0, 10) <= monthEnd
          && String(d.expected_close).slice(0, 10) >= today,
      ).length,
      wonThisMonth: won.filter(
        d => d.closed_at && String(d.closed_at).slice(0, 10) >= monthStart,
      ).length,
      wonValueThisMonth: won
        .filter(d => d.closed_at && String(d.closed_at).slice(0, 10) >= monthStart)
        .reduce((sum, d) => sum + Number(d.value ?? 0), 0),
      /** The five largest open deals, named. */
      topOpen: [...open]
        .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
        .slice(0, 5)
        .map(d => ({
          id: d.id,
          name: d.name,
          stage: d.stage,
          value: Number(d.value ?? 0),
          probability: Number(d.probability ?? 0),
          expectedClose: d.expected_close ?? null,
        })),
    };

    (payload.company as any).pipelineValue = pipelineValue;
    (payload.company as any).weightedPipeline = weighted;
    (payload.company as any).openDeals = open.length;
  }

  // Revenue is limited to roles with organisation-wide sight of finance.
  if (sees('finance') && orgWide('finance')) {
    const revenue = monthly.reduce((sum, m) => sum + Number(m.revenue ?? 0), 0);
    const expenses = monthly.reduce((sum, m) => sum + Number(m.expenses ?? 0), 0);

    /**
     * Receivables, from the ageing view rather than from a constant.
     *
     * `current` is invoiced and not yet due; everything else is late by the
     * number of days in its bucket name. Both totals are sums of `balance`,
     * which is `total - amount_paid`, so a part-paid invoice contributes only
     * what is still owed.
     */
    const ageing = (ageingRes.data ?? []) as any[];
    const overdue = ageing.filter(r => r.ageing_bucket !== 'current');
    const sumBalance = (rows: any[]) => rows.reduce((sum, r) => sum + Number(r.balance ?? 0), 0);

    const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;

    payload.finance = {
      revenue,
      revenueThisMonth,
      revenueTrend,
      outstanding: Number(s.receivables ?? 0),
      overdueCount: overdue.length,
      overdueValue: sumBalance(overdue),
      totalExpenses: expenses,
      expensesThisMonth: Number(thisMonth?.expenses ?? 0),
      pendingExpenseCount: s.pending_expenses ?? 0,
      pendingExpenseValue: 0,
      netPosition: revenue - expenses,
      // `invoiced` was already in the view and already fetched. Collected
      // against invoiced is the difference between "we did the work" and "we
      // got paid for it", which is the question the chart could not answer.
      /**
       * ── `current`, and why the client cannot work it out for itself ──────
       *
       * The last row of this series is almost always the month in progress,
       * and the whole page treats it as a completed measurement: the plate
       * prints it as "Revenue this month", the trend divides it by a *whole*
       * previous month, and the chart plots it as the twelfth point of twelve.
       * On the 28th that is twenty-eight days being compared against
       * thirty-one, and the resulting "down 34.2%" is arithmetic on two
       * different-sized things.
       *
       * The weekly completion chart in `delivery.tsx` already handles exactly
       * this — it draws the current week lighter, with a note saying a Tuesday
       * reading always looks like a collapse. The money chart never did.
       *
       * The flag is computed here rather than on the client for two reasons:
       * the comparison has to happen in the *organisation's* timezone, which
       * only the server knows, and the label the client receives is "Aug",
       * which two Augusts a year apart both answer to. `period` is the
       * month's first day, so the year-and-month prefix is the whole test.
       */
      revenueByMonth: monthly.map(m => ({
        month: new Date(m.period).toLocaleString('en-US', { month: 'short' }),
        revenue: Number(m.revenue ?? 0),
        expenses: Number(m.expenses ?? 0),
        invoiced: Number(m.invoiced ?? 0),
        current: String(m.period).slice(0, 7) === monthStart.slice(0, 7),
      })),

      /**
       * How far into the current month the organisation is.
       *
       * Both bounds already exist above and are already in the organisation's
       * timezone. It is sent unconditionally — a series that happens to end on
       * a past month simply has no row flagged `current`, and the client draws
       * nothing.
       */
      monthToDate: {
        elapsed: Number(today.slice(8, 10)),
        days: Number(monthEnd.slice(8, 10)),
      },
      receivables: {
        outstanding: sumBalance(ageing),
        current: sumBalance(ageing.filter(r => r.ageing_bucket === 'current')),
        overdueValue: sumBalance(overdue),
        overdueCount: overdue.length,
        invoiceCount: ageing.length,
        buckets: BUCKETS.map(bucket => {
          const rows = ageing.filter(r => r.ageing_bucket === bucket);
          return { bucket, count: rows.length, value: sumBalance(rows) };
        }),
        // The worst few, named — an ageing chart tells you there is a problem
        // and a list tells you whose.
        worst: overdue.slice(0, 4).map(r => ({
          id: r.invoice_id,
          number: r.invoice_number,
          company: r.company_name ?? null,
          balance: Number(r.balance ?? 0),
          daysOverdue: Number(r.days_overdue ?? 0),
        })),
      },
      recentInvoices: [],
    };

    (payload.company as any).revenue = revenue;
    (payload.company as any).revenueThisMonth = revenueThisMonth;
    (payload.company as any).revenueTrend = revenueTrend;
  }

  if (sees('projects')) {
    /**
     * `v_project_health` computes eleven columns and this endpoint used to map
     * five of them. Blocked tasks, overdue tasks and the milestone counts were
     * all being fetched over the wire and thrown away — so "why is this project
     * at risk" was unanswerable on the dashboard even though the database had
     * already worked it out.
     */
    const progress = ((projectsRes.data ?? []) as any[]).map(p => {
      const daysLeft = p.days_remaining === null ? null : Number(p.days_remaining);
      return {
        id: p.project_id,
        name: p.name,
        status: p.status,
        priority: p.priority,
        totalTasks: Number(p.total_tasks ?? 0),
        doneTasks: Number(p.completed_tasks ?? 0),
        blockedTasks: Number(p.blocked_tasks ?? 0),
        overdueTasks: Number(p.overdue_tasks ?? 0),
        progress: Number(p.progress_pct ?? 0),
        daysLeft,
        endDate: p.end_date ?? null,
        atRisk: !!p.is_at_risk,
        // 0015 added these; they are null on a database still at 0007, so the
        // client must treat a zero total as "this project has no milestones"
        // rather than as "none are done".
        milestones: {
          total: Number(p.total_milestones ?? 0),
          done: Number(p.completed_milestones ?? 0),
          overdue: Number(p.overdue_milestones ?? 0),
        },
      };
    });

    const late = progress.filter(p => p.daysLeft !== null && p.daysLeft < 0);

    payload.projects = {
      total: progress.length,
      active: s.active_projects ?? 0,
      atRisk: progress.filter(p => p.atRisk).length,
      // Past its end date is a different condition from flagged at risk, and
      // the two overlap; counted separately so the client never adds them.
      delayed: late.length,
      onTrack: progress.filter(p => !p.atRisk && !(p.daysLeft !== null && p.daysLeft < 0)).length,
      totalBudget: 0,
      overdueTasks: s.overdue_tasks ?? 0,
      tasksDueThisWeek: 0,
      progress,
    };

    /**
     * Work: the two totals the database already aggregates, and eight weeks of
     * completions bucketed by ISO week.
     *
     * Bucketing happens here rather than in SQL because the boundary has to be
     * the organisation's week, not UTC's — the same reason every other date
     * bound in this file goes through `org-time`.
     */
    const completions = ((doneTasksRes.data ?? []) as any[])
      .map(t => t.completed_at)
      .filter(Boolean);

    const weeks: { week: string; start: string; count: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(daysFromTodayIn(ctx.org.timezone, -i * 7));
      // Monday of that week, so the buckets are stable rather than sliding.
      const day = (start.getUTCDay() + 6) % 7;
      start.setUTCDate(start.getUTCDate() - day);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      const iso = start.toISOString().slice(0, 10);
      if (weeks.some(w => w.start === iso)) continue;
      weeks.push({
        week: start.toLocaleString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        start: iso,
        count: completions.filter(c => {
          const t = new Date(c).getTime();
          return t >= start.getTime() && t < end.getTime();
        }).length,
      });
    }

    payload.work = {
      openTasks: s.open_tasks ?? 0,
      overdueTasks: s.overdue_tasks ?? 0,
      completedLast8Weeks: completions.length,
      completionByWeek: weeks,
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
    /**
     * The workspace's recent pages.
     *
     * This read used to say `is_starred:is_template` - an alias written before
     * `is_starred` existed, which 0014 then added. It selected the *template*
     * flag under the star's name, and the mapping below discarded it anyway
     * and hard-coded `isStarred: false`, so the dashboard has never shown a
     * star on a starred page and the alias was pointing at the wrong column
     * the whole time. Both are fixed: the real columns are read, and the
     * colour is the page's own rather than a framework green.
     *
     * Folders and templates are excluded. A folder's timestamp moves whenever
     * anything inside it is renamed, so including them fills a "recent" list
     * with containers rather than with what somebody was working on.
     */
    const { data: pages } = await supabase
      .from('workspace_pages')
      .select('id, title, icon, colour, updated_at, is_starred')
      .eq('organization_id', orgId).is('deleted_at', null)
      .eq('is_folder', false).eq('is_template', false)
      .order('updated_at', { ascending: false }).limit(6);
    payload.recentFiles = (pages ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      icon: p.icon ?? 'file-text',
      color: p.colour ?? '#2d9572',
      updatedAt: p.updated_at,
      isStarred: p.is_starred === true,
    }));
  }

  return success(payload);
}
