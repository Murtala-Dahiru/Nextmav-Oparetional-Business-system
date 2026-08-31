import { recordHandlers } from '@/lib/supabase/crud';
import { SELECTS } from '@/lib/supabase/selects';
import { updateTaskSchema } from '@/lib/validations';
import { authorize } from '@/lib/auth-context';
import { error } from '@/lib/api-response';
import { toCamel } from '@/lib/case';

/**
 * A single task.
 *
 * `updateSchema` is the list of fields a client may set. Without one this route
 * wrote whatever the body contained, so any column was reachable by anyone
 * holding `projects.edit` - including `deleted_at`, `created_at` and the tenant
 * key - and none of the validation the create route applies was applied to an
 * edit. See the note on `RecordOptions.updateSchema` for why `toUpdateSchema`
 * and not `.partial()`.
 *
 * `SELECTS.tasks` is the expression the collection route already used, so a
 * record and a list row come back the same shape. This route was falling back
 * to `select: '*'` and returning no embedded relations at all.
 */
const { GET, PATCH: patchTask, DELETE } = recordHandlers({
  table: 'tasks',
  module: 'projects',
  select: SELECTS.tasks,
  softDelete: true,
  updateSchema: updateTaskSchema,
});

export { GET, DELETE };

type Params = { params: Promise<{ id: string }> };

/**
 * Moving a task onto a phase, or under a parent.
 *
 * `POST /api/projects/tasks` has always refused a milestone belonging to a
 * different project, and said why: the foreign key only proves the milestone
 * exists somewhere in the tenant, so without the check a task could be filed
 * against another project's phase and that project's progress would silently
 * count work that is not part of it.
 *
 * The edit path had no such check, which did not matter while `milestoneId`
 * was missing from the schema and could not be sent at all. It matters now.
 * The same rule, applied to the same two columns, on the way in:
 *
 *   · a phase must belong to the task's own project;
 *   · a parent must be a task on that same project, and cannot be the task
 *     itself - a task that is its own subtask disappears from every tree that
 *     walks upwards from it.
 *
 * Validated here and then handed to the generated handler with the body it
 * already parsed, so mass-assignment protection, the update schema and the
 * activity record stay in exactly one place.
 */
export async function PATCH(req: Request, context: Params) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;

  let raw: any;
  try {
    raw = await req.json();
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const body = toCamel(raw) as Record<string, any>;
  const wantsMilestone = 'milestoneId' in body && body.milestoneId;
  const wantsParent = 'parentTaskId' in body && body.parentTaskId;

  if (wantsMilestone || wantsParent) {
    const { data: task } = await ctx.supabase
      .from('tasks').select('id, project_id')
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .is('deleted_at', null).maybeSingle();

    if (!task) return error('Not found', 404, 'NOT_FOUND');

    // The project the task will be on once this update lands, which is not
    // necessarily the one it is on now.
    const projectId = 'projectId' in body ? body.projectId : task.project_id;

    if (wantsMilestone) {
      const { data: milestone } = await ctx.supabase
        .from('milestones').select('id, project_id')
        .eq('organization_id', ctx.org.organizationId).eq('id', body.milestoneId)
        .maybeSingle();

      if (!milestone) {
        return error('That phase does not exist in this organization.', 422, 'MILESTONE_NOT_FOUND');
      }
      if (milestone.project_id !== projectId) {
        return error('That phase belongs to a different project.', 422, 'MILESTONE_PROJECT_MISMATCH');
      }
    }

    if (wantsParent) {
      if (body.parentTaskId === id) {
        return error('A task cannot be a subtask of itself.', 422, 'PARENT_IS_SELF');
      }
      const { data: parent } = await ctx.supabase
        .from('tasks').select('id, project_id, parent_task_id')
        .eq('organization_id', ctx.org.organizationId).eq('id', body.parentTaskId)
        .is('deleted_at', null).maybeSingle();

      if (!parent) {
        return error('That parent task does not exist in this organization.', 422, 'PARENT_NOT_FOUND');
      }
      if (parent.project_id !== projectId) {
        return error('A subtask has to sit under a task on the same project.', 422, 'PARENT_PROJECT_MISMATCH');
      }
      /**
       * One level of subtasks, deliberately.
       *
       * `parent_task_id` is a self-reference, so the schema permits any depth.
       * A checklist under a task is what people mean by a subtask; a tree five
       * deep is a second project inside a task, and every list that renders it
       * has to become recursive to avoid hiding work. Refusing the third level
       * is a smaller cost than a plan nobody can read.
       */
      if (parent.parent_task_id) {
        return error('That task is already a subtask. Subtasks go one level deep.', 422, 'PARENT_IS_SUBTASK');
      }
    }
  }

  // Re-issue the body the generated handler expects to read for itself.
  return patchTask(
    new Request(req.url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(raw),
    }),
    context,
  );
}

export { PATCH as PUT };
