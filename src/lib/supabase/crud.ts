import { isFilterValue } from '@/lib/filters';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleId } from '@/lib/constants';
import { authorize, pgError, type RequestContext } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody, toCamel, toSnake } from '@/lib/case';
import { recordActivity } from '@/lib/activity';

/**
 * Turn a Zod failure into the one sentence a user can act on.
 *
 * Routes in this codebase report validation failures as a written explanation
 * with a 422 — "An invoice needs at least one line item" — and the toast shows
 * it verbatim. A serialised issue array would be a regression in the same place
 * that was just fixed to stop showing bare status codes, so the field is named
 * and the first message is used.
 */
function firstIssue(err: any): string {
  const issue = err?.issues?.[0];
  if (!issue) return 'Invalid request body';
  const path = (issue.path ?? []).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

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
  /**
   * Direction used when the caller does not ask for one.
   *
   * Descending suits a feed of recent records, which is why it was the only
   * behaviour — but it is wrong for anything with a deliberate sequence. A
   * roadmap ordered by `sort_order` came back last-phase-first, so 'Launch'
   * appeared above 'Design complete'.
   */
  defaultSortDir?: 'asc' | 'desc';
  /** `?key=value` filters passed straight through as equality matches. */
  filterable?: string[];
  /** Exclude soft-deleted rows. */
  softDelete?: boolean;
  /**
   * Extra constraints applied to every query, e.g. per-role scoping.
   *
   * Receives the request URL as well so a resource can offer a filter that
   * depends on who is asking — `?assignedToMe=true` resolving to the caller's
   * own membership id, say — without the client needing to know its own
   * identifiers, and without hand-writing a whole list handler for it.
   */
  scope?: (q: any, ctx: RequestContext, url: URL) => any;
}

const MAX_PAGE_SIZE = 100;

/**
 * Build a GET handler that lists rows with search, filter, sort and paging.
 */
export function listHandler(opts: ListOptions) {
  const {
    table, module, select = '*', searchColumns = [], sortable = [],
    defaultSort = 'created_at', defaultSortDir = 'desc',
    filterable = [], softDelete = false, scope,
  } = opts;

  return async function GET(req: Request) {
    const ctx = await authorize(module, 'view');
    if (ctx instanceof Response) return ctx;

    const url = new URL(req.url);
    const { searchParams } = url;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    // Sorting on an arbitrary column is an injection vector and can also be an
    // information leak (ordering by a column you cannot read). Allow-list only.
    const requestedSort = searchParams.get('sort') ?? defaultSort;
    const sort = sortable.includes(requestedSort) ? requestedSort : defaultSort;
    const sortDir = searchParams.get('sortDir') ?? defaultSortDir;
    const ascending = sortDir === 'asc';

    let q = ctx.supabase
      .from(table)
      .select(select, { count: 'exact' })
      .eq('organization_id', ctx.org.organizationId);

    if (softDelete) q = q.is('deleted_at', null);
    if (scope) q = scope(q, ctx, url);

    const search = searchParams.get('search')?.trim();
    if (search && searchColumns.length) {
      // PostgREST `or` with ilike. Commas and parentheses would break out of
      // the filter expression, so they are stripped rather than escaped.
      const safe = search.replace(/[,()*]/g, ' ').trim();
      if (safe) {
        q = q.or(searchColumns.map(c => `${c}.ilike.%${safe}%`).join(','));
      }
    }

    /**
     * Filters, accepted in either dialect.
     *
     * ── Why both spellings ────────────────────────────────────────────────
     *
     * `filterable` lists column names, which are snake_case, and this read
     * `searchParams.get(key)` and nothing else. The components build query
     * strings in camelCase — `params.set('projectId', …)` — so every one of
     * those filters was silently ignored.
     *
     * Silently is the problem. An unmatched filter is not an error: the query
     * simply runs unfiltered and returns everything. Choosing a project in the
     * Tasks table's Project filter showed every task in the organisation, and
     * `/api/projects/milestones?projectId=…` returned every milestone in the
     * tenant rather than that project's roadmap. Both looked like working
     * screens with surprising data in them.
     *
     * The snake_case name still wins where a caller sends both, matching the
     * convention `acceptBody` uses on the way in and the one the messages and
     * workspace routes already implemented by hand.
     */
    const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

    for (const key of filterable) {
      const value = searchParams.get(key) ?? searchParams.get(camel(key));
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
    recordActivity(ctx, { action: 'create', table, row: data as any });
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
  /**
   * The `toUpdateSchema(createX)` schema from `lib/validations`, in camelCase.
   *
   * ── Why an update needs a schema of its own ────────────────────────────────
   *
   * Eighteen of these were written and none of them was ever reached: no route
   * imported one, so `updateHandler` wrote whatever the body contained. Two
   * consequences, both real:
   *
   *   1. Mass assignment. Any column the caller could name was writable by
   *      anyone holding `edit` on the module — `deleted_at` to resurrect a
   *      deleted record, `created_at` to backdate one, `invoice_number` to
   *      collide with another invoice, `stock` to bypass the movement ledger
   *      that is supposed to be the only way stock changes.
   *
   *   2. No validation at all on the way in. Creating a project rejects an end
   *      date before its start date; editing one did not, because the check
   *      lives in the create route's `prepare` and the update path had none.
   *
   * `z.object` strips unknown keys, so naming the accepted fields is what
   * closes (1). `toUpdateSchema` strips `.default()` as well as marking fields
   * optional, so an omitted field stays omitted rather than being written back
   * as its default — the distinction a PATCH depends on, and the reason
   * `.partial()` is not usable here.
   */
  updateSchema?: { safeParse: (v: unknown) => { success: boolean; data?: any; error?: any } };
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
  const { table, module, select = '*', prepare, updateAction = 'edit', updateSchema } = opts;

  return async function PATCH(req: Request, { params }: Params) {
    const ctx = await authorize(module, updateAction);
    if (ctx instanceof Response) return ctx;
    const { id } = await params;

    let payload: Record<string, any>;
    try {
      const raw = await req.json();

      if (updateSchema) {
        /**
         * `toCamel` rather than `acceptBody` for the schema's input.
         *
         * The schemas in `lib/validations` are keyed in camelCase, and
         * `toCamel` normalises both dialects into it unambiguously: it renames
         * `first_name` and leaves `firstName` alone, so a form and the
         * verification harness — which sends snake_case — are both accepted
         * without the output ever carrying two spellings of one field.
         */
        const parsed = updateSchema.safeParse(toCamel(raw));
        if (!parsed.success) throw new Error(firstIssue(parsed.error));
        payload = toSnake(parsed.data) as Record<string, any>;
      } else {
        // Forms send a mix of camelCase (pre-migration fields) and snake_case.
        payload = acceptBody(raw);
      }

      if (prepare) payload = prepare(payload, ctx);
    } catch (e: any) {
      return error(e.message || 'Invalid request body', 422, 'VALIDATION_ERROR');
    }

    /**
     * An update that names no known column is refused rather than performed.
     *
     * `.update({})` is a no-op that PostgREST answers 200 to, so a form sending
     * only fields the schema does not accept got a success toast and changed
     * nothing — the silent failure this pass exists to remove.
     */
    if (!Object.keys(payload).length) {
      return error('No recognised fields to update', 422, 'VALIDATION_ERROR');
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
    recordActivity(ctx, { action: 'update', table, row: data as any });
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

    /**
     * The removed row is returned so the activity feed can name what went.
     *
     * "Deleted company: Northwind Traders" is the only version of that entry
     * worth writing — an id tells a colleague reading the feed nothing, and by
     * the time they read it the row is gone or hidden, so it cannot be looked
     * up afterwards. The representation costs nothing: PostgREST already has
     * the row in hand to delete it.
     */
    const { data, error: e } = softDelete
      ? await ctx.supabase.from(table)
          .update({ deleted_at: new Date().toISOString() })
          .eq('organization_id', ctx.org.organizationId).eq('id', id)
          .select().maybeSingle()
      : await ctx.supabase.from(table)
          .delete()
          .eq('organization_id', ctx.org.organizationId).eq('id', id)
          .select().maybeSingle();

    if (e) return pgError(e);
    recordActivity(ctx, { action: 'delete', table, row: data as any });
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
