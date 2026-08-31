import { collectionHandlers } from '@/lib/supabase/crud';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { todayIn } from '@/lib/org-time';

const SELECT = '*, project:projects(id, name), assignee:organization_members!tasks_assignee_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export const { GET } = collectionHandlers(
  {
    table: 'tasks', module: 'projects', select: SELECT, softDelete: true,
    searchColumns: ['title', 'description'],
    sortable: ['created_at', 'updated_at', 'title', 'status', 'priority', 'due_date', 'sort_order'],
    filterable: ['status', 'priority', 'project_id', 'assignee_id', 'milestone_id'],
    /**
     * `?assignedToMe=true` - the caller's own work.
     *
     * Expressed here rather than left to the client passing its own
     * `assigneeId`, because the client would have to know its membership id.
     * That is available in the session, but every screen resolving it
     * independently is how "my tasks" ends up meaning slightly different
     * things on the dashboard, in My Work and in the projects board.
     */
    scope: (q, ctx, url) => {
      const query = url.searchParams.get('assignedToMe') === 'true'
        ? q.eq('assignee_id', ctx.org.memberId)
        : q;

      /**
       * `?state=` - the four questions a task list is actually asked.
       *
       * ── Why not the `filterable` list ────────────────────────────────────
       *
       * The route factory's filters are equality on one column, so "not done"
       * and "past its due date" are not expressible through them. The module
       * filtered those two in the browser instead, which meant something worse
       * than a slow query: the filter applied to the *page*, so "Open" on a
       * workspace with two hundred tasks showed whichever of the first twenty
       * happened to be open, and the count under the table described a
       * different population from the heading above it.
       *
       * Expressed here rather than by widening the shared factory, because
       * adding operators to `filterable` changes the contract for the eleven
       * other modules built on it and only this one needs them.
       *
       * "Overdue" is judged against the organisation's calendar day, not
       * UTC's - the same rule the workspace's risk list uses, so a task cannot
       * be late on one screen and on time on the other.
       */
      switch (url.searchParams.get('state')) {
        case 'open': return query.neq('status', 'done');
        case 'done': return query.eq('status', 'done');
        case 'blocked': return query.eq('status', 'blocked');
        case 'overdue':
          return query.neq('status', 'done').lt('due_date', todayIn(ctx.org.timezone));
        default: return query;
      }
    },
  },
  { table: 'tasks', module: 'projects', select: SELECT },
);

/**
 * Raise a task.
 *
 * ── Why this is not the shared create handler ────────────────────────────
 *
 * There are two different acts here, and they need different permissions.
 *
 * A *project* task is planned work on someone's project, so it requires
 * `create` on the projects module - the same right the shared handler asks
 * for.
 *
 * A *personal* task is somebody's own note to themselves: "prepare the monthly
 * report". `tasks.project_id` has always been nullable so that this could
 * exist, but the endpoint demanded `create` regardless, and the `employee`
 * role holds only `['view', 'edit']` on projects. The result was that ordinary
 * staff - the majority of any organization - could not create a task at all,
 * and "My Tasks" was unreachable for exactly the people it is for.
 *
 * Anyone who can open the module may keep their own list. Two guards make that
 * safe: a personal task cannot be assigned to anybody else, and it cannot be
 * attached to a milestone (which would put it on a project plan through the
 * back door).
 */
export async function POST(req: Request) {
  let body: Record<string, any>;
  try {
    body = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const isPersonal = !body.project_id;

  const ctx = await authorize('projects', isPersonal ? 'view' : 'create');
  if (ctx instanceof Response) return ctx;

  const title = String(body.title ?? '').trim();
  if (!title) return error('Task title is required', 422, 'VALIDATION_ERROR');

  if (isPersonal) {
    if (body.assignee_id && body.assignee_id !== ctx.org.memberId) {
      return error(
        'A personal task cannot be assigned to someone else. Add it to a project first.',
        403, 'PERSONAL_TASK_ASSIGNEE',
      );
    }
    if (body.milestone_id) {
      return error(
        'A milestone belongs to a project, so a task on one must belong to that project too.',
        422, 'PERSONAL_TASK_MILESTONE',
      );
    }
  }

  /**
   * A milestone must belong to the project the task is on.
   *
   * The foreign key only proves the milestone exists. Without this a task
   * could be filed against another project's phase - inside the same tenant,
   * so RLS would allow it - and that project's progress would silently count
   * work that is not part of it.
   */
  if (body.milestone_id) {
    const { data: milestone } = await ctx.supabase
      .from('milestones').select('id, project_id')
      .eq('organization_id', ctx.org.organizationId).eq('id', body.milestone_id)
      .maybeSingle();

    if (!milestone) {
      return error('That milestone does not exist in this organization.', 422, 'MILESTONE_NOT_FOUND');
    }
    if (milestone.project_id !== body.project_id) {
      return error(
        'That milestone belongs to a different project.',
        422, 'MILESTONE_PROJECT_MISMATCH',
      );
    }
  }

  /**
   * A subtask sits under a task on the same project, one level deep.
   *
   * `parent_task_id` has been passed through to the insert since this handler
   * was written and nothing has ever set it, so the rule has never been
   * exercised. The same reasoning as the milestone check above applies: the
   * foreign key proves the row exists, not that it belongs here, and a subtask
   * of another project's task is work counted twice.
   */
  if (body.parent_task_id) {
    const { data: parent } = await ctx.supabase
      .from('tasks').select('id, project_id, parent_task_id')
      .eq('organization_id', ctx.org.organizationId).eq('id', body.parent_task_id)
      .is('deleted_at', null).maybeSingle();

    if (!parent) {
      return error('That parent task does not exist in this organization.', 422, 'PARENT_NOT_FOUND');
    }
    if (parent.project_id !== (body.project_id || null)) {
      return error('A subtask has to sit under a task on the same project.', 422, 'PARENT_PROJECT_MISMATCH');
    }
    if (parent.parent_task_id) {
      return error('That task is already a subtask. Subtasks go one level deep.', 422, 'PARENT_IS_SUBTASK');
    }
  }

  const { data, error: e } = await ctx.supabase
    .from('tasks')
    .insert({
      organization_id: ctx.org.organizationId,
      title,
      description: body.description ?? '',
      status: body.status ?? 'todo',
      priority: body.priority ?? 'medium',
      project_id: body.project_id || null,
      milestone_id: body.milestone_id || null,
      parent_task_id: body.parent_task_id || null,
      // A personal task is yours by definition; the picker is not shown for it.
      assignee_id: isPersonal ? ctx.org.memberId : (body.assignee_id || null),
      // Who raised it, for accountability on the board.
      reporter_id: ctx.org.memberId,
      due_date: body.due_date || null,
      estimated_hours: Math.max(0, Number(body.estimated_hours) || 0),
      sort_order: Number(body.sort_order) || 0,
    })
    .select(SELECT)
    .single();

  if (e) return pgError(e);
  return success(data, undefined, 201);
}
