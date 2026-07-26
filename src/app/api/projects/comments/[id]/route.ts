import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * Edit or retract a comment.
 *
 * Both are restricted to the author by RLS. Checked here as well so the answer
 * is "that is not your comment" rather than an empty result that reads as "it
 * does not exist" — a distinction that matters when two people are looking at
 * the same thread.
 */

type Params = { params: Promise<{ id: string }> };

const SELECT =
  'id, body, mentions, is_client_visible, created_at, edited_at, project_id, task_id, ' +
  'author:organization_members!comments_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('body' in b) {
      const body = String(b.body ?? '').trim();
      if (!body) return error('A comment cannot be empty', 422, 'VALIDATION_ERROR');
      update.body = body;
      /**
       * Edits are marked, not hidden.
       *
       * A thread where messages can change without trace is one nobody can
       * rely on afterwards — and project discussions are read back precisely
       * when someone is trying to establish what was agreed.
       */
      update.edited_at = new Date().toISOString();
    }

    // Publishing to the client is a deliberate, reversible act.
    if ('is_client_visible' in b) update.is_client_visible = b.is_client_visible === true;

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data: existing } = await ctx.supabase
      .from('comments').select('id, author_id')
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .is('deleted_at', null).maybeSingle();

    if (!existing) return error('Not found', 404, 'NOT_FOUND');
    if (existing.author_id !== ctx.org.memberId) {
      return error('You can only edit your own comments.', 403, 'NOT_AUTHOR');
    }

    const { data, error: e } = await ctx.supabase
      .from('comments').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
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
 * Retract a comment.
 *
 * Soft, so replies below it keep their parent and the thread does not
 * rearrange itself around the gap. Authors retract their own; administrators
 * moderate, which the RLS policy also permits.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found, or not yours to remove.', 404, 'NOT_FOUND');
  return success({ deleted: true, soft: true });
}
