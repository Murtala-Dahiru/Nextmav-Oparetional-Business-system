/**
 * How often a personal to-do comes back.
 *
 * Four intervals, each a sentence somebody would say out loud, rather than an
 * RFC 5545 rule. See migration 0022 for the reasoning: an RRULE is the right
 * answer for a calendar that must interoperate, and a parser plus an
 * edge-case surface plus a UI for "every third Tuesday" is the wrong one for a
 * private list.
 *
 * Lives in `lib` rather than beside the route because both `/api/todos` and
 * `/api/todos/[id]` need it, and a `route.ts` is not a module other code
 * should be importing from — Next reserves those files for HTTP handlers.
 */

export const RECURRENCES = ['daily', 'weekdays', 'weekly', 'monthly'] as const;

export type Recurrence = (typeof RECURRENCES)[number];

/** What each interval is called on screen. */
export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
};

/**
 * Validate a repeat against the date it would repeat from.
 *
 * The two constrain each other, and the database says so as well
 * (`todo_recurrence_valid`): a repeat needs a day to advance from, or you get
 * a to-do that claims to recur and never does. Returning a message rather than
 * throwing keeps the failure a sentence the user can act on, which is how
 * every other validation in this codebase reports.
 */
export function readRecurrence(
  raw: unknown,
  dueOn: string | null,
): { value: Recurrence | null } | { message: string } {
  if (raw === null || raw === undefined || raw === '' || raw === 'none') {
    return { value: null };
  }
  const value = String(raw);
  if (!RECURRENCES.includes(value as Recurrence)) {
    return { message: `"${value}" is not a repeat. Choose one of: ${RECURRENCES.join(', ')}.` };
  }
  if (!dueOn) {
    return { message: 'A repeating to-do needs a date to repeat from.' };
  }
  return { value: value as Recurrence };
}

/**
 * The next occurrence, mirrored from `public.next_todo_occurrence`.
 *
 * The database is the authority — the trigger is what actually queues the next
 * one, so that it holds for every path that sets `is_done`. This copy exists
 * only so the UI can say "next: Friday 8 Aug" before the round trip, and it
 * must stay in step with 0022.
 */
export function nextOccurrence(dueOn: string, rule: Recurrence): string {
  const d = new Date(`${dueOn}T00:00:00`);

  switch (rule) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'weekdays': {
      // Friday and Saturday both roll to Monday, so a workday item does not
      // queue two occurrences across a weekend.
      const isoDow = d.getDay() === 0 ? 7 : d.getDay();
      d.setDate(d.getDate() + (isoDow === 5 ? 3 : isoDow === 6 ? 2 : 1));
      break;
    }
  }

  return d.toISOString().slice(0, 10);
}
