import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { todayIn } from '@/lib/org-time';

/**
 * Everything a project workspace opens with, in one request.
 *
 * ── Why an aggregate rather than eight endpoints ──────────────────────────
 *
 * The pieces already exist separately: project, members, milestones, tasks,
 * files, comments. A detail view that fetches them individually issues eight
 * round trips before it can render anything, and each one arrives on its own
 * schedule — so the header appears, then the team, then the roadmap, and the
 * progress figure changes twice while the user is reading it.
 *
 * More importantly they have to agree. Progress, health and the milestone
 * counts all come from `v_project_health`; if the roadmap is fetched a second
 * after the header, the two can disagree about how many phases are done. One
 * read, one consistent answer.
 *
 * The per-resource endpoints all still exist and are what the workspace uses
 * for writes and for refreshing a single panel after an edit. This is the
 * initial load only.
 */

type Params = { params: Promise<{ id: string }> };

const MEMBER_SELECT =
  'id, role, allocation_pct, joined_at, ' +
  'member:organization_members!project_members_member_id_fkey(' +
  'id, role, department_id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

const MILESTONE_SELECT =
  'id, name, description, stage, start_date, due_date, completed_at, progress_pct, sort_order, ' +
  'owner:organization_members!milestones_owner_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const TASK_SELECT =
  'id, title, status, priority, due_date, milestone_id, estimated_hours, logged_hours, ' +
  'assignee:organization_members!tasks_assignee_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const COMMENT_SELECT =
  'id, body, mentions, is_client_visible, created_at, edited_at, ' +
  'author:organization_members!comments_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  /**
   * `project` is read as `any`.
   *
   * PostgREST's generated types widen an embedded select into a union with
   * `GenericStringError`, so every field access below fails to compile even
   * though the query is correct. The same cast is used by the other handlers
   * that embed relations; narrowing it properly needs generated database
   * types, which this project does not yet have.
   */
  const { data: project, error: projectError } = await ctx.supabase
    .from('projects')
    .select(
      '*, department:departments(id, name), ' +
      'owner:organization_members!projects_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)), ' +
      'client:companies(id, name, industry)',
    )
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle<any>();

  if (projectError) return pgError(projectError);
  // A project hidden by RLS and one that does not exist are deliberately
  // indistinguishable — confirming existence would leak across tenants.
  if (!project) return error('Not found', 404, 'NOT_FOUND');

  const [health, members, milestones, tasks, files, comments, events] = await Promise.all([
    ctx.supabase
      .from('v_project_health')
      .select('*')
      .eq('project_id', id)
      .maybeSingle(),

    ctx.supabase
      .from('project_members')
      .select(MEMBER_SELECT)
      .eq('project_id', id)
      .order('joined_at'),

    // The roadmap, in plan order rather than newest-first.
    ctx.supabase
      .from('milestones')
      .select(MILESTONE_SELECT)
      .eq('organization_id', ctx.org.organizationId)
      .eq('project_id', id)
      .order('sort_order')
      .order('due_date', { nullsFirst: false }),

    ctx.supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('organization_id', ctx.org.organizationId)
      .eq('project_id', id)
      .is('deleted_at', null)
      .order('sort_order')
      .limit(200),

    ctx.supabase
      .from('files')
      .select('id, filename, mime_type, size_bytes, folder, is_client_visible, bucket, path, created_at, uploaded_by')
      .eq('organization_id', ctx.org.organizationId)
      .eq('project_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),

    ctx.supabase
      .from('comments')
      .select(COMMENT_SELECT)
      .eq('organization_id', ctx.org.organizationId)
      .eq('project_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50),

    // Meetings and deadlines attached to this project, for the timeline.
    ctx.supabase
      .from('calendar_events')
      .select('id, title, description, starts_at, ends_at, all_day, location')
      .eq('organization_id', ctx.org.organizationId)
      .eq('project_id', id)
      .order('starts_at', { ascending: false })
      .limit(50),
  ]);

  const taskRows = tasks.data ?? [];
  const milestoneRows = milestones.data ?? [];

  /**
   * Blockers and risks, derived rather than stored.
   *
   * A "risk register" the team has to maintain by hand is a register that goes
   * stale within a fortnight and then actively misleads. These are computed
   * from the work itself, so they are true whenever anybody looks: a blocked
   * task is a blocker because someone set it to blocked, and an overdue phase
   * is a risk because the date passed.
   */
  // Overdue is judged against the organisation's calendar day, not UTC's —
  // otherwise a phase reads as late for several hours before it actually is.
  const today = todayIn(ctx.org.timezone);

  const blockers = taskRows
    .filter((t: any) => t.status === 'blocked')
    .map((t: any) => ({
      kind: 'blocked_task',
      id: t.id,
      title: t.title,
      owner: t.assignee?.profiles?.full_name ?? null,
      detail: 'Task is blocked and cannot proceed.',
    }));

  const risks = [
    ...milestoneRows
      .filter((m: any) => !m.completed_at && m.due_date && m.due_date < today)
      .map((m: any) => ({
        kind: 'overdue_milestone',
        id: m.id,
        title: m.name,
        owner: m.owner?.profiles?.full_name ?? null,
        detail: `Phase was due ${m.due_date} and is not complete.`,
      })),
    ...taskRows
      .filter((t: any) => t.status !== 'done' && t.due_date && t.due_date < today)
      .map((t: any) => ({
        kind: 'overdue_task',
        id: t.id,
        title: t.title,
        owner: t.assignee?.profiles?.full_name ?? null,
        detail: `Due ${t.due_date}, still ${String(t.status).replace('_', ' ')}.`,
      })),
    ...(project.end_date && project.end_date < today
      && !['completed', 'cancelled', 'archived'].includes(project.status)
      ? [{
          kind: 'past_end_date',
          id: project.id,
          title: 'Project is past its end date',
          owner: project.owner?.profiles?.full_name ?? null,
          detail: `The end date was ${project.end_date}.`,
        }]
      : []),
    // Work with nobody's name on it is a risk that surfaces late, when the
    // deadline arrives and it turns out nobody had picked it up.
    ...(taskRows.some((t: any) => !t.assignee && t.status !== 'done')
      ? [{
          kind: 'unassigned_work',
          id: project.id,
          title: 'Unassigned work on the plan',
          owner: null,
          detail: `${taskRows.filter((t: any) => !t.assignee && t.status !== 'done').length} open task(s) have no assignee.`,
        }]
      : []),
  ];

  /**
   * The timeline: everything with a date, in one chronology.
   *
   * A project's history is spread across four tables, and answering "what
   * happened, in what order" by reading four lists side by side is exactly the
   * work software should be doing. Merged and sorted here so the client
   * renders one sequence.
   */
  const timeline = [
    ...(project.start_date
      ? [{ at: project.start_date, kind: 'project_start', title: 'Project started', detail: project.name }]
      : []),
    ...milestoneRows.map((m: any) => ({
      at: m.completed_at ? String(m.completed_at).slice(0, 10) : m.due_date,
      kind: m.completed_at ? 'milestone_completed' : 'milestone_due',
      title: m.name,
      detail: m.completed_at ? 'Phase completed' : `Due in ${m.stage}`,
      id: m.id,
    })),
    ...(events.data ?? []).map((e: any) => ({
      at: String(e.starts_at).slice(0, 10),
      kind: 'meeting',
      title: e.title,
      detail: e.location || 'Meeting',
      id: e.id,
    })),
    ...(project.end_date
      ? [{ at: project.end_date, kind: 'project_end', title: 'Target completion', detail: project.name }]
      : []),
  ]
    .filter(e => !!e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return success({
    project,
    health: health.data ?? null,
    members: members.data ?? [],
    milestones: milestoneRows,
    tasks: taskRows,
    files: files.data ?? [],
    comments: comments.data ?? [],
    events: events.data ?? [],
    timeline,
    risks,
    blockers,
  });
}
