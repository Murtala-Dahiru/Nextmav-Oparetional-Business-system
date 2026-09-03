import { formatCurrency } from '@/lib/format';
import type { ApiMeta } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Talking to the HR endpoints, and rendering what comes back
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same four helpers Projects and Workspace use, for the same reason: error
 * handling written once. The HR module this replaces declared its own
 * `fetchList` / `createRecord` / `updateRecord` / `deleteRecord` inline in
 * `index.tsx`, and `attendance-tab.tsx` declared a fifth - which is how two
 * screens in one module came to disagree about what a non-`ok` response means.
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

export const post = <T,>(url: string, body?: unknown) => send<T>(url, 'POST', body);
export const patch = <T,>(url: string, body: unknown) => send<T>(url, 'PATCH', body);
export const remove = (url: string) => send<void>(url, 'DELETE');

/* -------------------------------------------------------------------------- */
/*  Numbers and dates                                                         */
/* -------------------------------------------------------------------------- */

/** Money without the decimals a whole figure does not need. */
export function money(value: number | null | undefined, currency?: string): string {
  const n = Number(value ?? 0);
  const formatted = formatCurrency(n, currency);
  return Number.isInteger(n) ? formatted.replace(/[.,]00$/, '') : formatted;
}

/**
 * A salary at a glance, on a row where four of them sit above each other.
 *
 * ₦7,200,000 is eleven characters and the digits after the first three carry
 * no information a reader is using to compare two rows. Kept exact wherever
 * the figure is the subject rather than the context - a payslip line, the
 * compensation panel's headline - and never used for a total that has to add
 * up on screen.
 */
export function compact(value: number | null | undefined, currency?: string): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs < 1000) return money(n, currency);
  const symbol = money(0, currency).replace(/[\d.,\s]/g, '');
  const [scaled, suffix] =
    abs >= 1_000_000_000 ? [n / 1_000_000_000, 'b']
      : abs >= 1_000_000 ? [n / 1_000_000, 'm']
        : [n / 1000, 'k'];
  const rounded = Math.abs(scaled) >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${symbol}${rounded}${suffix}`;
}

/** A percentage as an integer. Nobody is 47.3% through their onboarding. */
export function pct(value: number | null | undefined): string {
  return `${Math.round(Number(value ?? 0))}%`;
}

/** Worked minutes as hours and minutes, the way a timesheet reads. */
export function duration(minutes: number | null | undefined): string {
  const n = Math.max(0, Math.round(Number(minutes ?? 0)));
  if (!n) return '—';
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * "in 3 days", "today", "5 days ago" - and where it comes from.
 *
 * `relativeDay` and `todayISO` were lifted into `lib/format` during Phase 6,
 * after My Work, CRM and Projects had each written their own. Re-exported here
 * rather than imported directly by nine screens, so this module has one place
 * that decides what its dates look like - and so writing a tenth copy in the
 * next file is visibly the wrong move.
 */
export { relativeDay as whenWord, todayISO, daysUntil, formatDay, formatDayShort } from '@/lib/format';

/** Add days to an ISO date without going through the local timezone. */
export function shiftISO(dateISO: string, days: number): string {
  return new Date(Date.parse(`${dateISO}T00:00:00Z`) + days * 86_400_000)
    .toISOString().slice(0, 10);
}

/**
 * A month key as a person reads it: `2026-03` becomes `Mar`.
 *
 * January carries its year, because a twelve-month axis crosses one and a row
 * of month names with no year is ambiguous exactly where it matters.
 */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const name = new Date(Date.UTC(y, (m ?? 1) - 1, 1))
    .toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  return m === 1 ? `${name} ${String(y).slice(2)}` : name;
}
