import { ATTENDED_STATUSES, PUNCTUAL_STATUSES, type AttendanceStatus } from '@/lib/attendance';
import type { RawEvent } from '@/lib/performance';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Performance evidence, and the difference between it and activity
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The rule this file exists to hold ────────────────────────────────────
 *
 * **There is no score here, and there is not going to be one.**
 *
 * The obvious thing to build is a number out of ten. It is obvious because it
 * is easy, it looks decisive, and it is wrong in a way that is expensive to
 * discover: the weights that produce it are invented, nobody can say why they
 * are those weights, and the moment it exists somebody makes an employment
 * decision with it. What this file produces instead is a set of *figures with
 * their workings attached* — each one countable, each one traceable to rows a
 * person can go and look at, and each one refusing to be computed when there
 * is not enough behind it to mean anything.
 *
 * A manager reads them and forms a judgement. That is the correct division of
 * labour, and it is the reason `EvidenceMetric` carries `basis` and `sample`
 * next to `value` rather than in a tooltip somewhere.
 *
 * ── Activity is not performance ──────────────────────────────────────────
 *
 * Nothing here counts logins, sessions, messages sent, hours with the tab
 * open, or keystrokes. Somebody online for twelve hours has not out-performed
 * somebody who finished at two; the first figure measures presence and the
 * second measures nothing at all. Every metric below is an *outcome* — a thing
 * that was finished, a day that was worked, a goal that was reached, a
 * recognition somebody chose to give — or a *reliability rate* over those
 * outcomes.
 *
 * The one presence-shaped thing here is attendance, and it is included because
 * it is a contractual fact with its own authoritative record and its own
 * correction history (0046), not because being present is an achievement.
 *
 * ── Provenance, and why it is on every figure ────────────────────────────
 *
 * Two kinds of fact reach this file, and conflating them is how a performance
 * screen quietly starts lying:
 *
 *   · `event`  — frozen when it happened, in `business_events`. "Was this task
 *                on time" is a fact about the day it was finished, and the due
 *                date it was measured against is editable for ever. Only a
 *                frozen copy can answer it.
 *   · `record` — read live from the table that owns it, because that table is
 *                already the authority and already has its own audit trail.
 *                Attendance is the example: 0046 made `attendance_records`
 *                correctable-with-history, so reading it live is reading the
 *                corrected truth rather than a stale snapshot of it.
 *
 * A screen that shows both must be able to say which is which, because they
 * behave differently when history is corrected: an event does not move, and a
 * record does.
 *
 * ── How a new module contributes ─────────────────────────────────────────
 *
 * Add an entry to `EVIDENCE_SOURCES` and, if it is event-shaped, emit through
 * `emit_business_event()` in a migration. Nothing in the Performance screens
 * is written against a specific module — they render whatever sections the
 * registry produces — so a module that starts contributing evidence appears
 * without any of this being edited. That is the whole reason the registry
 * exists rather than a function per module.
 */

/** The domains evidence can come from. Adding one is adding a source below. */
export type EvidenceArea =
  | 'delivery' | 'goals' | 'attendance' | 'commercial' | 'recognition' | 'review';

export type Provenance = 'event' | 'record';

export type EvidenceUnit = 'count' | 'percent' | 'money' | 'days';

export interface EvidenceMetric {
  key: string;
  label: string;
  /**
   * Null is a first-class answer and means "not enough to say", never zero.
   *
   * A completion rate over two tasks is not a completion rate, and rendering
   * it as 50% invites a conversation about a number that is noise. `sample`
   * says how much is behind it so the screen can show the count instead.
   */
  value: number | null;
  unit: EvidenceUnit;
  /** How many observations the figure rests on. */
  sample: number;
  /** Where it came from, in words the person it describes can check. */
  basis: string;
  provenance: Provenance;
}

export interface EvidenceSection {
  area: EvidenceArea;
  label: string;
  /** Which module owns the underlying records, for cross-module navigation. */
  module: string;
  note: string;
  metrics: EvidenceMetric[];
  /**
   * Whether this organisation has the data at all.
   *
   * A section that cannot be computed says so in its own words rather than
   * rendering zeroes. "No goals have been set for you" and "you achieved none
   * of your goals" are different statements and the product must not confuse
   * them — that is the difference between an honest empty state and a
   * fabricated metric.
   */
  available: boolean;
  unavailable?: string;
}

/**
 * The registry. One entry per contributing domain.
 *
 * `events` names what the domain freezes; `tables` names what it reads live.
 * A domain may do both. The list is documentation that is also code: it is the
 * answer to "what feeds performance", and it cannot drift from the truth
 * because the route iterates it.
 */
export interface EvidenceSource {
  area: EvidenceArea;
  label: string;
  module: string;
  note: string;
  events: readonly string[];
  tables: readonly string[];
}

export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  {
    area: 'delivery',
    label: 'Delivered work',
    module: 'projects',
    note: 'Tasks assigned to you in the shared tracker, and whether they landed by their due date',
    events: ['task.completed'],
    tables: [],
  },
  {
    area: 'goals',
    label: 'Goals',
    module: 'hr',
    note: 'Goals set for you in a performance cycle',
    events: ['goal.achieved'],
    tables: ['performance_goals'],
  },
  {
    area: 'attendance',
    label: 'Attendance',
    module: 'hr',
    note: 'The register, including any corrections made to it',
    events: [],
    tables: ['attendance_records'],
  },
  {
    area: 'commercial',
    label: 'Commercial',
    module: 'crm',
    note: 'Deals and leads credited to you, at the values they were closed at',
    events: ['deal.won', 'deal.lost', 'lead.qualified', 'lead.converted', 'invoice.paid'],
    tables: [],
  },
  {
    area: 'recognition',
    label: 'Recognition',
    module: 'hr',
    note: 'Recognition recorded for you by colleagues and managers',
    events: [],
    tables: ['performance_achievements'],
  },
  {
    area: 'review',
    label: 'Reviews',
    module: 'hr',
    note: 'Formal reviews that have been completed and shared with you',
    events: [],
    tables: ['performance_reviews'],
  },
] as const;

/**
 * Below this many observations, a rate is not reported.
 *
 * Five is a judgement rather than a theorem, and it is deliberately stated
 * once here instead of being written as `> 5` in six places. The point is not
 * statistical rigour — it is that a percentage computed from two things reads
 * with exactly the same authority as one computed from two hundred, and the
 * screen has no way to show the difference unless this file refuses.
 */
export const MIN_SAMPLE = 5;

/**
 * A percentage, or null when there is not enough behind it.
 *
 * Returns 0–100 rounded, because every consumer wants it that way and a
 * fraction that is rounded in four different places is rounded four different
 * ways.
 */
export function rate(part: number, whole: number, minimum = MIN_SAMPLE): number | null {
  if (whole < minimum || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/* ─────────────────────────────────────────────────────────────────────────
   Delivery — from `task.completed`
   ───────────────────────────────────────────────────────────────────────── */

export interface DeliveryInput {
  /** `task.completed` events inside the window. */
  completed: RawEvent[];
  /** Tasks assigned to the person and still open, for the overdue figure. */
  openAssigned: { dueDate: string | null }[];
  /** Today, in the organisation's calendar, for deciding what is overdue. */
  today: string;
}

export function deliveryEvidence(input: DeliveryInput): EvidenceSection {
  const { completed, openAssigned, today } = input;

  /**
   * Only tasks that had a due date can answer "on time".
   *
   * `on_time` is null in the payload when there was no due date, and those are
   * excluded from the denominator rather than counted as failures. About half
   * the tasks in a real tracker have no due date; counting them as late would
   * make this figure wrong for everybody, in the same direction, for ever.
   */
  const dated = completed.filter(e => e.payload?.on_time === true || e.payload?.on_time === false);
  const onTime = dated.filter(e => e.payload?.on_time === true).length;

  const projects = new Set(
    completed.map(e => e.payload?.project_id).filter(Boolean) as string[],
  );
  const milestones = new Set(
    completed.map(e => e.payload?.milestone_id).filter(Boolean) as string[],
  );

  const overdue = openAssigned.filter(t => t.dueDate && t.dueDate < today).length;

  const metrics: EvidenceMetric[] = [
    {
      key: 'tasks_completed',
      label: 'Tasks completed',
      value: completed.length,
      unit: 'count',
      sample: completed.length,
      basis: 'Tasks assigned to you that reached Done in this period',
      provenance: 'event',
    },
    {
      key: 'on_time_rate',
      label: 'Completed by their due date',
      value: rate(onTime, dated.length),
      unit: 'percent',
      sample: dated.length,
      basis: `${onTime} of ${dated.length} completed tasks that had a due date, measured against the date `
        + 'it held on the day the task was finished',
      provenance: 'event',
    },
    {
      key: 'projects_contributed',
      label: 'Projects contributed to',
      value: projects.size,
      unit: 'count',
      sample: projects.size,
      basis: 'Distinct projects you completed at least one task in',
      provenance: 'event',
    },
    {
      key: 'milestones_contributed',
      label: 'Milestones contributed to',
      value: milestones.size,
      unit: 'count',
      sample: milestones.size,
      basis: 'Distinct milestones you completed at least one task under',
      provenance: 'event',
    },
    {
      key: 'overdue_open',
      label: 'Assigned and now overdue',
      value: overdue,
      unit: 'count',
      sample: openAssigned.length,
      basis: 'Tasks still assigned to you whose due date has passed. Read live, so it changes as you work',
      provenance: 'record',
    },
  ];

  return {
    area: 'delivery',
    label: 'Delivered work',
    module: 'projects',
    note: 'Tasks assigned to you in the shared tracker. Your private My Work list is not counted here.',
    metrics,
    available: completed.length > 0 || openAssigned.length > 0,
    unavailable: 'No tasks have been assigned to you in the shared tracker for this period.',
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Goals — from `goal.achieved` and the goal rows themselves
   ───────────────────────────────────────────────────────────────────────── */

export interface GoalRow {
  status: 'draft' | 'active' | 'achieved' | 'missed' | 'cancelled';
  weight: number;
}

export function goalEvidence(goals: GoalRow[], achievedEvents: RawEvent[]): EvidenceSection {
  /**
   * Cancelled and draft goals are not part of the denominator.
   *
   * A goal that was withdrawn was not failed, and a goal still being written
   * has not been agreed. Counting either against somebody would make "goals
   * achieved" a figure that a manager can move by tidying up the list.
   */
  const settled = goals.filter(g => g.status === 'achieved' || g.status === 'missed');
  const achieved = goals.filter(g => g.status === 'achieved');
  const active = goals.filter(g => g.status === 'active');

  /* Weighted, because goals carry a weight and treating them equally ignores it. */
  const weightTotal = settled.reduce((s, g) => s + g.weight, 0);
  const weightDone = achieved.reduce((s, g) => s + g.weight, 0);

  const onTime = achievedEvents.filter(e => e.payload?.on_time === true).length;
  const datedAchievements = achievedEvents.filter(
    e => e.payload?.on_time === true || e.payload?.on_time === false,
  ).length;

  const metrics: EvidenceMetric[] = [
    {
      key: 'goals_achieved',
      label: 'Goals achieved',
      value: achieved.length,
      unit: 'count',
      sample: goals.length,
      basis: `${achieved.length} achieved of ${settled.length} goals that have been settled, `
        + `with ${active.length} still open`,
      provenance: 'record',
    },
    {
      key: 'goal_achievement_rate',
      label: 'Goal achievement',
      /* A goal list is short by nature, so the usual minimum would silence it. */
      value: rate(weightDone, weightTotal, 1),
      unit: 'percent',
      sample: settled.length,
      basis: 'Weighted by each goal’s own weight, over goals that have been settled '
        + 'as achieved or missed. Draft and cancelled goals are excluded.',
      provenance: 'record',
    },
    {
      key: 'goals_on_time',
      label: 'Achieved by their due date',
      value: rate(onTime, datedAchievements, 1),
      unit: 'percent',
      sample: datedAchievements,
      basis: `${onTime} of ${datedAchievements} achieved goals that had a due date`,
      provenance: 'event',
    },
  ];

  return {
    area: 'goals',
    label: 'Goals',
    module: 'hr',
    note: 'Goals set for you in a performance cycle by HR or your manager.',
    metrics,
    available: goals.length > 0,
    unavailable: 'No goals have been set for you. This is not a score of zero — there is nothing to measure yet.',
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Attendance — from the register, read live
   ───────────────────────────────────────────────────────────────────────── */

export interface AttendanceRow {
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
}

export function attendanceEvidence(rows: AttendanceRow[], expectedDays: number): EvidenceSection {
  const attended = rows.filter(r =>
    (ATTENDED_STATUSES as readonly string[]).includes(r.status)).length;
  const punctual = rows.filter(r =>
    (PUNCTUAL_STATUSES as readonly string[]).includes(r.status)).length;
  const onLeave = rows.filter(r => r.status === 'on_leave').length;
  const late = rows.filter(r => r.status === 'late').length;
  const workedMinutes = rows.reduce((s, r) => s + r.workedMinutes, 0);

  const metrics: EvidenceMetric[] = [
    {
      key: 'days_attended',
      label: 'Days attended',
      value: attended,
      unit: 'count',
      sample: rows.length,
      basis: `${attended} ${attended === 1 ? 'day' : 'days'} recorded present, late, early, remote `
        + `or half-day, out of ${expectedDays} working days in this period`,
      provenance: 'record',
    },
    {
      key: 'attendance_rate',
      label: 'Attendance',
      value: rate(attended, expectedDays),
      unit: 'percent',
      sample: expectedDays,
      basis: 'Days attended against the organisation’s working days for this period',
      provenance: 'record',
    },
    {
      key: 'punctuality_rate',
      label: 'Punctuality',
      value: rate(punctual, attended),
      unit: 'percent',
      sample: attended,
      basis: `${punctual} of ${attended} attended days began on time, within the organisation’s `
        + 'grace period. Measured over days attended, so approved leave does not count against you.',
      provenance: 'record',
    },
    {
      key: 'late_arrivals',
      label: 'Late arrivals',
      value: late,
      unit: 'count',
      sample: attended,
      basis: 'Days the register recorded a late arrival',
      provenance: 'record',
    },
    {
      key: 'approved_leave',
      label: 'Approved leave taken',
      value: onLeave,
      unit: 'count',
      sample: rows.length,
      basis: 'Days recorded as approved leave. These are not absences and do not reduce your attendance rate.',
      provenance: 'record',
    },
    {
      key: 'hours_worked',
      label: 'Hours recorded',
      value: Math.round(workedMinutes / 60),
      unit: 'count',
      sample: attended,
      basis: 'Total worked minutes on the register, less the organisation’s break allowance, '
        + 'converted to hours',
      provenance: 'record',
    },
  ];

  return {
    area: 'attendance',
    label: 'Attendance',
    module: 'hr',
    note: 'From the register. Corrections are kept with their reasons and are visible to you.',
    metrics,
    available: rows.length > 0,
    unavailable: 'Nothing has been recorded on the register for you in this period.',
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Recognition and reviews — read live
   ───────────────────────────────────────────────────────────────────────── */

export function recognitionEvidence(received: number, given: number): EvidenceSection {
  return {
    area: 'recognition',
    label: 'Recognition',
    module: 'hr',
    note: 'Recorded by colleagues and managers.',
    metrics: [
      {
        key: 'recognition_received',
        label: 'Recognition received',
        value: received,
        unit: 'count',
        sample: received,
        basis: 'Entries recorded about you in this period',
        provenance: 'record',
      },
      {
        key: 'recognition_given',
        label: 'Recognition given',
        value: given,
        unit: 'count',
        sample: given,
        basis: 'Entries you recorded about colleagues. Shown because recognising others is '
          + 'contribution, not because giving more is better.',
        provenance: 'record',
      },
    ],
    available: received > 0 || given > 0,
    unavailable: 'No recognition has been recorded in this period.',
  };
}

export interface ReviewRow {
  status: 'not_started' | 'self_review' | 'manager_review' | 'shared' | 'closed';
  overallRating: number | null;
  closedAt: string | null;
}

export function reviewEvidence(reviews: ReviewRow[]): EvidenceSection {
  /**
   * Only shared or closed reviews are visible evidence.
   *
   * A review still in `manager_review` holds a rating the employee has not
   * been shown, and surfacing it here would leak the outcome of a conversation
   * that has not happened. 0032 already refuses to close a review before
   * `shared_at` is stamped, and this is the same rule on the read side.
   */
  const visible = reviews.filter(r => r.status === 'shared' || r.status === 'closed');
  const rated = visible.filter(r => r.overallRating != null);
  const mean = rated.length
    ? Math.round((rated.reduce((s, r) => s + (r.overallRating ?? 0), 0) / rated.length) * 10) / 10
    : null;

  return {
    area: 'review',
    label: 'Reviews',
    module: 'hr',
    note: 'Formal reviews that have been shared with you. Ratings still in progress are not shown here.',
    metrics: [
      {
        key: 'reviews_completed',
        label: 'Reviews completed',
        value: visible.length,
        unit: 'count',
        sample: reviews.length,
        basis: 'Reviews that have been shared with you or closed',
        provenance: 'record',
      },
      {
        key: 'mean_rating',
        label: 'Average overall rating',
        value: mean,
        unit: 'count',
        sample: rated.length,
        basis: rated.length
          ? `Mean of ${rated.length} shared review rating${rated.length === 1 ? '' : 's'}, out of 5`
          : 'No shared review carries an overall rating yet',
        provenance: 'record',
      },
    ],
    available: visible.length > 0,
    unavailable: 'No review has been shared with you yet.',
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Commercial — the CRM figures, which were the whole screen before
   ───────────────────────────────────────────────────────────────────────── */

export function commercialEvidence(
  events: RawEvent[],
  currency: string,
): EvidenceSection {
  const won = events.filter(e => e.eventType === 'deal.won');
  const lost = events.filter(e => e.eventType === 'deal.lost');
  const qualified = events.filter(e => e.eventType === 'lead.qualified');
  const revenue = won.reduce((s, e) => s + Number(e.payload?.value ?? 0), 0);

  return {
    area: 'commercial',
    label: 'Commercial',
    module: 'crm',
    note: 'Only meaningful for people who own deals. An empty section here is not a gap in your record.',
    metrics: [
      {
        key: 'revenue_won',
        label: 'Revenue won',
        value: revenue,
        unit: 'money',
        sample: won.length,
        basis: `Value of ${won.length} deal${won.length === 1 ? '' : 's'} at the moment each was `
          + `closed, not at today’s value. In ${currency}.`,
        provenance: 'event',
      },
      {
        key: 'deals_won',
        label: 'Deals won',
        value: won.length,
        unit: 'count',
        sample: won.length + lost.length,
        basis: 'Deals you owned that closed won in this period',
        provenance: 'event',
      },
      {
        key: 'win_rate',
        label: 'Win rate',
        value: rate(won.length, won.length + lost.length),
        unit: 'percent',
        sample: won.length + lost.length,
        basis: `${won.length} won of ${won.length + lost.length} deals you closed either way`,
        provenance: 'event',
      },
      {
        key: 'leads_qualified',
        label: 'Leads qualified',
        value: qualified.length,
        unit: 'count',
        sample: qualified.length,
        basis: 'Leads you moved to qualified in this period',
        provenance: 'event',
      },
    ],
    available: events.length > 0,
    unavailable: 'You do not own deals or leads, so there is nothing commercial to show.',
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   The timeline
   ───────────────────────────────────────────────────────────────────────── */

export interface TimelineEntry {
  at: string;
  kind: string;
  title: string;
  detail: string;
  area: EvidenceArea;
  /** True when this entry is a thing that happened, false when it is a state. */
  provenance: Provenance;
  /**
   * Where the underlying record lives, when it can be opened.
   *
   * Null for entries whose record has no screen of its own — a recognition
   * entry is read where it is written, and there is nowhere to send somebody
   * who clicks it. A row that looks clickable and does nothing is worse than
   * one that plainly is not, so the component keys off this rather than
   * guessing from the event type.
   */
  openIn: { module: string; type: string; id: string } | null;
}

/**
 * What each event type is called when it appears on somebody's timeline, and
 * where clicking it should go.
 *
 * Kept here rather than in the component because the timeline is assembled on
 * the server, and because a label that only exists in JSX cannot be reused by
 * the HR review screen that shows the same entries to a manager.
 *
 * `opens` names a module and the record type that module's `useFocusRequest`
 * already understands — this is the cross-module navigation contract, not a
 * new one. An event type with no `opens` is rendered as plain text.
 */
export const TIMELINE_LABELS: Record<
  string,
  { verb: string; area: EvidenceArea; opens?: { module: string; type: string } }
> = {
  'task.completed': { verb: 'Completed a task', area: 'delivery', opens: { module: 'projects', type: 'task' } },
  'goal.achieved': { verb: 'Achieved a goal', area: 'goals' },
  'deal.won': { verb: 'Won a deal', area: 'commercial', opens: { module: 'crm', type: 'deal' } },
  'deal.lost': { verb: 'Lost a deal', area: 'commercial', opens: { module: 'crm', type: 'deal' } },
  'deal.reopened': { verb: 'Reopened a deal', area: 'commercial', opens: { module: 'crm', type: 'deal' } },
  'lead.qualified': { verb: 'Qualified a lead', area: 'commercial', opens: { module: 'crm', type: 'lead' } },
  'lead.converted': { verb: 'Converted a lead', area: 'commercial', opens: { module: 'crm', type: 'lead' } },
  'invoice.paid': { verb: 'Collected on an invoice', area: 'commercial' },
};

export function eventTitle(e: RawEvent): string {
  const p = e.payload ?? {};
  return p.title || p.deal_name || p.lead_name || p.invoice_number || 'Record';
}
