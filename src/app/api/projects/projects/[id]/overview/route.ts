import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { todayIn } from '@/lib/org-time';
import { can } from '@/lib/permissions';

/**
 * Everything a project workspace opens with, in one request.
 *
 * ── Why an aggregate rather than eight endpoints ──────────────────────────
 *
 * The pieces already exist separately: project, members, milestones, tasks,
 * files, comments. A detail view that fetches them individually issues eight
 * round trips before it can render anything, and each one arrives on its own
 * schedule - so the header appears, then the team, then the roadmap, and the
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
 *
 * ── What Phase 6 added ────────────────────────────────────────────────────
 *
 * Four things the schema already held and this response did not carry, so the
 * workspace could not show them however well it was designed:
 *
 *   · **Deliverables and their decisions.** `v_project_health` has counted
 *     them since 0018 and they are twenty per cent of the progress figure the
 *     client sees, but the files list came back without `requires_approval`
 *     or `approval_decision` - so the one thing the project is waiting on the
 *     customer for was the one thing the team could not see.
 *   · **Dependencies.** `task_dependencies` got its first consumer in 0034.
 *     "Blocked" is a status somebody sets; "blocked by" is a fact.
 *   · **Subtasks.** `parent_task_id` is as old as the table and was never
 *     selected, so a checklist under a task rendered as loose top-level work.
 *   · **Money, where the reader may see money.** `invoices.project_id` and
 *     `expenses.project_id` have always existed. A budget with nothing beside
 *     it is a number nobody can act on.
 *
 * ── The finance gate ──────────────────────────────────────────────────────
 *
 * RLS already refuses invoices to anyone without the finance module, so a
 * project manager reading this endpoint would simply get an empty array. That
 * is exactly the trap: an empty array renders as "nothing invoiced", which is
 * a statement, and a false one. The capability is therefore checked here and
 * reported as `finance: null` - no figures at all - so the workspace can leave
 * the region out rather than print a confident zero. A route's module says who
 * may call it, not what the caller may see inside it.
 */

type Params = { params: Promise<{ id: string }> };

/**
 * A task status, in a sentence.
 *
 * `status.replace('_', ' ')` handles `in_progress` and leaves `todo` as a word
 * nobody writes: "20 days overdue, still todo". The three that read badly are
 * named; anything else falls through to the de-underscored form, so a status
 * added to the enum later degrades to acceptable rather than to nothing.
 */
function statusWord(status: string): string {
  const said: Record<string, string> = {
    todo: 'to do',
    in_progress: 'in progress',
    review: 'in review',
  };
  return said[status] ?? String(status).replace(/_/g, ' ');
}

const MEMBER_SELECT =
  'id, role, allocation_pct, joined_at, ' +
  'member:organization_members!project_members_member_id_fkey(' +
  'id, role, department_id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

const MILESTONE_SELECT =
  'id, name, description, stage, start_date, due_date, completed_at, progress_pct, sort_order, ' +
  'owner:organization_members!milestones_owner_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const TASK_SELECT =
  'id, title, description, status, priority, due_date, milestone_id, parent_task_id, ' +
  'estimated_hours, logged_hours, created_at, completed_at, sort_order, ' +
  'assignee:organization_members!tasks_assignee_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const FILE_SELECT =
  'id, filename, mime_type, size_bytes, folder, is_client_visible, is_confidential, ' +
  'external_url, requires_approval, approval_decision, approved_at, approval_note, ' +
  'created_at, ' +
  'uploader:organization_members!files_uploaded_by_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'approver:organization_members!files_approved_by_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name))';

const COMMENT_SELECT =
  'id, body, mentions, is_client_visible, created_at, edited_at, parent_id, author_id, ' +
  'author:organization_members!comments_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

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
  // indistinguishable - confirming existence would leak across tenants.
  if (!project) return error('Not found', 404, 'NOT_FOUND');

  const mayReadMoney = can(ctx.org.role, 'finance', 'view');

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
      .limit(500),

    ctx.supabase
      .from('files')
      .select(FILE_SELECT)
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
      .limit(200),

    // Meetings and deadlines attached to this project, for the timeline.
    ctx.supabase
      .from('calendar_events')
      .select('id, title, description, starts_at, ends_at, all_day, location')
      .eq('organization_id', ctx.org.organizationId)
      .eq('project_id', id)
      .order('starts_at', { ascending: false })
      .limit(50),
  ]);

  const taskRows = (tasks.data ?? []) as any[];
  const milestoneRows = (milestones.data ?? []) as any[];
  const fileRows = (files.data ?? []) as any[];

  /**
   * Dependencies among this project's tasks.
   *
   * A second round trip, and only when the project has tasks at all: the edge
   * table has no `project_id` (it is scoped through `tasks`, which is correct
   * - a dependency belongs to the pair, not to a project), so the ids have to
   * be known before it can be read. `in()` on both columns rather than one,
   * because an edge that reaches out of this project is still something this
   * project is waiting on and hiding it would be the whole point missed.
   */
  const taskIds = taskRows.map(t => t.id);
  const { data: edgeRows } = taskIds.length
    ? await ctx.supabase
        .from('task_dependencies')
        .select(
          'id, task_id, depends_on_id, ' +
          'depends_on:tasks!task_dependencies_depends_on_id_fkey(id, title, status, project_id), ' +
          'task:tasks!task_dependencies_task_id_fkey(id, title, status, project_id)',
        )
        .or(`task_id.in.(${taskIds.join(',')}),depends_on_id.in.(${taskIds.join(',')})`)
    : { data: [] as any[] };

  const dependencies = (edgeRows ?? []) as any[];

  /**
   * What this project has billed and spent.
   *
   * Read only when the caller holds finance. Both are small per project, so
   * the rows come back rather than a total: "three invoices, one overdue" is
   * the useful sentence, and a single number cannot say it.
   */
  const [invoices, expenses] = mayReadMoney
    ? await Promise.all([
        ctx.supabase
          .from('invoices')
          .select('id, invoice_number, status, issue_date, due_date, total, amount_paid, currency')
          .eq('organization_id', ctx.org.organizationId)
          .eq('project_id', id)
          .is('deleted_at', null)
          .order('issue_date', { ascending: false })
          .limit(100),
        ctx.supabase
          .from('expenses')
          .select('id, title, amount, category, status, expense_date')
          .eq('organization_id', ctx.org.organizationId)
          .eq('project_id', id)
          .is('deleted_at', null)
          .order('expense_date', { ascending: false })
          .limit(100),
      ])
    : [null, null];

  /**
   * Blockers and risks, derived rather than stored.
   *
   * A "risk register" the team has to maintain by hand is a register that goes
   * stale within a fortnight and then actively misleads. These are computed
   * from the work itself, so they are true whenever anybody looks: a blocked
   * task is a blocker because someone set it to blocked, and an overdue phase
   * is a risk because the date passed.
   */
  // Overdue is judged against the organisation's calendar day, not UTC's -
  // otherwise a phase reads as late for several hours before it actually is.
  const today = todayIn(ctx.org.timezone);

  /**
   * How late something is, in days rather than as a date.
   *
   * These strings are built on the server, where the reader's locale is not
   * known, so embedding a date means shipping `2026-08-19` into a sentence -
   * and in a workspace that already draws every date through `formatDay`, one
   * raw ISO string is the thing that looks like a bug. Days are locale-free
   * and are what somebody actually wants to know.
   */
  const lateBy = (iso: string | null): string => {
    if (!iso) return 'some time';
    const n = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000,
    );
    return n === 1 ? '1 day' : `${n} days`;
  };

  /** Which unfinished tasks are waiting on something that is not done yet. */
  const waitingOn = new Map<string, string[]>();
  for (const e of dependencies) {
    if (!e.depends_on || e.depends_on.status === 'done') continue;
    const list = waitingOn.get(e.task_id) ?? [];
    list.push(e.depends_on.title);
    waitingOn.set(e.task_id, list);
  }

  const blockers = [
    ...taskRows
      .filter(t => t.status === 'blocked')
      .map(t => ({
        kind: 'blocked_task',
        id: t.id,
        title: t.title,
        owner: t.assignee?.profiles?.full_name ?? null,
        detail: 'Marked blocked and cannot proceed.',
      })),
    /**
     * Work that is waiting on something unfinished, without anyone having said
     * so. This is the case the `blocked` status has always missed: nobody
     * remembers to set it, and the dependency is already on record.
     */
    ...taskRows
      .filter(t => t.status !== 'done' && t.status !== 'blocked' && waitingOn.has(t.id))
      .map(t => ({
        kind: 'waiting_task',
        id: t.id,
        title: t.title,
        owner: t.assignee?.profiles?.full_name ?? null,
        detail: `Waiting on ${waitingOn.get(t.id)!.join(', ')}.`,
      })),
  ];

  const rejectedDeliverables = fileRows.filter(
    f => f.requires_approval && f.approval_decision === 'rejected',
  );
  const pendingDeliverables = fileRows.filter(
    f => f.requires_approval && !f.approval_decision,
  );

  const risks = [
    ...milestoneRows
      .filter(m => !m.completed_at && m.due_date && m.due_date < today)
      .map(m => ({
        kind: 'overdue_milestone',
        id: m.id,
        title: m.name,
        owner: m.owner?.profiles?.full_name ?? null,
        detail: `${lateBy(m.due_date)} overdue, and not complete.`,
      })),
    ...taskRows
      .filter(t => t.status !== 'done' && t.due_date && t.due_date < today)
      .map(t => ({
        kind: 'overdue_task',
        id: t.id,
        title: t.title,
        owner: t.assignee?.profiles?.full_name ?? null,
        detail: `${lateBy(t.due_date)} overdue, still ${statusWord(t.status)}.`,
      })),
    ...(project.end_date && project.end_date < today
      && !['completed', 'cancelled', 'archived'].includes(project.status)
      ? [{
          kind: 'past_end_date',
          id: project.id,
          title: 'Project is past its end date',
          owner: project.owner?.profiles?.full_name ?? null,
          detail: `${lateBy(project.end_date)} past the target completion date.`,
        }]
      : []),
    // Work with nobody's name on it is a risk that surfaces late, when the
    // deadline arrives and it turns out nobody had picked it up.
    ...(taskRows.some(t => !t.assignee && t.status !== 'done')
      ? [{
          kind: 'unassigned_work',
          id: project.id,
          title: 'Unassigned work on the plan',
          owner: null,
          detail: `${taskRows.filter(t => !t.assignee && t.status !== 'done').length} open task(s) have no assignee.`,
        }]
      : []),
    /**
     * A deliverable the client sent back.
     *
     * This is the one item on the list that is somebody else's decision, and
     * it was invisible: the health verdict has counted a rejection as a reason
     * to look since 0018, and the workspace had no way to say which file.
     */
    ...rejectedDeliverables.map(f => ({
      kind: 'rejected_deliverable',
      id: f.id,
      title: `${f.filename} was not accepted`,
      owner: f.approver?.profiles?.full_name ?? null,
      detail: f.approval_note || 'The client asked for changes.',
    })),
  ];

  /**
   * The timeline: everything that happened, in one chronology.
   *
   * A project's history is spread across five tables, and answering "what
   * happened, in what order" by reading five lists side by side is exactly the
   * work software should be doing. Merged and sorted here so the client
   * renders one sequence.
   *
   * Task completions became possible in 0034, which is the migration that
   * started stamping `tasks.completed_at`. Before it, the only date a finished
   * task carried was `updated_at`, so a task done in March would have appeared
   * on the timeline on the day somebody last fixed its title.
   */
  const timeline = [
    ...(project.start_date
      ? [{ at: project.start_date, kind: 'project_start', title: 'Project started', detail: project.name }]
      : []),
    ...milestoneRows.map(m => ({
      at: m.completed_at ? String(m.completed_at).slice(0, 10) : m.due_date,
      kind: m.completed_at ? 'milestone_completed' : 'milestone_due',
      title: m.name,
      // "Due in planning" read as though the phase were due *during* planning.
      // It is a phase, it is due, and its stage is a separate fact.
      detail: m.completed_at ? 'Phase completed' : 'Phase due',
      id: m.id,
      by: m.owner?.profiles?.full_name ?? null,
    })),
    ...taskRows
      .filter(t => t.completed_at)
      .map(t => ({
        at: String(t.completed_at).slice(0, 10),
        kind: 'task_completed',
        title: t.title,
        detail: 'Task completed',
        id: t.id,
        by: t.assignee?.profiles?.full_name ?? null,
      })),
    ...fileRows.map(f => ({
      at: String(f.created_at).slice(0, 10),
      kind: f.external_url ? 'link_added' : 'file_added',
      title: f.filename,
      detail: f.external_url ? 'Link added' : 'File added',
      id: f.id,
      by: f.uploader?.profiles?.full_name ?? null,
    })),
    ...fileRows
      .filter(f => f.approval_decision && f.approved_at)
      .map(f => ({
        at: String(f.approved_at).slice(0, 10),
        kind: f.approval_decision === 'approved' ? 'deliverable_approved' : 'deliverable_rejected',
        title: f.filename,
        detail: f.approval_decision === 'approved' ? 'Deliverable approved' : 'Changes requested',
        id: f.id,
        by: f.approver?.profiles?.full_name ?? null,
      })),
    ...(comments.data ?? []).map((c: any) => ({
      at: String(c.created_at).slice(0, 10),
      kind: 'comment',
      title: c.body.length > 90 ? `${c.body.slice(0, 90)}…` : c.body,
      detail: c.is_client_visible ? 'Posted to the client' : 'Discussion',
      id: c.id,
      by: c.author?.profiles?.full_name ?? null,
    })),
    ...(events.data ?? []).map((e: any) => ({
      at: String(e.starts_at).slice(0, 10),
      kind: 'meeting',
      title: e.title,
      detail: e.location || 'Meeting',
      id: e.id,
      by: null,
    })),
    ...(project.end_date
      ? [{ at: project.end_date, kind: 'project_end', title: 'Target completion', detail: project.name, by: null }]
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
    dependencies,
    files: fileRows,
    comments: comments.data ?? [],
    events: events.data ?? [],
    timeline,
    risks,
    blockers,
    deliverables: {
      total: fileRows.filter(f => f.requires_approval).length,
      pending: pendingDeliverables.length,
      rejected: rejectedDeliverables.length,
      approved: fileRows.filter(f => f.approval_decision === 'approved').length,
    },
    // `null`, not an empty object: the workspace has to be able to tell "this
    // project has billed nothing" from "you cannot see what it has billed".
    finance: mayReadMoney
      ? { invoices: invoices?.data ?? [], expenses: expenses?.data ?? [] }
      : null,
  });
}
