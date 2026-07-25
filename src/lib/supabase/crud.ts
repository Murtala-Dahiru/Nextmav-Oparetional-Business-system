import { isFilterValue } from '@/lib/filters';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleId } from '@/lib/constants';
import { authorize, pgError, type RequestContext } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Generic list/create handlers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Most resources differ only in table name, searchable columns and which
 *  relations to embed. Writing forty near-identical handlers guarantees they
 *  drift — one forgets pagination, another sorts on an unvalidated column,
 *  a third omits the tenant. Expressing the shape once makes them provably
 *  consistent and leaves genuinely different endpoints obviously different.
 *
 *  Tenant scoping is applied here *and* enforced by RLS. The explicit filter
 *  keeps queries efficient (the index leads with organization_id) and makes
 *  the intent readable; RLS is what actually guarantees it.
 */

export interface ListOptions {
  /** Table or view to read. */
  table: string;
  /** Module the caller must have access to. */
  module: ModuleId;
  /** PostgREST select expression, including embedded relations. */
  select?: string;
  /** Columns `?search=` matches against, case-insensitively. */
  searchColumns?: string[];
  /** Columns that may be sorted on. Anything else is rejected. */
  sortable?: string[];
  /** Default ordering. */
  defaultSort?: string;
  /** `?key=value` filters passed straight through as equality matches. */
  filterable?: string[];
  /** Exclude soft-deleted rows. */
  softDelete?: boolean;
  /** Extra constraints applied to every query, e.g. per-role scoping. */
  scope?: (q: any, ctx: RequestContext) => any;
}

const MAX_PAGE_SIZE = 100;

/**
 * Build a GET handler that lists rows with search, filter, sort and paging.
 */
export function listHandler(opts: ListOptions) {
  const {
    table, module, select = '*', searchColumns = [], sortable = [],
    defaultSort = 'created_at', filterable = [], softDelete = false, scope,
  } = opts;

  return async function GET(req: Request) {
    const ctx = await authorize(module, 'view');
    if (ctx instanceof Response) return ctx;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    // Sorting on an arbitrary column is an injection vector and can also be an
    // information leak (ordering by a column you cannot read). Allow-list only.
    const requestedSort = searchParams.get('sort') ?? defaultSort;
    const sort = sortable.includes(requestedSort) ? requestedSort : defaultSort;
    const ascending = searchParams.get('sortDir') === 'asc';

    let q = ctx.supabase
      .from(table)
      .select(select, { count: 'exact' })
      .eq('organization_id', ctx.org.organizationId);

    if (softDelete) q = q.is('deleted_at', null);
    if (scope) q = scope(q, ctx);

    const search = searchParams.get('search')?.trim();
    if (search && searchColumns.length) {
      // PostgREST `or` with ilike. Commas and parentheses would break out of
      // the filter expression, so they are stripped rather than escaped.
      const safe = search.replace(/[,()*]/g, ' ').trim();
      if (safe) {
        q = q.or(searchColumns.map(c => `${c}.ilike.%${safe}%`).join(','));
      }
    }

    for (const key of filterable) {
      const value = searchParams.get(key);
      if (isFilterValue(value)) {
        q = q.eq(key, value === 'true' ? true : value === 'false' ? false : value);
      }
    }

    const from = (page - 1) * pageSize;
    const { data, count, error: e } = await q
      .order(sort, { ascending })
      .range(from, from + pageSize - 1);

    if (e) return pgError(e);
    return paginated(data ?? [], count ?? 0, page, pageSize);
  };
}

export interface CreateOptions {
  table: string;
  module: ModuleId;
  select?: string;
  /** Validate and shape the request body. Throw to reject. */
  prepare?: (body: any, ctx: RequestContext) => Record<string, any>;
}

/**
 * Build a POST handler that inserts a row into the caller's organization.
 *
 * `organization_id` is always taken from the session, never from the body:
 * accepting it from the client would let anyone write into another tenant.
 * RLS would reject it, but failing here gives a clearer error and avoids a
 * pointless round trip.
 */
export function createHandler(opts: CreateOptions) {
  const { table, module, select = '*', prepare } = opts;

  return async function POST(req: Request) {
    const ctx = await authorize(module, 'create');
    if (ctx instanceof Response) return ctx;

    let payload: Record<string, any>;
    try {
      // Forms send a mix of camelCase (pre-migration fields) and snake_case.
      const body = acceptBody(await req.json());
      payload = prepare ? prepare(body, ctx) : body;
    } catch (e: any) {
      return error(e.message || 'Invalid request body', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from(table)
      .insert({ ...payload, organization_id: ctx.org.organizationId })
      .select(select)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  };
}

// ─── single-record handlers ────────────────────────────────────────────────

export interface RecordOptions {
  table: string;
  module: ModuleId;
  select?: string;
  softDelete?: boolean;
  prepare?: (body: any, ctx: RequestContext) => Record<string, any>;
  /** Action required to update. Defaults to `edit`. */
  updateAction?: 'edit' | 'approve' | 'manage';
}

type Params = { params: Promise<{ id: string }> };

export function getOneHandler(opts: RecordOptions) {
  const { table, module, select = '*' } = opts;

  return async function GET(_req: Request, { params }: Params) {
    const ctx = await authorize(module, 'view');
    if (ctx instanceof Response) return ctx;
    const { id } = await params;

    const { data, error: e } = await ctx.supabase
      .from(table).select(select)
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .maybeSingle();

    if (e) return pgError(e);
    // A row hidden by RLS and a row that does not exist are indistinguishable
    // to the caller by design — confirming existence would leak across tenants.
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  };
}

export function updateHandler(opts: RecordOptions) {
  const { table, module, select = '*', prepare, updateAction = 'edit' } = opts;

  return async function PATCH(req: Request, { params }: Params) {
    const ctx = await authorize(module, updateAction);
    if (ctx instanceof Response) return ctx;
    const { id } = await params;

    let payload: Record<string, any>;
    try {
      // Forms send a mix of camelCase (pre-migration fields) and snake_case.
      const body = acceptBody(await req.json());
      payload = prepare ? prepare(body, ctx) : body;
    } catch (e: any) {
      return error(e.message || 'Invalid request body', 422, 'VALIDATION_ERROR');
    }

    // Never let a client move a record between tenants or reassign its id.
    delete payload.organization_id;
    delete payload.id;

    const { data, error: e } = await ctx.supabase
      .from(table).update(payload)
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .select(select)
      .maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  };
}

/**
 * Delete, soft where the table supports it.
 *
 * Soft delete keeps audit trails and foreign keys pointing at a real row;
 * hard delete is reserved for tables where nothing references the record.
 */
export function deleteHandler(opts: RecordOptions) {
  const { table, module, softDelete = false } = opts;

  return async function DELETE(_req: Request, { params }: Params) {
    const ctx = await authorize(module, 'delete');
    if (ctx instanceof Response) return ctx;
    const { id } = await params;

    const { error: e } = softDelete
      ? await ctx.supabase.from(table)
          .update({ deleted_at: new Date().toISOString() })
          .eq('organization_id', ctx.org.organizationId).eq('id', id)
      : await ctx.supabase.from(table)
          .delete()
          .eq('organization_id', ctx.org.organizationId).eq('id', id);

    if (e) return pgError(e);
    return success({ deleted: true, soft: softDelete });
  };
}

/** Convenience: everything a `[id]` route needs. */
export function recordHandlers(opts: RecordOptions) {
  return {
    GET: getOneHandler(opts),
    PATCH: updateHandler(opts),
    PUT: updateHandler(opts),
    DELETE: deleteHandler(opts),
  };
}

/** Convenience: everything a collection route needs. */
export function collectionHandlers(list: ListOptions, create: CreateOptions) {
  return { GET: listHandler(list), POST: createHandler(create) };
}

export type { SupabaseClient };
