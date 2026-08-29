import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { ApiMeta } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Talking to the CRM's endpoints, and rendering what comes back
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every screen in this module reads through these four functions, so the error
 * handling is written once. The old module inlined `fetch` in each of its six
 * tabs and each one reported failure slightly differently; two of them showed
 * a bare status code.
 */

async function unwrap(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    /**
     * The server's sentence, not the status.
     *
     * Every route in this product answers a failure with a message written for
     * a person - "A lead needs at least a name or a company". Showing "Error
     * 422" instead throws that away and leaves the user with nothing to act on.
     */
    throw new Error(json?.error?.message ?? `That did not work (${res.status})`);
  }
  return json;
}

export async function getList<T>(url: string): Promise<{ data: T[]; meta: ApiMeta }> {
  const json = await unwrap(await fetch(url));
  return { data: json.data ?? [], meta: json.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 0 } };
}

export async function getOne<T>(url: string): Promise<T> {
  const json = await unwrap(await fetch(url));
  return json.data as T;
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const json = await unwrap(await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return json.data as T;
}

export async function patch<T>(url: string, body: unknown): Promise<T> {
  const json = await unwrap(await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return json.data as T;
}

export async function remove(url: string): Promise<void> {
  await unwrap(await fetch(url, { method: 'DELETE' }));
}

/* -------------------------------------------------------------------------- */
/*  Dates                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A `date` column, rendered as the day it says.
 *
 * ── The trap ─────────────────────────────────────────────────────────────
 *
 * `new Date('2026-09-03')` is UTC midnight *by specification*, so in any
 * timezone west of UTC it renders as the 2nd. `deals.expected_close` is a
 * `date`, and the old CRM passed it straight to `formatDate` - so every close
 * date in the product was a day early for anybody in the Americas, on a screen
 * whose entire job is telling you what closes when.
 *
 * My Work found this in Phase 3 and fixed it locally. This is the second
 * consumer, which is the point the design system says to lift it - so this is
 * the same function, and when the third module needs it, it moves to
 * `lib/format.ts` and both call sites follow it.
 *
 * `timestamptz` values are unaffected and must not be passed here: they carry
 * their own offset, and appending one would shift them.
 */
export function formatDay(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '';
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(bare ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, opts ?? { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The same day, without the year - for dates inside the current one. */
export function formatDayShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(bare ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Today, as `YYYY-MM-DD` in the reader's own calendar. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Whole days from today to a date, negative for the past.
 *
 * Both ends are normalised to local midnight first, so "tomorrow" is 1 all day
 * rather than 0 in the morning and 1 in the evening. A count of days that
 * changes with the clock is the reason "closes in 0 days" used to appear on
 * something due next week.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const target = new Date(bare ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

/** "in 3 days", "today", "5 days ago" - said the way a person would. */
export function relativeDay(iso: string | null | undefined): string {
  const d = daysUntil(iso);
  if (d === null) return '';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 0) return d < 14 ? `in ${d} days` : `in ${Math.round(d / 7)} weeks`;
  const past = Math.abs(d);
  return past < 14 ? `${past} days ago` : `${Math.round(past / 7)} weeks ago`;
}

/** A month key (`2026-08`) as "Aug", or "Aug 25" when the year has turned. */
export function monthLabel(period: string, withYear = false): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, (m ?? 1) - 1, 1);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    ...(withYear ? { year: '2-digit' } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/*  Money                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Money at a size a chart axis or a headline can carry.
 *
 * `formatCurrency` is right in a table, where the reader is comparing exact
 * figures in a column. It is wrong in a 46px headline and wrong on an axis,
 * where "₦234,000,000.00" is nineteen characters of which four carry the
 * meaning.
 */
export function money(value: number, currency?: string): string {
  return formatCurrencyCompact(value, currency);
}

export function exact(value: number, currency?: string): string {
  return formatCurrency(value, currency);
}

/** A percentage that never claims precision it does not have. */
export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

/* -------------------------------------------------------------------------- */
/*  Query strings                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Build a list query, dropping anything empty.
 *
 * `?status=` with no value is not "all statuses" to a route that filters on
 * presence - it is a filter for the empty string, which matches nothing. Every
 * table in the old module built its query by hand and two of them had this
 * bug in a slightly different place.
 */
export function listQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    q.set(key, String(value));
  }
  return q.toString();
}
