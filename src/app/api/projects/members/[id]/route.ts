import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT =
  '*, member:organization_members!project_members_member_id_fkey(' +
  'id, role, department_id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

const PROJECT_ROLES = ['manager', 'lead', 'contributor', 'reviewer', 'observer'];

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm this assignment belongs to a project in the caller's organization.
 *
 * `project_members` carries no `organization_id`, so the tenant has to be
 * reached through the project. RLS enforces it; this makes a foreign row a
 * clear 404 instead of an empty update that looks like success.
 */
async function assignmentInOrg(ctx: any, id: string) {
  const { data } = await ctx.supabase
    .from('project_members')
    .select('id, project_id, member_id, project:projects!inner(id, organization_id)')
    .eq('id', id)
    .maybeSingle();

  if (!data) return null;
  const project: any = Array.isArray(data.project) ? data.project[0] : data.project;
  if (project?.organization_id !== ctx.org.organizationId) return null;
  return data;
}

/** Change someone's role on a project, or their allocation. */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('role' in b) {
      if (!PROJECT_ROLES.includes(b.role)) {
        return error(
          `"${b.role}" is not a project role. Expected one of: ${PROJECT_ROLES.join(', ')}.`,
          422, 'VALIDATION_ERROR',
        );
      }
      update.role = b.role;
    }
    if ('allocation_pct' in b) {
      update.allocation_pct = Math.min(100, Math.max(0, Number(b.allocation_pct) || 0));
    }
    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    if (!(await assignmentInOrg(ctx, id))) return error('Not found', 404, 'NOT_FOUND');

    const { data, error: e } = await ctx.supabase
      .from('project_members').update(update).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

export { PATCH as PUT };

/**
 * Take someone off a project.
 *
 * Their tasks are deliberately left assigned. Removing a person from the team
 * is a staffing change, not a statement that the work is unassigned — silently
 * orphaning their open tasks would lose the record of who was doing what. The
 * response reports how many they still hold so the caller can reassign them
 * deliberately.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const assignment = await assignmentInOrg(ctx, id);
  if (!assignment) return error('Not found', 404, 'NOT_FOUND');

  const { count: openTasks } = await ctx.supabase
    .from('tasks').select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.org.organizationId)
    .eq('project_id', assignment.project_id)
    .eq('assignee_id', assignment.member_id)
    .neq('status', 'done');

  const { error: e } = await ctx.supabase.from('project_members').delete().eq('id', id);
  if (e) return pgError(e);

  return success({
    removed: true,
    openTasksStillAssigned: openTasks ?? 0,
    ...(openTasks
      ? { message: `They still have ${openTasks} open task(s) on this project. Reassign them if someone else should pick them up.` }
      : {}),
  });
}
