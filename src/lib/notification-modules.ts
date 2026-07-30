import type { ModuleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Which module a notification belongs to
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The sidebar shows a count against each module — Support (3), Projects (2) —
 * and that requires deciding which module each notification is *about*. The
 * database emits a `type` and an `entity_type`; neither is a module.
 *
 * ── Why a map rather than a column ────────────────────────────────────────
 *
 * Adding `module` to `notifications` would mean every trigger in 0016 restating
 * something already implied by the type it emits, and the two would drift the
 * first time a trigger was edited without its module being updated. The type
 * vocabulary is small, closed, and defined in one place — the fan-out functions
 * — so mapping it here keeps the decision in one place too.
 *
 * ── The prefix fallback matters ───────────────────────────────────────────
 *
 * Types are consistently `<subject>_<event>`: `task_completed`,
 * `invoice_overdue`, `ticket_assigned`. A type added by a future trigger that
 * follows the convention is therefore routed correctly without this file being
 * touched, which is the difference between a map that ages well and one that
 * silently drops new notifications into no module at all.
 *
 * Anything genuinely unrecognised is deliberately left unmapped rather than
 * defaulted to `dashboard`: an uncounted notification is still visible in the
 * tray, whereas one attributed to the wrong module sends somebody looking in
 * the wrong place.
 */

/** Exact type → module, where the prefix alone would be wrong or ambiguous. */
const EXACT: Record<string, ModuleId> = {
  // The subject is a leave request, but the module people go to is HR.
  leave_request: 'hr',
  leave_requested: 'hr',
  leave_approved: 'hr',
  leave_rejected: 'hr',
  on_leave: 'hr',
  // An expense is submitted in Finance's expense tab.
  expense_submitted: 'finance',
  expense_approved: 'finance',
  expense_rejected: 'finance',
  // A mention always arrives in a conversation.
  mention: 'communication',
  message_mention: 'communication',
  // A deliverable decision is a client acting on a project.
  deliverable_approved: 'projects',
  deliverable_rejected: 'projects',
  // Announcements are organisation-wide; the dashboard is where they surface.
  announcement: 'dashboard',
};

/** Subject prefix → module, for the `<subject>_<event>` convention. */
const BY_PREFIX: Record<string, ModuleId> = {
  task: 'projects',
  project: 'projects',
  milestone: 'projects',
  deliverable: 'projects',
  ticket: 'support',
  support: 'support',
  message: 'communication',
  channel: 'communication',
  invoice: 'finance',
  payment: 'finance',
  expense: 'finance',
  leave: 'hr',
  attendance: 'hr',
  employee: 'hr',
  stock: 'inventory',
  product: 'inventory',
  purchase: 'inventory',
  event: 'calendar',
  meeting: 'calendar',
  page: 'workspace',
  document: 'workspace',
  todo: 'mywork',
};

/**
 * Every type that belongs to a module.
 *
 * The inverse of `moduleOfNotification`, and it has to be an explicit list
 * rather than a prefix match because it is used to build a SQL `IN` clause —
 * PostgREST cannot express "type starts with any of these prefixes" without a
 * `LIKE` per prefix, and a wrong answer here marks somebody's notifications
 * read without them being seen.
 *
 * Derived from the two maps so the count and the clear cannot disagree: a type
 * added to `EXACT` or a prefix added to `BY_PREFIX` is picked up by both.
 */
export function typesForModule(moduleId: string): string[] {
  const exact = Object.entries(EXACT)
    .filter(([, m]) => m === moduleId)
    .map(([type]) => type);

  /**
   * The prefixes belonging to this module, expanded against the events the
   * database actually emits.
   *
   * Listed rather than inferred: these are the `type` values written by the
   * fan-out functions in 0016 and 0018, and a set built from anything else
   * would either miss one or invent one.
   */
  const prefixes = Object.entries(BY_PREFIX)
    .filter(([, m]) => m === moduleId)
    .map(([prefix]) => prefix);

  const fromPrefixes = EMITTED_TYPES.filter(t => prefixes.includes(t.split('_')[0]));

  return [...new Set([...exact, ...fromPrefixes])];
}

/**
 * The notification types the database emits.
 *
 * Kept beside the map because the two are read together, and asserted against
 * the migrations by `npm run schema:check` — a trigger emitting a type that is
 * not listed here would count toward no badge and never be cleared by one.
 */
export const EMITTED_TYPES = [
  'task_assigned', 'task_completed', 'task_blocked',
  'project_comment', 'project_deadline', 'project_status',
  'deliverable_approved', 'deliverable_rejected',
  'ticket_assigned', 'ticket_resolved', 'ticket_escalated', 'ticket_created',
  'message_mention',
  'invoice_sent', 'invoice_paid', 'invoice_overdue',
  'expense_submitted', 'expense_approved', 'expense_rejected',
  'leave_request', 'leave_requested', 'leave_approved', 'leave_rejected', 'on_leave',
  'announcement',
];

export function moduleOfNotification(type: string | null | undefined): ModuleId | null {
  if (!type) return null;
  const exact = EXACT[type];
  if (exact) return exact;

  const prefix = type.split('_')[0];
  return BY_PREFIX[prefix] ?? null;
}

/**
 * Count unread notifications per module.
 *
 * Takes the tray rather than issuing its own query: the header already fetches
 * it, and a second count would be a second answer to the same question that
 * disagrees with the first while one of them is in flight.
 */
export function unreadByModule(
  notifications: { type: string; isRead: boolean }[],
): Partial<Record<ModuleId, number>> {
  const counts: Partial<Record<ModuleId, number>> = {};
  for (const n of notifications) {
    if (n.isRead) continue;
    const target = moduleOfNotification(n.type);
    if (!target) continue;
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}
