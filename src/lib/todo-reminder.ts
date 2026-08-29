/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  When to be told about a to-do
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── A reminder is not a due date ──────────────────────────────────────────
 *
 * `due_on` is a `date`: *when the work should be done*. "Read the contract
 * before Thursday" has no time of day and no timezone - that is why the column
 * is a date and why every screen in this module treats it as one.
 *
 * `remind_at` is a `timestamptz`: *when I want to be told*. "At nine" is
 * precisely a time of day, and it has to survive being read in another
 * timezone, so it is an instant.
 *
 * Collapsing the two is the mistake every simple to-do app makes and then
 * cannot undo: once "due" carries a time, every undated-but-owed item needs a
 * fake one, and the list starts lying about when things are actually needed.
 *
 * ── Why the offsets are relative and stored absolute ──────────────────────
 *
 * People choose a reminder relative to the work ("the evening before", "an
 * hour before"), and the database stores the instant that resolves to. The
 * alternative - storing the offset and computing at read time - means the
 * reminder silently moves whenever the due date is edited, which is sometimes
 * what you want and never what you asked for. Moving the date offers to move
 * the reminder; it does not do it behind your back.
 *
 * Lives in `lib` rather than beside a route because `/api/todos` and
 * `/api/todos/[id]` both validate it, and a `route.ts` is not a module other
 * code should import from.
 */

/** The offsets people actually pick, before reaching for a clock. */
export const REMINDER_PRESETS = [
  { key: 'morning',      label: 'On the day, 9:00' },
  { key: 'evening-before', label: 'The evening before, 18:00' },
  { key: 'hour-before',  label: 'An hour before 9:00 on the day' },
  { key: 'in-an-hour',   label: 'In an hour' },
  { key: 'tomorrow-9',   label: 'Tomorrow at 9:00' },
] as const;

export type ReminderPreset = (typeof REMINDER_PRESETS)[number]['key'];

/**
 * Resolve a preset against a due date, in the reader's own clock.
 *
 * Client-side: it builds a local `Date` and hands back an ISO instant, so
 * "9:00" means nine in the morning where the person is, not where the server
 * is. The three presets that need a due date return null without one - the
 * caller disables them rather than inventing a day.
 */
export function resolveReminder(preset: ReminderPreset, dueOn: string | null): string | null {
  const at = (iso: string, h: number, m = 0) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  switch (preset) {
    case 'morning':
      return dueOn ? at(dueOn, 9) : null;
    case 'evening-before': {
      if (!dueOn) return null;
      const d = new Date(`${dueOn}T00:00:00`);
      d.setDate(d.getDate() - 1);
      d.setHours(18, 0, 0, 0);
      return d.toISOString();
    }
    case 'hour-before':
      return dueOn ? at(dueOn, 8) : null;
    case 'in-an-hour': {
      const d = new Date();
      d.setHours(d.getHours() + 1, d.getMinutes(), 0, 0);
      return d.toISOString();
    }
    case 'tomorrow-9': {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
}

/** Whether a preset can be offered for a to-do with this due date. */
export function presetNeedsDate(preset: ReminderPreset): boolean {
  return preset === 'morning' || preset === 'evening-before' || preset === 'hour-before';
}

/**
 * Validate a reminder instant off the wire.
 *
 * Returning a message rather than throwing keeps the failure a sentence the
 * user can act on, which is how every other validation in this codebase
 * reports.
 *
 * A reminder in the past is refused rather than silently accepted: the sweep
 * would deliver it within the minute, so "remind me last Tuesday" becomes a
 * notification about nothing, and the person has no way to tell that from the
 * feature being broken. One hour of slack, because a form open across a clock
 * change or a slow submit should not be a rejection.
 */
export function readRemindAt(
  raw: unknown,
): { value: string | null } | { message: string } {
  if (raw === null || raw === undefined || raw === '') return { value: null };

  const at = new Date(String(raw));
  if (Number.isNaN(at.getTime())) {
    return { message: 'That reminder time could not be read.' };
  }

  if (at.getTime() < Date.now() - 60 * 60 * 1000) {
    return { message: 'A reminder has to be in the future.' };
  }

  /**
   * Far enough out to be a typo rather than a plan.
   *
   * Five years is comfortably past anything anybody schedules deliberately and
   * comfortably short of the year 9999 that a mis-keyed date field produces -
   * which would otherwise sit in the sweep's index for ever.
   */
  if (at.getTime() > Date.now() + 5 * 365 * 24 * 60 * 60 * 1000) {
    return { message: 'That reminder is more than five years away.' };
  }

  return { value: at.toISOString() };
}
