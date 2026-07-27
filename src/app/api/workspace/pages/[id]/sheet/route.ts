import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

const COLUMN_TYPES = ['text', 'number', 'currency', 'date', 'select', 'checkbox', 'member', 'url'];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The spreadsheet behind a page of kind 'sheet'.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One endpoint for both columns and rows, dispatched on `target`, because
 * every edit here is small and frequent — typing in a cell, dragging a column
 * wider — and a grid that opens four routes for four verbs ends up with four
 * slightly different permission checks. The RLS policies scope both tables
 * through `page_permission()`, so the sharing rule on the folder a sheet lives
 * in governs the grid without this handler restating it.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const [columns, rows] = await Promise.all([
    ctx.supabase.from('workspace_sheet_columns').select('*')
      .eq('organization_id', ctx.org.organizationId).eq('page_id', id).order('position'),
    ctx.supabase.from('workspace_sheet_rows').select('*')
      .eq('organization_id', ctx.org.organizationId).eq('page_id', id)
      .order('position').limit(1000),
  ]);

  if (columns.error) return pgError(columns.error);
  if (rows.error) return pgError(rows.error);

  return success({ columns: columns.data ?? [], rows: rows.data ?? [] });
}

/** Add a column or a row. */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  if (b.target === 'column') {
    const name = String(b.name ?? '').trim();
    if (!name) return error('A column needs a name.', 422, 'VALIDATION_ERROR');
    if (b.type && !COLUMN_TYPES.includes(b.type)) {
      return error(`"${b.type}" is not a column type. Expected one of: ${COLUMN_TYPES.join(', ')}.`,
        422, 'VALIDATION_ERROR');
    }

    // Appended at the end. Asking the client for the position would let two
    // people adding a column at once land on the same one.
    const { data: last } = await ctx.supabase
      .from('workspace_sheet_columns').select('position')
      .eq('page_id', id).order('position', { ascending: false }).limit(1).maybeSingle();

    const { data, error: e } = await ctx.supabase
      .from('workspace_sheet_columns')
      .insert({
        organization_id: ctx.org.organizationId,
        page_id: id,
        name,
        type: b.type ?? 'text',
        options: Array.isArray(b.options) ? b.options : [],
        width: Number(b.width) || 180,
        position: (last?.position ?? -1) + 1,
      })
      .select('*').single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  }

  if (b.target === 'row') {
    const { data: last } = await ctx.supabase
      .from('workspace_sheet_rows').select('position')
      .eq('page_id', id).order('position', { ascending: false }).limit(1).maybeSingle();

    const { data, error: e } = await ctx.supabase
      .from('workspace_sheet_rows')
      .insert({
        organization_id: ctx.org.organizationId,
        page_id: id,
        cells: typeof b.cells === 'object' && b.cells !== null ? b.cells : {},
        position: (last?.position ?? -1) + 1,
        created_by: ctx.org.memberId,
        updated_by: ctx.org.memberId,
      })
      .select('*').single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  }

  return error('target must be "column" or "row"', 422, 'VALIDATION_ERROR');
}

/**
 * Rename a column, retype it, resize it, reorder it; or write cells into a row.
 *
 * Cell writes are merged rather than replaced. The grid sends only the cell
 * that changed, and replacing `cells` wholesale would blank every other column
 * in the row on each keystroke.
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

  if (b.target === 'column') {
    if (!b.column_id) return error('columnId is required', 422, 'VALIDATION_ERROR');

    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (typeof b.name === 'string') {
      const name = b.name.trim();
      if (!name) return error('A column needs a name.', 422, 'VALIDATION_ERROR');
      update.name = name;
    }
    if (b.type) {
      if (!COLUMN_TYPES.includes(b.type)) {
        return error(`"${b.type}" is not a column type.`, 422, 'VALIDATION_ERROR');
      }
      update.type = b.type;
    }
    if (Array.isArray(b.options)) update.options = b.options;
    if ('width' in b) update.width = Math.min(900, Math.max(60, Number(b.width) || 180));
    if ('position' in b) update.position = Number(b.position) || 0;

    const { data, error: e } = await ctx.supabase
      .from('workspace_sheet_columns').update(update)
      .eq('organization_id', ctx.org.organizationId)
      .eq('page_id', id).eq('id', b.column_id)
      .select('*').maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  }

  if (b.target === 'row') {
    if (!b.row_id) return error('rowId is required', 422, 'VALIDATION_ERROR');

    const { data: current, error: readError } = await ctx.supabase
      .from('workspace_sheet_rows').select('cells')
      .eq('organization_id', ctx.org.organizationId)
      .eq('page_id', id).eq('id', b.row_id).maybeSingle();

    if (readError) return pgError(readError);
    if (!current) return error('Not found', 404, 'NOT_FOUND');

    const update: Record<string, any> = {
      updated_at: new Date().toISOString(),
      updated_by: ctx.org.memberId,
    };
    if (typeof b.cells === 'object' && b.cells !== null) {
      update.cells = { ...(current.cells ?? {}), ...b.cells };
      // An emptied cell is removed rather than stored as "", so a sheet does
      // not accumulate keys for every column anyone has ever tabbed through.
      for (const [k, v] of Object.entries(update.cells)) {
        if (v === '' || v === null || v === undefined) delete update.cells[k];
      }
    }
    if ('position' in b) update.position = Number(b.position) || 0;

    const { data, error: e } = await ctx.supabase
      .from('workspace_sheet_rows').update(update)
      .eq('organization_id', ctx.org.organizationId)
      .eq('page_id', id).eq('id', b.row_id)
      .select('*').maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  }

  return error('target must be "column" or "row"', 422, 'VALIDATION_ERROR');
}

/**
 * Delete a column or a row.
 *
 * Dropping a column also drops its cells — done by the `prune_sheet_column`
 * trigger rather than here, so the values cannot survive a delete issued by
 * any other path.
 */
export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const columnId = searchParams.get('columnId');
  const rowId = searchParams.get('rowId');

  if (columnId) {
    const { count } = await ctx.supabase
      .from('workspace_sheet_columns')
      .select('id', { count: 'exact', head: true })
      .eq('page_id', id);

    // A grid with no columns has no cells and no way to add one back except
    // through the column menu, which is attached to a column.
    if ((count ?? 0) <= 1) {
      return error('A sheet needs at least one column.', 409, 'RULE_VIOLATION');
    }

    const { error: e } = await ctx.supabase
      .from('workspace_sheet_columns').delete()
      .eq('organization_id', ctx.org.organizationId)
      .eq('page_id', id).eq('id', columnId);

    if (e) return pgError(e);
    return success({ deleted: true });
  }

  if (rowId) {
    const { error: e } = await ctx.supabase
      .from('workspace_sheet_rows').delete()
      .eq('organization_id', ctx.org.organizationId)
      .eq('page_id', id).eq('id', rowId);

    if (e) return pgError(e);
    return success({ deleted: true });
  }

  return error('columnId or rowId is required', 422, 'VALIDATION_ERROR');
}
