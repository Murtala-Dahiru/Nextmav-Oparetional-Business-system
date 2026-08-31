import { formatCurrency } from '@/lib/format';
import type { ApiMeta } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Talking to the projects endpoints, and rendering what comes back
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every screen in this module reads through these, so error handling is
 * written once. The module this replaces inlined `fetch` in two files and
 * declared two different `apiFetch` helpers that disagreed about what to do
 * with a non-`ok` response: one of them read `json.error` and returned the
 * envelope regardless of the status, so a 500 with an HTML body resolved
 * successfully with `data: undefined` and the screen rendered as empty rather
 * than as broken.
 */

async function unwrap(res: Response) {
  const json = await res.json().catch(() => null);
  if (json?.error) throw new Error(json.error.message || 'Request failed');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json;
}

export async function getOne<T>(url: string): Promise<T> {
  return (await unwrap(await fetch(url))).data as T;
}

export async function getList<T>(url: string): Promise<{ data: T[]; meta?: ApiMeta }> {
  const json = await unwrap(await fetch(url));
  return { data: (json.data ?? []) as T[], meta: json.meta as ApiMeta | undefined };
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const json = await unwrap(await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return json?.data as T;
}

export const post = <T,>(url: string, body: unknown) => send<T>(url, 'POST', body);
export const patch = <T,>(url: string, body: unknown) => send<T>(url, 'PATCH', body);
export const put = <T,>(url: string, body: unknown) => send<T>(url, 'PUT', body);
export const remove = (url: string) => send<void>(url, 'DELETE');

/* -------------------------------------------------------------------------- */
/*  Numbers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Money, without the decimals a whole figure does not need.
 *
 * `formatCurrency` forces two, which is right on an invoice line and wrong on
 * a project budget: a column of "₦2,500,000.00" is four characters of noise
 * per row, and the noise is what a reader's eye has to skip past to compare
 * two of them. Kept where the value genuinely has kobo in it.
 */
export function exact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  const formatted = formatCurrency(n);
  return Number.isInteger(n) ? formatted.replace(/[.,]00$/, '') : formatted;
}

/** A count of hours, without a trailing `.0` on a whole one. */
export function hours(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`;
}

/** A percentage as an integer, because a project is never 47.3% delivered. */
export function pct(value: number | null | undefined): string {
  return `${Math.round(Number(value ?? 0))}%`;
}

/**
 * Days remaining, said the way somebody would say it.
 *
 * The old workspace printed `12d` under the word "Timeline" with "remaining"
 * beneath it, and `12d` again with "past the end date" beneath it - the same
 * glyphs for opposite meanings, distinguished only by a caption in 11px grey.
 */
export function deadlineWord(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'No end date';
  if (days < 0) return `${Math.abs(days)} days late`;
  if (days === 0) return 'Due today';
  if (days === 1) return '1 day left';
  if (days < 45) return `${days} days left`;
  return `${Math.round(days / 30)} months left`;
}
