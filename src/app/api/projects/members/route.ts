import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * Who is on a project.
 *
 * `project_members` and its RLS policy have existed since the first
 * migrations and nothing ever wrote to them, so a project had exactly one
 * person — its owner — and no way to say that a designer, a developer and a
 * project manager were all working on it.
 *
 * Hand-written rather than built from `collectionHandlers`, because this table
 * has no `organization_id`: it is scoped through its project, and the factory
 * filters on a column that is not here. Tenant isolation still holds — RLS
 * reaches the organization through `projects` — but the explicit check below
 * makes a cross-tenant project id a clear 404 rather than a silent empty
 * result.
 */
const SELECT =
  '*, member:organization_members!project_members_member_id_fkey(' +
  'id, role, department_id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

/** Roles a person can hold *on a project*, distinct from their org-wide role. */
const PROJECT_ROLES = ['manager', 'lead', 'contributor', 'reviewer', 'observer'];

/**
 * Confirm the project belongs to the caller's organization.
 *
 * Returns the project, or null. Every handler here starts with this: without
 * it, a project id from another tenant would reach RLS and come back as an
 * empty list, which reads as "this project has no team" rather than "this is
 * not your project".
 */
async function projectInOrg(ctx: any, projectId: string) {
  const { data } = await ctx.supabase
    .from('projects').select('id, name, owner_id')
    .eq('organization_id', ctx.org.organizationId).eq('id', projectId)
    .maybeSingle();
  return data ?? null;
}

export async function GET(req: Request) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId') ?? searchParams.get('project_id');
  if (!projectId) return error('projectId is required', 422, 'VALIDATION_ERROR');

  if (!(await projectInOrg(ctx, projectId))) {
    return error('That project does not exist in this organization.', 404, 'NOT_FOUND');
  }

  const { data, error: e } = await ctx.supabase
    .from('project_members').select(SELECT)
    .eq('project_id', projectId)
    .order('joined_at');

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Add someone to a project.
 *
 * Both ids are checked against this organization before the insert. The
 * foreign keys would catch a nonexistent id, but not one belonging to another
 * tenant — `member_id` references `organization_members` globally, so without
 * this check an administrator could attach a stranger's membership to their
 * own project and the constraint would happily allow it.
 */
export async function POST(req: Request) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    const projectId = b.project_id;
    const memberId = b.member_id;

    if (!projectId || !memberId) {
      return error('projectId and memberId are required', 422, 'VALIDATION_ERROR');
    }

    const role = b.role ?? 'contributor';
    if (!PROJECT_ROLES.includes(role)) {
      return error(
        `"${role}" is not a project role. Expected one of: ${PROJECT_ROLES.join(', ')}.`,
        422, 'VALIDATION_ERROR',
      );
    }

    const project = await projectInOrg(ctx, projectId);
    if (!project) return error('That project does not exist in this organization.', 404, 'NOT_FOUND');

    const { data: member } = await ctx.supabase
      .from('organization_members').select('id, is_active')
      .eq('organization_id', ctx.org.organizationId).eq('id', memberId)
      .maybeSingle();
    if (!member) return error('That person is not a member of this organization.', 422, 'MEMBER_NOT_FOUND');
    if (!member.is_active) {
      return error('That account is deactivated and cannot be assigned work.', 422, 'MEMBER_INACTIVE');
    }

    // Allocation is a percentage of someone's time; anything outside 0-100 is
    // a typo, and capacity reporting reads this column.
    const allocation = b.allocation_pct === undefined || b.allocation_pct === null
      ? 100
      : Math.min(100, Math.max(0, Number(b.allocation_pct) || 0));

    const { data, error: e } = await ctx.supabase
      .from('project_members')
      .insert({ project_id: projectId, member_id: memberId, role, allocation_pct: allocation })
      .select(SELECT).single();

    if (e) {
      // The unique constraint on (project_id, member_id) is what stops the
      // same person appearing on a project twice.
      if (e.code === '23505') {
        return error('That person is already on this project.', 409, 'ALREADY_ON_PROJECT');
      }
      return pgError(e);
    }

    /**
     * Tell them they are on it.
     *
     * Matches the existing task-assignment notification: being given work is
     * the event worth knowing about, and adding yourself is not news.
     */
    if (memberId !== ctx.org.memberId) {
      await ctx.supabase.from('notifications').insert({
        organization_id: ctx.org.organizationId,
        recipient_id: memberId,
        type: 'project_assigned',
        title: `Added to ${project.name}`,
        body: `You are now a ${role} on this project.`,
        entity_type: 'project',
        entity_id: projectId,
      }).then(undefined, (err: any) => console.error('project notification:', err?.message));
    }

    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Could not add the member', 500);
  }
}
