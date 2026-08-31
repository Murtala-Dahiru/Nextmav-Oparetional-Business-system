import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { todayIn } from '@/lib/org-time';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The delivery portfolio, in one request
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this answers, and why it is not the dashboard ────────────────────
 *
 * The Executive Overview asks whether the *business* is healthy. This asks
 * whether the *work* is: which engagements are moving, which have stopped,
 * what is due this fortnight, and what is waiting on somebody. They read some
 * of the same rows and they are not the same screen - one is about money that
 * has been earned, the other about promises that have been made.
 *
 * ── Everything here is counted from one population ────────────────────────
 *
 * The Executive Overview shipped a defect worth not repeating: `active` was
 * counted org-wide by one view while `atRisk` and `delayed` were counted over
 * the six rows another query happened to fetch, so a heading and the bar under
 * it described different things. Here, every figure on this page is computed
 * from the same `v_project_health` read, filtered once. If a project is in the
 * count it is in the list, and the arithmetic closes.
 *
 * ── Why `v_project_health` and not a new view ─────────────────────────────
 *
 * Because progress and health already have exactly one definition, shared with
 * the board, the reports, the dashboard and the client portal. A "portfolio
 * view" with its own CASE expression is how those five stop agreeing.
 */

/** A project is being *delivered* in these states. Archived work is history. */
const LIVE = ['planning', 'active', 'on_hold'];

/** Whole days between two `YYYY-MM-DD` days, in the organisation's calendar. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

export async function GET(req: Request) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;

  const today = todayIn(ctx.org.timezone);

  const horizon = new URL(req.url).searchParams.get('horizon');
  /** How far ahead "coming up" looks. Two weeks unless asked otherwise. */
  const days = Math.min(90, Math.max(7, Number(horizon) || 14));
  const until = new Date(`${today}T00:00:00`);
  until.setDate(until.getDate() + days);
  const untilIso = until.toISOString().slice(0, 10);

  /**
   * Twelve weeks of delivery, bucketed from Monday.
   *
   * The window starts on the Monday of the week eleven weeks back, so the last
   * bucket is the week in progress and the first is a whole one. Weeks rather
   * than days because a team's output is lumpy across a week and a daily series
   * is mostly noise; twelve because a quarter is the horizon a delivery lead
   * actually plans over.
   */
  const WEEKS = 12;
  const firstDay = new Date(`${today}T00:00:00Z`);
  // getUTCDay: Sunday is 0, so a Sunday steps back six days rather than none.
  firstDay.setUTCDate(firstDay.getUTCDate() - ((firstDay.getUTCDay() + 6) % 7) - (WEEKS - 1) * 7);
  const trendStart = firstDay.toISOString().slice(0, 10);

  /**
   * The portfolio itself.
   *
   * `v_project_health` is one row per live project with its counts, its
   * progress and its verdict. Read whole rather than aggregated in SQL,
   * because the page shows the projects as well as counting them and a second
   * query for the rows would be a second population.
   */
  const { data: healthRows, error: healthError } = await ctx.supabase
    .from('v_project_health')
    .select('*')
    .eq('organization_id', ctx.org.organizationId)
    .in('status', LIVE);

  if (healthError) return pgError(healthError);
  const portfolio = (healthRows ?? []) as any[];
  const ids = portfolio.map(p => p.project_id);

  /**
   * Who owns each project, and for whom.
   *
   * The health view deliberately carries no joins - it is read by five
   * consumers with five different ideas of what a project's "owner" should
   * look like. One indexed read by id here is cheaper than widening it.
   */
  const { data: metaRows } = ids.length
    ? await ctx.supabase
        .from('projects')
        .select(
          'id, description, updated_at, client_company_id, ' +
          'owner:organization_members!projects_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
          'client:companies(id, name), department:departments(id, name)',
        )
        .in('id', ids)
    : { data: [] as any[] };

  const meta = new Map((metaRows ?? []).map((r: any) => [r.id, r]));

  const [milestones, mine, recentTasks, openTasks, deliverables] = await Promise.all([
    /**
     * Every unfinished phase that has a date, nearest first.
     *
     * One read serves two regions: the runway takes the ones inside the
     * horizon, and each project takes its own first row as the next thing it
     * owes. Two queries for that would be two orderings to keep in step.
     *
     * Phases only. Task due dates are a person's own business and belong in My
     * Work; a milestone is a promise the company made, which is what a
     * portfolio screen is for.
     */
    ids.length
      ? ctx.supabase
          .from('milestones')
          .select(
            'id, name, stage, due_date, completed_at, project_id, ' +
            'owner:organization_members!milestones_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name))',
          )
          .eq('organization_id', ctx.org.organizationId)
          .in('project_id', ids)
          .is('completed_at', null)
          .not('due_date', 'is', null)
          .order('due_date')
          .limit(300)
      : Promise.resolve({ data: [] as any[] }),

    // The caller's own involvement: projects they own or are a member of.
    ctx.supabase
      .from('project_members')
      .select('project_id, role, allocation_pct')
      .eq('member_id', ctx.org.memberId),

    /**
     * What has actually been finished lately.
     *
     * Possible only since 0034 began stamping `tasks.completed_at`. It is the
     * one signal on this page that goes *down* when a team stops delivering,
     * which is what makes it worth showing beside a progress figure that only
     * ever rises.
     */
    ids.length
      ? ctx.supabase
          .from('tasks')
          .select(
            'id, title, project_id, completed_at, ' +
            'assignee:organization_members!tasks_assignee_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))',
          )
          .eq('organization_id', ctx.org.organizationId)
          .in('project_id', ids)
          .is('deleted_at', null)
          .not('completed_at', 'is', null)
          .gte('completed_at', trendStart)
          .order('completed_at', { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [] as any[] }),

    /**
     * Who is carrying the open work, across the whole portfolio.
     *
     * The team panel answers this for one project from tasks it already holds.
     * A portfolio screen cannot: the person under most pressure is usually the
     * one on four projects at once, and no single workspace can see that. One
     * indexed read of the open rows, counted in the route.
     *
     * Deliberately not a capacity model. `project_members.allocation_pct` is a
     * plan per project and the sum of somebody's allocations across four
     * projects is not a percentage of anything; open tasks are a count of real
     * rows, which is the only honest measure available here.
     */
    ids.length
      ? ctx.supabase
          .from('tasks')
          .select(
            'id, due_date, project_id, ' +
            'assignee:organization_members!tasks_assignee_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))',
          )
          .eq('organization_id', ctx.org.organizationId)
          .in('project_id', ids)
          .is('deleted_at', null)
          .neq('status', 'done')
          .limit(2000)
      : Promise.resolve({ data: [] as any[] }),

    // Deliverables the client has not answered on. The one queue on this page
    // where the company is waiting rather than being waited on.
    ids.length
      ? ctx.supabase
          .from('files')
          .select('id, filename, project_id, created_at, is_client_visible')
          .eq('organization_id', ctx.org.organizationId)
          .in('project_id', ids)
          .is('deleted_at', null)
          .eq('requires_approval', true)
          .is('approval_decision', null)
          .order('created_at')
          .limit(25)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const mineIds = new Set((mine.data ?? []).map((r: any) => r.project_id));

  /** The first unfinished dated phase on each project. The rows arrive sorted. */
  const nextPhase = new Map<string, { id: string; name: string; dueDate: string; stage: string }>();
  for (const m of (milestones.data ?? []) as any[]) {
    if (nextPhase.has(m.project_id)) continue;
    nextPhase.set(m.project_id, {
      id: m.id, name: m.name, dueDate: m.due_date, stage: m.stage,
    });
  }

  /**
   * One row per project, with everything a card or a table row renders.
   *
   * Shaped here rather than merged in the browser so the list, the counters
   * and the attention queue below are all reading the same objects - the fault
   * the Executive Overview pass found was two populations, and the cure is one
   * array that every region derives from.
   */
  const projects = portfolio.map(h => {
    const m: any = meta.get(h.project_id) ?? {};
    return {
      id: h.project_id,
      name: h.name,
      status: h.status,
      priority: h.priority,
      budget: Number(h.budget ?? 0),
      startDate: h.start_date,
      endDate: h.end_date,
      description: m.description ?? '',
      updatedAt: m.updated_at ?? null,
      owner: m.owner ?? null,
      client: m.client ?? null,
      department: m.department ?? null,
      health: h.health,
      progressPct: Number(h.progress_pct ?? 0),
      planPct: Number(h.plan_pct ?? 0),
      executionPct: Number(h.execution_pct ?? 0),
      acceptancePct: Number(h.acceptance_pct ?? 0),
      totalTasks: h.total_tasks ?? 0,
      completedTasks: h.completed_tasks ?? 0,
      blockedTasks: h.blocked_tasks ?? 0,
      overdueTasks: h.overdue_tasks ?? 0,
      totalMilestones: h.total_milestones ?? 0,
      completedMilestones: h.completed_milestones ?? 0,
      overdueMilestones: h.overdue_milestones ?? 0,
      totalDeliverables: h.total_deliverables ?? 0,
      pendingDeliverables: h.pending_deliverables ?? 0,
      approvedDeliverables: h.approved_deliverables ?? 0,
      daysRemaining: h.days_remaining,
      loggedHours: Number(h.logged_hours ?? 0),
      memberCount: h.member_count ?? 0,
      isMine: mineIds.has(h.project_id),
      isOverdue: !!h.end_date && h.end_date < today,
      nextMilestone: nextPhase.get(h.project_id) ?? null,
    };
  });

  const byId = new Map(projects.map(p => [p.id, p]));
  const nameOf = (projectId: string) => byId.get(projectId)?.name ?? 'Unknown project';

  /**
   * The attention queue.
   *
   * Three rules, the same three the dashboard's and the CRM's follow, because
   * a queue that behaves differently in each module has to be relearned in
   * each module:
   *
   *   · one row per *concern*, not per record - "four tasks overdue on Atlas"
   *     rather than four rows that push everything else off the screen;
   *   · nothing invented - every row names rows that exist;
   *   · severity means urgency, not size. A missed deadline outranks a large
   *     project that is merely behind.
   */
  const attention = [
    ...projects
      .filter(p => p.isOverdue)
      .map(p => ({
        severity: 'critical' as const,
        projectId: p.id,
        title: `${p.name} is past its end date`,
        /**
         * Days, not a date.
         *
         * The route cannot format a date for the reader: the locale lives in
         * the browser and this string is built on the server, so embedding one
         * means shipping `2026-08-19` into a sentence. A count of days is
         * locale-free, and it is the thing somebody actually wants to know.
         *
         * Rounded, because `progress_pct` is `numeric(4,1)` and "62.1%
         * complete" is a decimal place nobody asked for.
         */
        detail: `${lateBy(p.endDate)} past the target. ${Math.round(p.progressPct)}% complete.`,
      })),
    ...projects
      .filter(p => !p.isOverdue && p.overdueMilestones > 0)
      .map(p => ({
        severity: 'critical' as const,
        projectId: p.id,
        title: `${p.overdueMilestones} phase${p.overdueMilestones === 1 ? '' : 's'} overdue on ${p.name}`,
        detail: 'The plan has slipped behind its own dates.',
      })),
    ...projects
      .filter(p => p.blockedTasks > 0)
      .map(p => ({
        severity: 'high' as const,
        projectId: p.id,
        title: `${p.blockedTasks} blocked task${p.blockedTasks === 1 ? '' : 's'} on ${p.name}`,
        detail: 'Work that cannot proceed until something changes.',
      })),
    ...projects
      .filter(p => !p.isOverdue && p.overdueMilestones === 0 && p.overdueTasks > 0)
      .map(p => ({
        severity: 'high' as const,
        projectId: p.id,
        title: `${p.overdueTasks} overdue task${p.overdueTasks === 1 ? '' : 's'} on ${p.name}`,
        detail: 'Past their due date and not finished.',
      })),
    /**
     * A live project with nobody on it.
     *
     * `member_count` excludes the owner, who is on `projects.owner_id` - so
     * this is "nobody has been assigned to deliver it", which on an active
     * engagement is the quietest way for a month to disappear.
     */
    ...projects
      .filter(p => p.status === 'active' && p.memberCount === 0)
      .map(p => ({
        severity: 'medium' as const,
        projectId: p.id,
        title: `${p.name} has no team`,
        detail: 'Active, with nobody assigned to it.',
      })),
    ...projects
      .filter(p => p.status === 'active' && p.totalTasks === 0 && p.totalMilestones === 0)
      .map(p => ({
        severity: 'medium' as const,
        projectId: p.id,
        title: `${p.name} has no plan yet`,
        detail: 'Active, with no phases and no tasks.',
      })),
  ];

  /** "11 days", from a date in the past to today. */
  function lateBy(iso: string | null): string {
    if (!iso) return 'Some time';
    const n = daysBetween(iso, today);
    return n === 1 ? '1 day' : `${n} days`;
  }

  const RANK = { critical: 0, high: 1, medium: 2 } as const;
  attention.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  const upcoming = (milestones.data ?? [])
    .filter((m: any) => m.due_date <= untilIso)
    .map((m: any) => ({
    id: m.id,
    name: m.name,
    stage: m.stage,
    dueDate: m.due_date,
    projectId: m.project_id,
    projectName: nameOf(m.project_id),
    owner: m.owner?.profiles?.full_name ?? null,
    overdue: m.due_date < today,
  }));

  /**
   * The completion trend.
   *
   * Bucketed here rather than in SQL because the week boundary depends on the
   * organisation's timezone, and a view cannot know it - the same reason 0028
   * refused to bucket the CRM's revenue by month in the database.
   */
  const buckets = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(`${trendStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return { weekStart: d.toISOString().slice(0, 10), count: 0 };
  });

  for (const t of (recentTasks.data ?? []) as any[]) {
    const day = String(t.completed_at).slice(0, 10);
    const week = Math.floor(daysBetween(trendStart, day) / 7);
    if (week >= 0 && week < WEEKS) buckets[week].count += 1;
  }

  /**
   * Open work per person, heaviest first.
   *
   * Unassigned rows are counted separately rather than dropped: on a portfolio
   * screen "nobody is holding forty tasks" is the most important row there is,
   * and a list of named people silently omits it.
   */
  const perPerson = new Map<string, { name: string; avatarUrl: string | null; open: number; overdue: number }>();
  let unassigned = 0;
  for (const t of (openTasks.data ?? []) as any[]) {
    const a = t.assignee;
    if (!a?.id) { unassigned += 1; continue; }
    const row = perPerson.get(a.id) ?? {
      name: a.profiles?.full_name ?? 'Unknown',
      avatarUrl: a.profiles?.avatar_url ?? null,
      open: 0,
      overdue: 0,
    };
    row.open += 1;
    if (t.due_date && t.due_date < today) row.overdue += 1;
    perPerson.set(a.id, row);
  }

  const workload = [...perPerson.entries()]
    .map(([memberId, r]) => ({ memberId, ...r }))
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue);

  return success({
    today,
    horizonDays: days,
    projects,
    attention,
    upcoming,
    waitingOnClient: (deliverables.data ?? []).map((f: any) => ({
      id: f.id,
      filename: f.filename,
      projectId: f.project_id,
      projectName: nameOf(f.project_id),
      since: f.created_at,
    })),
    completionTrend: buckets,
    workload,
    unassignedOpen: unassigned,
    recentlyCompleted: (recentTasks.data ?? []).slice(0, 25).map((t: any) => ({
      id: t.id,
      title: t.title,
      projectId: t.project_id,
      projectName: nameOf(t.project_id),
      at: t.completed_at,
      by: t.assignee?.profiles?.full_name ?? null,
    })),
    /**
     * The totals, computed from `projects` above rather than queried again.
     *
     * This is the whole point of the single population: the strip cannot
     * disagree with the list under it, because it is the list under it.
     */
    totals: {
      live: projects.length,
      active: projects.filter(p => p.status === 'active').length,
      onTrack: projects.filter(p => p.health === 'on_track').length,
      atRisk: projects.filter(p => p.health === 'at_risk').length,
      offTrack: projects.filter(p => p.health === 'off_track').length,
      overdue: projects.filter(p => p.isOverdue).length,
      mine: projects.filter(p => p.isMine).length,
      blockedTasks: projects.reduce((n, p) => n + Number(p.blockedTasks), 0),
      overdueTasks: projects.reduce((n, p) => n + Number(p.overdueTasks), 0),
      openTasks: projects.reduce((n, p) => n + (Number(p.totalTasks) - Number(p.completedTasks)), 0),
      completedTasks: projects.reduce((n, p) => n + Number(p.completedTasks), 0),
      awaitingClient: (deliverables.data ?? []).length,
    },
  });
}
