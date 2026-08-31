'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The record table
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Where this came from ─────────────────────────────────────────────────
 *
 * Written for the CRM in Phase 4 as `modules/crm/table.tsx`, and moved here in
 * Phase 6 with Projects as its second consumer. That is the condition this
 * design system sets for lifting a shared mechanism: add it *with* its first
 * caller, generalise it at the second, never in anticipation of a third. The
 * component is otherwise unchanged — same props, same contract, same
 * rendering — so nothing about CRM's four lists moved with it.
 *
 * ── Why not the shared `DataTable` ───────────────────────────────────────
 *
 * `components/shared/data-table` is used by eleven modules and is not being
 * changed by these phases: rewriting it would be a redesign of Finance, HR,
 * Inventory and the rest by side effect, which is exactly what a
 * one-module-at-a-time process exists to prevent.
 *
 * What it cannot do, and what a list of records needs it to:
 *
 *   · **Adapt on a phone.** It renders a table at every width, so a lead list
 *     on a 390px screen is a horizontal scroll with three columns off-screen.
 *     A salesperson uses this standing in a car park. Below `md` this renders
 *     the same rows as cards, switched in CSS rather than in JavaScript -
 *     because a JS breakpoint and a CSS one disagreeing is a defect this
 *     product has already shipped once.
 *
 *   · **Align.** Money and dates are read down a column and belong right and
 *     tabular; status belongs left. `DataTable` has one alignment.
 *
 *   · **Be quiet.** 52px rows with a filled pill in two of them is a lot of
 *     furniture for a list somebody scans a hundred times a day.
 *
 * The *contract* is unchanged and deliberately so: page, pageSize, sort,
 * sortDir, search and filters are all still decided by the server, and this
 * component holds none of that state. The old behaviour was right; only the
 * rendering was.
 *
 * ── The sort key ─────────────────────────────────────────────────────────
 *
 * `key` is passed to the API verbatim. It may be either spelling - the route
 * factory accepts `estimatedValue` and `estimated_value` alike since this
 * phase - but a column with no `key` is genuinely not sortable and does not
 * pretend to be. The old tables put a sort arrow on every header, including
 * the ones the server refuses, and clicking those quietly re-sorted by
 * creation date.
 */

export interface Column<T> {
  /** What the server sorts on. Omit for a column that cannot be sorted. */
  key?: string;
  header: string;
  /** A CSS width for the column. Omitted columns share what is left. */
  width?: string;
  align?: 'left' | 'right';
  /** Hidden below this breakpoint on the desktop table. */
  hide?: 'md' | 'lg' | 'xl';
  cell: (row: T) => React.ReactNode;
  /** How this column reads on a phone card. Omit to leave it off the card. */
  card?: 'title' | 'subtitle' | 'meta' | 'figure';
}

export interface RecordTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Opening the record. Also what a card tap does. */
  onOpen?: (row: T) => void;
  /** The row-action menu. Rendered inside a `DropdownMenuContent`. */
  actions?: (row: T) => React.ReactNode;

  sort?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string, dir: 'asc' | 'desc') => void;

  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;

  /** Shown in place of the rows when there are none. */
  empty: React.ReactNode;
  /** The word for one row, used by the pagination line. */
  noun?: string;
}

const HIDE: Record<string, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

/** The widths behind those class names, so the same rule can be asked in JS. */
const AT: Record<string, number> = { md: 768, lg: 1024, xl: 1280 };

/**
 * Which `hide` tiers are currently showing.
 *
 * ── Why the table needs to know ──────────────────────────────────────────
 *
 * Column widths are percentages of the whole table, and they add up to about
 * 100 only when every column is on screen. On a tablet, half of them are
 * hidden, so the percentages ask for 60% of the table and a fixed layout hands
 * the other 40% to whichever column will take it - which was the empty strip
 * beside the row menu. Locations were being cut short next to 230px of
 * nothing. Knowing which columns are actually showing lets the percentages be
 * shared out over those, so a narrower screen makes the remaining columns
 * wider rather than emptier.
 */
function useShownTiers(): Set<string> {
  const read = React.useCallback(() => {
    const shown = new Set<string>();
    if (typeof window === 'undefined') return shown;
    for (const [tier, px] of Object.entries(AT)) {
      if (window.matchMedia(`(min-width: ${px}px)`).matches) shown.add(tier);
    }
    return shown;
  }, []);

  /* Server-render as the widest case, which is what the markup already assumes. */
  const [tiers, setTiers] = React.useState<Set<string>>(() => new Set(Object.keys(AT)));

  React.useEffect(() => {
    const sync = () => setTiers(read());
    sync();
    const lists = Object.values(AT).map(px => window.matchMedia(`(min-width: ${px}px)`));
    for (const l of lists) l.addEventListener('change', sync);
    return () => { for (const l of lists) l.removeEventListener('change', sync); };
  }, [read]);

  return tiers;
}

export function RecordTable<T>({
  columns, rows, rowKey, loading, onOpen, actions,
  sort, sortDir = 'desc', onSort,
  page, pageSize, total, onPage, onPageSize,
  empty, noun = 'record',
}: RecordTableProps<T>) {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const tiers = useShownTiers();

  /**
   * The percentage widths, shared out over the columns that are on screen.
   *
   * Plain percentages, deliberately: a `calc()` that mixes a percentage with a
   * rem is valid CSS but a fixed table layout in Chrome quietly discards it and
   * falls back to equal columns, which is how a 30% name column and a 14%
   * status column ended up the same width. Percentages it understands. They sum
   * to 100 alongside the row-menu column's fixed 2.5rem, so the table is
   * over-specified by that much and every column is scaled down in proportion -
   * which keeps the ratios, and is the point.
   */
  const widthOf = React.useMemo(() => {
    const showing = columns.filter(c => !c.hide || tiers.has(c.hide));
    const asked = showing.reduce((sum, c) => sum + (parseFloat(c.width ?? '') || 0), 0);
    const scale = asked > 0 ? 100 / asked : 1;
    return (col: Column<T>) => {
      const own = parseFloat(col.width ?? '') || 0;
      if (!own) return col.width;
      return `${(own * scale).toFixed(3)}%`;
    };
  }, [columns, tiers]);

  const head = (col: Column<T>, i: number) => {
    const active = col.key && sort === col.key;
    const label = (
      <span className="inline-flex items-center gap-1">
        {col.header}
        {active
          ? (sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
          : null}
      </span>
    );

    return (
      <th
        key={`${col.header}-${i}`}
        scope="col"
        style={{ width: widthOf(col) }}
        /**
         * The header sits *inside* the card, so it needs room above it.
         *
         * `pt-0` put the column names hard against the card's top border,
         * with the search field a few pixels beyond that. It read as a strip
         * of small caps wedged into a seam rather than as the head of a
         * table, and it was the single thing most responsible for the whole
         * list feeling squeezed. The padding is now symmetrical with the
         * rows' own, so the header is a band rather than an edge.
         */
        className={cn(
          'whitespace-nowrap px-4 pb-3 pt-3.5 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground/80',
          col.align === 'right' ? 'text-right' : 'text-left',
          col.hide ? HIDE[col.hide] : '',
        )}
      >
        {col.key && onSort ? (
          <button
            type="button"
            onClick={() => onSort(col.key!, active && sortDir === 'desc' ? 'asc' : 'desc')}
            className={cn(
              'inline-flex items-center gap-1 rounded uppercase tracking-[0.07em] transition-colors hover:text-foreground',
              active && 'text-foreground',
            )}
            aria-label={`Sort by ${col.header}`}
          >
            {label}
          </button>
        ) : label}
      </th>
    );
  };

  /* ── Loading ───────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      /**
       * Sized like the rows it precedes, not like a generic list.
       *
       * The skeleton used a shorter rhythm than the table, so the page
       * visibly jumped taller the moment the data arrived. Two bars per row,
       * because every CRM table here has a name over a subtitle.
       */
      <div className="rounded-xl border border-border bg-card shadow-e1">
        {/* Standing in for the header band, so that does not jump either. */}
        <div className="h-[42px] border-b border-border" />
        <div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border/70 px-4 py-3.5 last:border-0"
            >
              <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div
                  className="h-3 animate-pulse rounded bg-muted"
                  style={{ width: `${38 + (i % 4) * 11}%` }}
                />
                <div
                  className="h-2.5 animate-pulse rounded bg-muted/70"
                  style={{ width: `${26 + (i % 3) * 9}%` }}
                />
              </div>
              <div className="hidden h-3 w-24 animate-pulse rounded bg-muted md:block" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!rows.length) {
    return <div className="rounded-xl border border-border bg-card shadow-e1">{empty}</div>;
  }

  /* ── Cards, below md ───────────────────────────────────────────────────── */

  const title = columns.find(c => c.card === 'title');
  const subtitle = columns.find(c => c.card === 'subtitle');
  const figure = columns.find(c => c.card === 'figure');
  const metas = columns.filter(c => c.card === 'meta');

  return (
    <div className="rounded-xl border border-border bg-card shadow-e1">
      {/* Phone: one card per record. The same data, arranged for a thumb. */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map(row => {
          const inner = (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium leading-tight text-foreground">
                    {title ? title.cell(row) : null}
                  </div>
                  {subtitle && (
                    <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                      {subtitle.cell(row)}
                    </div>
                  )}
                </div>
                {figure && (
                  <div className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-foreground">
                    {figure.cell(row)}
                  </div>
                )}
              </div>
              {metas.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground">
                  {metas.map((m, i) => <span key={i} className="min-w-0">{m.cell(row)}</span>)}
                </div>
              )}
            </>
          );

          return (
            <li key={rowKey(row)} className="relative">
              {/*
                A div with a click handler, not a button.

                The card contains its own controls - the company opens the
                customer, the address opens a mail client - and a `<button>`
                inside a `<button>` is invalid HTML that React reports as a
                hydration error. The desktop table has the same shape and
                solves it the same way, for the reason the shared DataTable
                already sets out: the keyboard path is the row menu's named
                "Open" item, which is properly focusable and announced, rather
                than a table row pretending to be a button.
              */}
              {onOpen ? (
                <div
                  onClick={e => {
                    // A click that started inside a control belongs to that
                    // control. Without this, tapping an email address opens
                    // the record behind it as well.
                    if ((e.target as HTMLElement).closest('a,button,[role="button"],input,select')) return;
                    onOpen(row);
                  }}
                  className={cn(
                    'cursor-pointer px-4 py-4 transition-colors active:bg-accent/70',
                    // The row menu is positioned over the card's top-right
                    // corner, which is exactly where the figure sits. Without
                    // this the deal value on every card was clipped by it.
                    actions && 'pr-12',
                  )}
                >
                  {inner}
                </div>
              ) : (
                <div className={cn('px-4 py-4', actions && 'pr-12')}>{inner}</div>
              )}

              {actions && (
                <div className="absolute right-1 top-2.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label="More">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">{actions(row)}</DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Desktop: the table. */}
      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-border">
              {columns.map(head)}
              {actions && <th scope="col" className="w-12" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={rowKey(row)}
                onClick={onOpen ? () => onOpen(row) : undefined}
                className={cn(
                  'border-b border-border/70 last:border-0 transition-colors',
                  onOpen && 'cursor-pointer hover:bg-accent/60',
                )}
              >
                {columns.map((col, i) => (
                  <td
                    key={`${col.header}-${i}`}
                    className={cn(
                      'px-4 py-3.5 text-[13px] leading-snug text-foreground',
                      col.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                      col.hide ? HIDE[col.hide] : '',
                    )}
                  >
                    <div className="truncate">{col.cell(row)}</div>
                  </td>
                ))}
                {actions && (
                  <td className="px-2 py-3.5 align-middle text-right">
                    {/*
                      The menu stops the click reaching the row. Without this,
                      opening the row menu also opens the record behind it -
                      the defect every table with both a row handler and a row
                      menu ships at least once.
                    */}
                    <div onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" aria-label="More">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">{actions(row)}</DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Paging ──────────────────────────────────────────────────────────
          Shown only when there is more than one page. A pager under twelve
          rows saying "1 of 1" is furniture. */}
      {total > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-[12px] tabular-nums text-muted-foreground">
            {from}-{to} of {total} {total === 1 ? noun : `${noun}s`}
          </p>

          <div className="flex items-center gap-1.5">
            {onPageSize && (
              <select
                value={pageSize}
                onChange={e => onPageSize(Number(e.target.value))}
                aria-label="Rows per page"
                className="h-7 rounded-md border border-input bg-card px-1.5 text-[12px] text-muted-foreground"
              >
                {[20, 50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
              </select>
            )}
            <Button
              variant="outline" size="sm" className="h-7 gap-1 px-2 text-[12px]"
              disabled={page === 0} onClick={() => onPage(page - 1)}
            >
              <ChevronLeft className="size-3.5" /> Back
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 gap-1 px-2 text-[12px]"
              disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}
            >
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
