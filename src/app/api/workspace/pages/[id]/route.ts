import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

/**
 * One page, with everything the editor needs to open it.
 *
 * The generic record handler was enough while a page was only markdown. A
 * spreadsheet needs its columns and rows, a folder needs its children and its
 * files, and every page needs the caller's permission so the editor knows
 * whether to render read-only. Fetching those separately would be four round
 * trips before the first character appears.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: page, error: e } = await ctx.supabase
    .from('v_workspace_tree').select('*')
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  // A row hidden by RLS and a row that does not exist are indistinguishable to
  // the caller by design — confirming existence would leak across tenants.
  if (!page) return error('Not found', 404, 'NOT_FOUND');

  // The body lives on the table, not the view: the tree carries structure, and
  // shipping every page's full markdown with the sidebar would be wasteful.
  const { data: body } = await ctx.supabase
    .from('workspace_pages').select('content')
    .eq('id', id).maybeSingle();

  const [columns, rows, files, shares] = await Promise.all([
    page.kind === 'sheet'
      ? ctx.supabase.from('workspace_sheet_columns').select('*')
          .eq('page_id', id).order('position')
      : Promise.resolve({ data: [] }),
    page.kind === 'sheet'
      ? ctx.supabase.from('workspace_sheet_rows').select('*')
          .eq('page_id', id).order('position').limit(1000)
      : Promise.resolve({ data: [] }),
    ctx.supabase.from('v_files').select('*').eq('page_id', id).order('created_at', { ascending: false }),
    ctx.supabase.from('workspace_page_shares')
      .select('*, member:organization_members!workspace_page_shares_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), department:departments(id, name)')
      .eq('page_id', id),
  ]);

  return success({
    ...page,
    content: body?.content ?? '',
    columns: columns.data ?? [],
    rows: rows.data ?? [],
    files: files.data ?? [],
    shares: shares.data ?? [],
  });
}

/**
 * Update a page: its body, its name, its place in the tree, its visibility.
 *
 * Fields are allow-listed rather than passed through. `version` is maintained
 * by the snapshot trigger and `created_by` decides who may re-share, so a
 * client that sent either — deliberately or by echoing back a whole record —
 * would rewrite history or hand itself ownership.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const update: Record<string, any> = {};

  if (typeof b.title === 'string') {
    const title = b.title.trim();
    if (!title) return error('A page needs a name.', 422, 'VALIDATION_ERROR');
    update.title = title;
  }
  if (typeof b.content === 'string') update.content = b.content;
  if (typeof b.icon === 'string') update.icon = b.icon;
  if (b.colour || b.color) update.colour = b.colour || b.color;
  if ('is_starred' in b) update.is_starred = !!b.is_starred;
  if ('is_template' in b) update.is_template = !!b.is_template;
  if ('sort_order' in b) update.sort_order = Number(b.sort_order) || 0;

  /**
   * Moving a page.
   *
   * `parentId: null` means "move to the root" and is distinct from not sending
   * the field at all, so the key's presence is what is tested rather than its
   * truthiness — otherwise a page could never be moved out of a folder.
   */
  if ('parent_id' in b) {
    if (b.parent_id === id) {
      return error('A page cannot be placed inside itself.', 422, 'VALIDATION_ERROR');
    }
    update.parent_id = b.parent_id || null;
  }
  if ('space_id' in b) update.space_id = b.space_id || null;

  if ('visibility' in b) {
    if (!['inherit', 'organization', 'department', 'private'].includes(b.visibility)) {
      return error('That is not a valid visibility.', 422, 'VALIDATION_ERROR');
    }
    if (b.visibility === 'department' && !(b.department_id ?? null)) {
      return error('Choose a department to share this with.', 422, 'VALIDATION_ERROR');
    }
    update.visibility = b.visibility;
    update.department_id = b.visibility === 'department' ? b.department_id : null;
  }

  if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

  update.last_edited_by = ctx.org.memberId;

  const { data, error: e } = await ctx.supabase
    .from('workspace_pages').update(update)
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (e) return pgError(e);
  // No row came back either because it is not there or because the caller may
  // read it but not change it. The second is the common case and deserves the
  // clearer answer.
  if (!data) {
    const { data: exists } = await ctx.supabase
      .from('workspace_pages').select('id')
      .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();
    return exists
      ? error('You do not have permission to change this page.', 403, 'RLS_DENIED')
      : error('Not found', 404, 'NOT_FOUND');
  }
  return success(data);
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  /**
   * Deleting a folder deletes what is inside it.
   *
   * `parent_id` cascades on hard delete, but these are soft deletes, so the
   * children would keep `deleted_at IS NULL` and reappear at the root of the
   * tree — the folder gone and its contents scattered. The descendants are
   * collected first and marked in one statement.
   */
  const ids = [id];
  let frontier = [id];
  for (let depth = 0; depth < 20 && frontier.length; depth++) {
    const { data } = await ctx.supabase
      .from('workspace_pages').select('id')
      .eq('organization_id', ctx.org.organizationId)
      .in('parent_id', frontier)
      .is('deleted_at', null);
    frontier = (data ?? []).map(r => r.id).filter(x => !ids.includes(x));
    ids.push(...frontier);
  }

  const { error: e } = await ctx.supabase
    .from('workspace_pages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.organizationId)
    .in('id', ids);

  if (e) return pgError(e);
  return success({ deleted: true, soft: true, count: ids.length });
}

// The editor sends PUT when saving.
export { PATCH as PUT };
