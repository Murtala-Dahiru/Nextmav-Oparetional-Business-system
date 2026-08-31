import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ===========================================================================
 *  Discussion on a workspace page.
 * ===========================================================================
 *
 *  `comments.page_id` has had a foreign key and an index since the first
 *  business migration, `comments.mentions` has had a notification trigger
 *  reading it since 0004, and no row has ever been written with a `page_id`
 *  set. A workspace where a policy cannot be questioned in place is one where
 *  the questions happen in chat and are unfindable a week later.
 *
 *  -- Guarded on view, not on create --------------------------------------
 *
 *  Commenting on a document you can open is participation, not authorship of
 *  workspace data. The `employee` role holds `['view', 'edit']` on workspace;
 *  requiring `create` would mean the people who read the SOPs could not ask
 *  about them. The projects discussion made the same call for the same reason.
 *
 *  RLS is the real boundary either way: 0035 made `comments_insert` require
 *  `page_permission(page_id) IS NOT NULL`, so a comment cannot be filed
 *  against a page the author cannot open, whatever this handler allows.
 */

const SELECT =
  'id, body, mentions, parent_id, created_at, edited_at, page_id, ' +
  'author:organization_members!comments_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title))';

export async function GET(req: Request) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const pageId = searchParams.get('pageId') ?? searchParams.get('page_id');
  if (!pageId) return error('pageId is required', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('comments')
    .select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .eq('page_id', pageId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(500);

  if (e) return pgError(e);
  return success(data ?? []);
}

export async function POST(req: Request) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    const body = String(b.body ?? '').trim();
    if (!body) return error('A comment cannot be empty.', 422, 'VALIDATION_ERROR');

    const pageId = b.page_id || null;
    if (!pageId) return error('pageId is required', 422, 'VALIDATION_ERROR');

    /**
     * The page must be one this person can open.
     *
     * RLS says the same thing, and would answer with a policy violation. This
     * answers with a sentence, and it distinguishes "no such page" from "not
     * yours" without leaking which - both come back as the same 404, because
     * confirming that a private page exists is itself a disclosure.
     */
    const { data: page } = await ctx.supabase
      .from('v_workspace_tree').select('id, permission')
      .eq('organization_id', ctx.org.organizationId).eq('id', pageId).maybeSingle();
    if (!page) return error('That page does not exist in this organization.', 404, 'NOT_FOUND');

    /**
     * A reply's parent must be on the same page.
     *
     * Without this a reply could be threaded under a comment on a different
     * document, and it would then render on that document's thread - a comment
     * moved between pages by nothing more than a mistyped id.
     */
    const parentId = b.parent_id || null;
    if (parentId) {
      const { data: parent } = await ctx.supabase
        .from('comments').select('id, page_id, parent_id')
        .eq('organization_id', ctx.org.organizationId).eq('id', parentId)
        .is('deleted_at', null).maybeSingle();
      if (!parent || parent.page_id !== pageId) {
        return error('That comment is not on this page.', 422, 'VALIDATION_ERROR');
      }
      // One level of nesting. A thread of threads is a thread nobody reads,
      // and the projects discussion settled on the same rule.
      if (parent.parent_id) {
        return error('Replies go on the top comment of a thread.', 422, 'NESTING_LIMIT');
      }
    }

    /**
     * Mentions are validated against the organisation.
     *
     * An id that is not a colleague would sit in the array forever and the
     * notification trigger would silently drop it, leaving the author
     * believing they had notified somebody they had not.
     */
    let mentions: string[] = Array.isArray(b.mentions) ? b.mentions.filter(Boolean) : [];
    if (mentions.length) {
      const { data: valid } = await ctx.supabase
        .from('organization_members').select('id')
        .eq('organization_id', ctx.org.organizationId)
        .eq('is_active', true)
        .in('id', mentions);
      const allowed = new Set((valid ?? []).map((m: any) => m.id));
      if (mentions.some(m => !allowed.has(m))) {
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
        page_id: pageId,
        parent_id: parentId,
        mentions,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not post the comment');
  }
}
