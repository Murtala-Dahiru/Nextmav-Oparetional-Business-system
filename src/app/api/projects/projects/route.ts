import { collectionHandlers } from '@/lib/supabase/crud';
import { getContext } from '@/lib/auth-context';

/**
 * `owner` previously resolved to `(id)` alone, so the project card — which
 * renders the owner's initials and full name — had nothing to show and left
 * both blank. The profile join is the same one every other module already
 * uses for a member.
 */
const SELECT =
  '*, department:departments(id, name), ' +
  'owner:organization_members!projects_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'client:companies(id, name)';

const { GET: listProjects, POST } = collectionHandlers(
  {
    table: 'projects', module: 'projects', select: SELECT, softDelete: true,
    searchColumns: ['name', 'description'],
    sortable: ['created_at', 'updated_at', 'name', 'status', 'priority', 'budget', 'start_date', 'end_date'],
    filterable: ['status', 'priority', 'owner_id', 'department_id'],
  },
  {
    table: 'projects', module: 'projects', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Project name is required');
      if (b.start_date && b.end_date && b.end_date < b.start_date) {
        throw new Error('End date cannot be before the start date');
      }
      return {
        name: b.name.trim(), description: b.description ?? '',
        status: b.status ?? 'planning', priority: b.priority ?? 'medium',
        department_id: b.department_id || null, team_id: b.team_id || null,
        client_company_id: b.client_company_id || null,
        budget: Math.max(0, Number(b.budget) || 0),
        start_date: b.start_date || null, end_date: b.end_date || null,
        owner_id: b.owner_id ?? ctx.org.memberId,
      };
    },
  },
);

export { POST };

/**
 * Projects, with the health metrics the board actually displays.
 *
 * `v_project_health` has existed since 0007 and already computes total,
 * completed, blocked and overdue tasks, progress, days remaining, logged hours
 * and an at-risk flag — per project, in one place, using the same definitions
 * the reports use.
 *
 * Nothing read it. The board recomputed progress in the browser from
 * `project._count.tasks` and a `tasks[]` array, neither of which the endpoint
 * ever returned, so every project showed 0 tasks and 0% complete no matter how
 * much work was on it.
 *
 * Merged here rather than embedded, because the view is not related to
 * `projects` by a foreign key and PostgREST cannot join it. One extra query per
 * page keeps a single definition of "progress" shared with the reports, which
 * is worth more than saving the round trip.
 */
export async function GET(req: Request) {
  const res = await listProjects(req);
  if (!res.ok) return res;

  const payload = await res.json();
  const rows: any[] = payload?.data ?? [];
  if (!rows.length) return Response.json(payload, { status: res.status });

  const ctx = await getContext();
  if (!ctx) return Response.json(payload, { status: res.status });

  const { data: health } = await ctx.supabase
    .from('v_project_health')
    .select(
      'project_id, total_tasks, completed_tasks, blocked_tasks, overdue_tasks, ' +
      'total_milestones, completed_milestones, overdue_milestones, progress_pct, ' +
      // Added in 0016. `health` grades what `is_at_risk` could only flag, and
      // the board shows the grade — a project a month past its deadline should
      // not look identical to one carrying a single late task.
      'days_remaining, logged_hours, is_at_risk, health, member_count',
    )
    .in('project_id', rows.map(r => r.id));

  const byId = new Map((health ?? []).map((h: any) => [h.project_id, h]));

  return Response.json(
    {
      ...payload,
      data: rows.map(r => {
        const h: any = byId.get(r.id);
        return {
          ...r,
          // Zeros rather than undefined for a project with no tasks yet: the
          // card renders these directly and "0%" is the honest answer.
          totalTasks: h?.total_tasks ?? 0,
          completedTasks: h?.completed_tasks ?? 0,
          blockedTasks: h?.blocked_tasks ?? 0,
          overdueTasks: h?.overdue_tasks ?? 0,
          // Added in 0015. A project run to a plan reports progress from its
          // phases; one without milestones still reports it from tasks.
          totalMilestones: h?.total_milestones ?? 0,
          completedMilestones: h?.completed_milestones ?? 0,
          overdueMilestones: h?.overdue_milestones ?? 0,
          progressPct: h?.progress_pct ?? 0,
          daysRemaining: h?.days_remaining ?? null,
          loggedHours: h?.logged_hours ?? 0,
          isAtRisk: h?.is_at_risk ?? false,
          /**
           * The three-grade verdict, and the team size.
           *
           * `'on_track'` rather than null when the view has no row: a project
           * created a moment ago has nothing wrong with it, and a card that
           * renders an empty health badge reads as a loading failure.
           */
          health: h?.health ?? 'on_track',
          memberCount: h?.member_count ?? 0,
        };
      }),
    },
    { status: res.status },
  );
}
