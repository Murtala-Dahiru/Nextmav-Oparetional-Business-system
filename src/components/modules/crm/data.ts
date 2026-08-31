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
 * The calendar-day helpers moved to `lib/format.ts` in Phase 6.
 *
 * They were written in My Work, written again here, and Projects was about to
 * be the third module needing them - which is the condition this repository
 * uses for lifting a helper rather than copying it a third time. Re-exported
 * rather than repointed at every call site: seven files in this module import
 * them from here, and a move that also touches seven files is a move whose
 * diff hides whether anything changed. Nothing did.
 */
export { formatDay, formatDayShort, todayISO as today, daysUntil, relativeDay } from '@/lib/format';

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

/**
 * Money at full precision, without pennies nobody typed.
 *
 * ── Why not `formatCurrency` directly ────────────────────────────────────
 *
 * It forces two decimal places, which is right for an invoice line and wrong
 * for every figure in a CRM: a deal is worth ₦2,000,000, and rendering it as
 * ₦2,000,000.00 spends three characters per row on two zeros that are never
 * anything else. In a table of twenty deals that is a column of noise the eye
 * has to look past to compare the magnitudes.
 *
 * The decimals come back the moment a value actually has them, so a deal
 * genuinely worth ₦1,500.50 is not rounded on screen.
 */
export function exact(value: number, currency?: string): string {
  return Number.isInteger(value)
    ? formatCurrencyCompact(value, currency)
    : formatCurrency(value, currency);
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
