'use client';

import * as React from 'react';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { getList, listQuery } from './data';
import type { ApiMeta } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  One list, with the server doing the work
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * Six copies of the same ninety lines, one per tab, each with its own
 * `useState` for search, page, page size, sort, sort direction and filters,
 * its own `useCallback` fetch, its own error toast and its own realtime
 * subscription. They had drifted: two subscribed to realtime and four did not,
 * so a contact added by a colleague appeared for some people and not others.
 *
 * ── The two things it gets right that the copies did not ─────────────────
 *
 *   · **A failed read is a state, not a toast.** The old lists caught the
 *     error, raised a toast and left `rows` empty - so a screen that could not
 *     reach the server looked exactly like a workspace with no records in it,
 *     and the toast was gone in four seconds. `error` is returned and the
 *     section renders it with a way back.
 *
 *   · **A stale response cannot win.** Typing quickly fires several requests
 *     and they do not come back in order. Without the guard, a slower earlier
 *     query overwrites a faster later one and the table shows results for
 *     something the user has already finished typing.
 */

export interface ListState<T> {
  rows: T[];
  meta: ApiMeta;
  loading: boolean;
  error: string | null;
  reload: () => void;

  search: string;
  setSearch: (v: string) => void;

  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;

  sort: string;
  sortDir: 'asc' | 'desc';
  setSort: (key: string, dir: 'asc' | 'desc') => void;

  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
}

export function useCrmList<T>(
  endpoint: string,
  opts: {
    /** Realtime tables whose changes should refetch this list. */
    watch: string[];
    /** A name for the realtime channel. Must be unique per screen. */
    channel: string;
    defaultSort?: string;
    defaultSortDir?: 'asc' | 'desc';
    /** Filters the caller wants applied but does not expose as controls. */
    fixed?: Record<string, string | undefined>;
  },
): ListState<T> {
  const { watch, channel, defaultSort = 'updatedAt', defaultSortDir = 'desc', fixed } = opts;

  const [rows, setRows] = React.useState<T[]>([]);
  const [meta, setMeta] = React.useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearchRaw] = React.useState('');
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [sort, setSortKey] = React.useState(defaultSort);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>(defaultSortDir);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSizeRaw] = React.useState(20);
  const [nonce, setNonce] = React.useState(0);

  const request = React.useRef(0);
  const fixedKey = JSON.stringify(fixed ?? {});

  React.useEffect(() => {
    const id = ++request.current;
    setLoading(true);

    const query = listQuery({
      page: page + 1,
      pageSize,
      sort,
      sortDir,
      search: search || undefined,
      ...filters,
      ...(fixed ?? {}),
    });

    getList<T>(`${endpoint}?${query}`)
      .then(res => {
        if (request.current !== id) return;
        setRows(res.data);
        setMeta(res.meta);
        setError(null);
      })
      .catch((e: Error) => {
        if (request.current !== id) return;
        setRows([]);
        setError(e.message);
      })
      .finally(() => {
        if (request.current === id) setLoading(false);
      });
  }, [endpoint, page, pageSize, sort, sortDir, search, filters, fixedKey, nonce]);

  const reload = React.useCallback(() => setNonce(n => n + 1), []);

  /**
   * A colleague's change reaches an open screen.
   *
   * The refetch is silent: no spinner, no scroll jump, and any dialog that is
   * open stays open. See `hooks/use-realtime` for why an event means "your
   * data is stale" rather than carrying the new row - the lists render
   * embedded relations the raw row does not have.
   */
  useModuleRealtime(channel, watch, reload);

  const setSearch = React.useCallback((v: string) => {
    setSearchRaw(v);
    // A search that keeps the old page shows page four of a two-page result,
    // which renders empty and reads as "no matches".
    setPage(0);
  }, []);

  const setFilter = React.useCallback((key: string, value: string) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
    setPage(0);
  }, []);

  const setSort = React.useCallback((key: string, dir: 'asc' | 'desc') => {
    setSortKey(key);
    setSortDir(dir);
    setPage(0);
  }, []);

  const setPageSize = React.useCallback((n: number) => {
    setPageSizeRaw(n);
    setPage(0);
  }, []);

  return {
    rows, meta, loading, error, reload,
    search, setSearch,
    filters, setFilter,
    sort, sortDir, setSort,
    page, setPage, pageSize, setPageSize,
  };
}
