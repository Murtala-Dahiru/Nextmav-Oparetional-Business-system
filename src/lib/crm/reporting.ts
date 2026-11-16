import { dateIn } from '../org-time';

type ReadError = { code?: string; message?: string; details?: string };
type Page<T> = { data: T[] | null; error: ReadError | null; count: number | null };

/** Read complete report inputs even when PostgREST's row cap is below our page size.
 * Callers must request an exact count and a deterministic, unique ordering.
 * The bounded fallback refuses oversized/changing reports instead of showing partial totals.
 * SQL aggregation should replace this fallback for high-volume workspaces.
 */
export async function readReportRows<T>(
  read: (from: number, to: number) => PromiseLike<Page<T>>,
  maxRows = 50_000,
): Promise<Page<T>> {
  const rows: T[] = [];
  let expected: number | null = null;
  const invalid = (message: string): Page<T> => ({
    data: null, count: null, error: { code: 'CRM_REPORT_INCOMPLETE', message },
  });
  for (;;) {
    const page = await read(rows.length, rows.length + 499);
    if (page.error) return { data: null, count: null, error: page.error };
    if (page.count === null || page.count > maxRows) {
      return invalid('Report requires a complete count within the supported row budget.');
    }
    if (expected !== null && expected !== page.count) {
      return invalid('Report changed while reading; retry for a complete result.');
    }
    expected = page.count;
    const batch = page.data ?? [];
    rows.push(...batch);
    if (rows.length === expected) return { data: rows, count: expected, error: null };
    if (!batch.length || rows.length > expected) return invalid('Report read was incomplete.');
  }
}

export function shiftCalendarDay(day: string, days: number): string {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Eight consecutive seven-day buckets, including today, in the organization calendar. */
export function activityWeeks(instants: string[], today: string, zone: string) {
  const weeks = Array.from({ length: 8 }, (_, i) => ({
    week: shiftCalendarDay(today, -55 + i * 7), count: 0,
  }));
  for (const instant of instants) {
    const parsed = new Date(instant);
    if (!Number.isFinite(parsed.getTime())) continue;
    const day = dateIn(parsed, zone);
    if (day < weeks[0].week || day > today) continue;
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (day >= weeks[i].week) { weeks[i].count++; break; }
    }
  }
  return weeks;
}
