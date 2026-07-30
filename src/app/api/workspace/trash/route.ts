import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The workspace trash
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this was missing rather than absent ───────────────────────────────
 *
 * Deleting a page has always been soft — `workspace_pages.deleted_at` is
 * stamped, the row survives, and deleting a folder marks its descendants in the
 * same statement so they do not reappear scattered at the root.
 *
 * Nothing ever read those rows back. So the data for a trash existed from the
 * first migration, every delete was quietly recoverable, and there was no way
 * to recover anything — which is the worst of both: the storage cost of keeping
 * it and none of the reassurance.
 *
 * ── What restoring has to get right ───────────────────────────────────────
 *
 * A page's parent may itself be deleted. Restoring the child alone would put it
 * back into a folder that is not there, and it would render at the root or not
 * at all depending on how the tree is walked. So a restore either brings the
 * ancestors back with it or detaches the page to the root, and this one does
 * the former — somebody who deletes a folder by mistake and restores a document
 * from it expects the folder back too.
 */

const SELECT =
  'id, title, icon, colour, kind, is_folder, parent_id, deleted_at, updated_at, ' +
  'created_by, last_edited_by';

/**
 * What is in the trash.
 *
 * Newest first: the thing somebody wants back is almost always the thing they
 * just deleted.
 */
export async function GET() {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  const { data, error: e } = await ctx.supabase
    .from('workspace_pages')
    .select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(200);

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Restore, or empty.
 *
 * `{ id }` restores one page and the ancestors it needs; `{ empty: true }`
 * removes everything in the trash for good.
 */
export async function POST(req: Request) {
  const ctx = await authorize('workspace', 'delete');
  if (ctx instanceof Response) return ctx;

  const b = acceptBody(await req.json().catch(() => ({})));

  /**
   * Emptying is a hard delete, and it is the one destructive act here.
   *
   * Guarded on `manage` rather than `delete`: moving something to the trash and
   * destroying everything anybody has ever deleted are different decisions, and
   * the second should not be reachable by whoever holds the first.
   */
  if (b.empty === true) {
    const guard = await authorize('workspace', 'manage');
    if (guard instanceof Response) return guard;

    const { data, error: e } = await ctx.supabase
      .from('workspace_pages')
      .delete()
      .eq('organization_id', ctx.org.organizationId)
      .not('deleted_at', 'is', null)
      .select('id');

    if (e) return pgError(e);
    return success({ emptied: (data ?? []).length });
  }

  const id = String(b.id ?? '').trim();
  if (!id) {
    return error('Pass an id to restore, or empty: true to clear the trash.', 422, 'VALIDATION_ERROR');
  }

  const { data: target } = await ctx.supabase
    .from('workspace_pages')
    .select('id, parent_id, deleted_at, title')
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .maybeSingle();

  if (!target) return error('Not found', 404, 'NOT_FOUND');
  if (!target.deleted_at) {
    return error('That page is not in the trash.', 409, 'NOT_DELETED');
  }

  /**
   * Walk up to the root, collecting any deleted ancestors.
   *
   * Bounded at twenty, the same depth limit the delete uses — a workspace tree
   * that deep is a data problem, and an unbounded walk over a cycle would not
   * terminate.
   */
  const toRestore = [target.id];
  let parentId: string | null = target.parent_id;

  for (let depth = 0; depth < 20 && parentId; depth++) {
    const { data: parent } = await ctx.supabase
      .from('workspace_pages')
      .select('id, parent_id, deleted_at')
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', parentId)
      .maybeSingle();

    if (!parent) break;
    // A live ancestor means the rest of the path is intact.
    if (!parent.deleted_at) break;
    toRestore.push(parent.id);
    parentId = parent.parent_id;
  }

  /**
   * Restoring a folder restores what was in it.
   *
   * Deleting a folder marked its descendants in one statement, so restoring
   * only the folder would leave its contents in the trash — the folder back and
   * empty, which is not what anybody means by undo. Only descendants deleted at
   * the *same moment* are brought back, so a document deleted separately a week
   * earlier stays where it was put.
   */
  const deletedAt = target.deleted_at;
  let frontier = [target.id];
  for (let depth = 0; depth < 20 && frontier.length; depth++) {
    const { data: children } = await ctx.supabase
      .from('workspace_pages')
      .select('id')
      .eq('organization_id', ctx.org.organizationId)
      .in('parent_id', frontier)
      .eq('deleted_at', deletedAt);

    frontier = (children ?? []).map(r => r.id).filter(x => !toRestore.includes(x));
    toRestore.push(...frontier);
  }

  const { data, error: e } = await ctx.supabase
    .from('workspace_pages')
    .update({ deleted_at: null })
    .eq('organization_id', ctx.org.organizationId)
    .in('id', toRestore)
    .select('id, title, parent_id');

  if (e) return pgError(e);
  return success({ restored: (data ?? []).length, pages: data ?? [] });
}

/**
 * Destroy one item for good.
 *
 * Separate from emptying so a single mistake can be cleaned up without
 * discarding everything else somebody may still want back.
 */
export async function DELETE(req: Request) {
  const ctx = await authorize('workspace', 'manage');
  if (ctx instanceof Response) return ctx;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return error('Pass ?id= to destroy one item.', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('workspace_pages')
    .delete()
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    // Only from the trash: a hard delete of a live page would bypass the
    // recovery this endpoint exists to provide.
    .not('deleted_at', 'is', null)
    .select('id');

  if (e) return pgError(e);
  if (!(data ?? []).length) {
    return error('That page is not in the trash.', 409, 'NOT_DELETED');
  }
  return success({ destroyed: true });
}
