import { dateIn, todayIn } from '@/lib/org-time';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Performance, computed rather than stored
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The rule this file exists to hold ────────────────────────────────────
 *
 * Every figure here is derived from `business_events` on read. None of it is
 * written down. That is not an optimisation deferred, it is the design: a
 * stored `revenue_won_total` is a second source of truth, and this repository
 * has already paid for one of those. The Deals page used to draw a bar chart
 * of deals by stage from a capped hundred rows while CRM Home drew the same
 * chart from a GROUP BY over every row, and the two disagreed. That was a
 * chart. This would be a payslip.
 *
 * The single exception is `performance_targets`, and it earns the exception
 * by being an input: nothing in the CRM implies what somebody agreed to do.
 *
 * ── Why the events and not the deals ─────────────────────────────────────
 *
 * `deals.value` is editable for ever. Reading revenue from it gives what the
 * deal is worth today, not what it was won at, so correcting a typo in March
 * silently rewrites February. The event payload froze the figure at the
 * moment it happened, and every money question here reads that instead.
 *
 * Open pipeline is the one thing read live from `deals`, because a pipeline
 * is by definition the current state of things that have not happened yet.
 */

/** The event types that count towards somebody's achievement. */
export const PERFORMANCE_EVENTS = [
  'deal.won', 'deal.lost', 'deal.reopened',
  'invoice.paid',
  'lead.qualified', 'lead.converted',
] as const;

export type PerformanceEvent = (typeof PERFORMANCE_EVENTS)[number];

export const TARGET_METRICS = [
  'revenue_won', 'revenue_collected', 'deals_won', 'leads_qualified', 'activities_logged',
] as const;

export type TargetMetric = (typeof TARGET_METRICS)[number];

/** What each metric is called on screen, and how it should be read. */
export const METRIC_META: Record<TargetMetric, { label: string; unit: 'money' | 'count'; note: string }> = {
  revenue_won: {
    label: 'Revenue won',
    unit: 'money',
    note: 'Value of deals closed won, at the value they were won at',
  },
  revenue_collected: {
    label: 'Revenue collected',
    unit: 'money',
    note: 'Invoices marked paid, credited to the deal owner where a deal is linked',
  },
  deals_won: { label: 'Deals won', unit: 'count', note: 'Count of deals closed won' },
  leads_qualified: { label: 'Leads qualified', unit: 'count', note: 'Leads moved to qualified' },
  activities_logged: { label: 'Activities logged', unit: 'count', note: 'Calls, emails, meetings and notes recorded' },
};

export interface RawEvent {
  eventType: string;
  subjectMemberId: string | null;
  /** The record it came from. This, not the payload, identifies the deal. */
  entityId: string;
  occurredAt: string;
  payload: Record<string, any>;
}

export interface Period {
  start: string;
  end: string;
  label: string;
}

/**
 * A period, defaulting to the current quarter in the organisation's calendar.
 *
 * Quarters rather than months, because a sales target is almost never monthly
 * and a screen whose default window disagrees with the window targets are set
 * in shows progress against nothing.
 */
export function resolvePeriod(
  zone: string,
  from?: string | null,
  to?: string | null,
): Period {
  if (from && to) {
    return { start: from, end: to, label: `${from} to ${to}` };
  }
  const today = todayIn(zone);
  const [y, m] = today.split('-').map(Number);
  const q = Math.floor((m - 1) / 3);
  const startMonth = q * 3 + 1;
  const start = `${y}-${String(startMonth).padStart(2, '0')}-01`;
  /* The day before the next quarter starts, so the range is inclusive. */
  const endDate = new Date(Date.UTC(y, startMonth + 2, 0));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end, label: `Q${q + 1} ${y}` };
}

/**
 * How far through the period we are, 0 to 1.
 *
 * This is the number that turns "62% of target" into a sentence worth
 * reading. 62% with 71% of the quarter gone is a problem; 62% with 40% gone
 * is ahead. A progress bar without it is decoration.
 */
export function periodPace(period: Period, zone: string): number {
  const today = todayIn(zone);
  if (today < period.start) return 0;
  if (today > period.end) return 1;
  const total = Date.parse(period.end) - Date.parse(period.start);
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(period.start)) / total));
}

/** A number from an event payload, tolerant of the string Postgres numerics arrive as. */
function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export interface Achievement {
  revenueWon: number;
  revenueCollected: number;
  dealsWon: number;
  dealsLost: number;
  leadsQualified: number;
  leadsConverted: number;
  /** Won divided by decided. Null when nothing was decided, rather than zero. */
  winRate: number | null;
  /** Total value won divided by deals won. Null when nothing was won. */
  averageDeal: number | null;
}

export const EMPTY_ACHIEVEMENT: Achievement = {
  revenueWon: 0, revenueCollected: 0, dealsWon: 0, dealsLost: 0,
  leadsQualified: 0, leadsConverted: 0, winRate: null, averageDeal: null,
};

/**
 * Roll a set of events into the figures a person is measured on.
 *
 * ── Why reopened deals are subtracted ────────────────────────────────────
 *
 * A deal won in January, reopened in February and won again in March emits
 * two `deal.won` events, correctly: both are real transitions. Counting both
 * would pay twice and would show two wins where the business got one. The
 * reopen is the signal that the earlier win was undone, so a `deal.reopened`
 * cancels the most recent win for that deal inside the window.
 */
export function rollUp(events: RawEvent[]): Achievement {
  const out: Achievement = { ...EMPTY_ACHIEVEMENT };

  /* Wins per deal, newest last, so a reopen can cancel the right one. */
  const winsByDeal = new Map<string, number[]>();
  const reopened = new Set<string>();

  for (const e of events) {
    switch (e.eventType) {
      case 'deal.won': {
        out.dealsWon += 1;
        out.revenueWon += num(e.payload?.value);
        winsByDeal.set(e.entityId, [...(winsByDeal.get(e.entityId) ?? []), num(e.payload?.value)]);
        break;
      }
      case 'deal.lost':
        out.dealsLost += 1;
        break;
      case 'deal.reopened':
        reopened.add(e.entityId);
        break;
      case 'invoice.paid':
        out.revenueCollected += num(e.payload?.amount_paid || e.payload?.total);
        break;
      case 'lead.qualified':
        out.leadsQualified += 1;
        break;
      case 'lead.converted':
        out.leadsConverted += 1;
        break;
    }
  }

  /* Undo the win a reopen cancelled, once per reopened deal. */
  for (const key of reopened) {
    const wins = winsByDeal.get(key);
    if (wins?.length) {
      out.dealsWon -= 1;
      out.revenueWon -= wins[wins.length - 1];
    }
  }

  const decided = out.dealsWon + out.dealsLost;
  out.winRate = decided > 0 ? out.dealsWon / decided : null;
  out.averageDeal = out.dealsWon > 0 ? out.revenueWon / out.dealsWon : null;

  return out;
}

/** What a metric's achieved value is, for target progress. */
export function achievedFor(
  metric: TargetMetric,
  achievement: Achievement,
  activitiesLogged: number,
): number {
  switch (metric) {
    case 'revenue_won': return achievement.revenueWon;
    case 'revenue_collected': return achievement.revenueCollected;
    case 'deals_won': return achievement.dealsWon;
    case 'leads_qualified': return achievement.leadsQualified;
    case 'activities_logged': return activitiesLogged;
  }
}

/** Month keys covering a period, oldest first, in the organisation's calendar. */
export function monthsBetween(period: Period, zone: string): string[] {
  const keys: string[] = [];
  const [sy, sm] = period.start.slice(0, 7).split('-').map(Number);
  const [ey, em] = period.end.slice(0, 7).split('-').map(Number);
  let y = sy, m = sm;
  /* Bounded so a malformed range cannot spin. Ten years of months is plenty. */
  for (let guard = 0; guard < 120; guard++) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    if (y === ey && m === em) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  void zone;
  return keys;
}

/** The month an instant falls in, in the organisation's own calendar. */
export function monthOf(instant: string, zone: string): string {
  return dateIn(new Date(instant), zone).slice(0, 7);
}
