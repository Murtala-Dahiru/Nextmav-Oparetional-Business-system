import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { log, serializeError } from '@/lib/logger';
import { builtInTemplates, builtInTemplate } from '@/lib/workspace-templates';

/**
 * ===========================================================================
 *  Templates: the shipped library, and the organisation's own.
 * ===========================================================================
 *
 *  Two sources, one list. The library in `lib/workspace-templates.ts` is
 *  shipped with the product and identical everywhere; an organisation
 *  template is a `workspace_pages` row with `is_template = true` - a column
 *  that has existed since 0003, is accepted by the create endpoint, is
 *  filterable on the list endpoint, and which no screen has ever set.
 *
 *  `source` says which is which, because they behave differently: a built-in
 *  cannot be edited or deleted, and an organisation's own can be opened like
 *  any other page.
 */

export async function GET(req: Request) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind');

  const { data, error: e } = await ctx.supabase
    .from('v_workspace_tree').select('*')
    .eq('organization_id', ctx.org.organizationId)
    .eq('is_template', true)
    .order('title');

  if (e) return pgError(e);

  const own = (data ?? []).map((row: any) => ({
    source: 'organization' as const,
    id: row.id,
    title: row.title,
    summary: row.summary ?? '',
    category: row.template_category || 'Company',
    kind: row.kind,
    icon: row.icon ?? 'file-text',
    colour: row.colour,
    updatedAt: row.updated_at,
    authorName: row.created_by_name ?? null,
    permission: row.permission,
  }));

  const built = builtInTemplates().map(t => ({
    source: 'builtin' as const,
    id: t.id,
    title: t.title,
    summary: t.summary,
    category: t.category,
    kind: t.kind,
    icon: t.icon,
    colour: null as string | null,
    updatedAt: null as string | null,
    authorName: null as string | null,
    permission: 'view' as const,
  }));

  const all = [...own, ...built].filter(t => !kind || t.kind === kind);
  return success(all);
}

/**
 * Create a page from a template.
 *
 * -- Why this is a POST here and not a flag on the create endpoint --------
 *
 * Copying an organisation's spreadsheet template means copying its columns
 * and, if asked, its rows. That is three inserts that have to either all
 * happen or leave nothing behind, and putting it inside the general create
 * handler would make the commonest call in the module carry a branch it never
 * takes. It also lets this endpoint read the source through RLS first, which
 * is what stops a template id from another tenant being copied by guess.
 */
export async function POST(req: Request) {
  const ctx = await authorize('workspace', 'create');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const source = b.source === 'organization' ? 'organization' : 'builtin';
  const templateId = String(b.template_id ?? '').trim();
  if (!templateId) return error('templateId is required', 422, 'VALIDATION_ERROR');

  const parentId = b.parent_id || null;

  // Creating inside a folder needs the right to write in it. RLS enforces the
  // same rule; asking here turns an opaque policy violation into a sentence.
  if (parentId) {
    const { data: parent } = await ctx.supabase
      .from('v_workspace_tree').select('id, permission')
      .eq('organization_id', ctx.org.organizationId).eq('id', parentId).maybeSingle();
    if (!parent) return error('That folder does not exist in this organization.', 404, 'NOT_FOUND');
    if (!['edit', 'manage'].includes(parent.permission)) {
      return error('You do not have permission to add pages there.', 403, 'RLS_DENIED');
    }
  }

  let title: string;
  let summary: string;
  let content: string;
  let kind: 'document' | 'sheet';
  let icon: string;
  let columns: { name: string; type: string; width?: number; options?: string[]; aggregate?: string; align?: string; formula?: string }[] = [];
  let sourceRows: any[] = [];

  if (source === 'builtin') {
    const template = builtInTemplate(templateId);
    if (!template) return error('That template no longer exists.', 404, 'NOT_FOUND');
    title = String(b.title ?? '').trim() || template.title;
    summary = template.summary;
    content = template.body;
    kind = template.kind;
    icon = template.icon;
    columns = template.columns ?? [];
  } else {
    const { data: page } = await ctx.supabase
      .from('workspace_pages')
      .select('id, title, summary, content, kind, icon, colour, is_template')
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', templateId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!page || !page.is_template) {
      return error('That template no longer exists.', 404, 'NOT_FOUND');
    }
    title = String(b.title ?? '').trim() || page.title;
    summary = page.summary ?? '';
    content = page.content ?? '';
    kind = page.kind === 'sheet' ? 'sheet' : 'document';
    icon = page.icon ?? 'file-text';

    if (kind === 'sheet') {
      const [cols, rows] = await Promise.all([
        ctx.supabase.from('workspace_sheet_columns').select('*')
          .eq('page_id', templateId).order('position'),
        // Rows are copied too: a template sheet's rows are its structure, not
        // its data - a budget template's category lines are the point of it.
        ctx.supabase.from('workspace_sheet_rows').select('*')
          .eq('page_id', templateId).order('position').limit(500),
      ]);
      columns = (cols.data ?? []) as any[];
      sourceRows = (rows.data ?? []) as any[];
    }
  }

  const { data: created, error: createError } = await ctx.supabase
    .from('workspace_pages')
    .insert({
      organization_id: ctx.org.organizationId,
      title,
      summary,
      content: kind === 'sheet' ? '' : content,
      icon,
      colour: b.colour || b.color || '#2d9572',
      parent_id: parentId,
      is_folder: false,
      kind,
      // A page made from a template is a document, never another template.
      // Without this an organisation's template gallery doubles every time
      // somebody uses one.
      is_template: false,
      visibility: parentId ? 'inherit' : 'organization',
      created_by: ctx.org.memberId,
      last_edited_by: ctx.org.memberId,
    })
    .select('id')
    .single();

  if (createError) return pgError(createError);

  if (kind === 'sheet' && columns.length) {
    /**
     * Column ids are regenerated, and the row cells are re-keyed to match.
     *
     * Cells are a jsonb object keyed by column id (0017 says why). Copying the
     * rows verbatim would leave every cell pointing at the *template's* column
     * ids, which do not exist on the new sheet - so the grid would render a
     * full set of columns and an entirely empty body, with the values present
     * in the database and unreachable.
     */
    const inserted = await ctx.supabase
      .from('workspace_sheet_columns')
      .insert(columns.map((c, index) => ({
        organization_id: ctx.org.organizationId,
        page_id: created.id,
        name: c.name,
        type: c.type ?? 'text',
        options: Array.isArray(c.options) ? c.options : [],
        width: Number(c.width) || 180,
        position: index,
        align: c.align ?? null,
        aggregate: c.aggregate ?? 'none',
        formula: c.formula ?? null,
      })))
      .select('id, name, position');

    if (inserted.error) {
      log.warn('template columns were not created', { err: serializeError(inserted.error) });
    } else if (sourceRows.length) {
      // Old column id -> new column id, matched on position, which is stable
      // and unique within a sheet.
      const byPosition = new Map(
        (inserted.data ?? []).map((c: any) => [c.position, c.id]),
      );
      const remap = new Map<string, string>();
      columns.forEach((c: any, index) => {
        const next = byPosition.get(index);
        if (c.id && next) remap.set(String(c.id), String(next));
      });

      const rows = sourceRows.map((row, index) => ({
        organization_id: ctx.org.organizationId,
        page_id: created.id,
        cells: Object.fromEntries(
          Object.entries(row.cells ?? {})
            .map(([key, value]) => [remap.get(key), value])
            .filter(([key]) => !!key),
        ),
        position: index,
        created_by: ctx.org.memberId,
        updated_by: ctx.org.memberId,
      }));

      const { error: rowError } = await ctx.supabase.from('workspace_sheet_rows').insert(rows);
      if (rowError) log.warn('template rows were not created', { err: serializeError(rowError) });
    }
  }

  // The tree shape, not the bare table row: the client puts this straight into
  // its node list and reads `permission`, `childCount` and `fileCount` off it.
  const { data: node } = await ctx.supabase
    .from('v_workspace_tree').select('*')
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', created.id)
    .maybeSingle();

  return success(node, undefined, 201);
}
