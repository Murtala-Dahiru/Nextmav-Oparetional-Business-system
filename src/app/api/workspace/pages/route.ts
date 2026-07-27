import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';

/**
 * The workspace tree.
 *
 * Reads `v_workspace_tree` rather than `workspace_pages` because the client
 * needs the caller's effective permission on each node to decide whether to
 * offer rename, share and delete — and that is resolved by walking the folder
 * ancestry, which is not something to ship to the browser. The view is
 * `security_invoker`, so RLS on the underlying table still decides which rows
 * exist at all; the permission column only says what may be done with the ones
 * that come back.
 */
const SORTABLE = new Set(['created_at', 'updated_at', 'title', 'sort_order']);

export async function GET(req: Request) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(searchParams.get('pageSize')) || 200));

  const requested = searchParams.get('sort') ?? 'sort_order';
  const sort = SORTABLE.has(requested) ? requested : 'sort_order';
  const ascending = (searchParams.get('sortDir') ?? 'asc') === 'asc';

  let q = ctx.supabase
    .from('v_workspace_tree')
    .select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  for (const key of ['space_id', 'parent_id', 'is_folder', 'is_starred', 'kind', 'is_template']) {
    const value = searchParams.get(key);
    if (isFilterValue(value)) {
      q = q.eq(key, value === 'true' ? true : value === 'false' ? false : value);
    }
  }

  // `?parentId=root` is how the client asks for the top level. An `eq` against
  // the empty string would be a type error on a uuid column, and omitting the
  // filter would return the whole tree.
  if (searchParams.get('parent_id') === 'root' || searchParams.get('parentId') === 'root') {
    q = q.is('parent_id', null);
  }

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) q = q.ilike('title', `%${safe}%`);
  }

  const from = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order(sort, { ascending })
    .order('title', { ascending: true })
    .range(from, from + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Create a folder, a document or a spreadsheet.
 *
 * A spreadsheet is created with three starter columns rather than empty. An
 * empty grid has nowhere to type — the first thing anybody has to do is work
 * out how to add a column — and "Name / Status / Owner" is the shape most
 * business sheets start from anyway.
 */
const STARTER_COLUMNS = [
  { name: 'Name', type: 'text', width: 240, position: 0, options: [] },
  { name: 'Status', type: 'select', width: 150, position: 1,
    options: ['Not started', 'In progress', 'Blocked', 'Done'] },
  { name: 'Owner', type: 'member', width: 180, position: 2, options: [] },
];

export async function POST(req: Request) {
  const ctx = await authorize('workspace', 'create');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const isFolder = b.is_folder ?? false;
  const kind = b.kind === 'sheet' ? 'sheet' : 'document';

  const visibility = ['inherit', 'organization', 'department', 'private'].includes(b.visibility)
    ? b.visibility
    // Something created inside a folder inherits that folder's rule by
    // default. Defaulting to 'organization' instead would quietly publish
    // every new page added to a restricted folder.
    : (b.parent_id ? 'inherit' : 'organization');

  if (visibility === 'department' && !b.department_id) {
    return error('Choose a department to share this with.', 422, 'VALIDATION_ERROR');
  }

  const payload = {
    organization_id: ctx.org.organizationId,
    title: b.title?.trim() || (isFolder ? 'New folder' : kind === 'sheet' ? 'Untitled sheet' : 'Untitled'),
    content: isFolder ? '' : (b.content ?? ''),
    icon: b.icon ?? (isFolder ? 'folder' : kind === 'sheet' ? 'table' : 'file-text'),
    space_id: b.space_id || null,
    parent_id: b.parent_id || null,
    is_folder: isFolder,
    kind: isFolder ? 'document' : kind,
    is_template: b.is_template ?? false,
    // 'color' is accepted as well as 'colour' because the client spells it the
    // American way and the schema does not.
    colour: b.colour || b.color || '#10b981',
    is_starred: b.is_starred ?? false,
    visibility,
    department_id: visibility === 'department' ? b.department_id : null,
    sort_order: Number(b.sort_order) || 0,
    created_by: ctx.org.memberId,
    last_edited_by: ctx.org.memberId,
  };

  const { data, error: e } = await ctx.supabase
    .from('workspace_pages').insert(payload).select('*').single();

  if (e) return pgError(e);

  if (!isFolder && kind === 'sheet') {
    const { error: colError } = await ctx.supabase.from('workspace_sheet_columns').insert(
      STARTER_COLUMNS.map(c => ({
        organization_id: ctx.org.organizationId,
        page_id: data.id,
        name: c.name,
        type: c.type,
        options: c.options,
        width: c.width,
        position: c.position,
      })),
    );
    // The sheet exists either way; a failed starter grid is a cosmetic loss,
    // not a reason to fail the create and leave nothing behind.
    if (colError) console.error('sheet starter columns:', colError.message);
  }

  /**
   * Answer with the same shape the tree does.
   *
   * `insert().select('*')` returns the bare table row, which has no
   * `permission`, `childCount` or `fileCount` — all of which the client's
   * node type declares and the sidebar reads. Returning it meant a
   * freshly-created folder was the one node in the tree whose controls could
   * not be rendered until the next full reload. The contract checker found
   * this by comparing the two responses against one declared shape.
   */
  const { data: node } = await ctx.supabase
    .from('v_workspace_tree').select('*')
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', data.id)
    .maybeSingle();

  return success(node ?? data, undefined, 201);
}
