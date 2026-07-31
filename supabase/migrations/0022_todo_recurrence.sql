-- ═══════════════════════════════════════════════════════════════════════════
--  0022 — A to-do that comes back
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ── Why this belongs on a personal list and not on tasks ─────────────────
--
--  The routine parts of a person's week are exactly the parts a to-do list is
--  worst at: "submit the timesheet", "Friday report", "check the standby
--  rota". They are trivially small, they are nobody else's business, and they
--  recur — so on a list without recurrence they are either retyped every week
--  or, in practice, never written down at all and simply remembered. That is
--  the friction this removes, and it is the single most common reason people
--  keep a second list in a notebook beside the software they were given.
--
--  `tasks` deliberately has no recurrence, and should not get one: a recurring
--  *project* task is a schedule the team has agreed, which is a plan, not a
--  repeat. This is one person's habit.
--
--  ── The shape ────────────────────────────────────────────────────────────
--
--  A single text column rather than an RRULE. The four intervals below cover
--  what a personal list needs, and each one is a sentence a person would say
--  out loud. An RFC 5545 recurrence rule is the correct answer for a calendar
--  that must interoperate; here it would be a parser, an edge-case surface and
--  a UI nobody asked for, in service of "every third Tuesday".
--
--  `recurrence` requires `due_on`, enforced below. A repeat with no date to
--  repeat *from* has nothing to compute the next occurrence out of, and
--  silently accepting one gives you a to-do that claims to recur and never
--  does — the class of quiet non-behaviour this codebase keeps finding.
--
--  There is no `recur_parent_id` and no occurrence table. Completing a
--  recurring to-do inserts the next one, and the completed row keeps its
--  `recurrence` value so history reads honestly ("this was the weekly report").
--  Chaining them would buy a series view nobody has asked for and would make
--  deleting one occurrence an ambiguous act.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS recurrence text;

COMMENT ON COLUMN public.todos.recurrence IS
  'How often this to-do comes back: daily, weekdays, weekly, monthly, or NULL '
  'for a one-off. Completing a recurring to-do inserts the next occurrence; '
  'the completed row keeps the value as history.';

-- Dropped first so re-running the migration against a database that already
-- has it does not fail on the duplicate name.
ALTER TABLE todos DROP CONSTRAINT IF EXISTS todo_recurrence_valid;
ALTER TABLE todos
  ADD CONSTRAINT todo_recurrence_valid CHECK (
    recurrence IS NULL
    OR (recurrence IN ('daily', 'weekdays', 'weekly', 'monthly') AND due_on IS NOT NULL)
  );

/**
 * The next occurrence of a repeating to-do.
 *
 * Advances from the *due date*, not from today, so a weekly item completed
 * three days late is still due on its usual day rather than drifting later
 * every time somebody is busy. That drift is the thing that makes recurring
 * to-dos stop lining up with the week they belong to.
 *
 * `weekdays` skips to Monday when the next day would land on a weekend, so a
 * daily-on-workdays item does not queue up two occurrences over a weekend for
 * somebody to clear on Monday morning.
 */
CREATE OR REPLACE FUNCTION public.next_todo_occurrence(from_date date, rule text)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE rule
    WHEN 'daily'   THEN from_date + 1
    WHEN 'weekly'  THEN from_date + 7
    WHEN 'monthly' THEN (from_date + interval '1 month')::date
    WHEN 'weekdays' THEN CASE extract(isodow FROM from_date)
      -- Friday and Saturday both roll to Monday.
      WHEN 5 THEN from_date + 3
      WHEN 6 THEN from_date + 2
      ELSE from_date + 1
    END
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.next_todo_occurrence(date, text) IS
  'The next due date for a recurring to-do, advanced from its own due date '
  'rather than from today so a late completion does not make the series drift.';

/**
 * Completing a recurring to-do queues the next one.
 *
 * In the database rather than the route, for the same reason `completed_at` is
 * stamped by a trigger: the guarantee has to hold for every path that ever
 * sets `is_done`, including a future bulk action or a "complete all overdue"
 * that nobody has written yet. A repeat that only continues when one
 * particular endpoint is used is a repeat that quietly stops.
 *
 * AFTER, not BEFORE: the completed row must exist before its successor is
 * written, or a failure halfway leaves the original unticked and a duplicate
 * queued.
 */
CREATE OR REPLACE FUNCTION public.spawn_next_todo_occurrence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  next_due date;
BEGIN
  IF NEW.recurrence IS NULL OR NEW.due_on IS NULL THEN
    RETURN NULL;
  END IF;

  next_due := public.next_todo_occurrence(NEW.due_on, NEW.recurrence);
  IF next_due IS NULL THEN
    RETURN NULL;
  END IF;

  /**
   * Guarded against a duplicate.
   *
   * Un-ticking and re-ticking the same item is an ordinary thing to do by
   * accident, and without this each round trip queues another copy of next
   * week's report.
   */
  IF EXISTS (
    SELECT 1 FROM todos
    WHERE member_id = NEW.member_id
      AND recurrence = NEW.recurrence
      AND due_on = next_due
      AND title = NEW.title
      AND is_done = false
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO todos (
    organization_id, member_id, list_id, title, note,
    due_on, is_starred, sort_order, recurrence
  )
  VALUES (
    NEW.organization_id, NEW.member_id, NEW.list_id, NEW.title, NEW.note,
    next_due, NEW.is_starred, NEW.sort_order, NEW.recurrence
  );

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_spawn_next_todo_occurrence ON todos;
CREATE TRIGGER trg_spawn_next_todo_occurrence
  AFTER UPDATE OF is_done ON todos
  FOR EACH ROW
  WHEN (NEW.is_done AND NOT OLD.is_done)
  EXECUTE FUNCTION public.spawn_next_todo_occurrence();

-- The recurring items a person still owes, which is what the list reads.
CREATE INDEX IF NOT EXISTS idx_todos_member_recurring
  ON todos (member_id, due_on) WHERE recurrence IS NOT NULL AND is_done = false;
