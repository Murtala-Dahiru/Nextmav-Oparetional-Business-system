import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { ENTITY_TYPES } from '@/lib/workspace-links';

/**
 * ===========================================================================
 *  The other direction: what has been written about this record.
 * ===========================================================================
 *
 *  -- Why this endpoint has to exist --------------------------------------
 *
 *  A link that can only be read from the page that made it is a link nobody
 *  finds. Somebody opening the Halden account wants the documents about
 *  Halden; they will not think to search the workspace for a page that
 *  happens to mention it. This repository's dominant defect is complete
 *  machinery that nothing calls, and a one-directional link is exactly that
 *  shape.
 *
 *  -- Why the workspace grant is required ---------------------------------
 *
 *  Guarded on `workspace`, not on the module the record belongs to. Somebody
 *  without the workspace module has no business enumerating its pages even
 *  about a customer they own, and RLS on `workspace_page_links` resolves each
 *  row through `page_permission()` - so a private document linked to a company
 *  does not appear in that company's list for somebody who cannot open it.
 *
 *  The consumer decides whether to render the panel at all: a CRM screen shows
 *  it only when the reader holds workspace, exactly as the project workspace
 *  hides the money panel from somebody without finance.
 */
export async function GET(req: Request) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType') ?? searchParams.get('entity_type') ?? '';
  const entityId = searchParams.get('entityId') ?? searchParams.get('entity_id') ?? '';
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20));

  if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return error('entityType must name a linkable record type.', 422, 'VALIDATION_ERROR');
  }
  if (!entityId) return error('entityId is required', 422, 'VALIDATION_ERROR');

  const { data: links, error: e } = await ctx.supabase
    .from('workspace_page_links')
    .select('id, page_id, created_at')
    .eq('organization_id', ctx.org.organizationId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (e) return pgError(e);

  const pageIds = [...new Set((links ?? []).map((l: any) => l.page_id))];
  if (!pageIds.length) return success([]);

  /**
   * The pages themselves come from the tree view.
   *
   * Two reads rather than an embed because the link row and the page row are
   * governed by the same rule and returning half a row when the second half is
   * hidden would be worse than returning nothing: RLS filters this read too,
   * so a page the caller cannot open simply does not come back and its link is
   * dropped below.
   */
  const { data: pages, error: pageError } = await ctx.supabase
    .from('v_workspace_tree')
    .select('id, title, summary, icon, colour, kind, is_folder, updated_at, ' +
      'last_edited_by_name, permission, visibility')
    .eq('organization_id', ctx.org.organizationId)
    .in('id', pageIds);

  if (pageError) return pgError(pageError);

  const byId = new Map((pages ?? []).map((p: any) => [p.id, p]));

  return success(
    (links ?? [])
      .map((link: any) => {
        const page = byId.get(link.page_id);
        return page ? { ...page, linkId: link.id, linkedAt: link.created_at } : null;
      })
      .filter(Boolean),
  );
}
