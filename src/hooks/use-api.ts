'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface UseApiOptions<T> {
  /** Base URL (e.g. '/api/crm/leads') */
  url: string;
  /** Default page size */
  pageSize?: number;
  /** Map raw response to typed array (default: identity) */
  transform?: (data: any) => T[];
  /** Auto-fetch on mount (default: true) */
  enabled?: boolean;
  /** Additional query params */
  params?: Record<string, string>;
}

export interface UseApiReturn<T> {
  data: T[];
  meta: PaginatedResponse<T>['meta'] | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (search: string) => void;
  setSort: (field: string, dir?: 'asc' | 'desc') => void;
  addFilter: (key: string, value: string) => void;
  removeFilter: (key: string) => void;
  setParams: (params: Record<string, string>) => void;
}

// ─── Allowed sort fields (security: prevent injection) ─────────────────────

const ALLOWED_SORT_FIELDS = new Set([
  'id', 'createdAt', 'updatedAt', 'firstName', 'lastName', 'email',
  'name', 'company', 'status', 'priority', 'stage', 'value', 'score',
  'title', 'subject', 'amount', 'category', 'type', 'startDate',
  'endDate', 'dueDate', 'date', 'stock', 'sku', 'price', 'budget',
]);

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useApi<T = any>(opts: UseApiOptions<T>): UseApiReturn<T> {
  const {
    url,
    pageSize: defaultPageSize = 20,
    transform,
    enabled = true,
    params: extraParams,
  } = opts;

  const [data, setData] = useState<T[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<T>['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageRef = useRef(0);
  const pageSizeRef = useRef(defaultPageSize);
  const searchRef = useRef('');
  const sortRef = useRef({ field: 'createdAt', dir: 'desc' as 'asc' | 'desc' });
  const filtersRef = useRef<Record<string, string>>({});
  const paramsRef = useRef(extraParams ?? {});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const sp = new URLSearchParams();
      sp.set('page', String(pageRef.current + 1));
      sp.set('pageSize', String(pageSizeRef.current));

      if (searchRef.current) sp.set('search', searchRef.current);

      const sortField = ALLOWED_SORT_FIELDS.has(sortRef.current.field)
        ? sortRef.current.field
        : 'createdAt';
      sp.set('sort', sortField);
      sp.set('sortDir', sortRef.current.dir);

      for (const [k, v] of Object.entries(filtersRef.current)) {
        if (v) sp.set(k, v);
      }
      for (const [k, v] of Object.entries(paramsRef.current)) {
        if (v) sp.set(k, v);
      }

      const res = await fetch(`${url}?${sp.toString()}`);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const json = await res.json();

      if (json.error) {
        throw new Error(json.error.message || 'Request failed');
      }

      const items = transform ? transform(json.data) : (json.data ?? []);
      setData(items);
      setMeta(json.meta ?? null);
    } catch (e: any) {
      setError(e.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [url, transform]);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  const setPage = useCallback((p: number) => {
    pageRef.current = p;
    fetchData();
  }, [fetchData]);

  const setPageSize = useCallback((s: number) => {
    pageSizeRef.current = s;
    pageRef.current = 0;
    fetchData();
  }, [fetchData]);

  const setSearch = useCallback((s: string) => {
    searchRef.current = s;
    pageRef.current = 0;
    fetchData();
  }, [fetchData]);

  const setSort = useCallback((field: string, dir?: 'asc' | 'desc') => {
    sortRef.current = { field, dir: dir ?? (sortRef.current.dir === 'asc' ? 'desc' : 'asc') };
    fetchData();
  }, [fetchData]);

  const addFilter = useCallback((key: string, value: string) => {
    filtersRef.current = { ...filtersRef.current, [key]: value };
    pageRef.current = 0;
    fetchData();
  }, [fetchData]);

  const removeFilter = useCallback((key: string) => {
    const next = { ...filtersRef.current };
    delete next[key];
    filtersRef.current = next;
    pageRef.current = 0;
    fetchData();
  }, [fetchData]);

  const setParams = useCallback((p: Record<string, string>) => {
    paramsRef.current = { ...paramsRef.current, ...p };
    fetchData();
  }, [fetchData]);

  // Auto-fetch on mount / URL change
  useEffect(() => {
    if (enabled) fetchData();
  }, [enabled, fetchData]);

  return {
    data, meta, loading, error, refetch,
    setPage, setPageSize, setSearch, setSort, addFilter, removeFilter, setParams,
  };
}

// ─── Mutation helpers ─────────────────────────────────────────────────────

/**
 * Read one mutation response.
 *
 * The failure branch has to parse the body *before* deciding what to throw.
 * These helpers used to short-circuit on `!res.ok` and throw the status alone,
 * which discarded the one useful thing the server sent: routes return a
 * written explanation ("An invoice needs at least one line item", "You cannot
 * approve your own leave request") and the user saw "Create failed (422)".
 * Every toast in the application was a status code, which is why so many of
 * these failures read as silent.
 *
 * A non-JSON body means the request never reached a route handler — a bare 405
 * from the framework, or an HTML error page — so the status is genuinely all
 * there is to report, and the label says so rather than inventing a cause.
 */
async function readMutation(res: Response, verb: string) {
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // Fall through: body is absent or not JSON.
  }

  if (json?.error) {
    throw new Error(json.error.message || `${verb} failed`);
  }
  if (!res.ok) {
    throw new Error(
      res.status === 405
        ? `${verb} failed: this action is not available on the server (405).`
        : `${verb} failed (${res.status})`,
    );
  }
  return json?.data;
}

export async function apiCreate(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readMutation(res, 'Create');
}

export async function apiUpdate(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readMutation(res, 'Update');
}

export async function apiDelete(url: string) {
  const res = await fetch(url, { method: 'DELETE' });
  return readMutation(res, 'Delete');
}

export function apiSuccess(message: string) {
  toast.success(message);
}

export function apiError(message: string) {
  toast.error(message);
}
