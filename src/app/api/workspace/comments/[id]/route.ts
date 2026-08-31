import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * Edit or retract a comment on a workspace page.
 *
 * Both are restricted to the author by RLS. Checked here as well so the answer
 * is "that is not your comment" rather than an empty result that reads as "it
 * does not exist" - a distinction that matters when two people are looking at
 * the same thread.
 *
 * Scoped to `page_id IS NOT NULL` throughout. The `comments` table is shared
 * with projects, tasks, deals and tickets, and an id is all that separates
 * them: without the clause, the workspace module would be a second, unguarded
 * door onto a project's discussion.
 */

type Params = { params: Promise<{ id: string }> };

const SELECT =
  'id, body, mentions, parent_id, created_at, edited_at, page_id, ' +
  'author:organization_members!comments_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const body = String(b.body ?? '').trim();
    if (!body) return error('A comment cannot be empty.', 422, 'VALIDATION_ERROR');

    const { data: existing } = await ctx.supabase
      .from('comments').select('id, author_id, page_id')
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .not('page_id', 'is', null)
      .is('deleted_at', null).maybeSingle();

    if (!existing) return error('Not found', 404, 'NOT_FOUND');
    if (existing.author_id !== ctx.org.memberId) {
      return error('You can only edit your own comments.', 403, 'NOT_AUTHOR');
    }

    const { data, error: e } = await ctx.supabase
      .from('comments')
      .update({
        body,
        /**
         * Edits are marked, not hidden.
         *
         * A thread where messages change without trace is one nobody can rely
         * on afterwards, and a discussion attached to a policy document is
         * read back precisely when somebody is establishing what was agreed.
         */
        edited_at: new Date().toISOString(),
      })
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
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
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .not('page_id', 'is', null)
    .is('deleted_at', null)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found, or not yours to remove.', 404, 'NOT_FOUND');
  return success({ deleted: true, soft: true });
}
