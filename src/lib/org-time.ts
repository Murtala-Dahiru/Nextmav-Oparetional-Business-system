/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Dates in the organisation's timezone.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The bug this exists to stop ──────────────────────────────────────────
 *
 *  `new Date().toISOString().slice(0, 10)` is the UTC date. Every `date`
 *  column in this schema holds a *local* date decided by the database, which
 *  computes it as `now() AT TIME ZONE organizations.timezone` — see
 *  `clock_in()` in 0004.
 *
 *  For any organisation east of UTC the two disagree for part of every day.
 *  A workspace in Lagos (UTC+1) checking in at 00:20 gets an attendance row
 *  dated the 27th, while the register's default window ended on the 26th,
 *  because that is what UTC still said. Today's attendance was therefore
 *  invisible on the register until UTC caught up — the rows existed, the
 *  query simply did not cover them. The verification harness caught it as
 *  three failures in "The attendance register can render what it is sent",
 *  which read as a contract problem and was actually a timezone one.
 *
 *  The same mistake makes an "overdue" comparison wrong by a day either side
 *  of midnight, which is exactly when someone is looking at it.
 *
 *  Everything that compares against a `date` column should therefore build its
 *  bounds here rather than from `toISOString()`.
 */

/**
 * Today's date in `zone`, as `YYYY-MM-DD`.
 *
 * Uses `en-CA` because its short date format *is* ISO order — the alternative
 * is reading the parts back out of `formatToParts` and reassembling them, and
 * this is the same answer with far less to get wrong.
 */
export function todayIn(zone: string | null | undefined): string {
  return dateIn(new Date(), zone);
}

/** A given instant's date in `zone`, as `YYYY-MM-DD`. */
export function dateIn(instant: Date, zone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(instant);
  } catch {
    /**
     * An unknown timezone throws a RangeError inside `Intl`.
     *
     * The column is free text, so a value that is not an IANA zone can be
     * stored; falling back to UTC keeps every date-bounded query answering
     * something sane rather than taking the endpoint down with it.
     */
    return instant.toISOString().slice(0, 10);
  }
}

/** The first day of the month that `zone` is currently in, as `YYYY-MM-DD`. */
export function startOfMonthIn(zone: string | null | undefined): string {
  return `${todayIn(zone).slice(0, 7)}-01`;
}

/**
 * `days` from today in `zone`, as `YYYY-MM-DD`. Negative counts backwards.
 *
 * Shifting the instant rather than the formatted string means daylight-saving
 * transitions are handled by `Intl` instead of by arithmetic here — a naive
 * `+ n * 86400000` on the *string* would drift by an hour twice a year and
 * silently produce the wrong day at the boundary.
 */
export function daysFromTodayIn(zone: string | null | undefined, days: number): string {
  return dateIn(new Date(Date.now() + days * 86_400_000), zone);
}

/**
 * The instant local midnight happened in `zone`, as an ISO timestamp.
 *
 * The helpers above all produce a `YYYY-MM-DD` for comparing against `date`
 * columns. This one is for `timestamptz` columns, where "today" is a moment
 * rather than a day — `todos.completed_at`, stamped by a trigger with `now()`,
 * is the case that needed it: counting what somebody finished today cannot be
 * done by comparing a timestamp to a date string, and comparing it to UTC
 * midnight tells a workspace in Lagos it has done nothing for the first hour
 * of every day, and counts yesterday evening's work as today's for the last.
 *
 * Derived by reading the same instant as wall-clock time in the zone and in
 * UTC, which is the offset; `Intl` handles daylight saving, so no arithmetic
 * here has to know about it.
 */
export function startOfDayIn(zone: string | null | undefined): string {
  const now = new Date();
  const day = dateIn(now, zone);

  try {
    const asZone = new Date(now.toLocaleString('en-US', { timeZone: zone || 'UTC' }));
    const asUTC = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetMs = asZone.getTime() - asUTC.getTime();
    return new Date(Date.parse(`${day}T00:00:00Z`) - offsetMs).toISOString();
  } catch {
    // Same reasoning as `dateIn`: an unknown zone must not take the query down.
    return `${day}T00:00:00.000Z`;
  }
}
