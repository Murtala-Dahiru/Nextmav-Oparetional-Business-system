import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * Project discussions.
 *
 * The `comments` table has carried a `project_id` column since the first
 * business migration and nothing ever wrote to it, so a project had no thread
 * — decisions about the work lived in chat, where they were unfindable a week
 * later, or in nobody's inbox at all.
 *
 * Mentions are stored as membership ids in `comments.mentions` rather than
 * being re-parsed out of the text on read. The notification trigger reads that
 * column, so a mention notifies exactly who the author picked, even if they
 * later edit the body.
 */

const SELECT =
  'id, body, mentions, is_client_visible, created_at, edited_at, project_id, task_id, ' +
  'author:organization_members!comments_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

export async function GET(req: Request) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId') ?? searchParams.get('project_id');
  const taskId = searchParams.get('taskId') ?? searchParams.get('task_id');

  if (!projectId && !taskId) {
    return error('projectId or taskId is required', 422, 'VALIDATION_ERROR');
  }

  let q = ctx.supabase
    .from('comments')
    .select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .is('deleted_at', null);

  q = taskId ? q.eq('task_id', taskId) : q.eq('project_id', projectId!);

  const { data, error: e } = await q.order('created_at', { ascending: true }).limit(500);
  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Post to a thread.
 *
 * `author_id` is taken from the session and never from the body — the RLS
 * policy enforces the same rule, but rejecting it here gives a clear error
 * rather than an opaque policy violation, and makes the intent obvious to
 * anyone reading the handler.
 *
 * Guarded on `view` rather than `create`: commenting on a project you can see
 * is participation, not authorship of project data. The `employee` role holds
 * `['view', 'edit']` on projects, and requiring `create` would mean the people
 * doing the work could read a discussion but not answer it.
 */
export async function POST(req: Request) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    const body = String(b.body ?? '').trim();
    if (!body) return error('A comment cannot be empty', 422, 'VALIDATION_ERROR');

    const projectId = b.project_id || null;
    const taskId = b.task_id || null;
    if (!projectId && !taskId) {
      return error('projectId or taskId is required', 422, 'VALIDATION_ERROR');
    }

    /**
     * The parent must be in this organization.
     *
     * The foreign key only proves the row exists somewhere. Without this check
     * a comment could be filed against another tenant's project — RLS would
     * refuse to *read* it back, so it would vanish silently rather than fail.
     */
    if (projectId) {
      const { data: project } = await ctx.supabase
        .from('projects').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', projectId)
        .is('deleted_at', null).maybeSingle();
      if (!project) return error('That project does not exist in this organization.', 404, 'NOT_FOUND');
    }
    if (taskId) {
      const { data: task } = await ctx.supabase
        .from('tasks').select('id, project_id')
        .eq('organization_id', ctx.org.organizationId).eq('id', taskId)
        .is('deleted_at', null).maybeSingle();
      if (!task) return error('That task does not exist in this organization.', 404, 'NOT_FOUND');
    }

    /**
     * Mentions are validated against the organization.
     *
     * An id that is not a colleague would sit in the array forever, and the
     * notification trigger would silently drop it — leaving the author
     * believing they had notified someone they had not.
     */
    let mentions: string[] = Array.isArray(b.mentions) ? b.mentions.filter(Boolean) : [];
    if (mentions.length) {
      const { data: valid } = await ctx.supabase
        .from('organization_members').select('id')
        .eq('organization_id', ctx.org.organizationId)
        .eq('is_active', true)
        .in('id', mentions);
      const allowed = new Set((valid ?? []).map((m: any) => m.id));
      const unknown = mentions.filter(m => !allowed.has(m));
      if (unknown.length) {
        return error('One of the people mentioned is not an active member.', 422, 'UNKNOWN_MENTION');
      }
      mentions = [...allowed];
    }

    const { data, error: e } = await ctx.supabase
      .from('comments')
      .insert({
        organization_id: ctx.org.organizationId,
        author_id: ctx.org.memberId,
        body,
        project_id: projectId,
        task_id: taskId,
        parent_id: b.parent_id || null,
        mentions,
        // Internal by default. A message reaches the client only when somebody
        // deliberately says so.
        is_client_visible: b.is_client_visible === true,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Could not post the comment', 500);
  }
}
