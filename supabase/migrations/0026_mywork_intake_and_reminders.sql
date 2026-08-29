-- ═══════════════════════════════════════════════════════════════════════════
--  0026 - My Work grows a memory, and a way in
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Two capabilities, and one idea underneath both of them: a personal list is
--  only worth keeping if the things you owe *arrive* on it and it *tells you*
--  when they are due. Everything before this migration required the person to
--  do both jobs themselves - retype work assigned to them elsewhere, and
--  remember to look.
--
--  ── 1. Where a to-do came from ────────────────────────────────────────────
--
--  `linked_task_id` has existed since 0016 and does one case well: a project
--  task pinned onto your own list, with a real foreign key, ON DELETE SET
--  NULL, and a live join to the task's status. It is exactly wrong for the
--  four other cases people actually have - a ticket they have been assigned, a
--  deal that needs chasing, a message that turned into a job, a customer to
--  call back - because a foreign key to five different tables is not a foreign
--  key.
--
--  So the general case is a polymorphic reference, the same shape
--  `notifications.entity_type` / `entity_id` has carried since 0004, plus a
--  label captured at the moment of intake.
--
--  **Why the label is stored rather than joined.** Two reasons, and the second
--  is the important one. There is no generic join across five tables. And a
--  to-do must outlive its source: this table's whole design says so already
--  (`ON DELETE SET NULL` on `linked_task_id`, with a comment explaining that
--  silently removing somebody's reminder because a project changed is the
--  surprise it exists to avoid). "Ticket #1043 · Acme Ltd" is what you wrote
--  down; it stays true when the ticket is closed and the row is gone.
--
--  The two mechanisms cannot drift, because a CHECK ties them: a row carrying
--  `linked_task_id` must also name that task in the source triple. One row of
--  truth per case, and a reader of the table alone can always answer "where
--  did this come from?".
--
--  ── 2. Reminders ──────────────────────────────────────────────────────────
--
--  A due date and a reminder are different statements and this table only had
--  the first. `due_on` is *when the work should be done*; `remind_at` is *when
--  I want to be told about it*. They are different types for a reason: the
--  first is a `date`, because "read the contract by Thursday" has no time of
--  day, and the second is a `timestamptz`, because "at 9am" is precisely a
--  time of day and must survive a timezone.
--
--  ── Why this is a database job ────────────────────────────────────────────
--
--  A reminder that only fires while the application happens to be open is not
--  a reminder; it is a badge you find later. The delivery therefore has to
--  happen without a browser, which leaves three options: a new external
--  service, a scheduler in the database, or nothing.
--
--  `pg_cron` is available on this project and is part of the infrastructure
--  the product already runs on, so it is the one that adds no new moving part.
--  The sweep is an ordinary function; the schedule is a caller. That
--  separation matters - where the extension cannot be installed (a local
--  Postgres, a restricted host), the migration still leaves a working
--  `sweep_todo_reminders()` and the application calls it from
--  `/api/todos/reminders/sweep` whenever a signed-in client is present.
--  Reminders then arrive on next use rather than on the minute, which is a
--  degradation the product can describe honestly rather than a silent failure.
--
--  Both callers are safe together: the sweep claims rows by stamping
--  `reminder_sent_at` in the same statement that selects them, so two
--  concurrent sweeps cannot both deliver the same reminder.
--
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. Provenance
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS source_module text,
  ADD COLUMN IF NOT EXISTS source_type   text,
  ADD COLUMN IF NOT EXISTS source_id     uuid,
  ADD COLUMN IF NOT EXISTS source_label  text;

COMMENT ON COLUMN public.todos.source_module IS
  'Which module this to-do was taken from: projects, support, crm, '
  'communication, finance, hr, inventory, calendar, workspace. NULL for a '
  'to-do somebody simply wrote down, which is the common case.';

COMMENT ON COLUMN public.todos.source_type IS
  'The kind of record within that module: task, ticket, deal, lead, message, '
  'invoice. Half of a polymorphic reference - there is deliberately no foreign '
  'key, for the same reason notifications.entity_type has none.';

COMMENT ON COLUMN public.todos.source_label IS
  'What the source was called when it was added, captured rather than joined '
  'so the to-do survives the source being deleted. "Q4 Campaign · Client '
  'Acquisition", "Ticket #1043 · Acme Ltd".';

/**
 * Existing pins already have a source; they just had nowhere to say so.
 *
 * Run before the CHECK below, which would otherwise reject every row written
 * by the pin flow since 0016.
 */
UPDATE todos
   SET source_module = 'projects',
       source_type   = 'task',
       source_id     = linked_task_id
 WHERE linked_task_id IS NOT NULL
   AND source_module IS NULL;

/**
 * All of it, or none of it.
 *
 * A `source_module` with no `source_id` is a claim the UI would draw a chip
 * for and then be unable to open. `source_label` is exempt: a source can
 * legitimately have nothing worth naming.
 */
ALTER TABLE todos DROP CONSTRAINT IF EXISTS todo_source_complete;
ALTER TABLE todos
  ADD CONSTRAINT todo_source_complete CHECK (
    (source_module IS NULL AND source_type IS NULL AND source_id IS NULL)
    OR (source_module IS NOT NULL AND source_type IS NOT NULL AND source_id IS NOT NULL)
  );

/**
 * The two mechanisms name the same thing or the row is refused.
 *
 * Without this, a pinned task could carry `linked_task_id = A` and
 * `source_id = B`, and the screen would draw a chip pointing at one while the
 * live status came from the other. This repository's dominant defect is
 * machinery nothing calls; its close cousin is two fields that are supposed to
 * agree and have no reason to.
 */
ALTER TABLE todos DROP CONSTRAINT IF EXISTS todo_linked_task_matches_source;
ALTER TABLE todos
  ADD CONSTRAINT todo_linked_task_matches_source CHECK (
    linked_task_id IS NULL
    OR (source_module = 'projects' AND source_type = 'task' AND source_id = linked_task_id)
  );

/**
 * One personal item per source, per person.
 *
 * "Add to My Work" is a button somebody will press twice - from the row and
 * again from the detail panel, or on a second day having forgotten. Two
 * personal copies of one assigned ticket is precisely the duplication this
 * feature exists to avoid, and a partial index over the live rows is what lets
 * the endpoint answer "you already have this" instead of creating it.
 *
 * Scoped to open items on purpose: an assignment you dealt with in March and
 * that has come back around is a new thing to do, not a duplicate.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_one_per_source
  ON todos (member_id, source_module, source_type, source_id)
  WHERE source_id IS NOT NULL AND is_done = false;

-- The chips a row draws, and the "is it already on my list?" lookup.
CREATE INDEX IF NOT EXISTS idx_todos_source
  ON todos (source_module, source_id) WHERE source_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  2. Reminders
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS remind_at        timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

COMMENT ON COLUMN public.todos.remind_at IS
  'When to bring this back to the person''s attention. Distinct from due_on: '
  'that is a date with no time of day, this is an instant. NULL means no '
  'reminder, which is the default and the common case.';

COMMENT ON COLUMN public.todos.reminder_sent_at IS
  'When the reminder was delivered. Set by sweep_todo_reminders(), and cleared '
  'by trigger whenever remind_at moves, so a rescheduled reminder fires again.';

/**
 * Moving a reminder re-arms it.
 *
 * Without this, snoozing something that had already reminded you would set a
 * new time and never fire, because the row still carried the stamp from the
 * first delivery. That is the quiet non-behaviour this schema keeps finding:
 * the field accepts the write, and nothing happens.
 *
 * BEFORE, so the cleared stamp is part of the same row version.
 */
CREATE OR REPLACE FUNCTION public.rearm_todo_reminder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.remind_at IS DISTINCT FROM OLD.remind_at THEN
    NEW.reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rearm_todo_reminder ON todos;
CREATE TRIGGER trg_rearm_todo_reminder
  BEFORE UPDATE OF remind_at ON todos
  FOR EACH ROW EXECUTE FUNCTION public.rearm_todo_reminder();

/**
 * The sweep's index.
 *
 * Partial on exactly the predicate the sweep uses, so the per-minute job reads
 * a handful of rows rather than the table. Everything not waiting to be
 * delivered is excluded from the index entirely.
 */
CREATE INDEX IF NOT EXISTS idx_todos_reminder_due
  ON todos (remind_at)
  WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL AND is_done = false;

/**
 * Deliver the reminders that have come due.
 *
 * ── The claim and the delivery are one statement ──────────────────────────
 *
 * The UPDATE selects and stamps in the same breath, and the INSERT reads its
 * RETURNING. Postgres takes a row lock for the UPDATE, so a second sweep
 * running concurrently - the cron job and a client-triggered call landing
 * together - sees the rows already stamped and delivers nothing. Doing it the
 * obvious way round (SELECT, then INSERT, then UPDATE) has a window in which
 * both callers deliver, and a duplicate reminder is worse than a late one.
 *
 * ── Why stale reminders are dropped ───────────────────────────────────────
 *
 * A reminder more than two days overdue is one the scheduler missed while
 * something was down. Delivering it announces "9am Tuesday" on Thursday
 * afternoon, which is noise pretending to be a service - and if the work still
 * matters, it is overdue on the list, where the person can see it. The row is
 * stamped either way, so it does not queue up behind the next restart.
 *
 * SECURITY DEFINER because the caller is either the cron worker or the
 * application's service role; the function is scoped to its own predicate and
 * takes no arguments that could widen it.
 */
CREATE OR REPLACE FUNCTION public.sweep_todo_reminders(limit_rows int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  delivered int;
BEGIN
  WITH claimed AS (
    UPDATE todos
       SET reminder_sent_at = now()
     WHERE id IN (
       SELECT id FROM todos
        WHERE remind_at IS NOT NULL
          AND reminder_sent_at IS NULL
          AND is_done = false
          AND remind_at <= now()
        ORDER BY remind_at
        LIMIT GREATEST(1, LEAST(limit_rows, 2000))
     )
    RETURNING id, organization_id, member_id, title, note, due_on, remind_at
  ), fresh AS (
    SELECT * FROM claimed WHERE remind_at > now() - interval '2 days'
  )
  INSERT INTO notifications (
    organization_id, recipient_id, type, title, body, entity_type, entity_id, link
  )
  SELECT
    organization_id,
    member_id,
    'todo_reminder',
    title,
    COALESCE(
      NULLIF(btrim(note), ''),
      CASE
        WHEN due_on IS NULL THEN 'A reminder from your own list.'
        ELSE 'Due ' || to_char(due_on, 'FMDD FMMon') || '.'
      END
    ),
    'todo',
    id,
    '/dashboard?module=mywork'
  FROM fresh;

  GET DIAGNOSTICS delivered = ROW_COUNT;
  RETURN delivered;
END;
$$;

COMMENT ON FUNCTION public.sweep_todo_reminders(int) IS
  'Turn every to-do reminder that has come due into a notification, exactly '
  'once. Called every minute by pg_cron where it is available, and by '
  '/api/todos/reminders/sweep from the application otherwise.';

/**
 * Executable by any signed-in member, and that is deliberate.
 *
 * The function chooses no recipients: every notification it writes is
 * addressed to the `member_id` already on the to-do, so a sweep triggered by
 * one person cannot route another person's reminder anywhere it was not
 * already going. What a caller can do is make the clock tick, which is exactly
 * what `/api/todos/reminders/sweep` is for on a deployment without `pg_cron`.
 *
 * SECURITY DEFINER is what makes that possible - RLS on `todos` would
 * otherwise hide everybody else's due reminders from the sweep, so a
 * caller-scoped run would deliver only their own and the feature would work
 * only for whoever happened to open the app.
 */
REVOKE ALL ON FUNCTION public.sweep_todo_reminders(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_todo_reminders(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_todo_reminders(int) TO authenticated;

/**
 * A repeat carries its reminder forward.
 *
 * The successor is written by 0022's trigger, which knew nothing about
 * reminders - so a weekly item with a Monday-morning reminder reminded you
 * once, ever, and every occurrence after the first arrived silent. The offset
 * between the reminder and the due date is preserved rather than the clock
 * time recomputed, which is what keeps "the evening before" meaning the
 * evening before.
 *
 * Replaces 0022's version wholesale; everything else about it is unchanged.
 */
CREATE OR REPLACE FUNCTION public.spawn_next_todo_occurrence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  next_due    date;
  next_remind timestamptz;
BEGIN
  IF NEW.recurrence IS NULL OR NEW.due_on IS NULL THEN
    RETURN NULL;
  END IF;

  next_due := public.next_todo_occurrence(NEW.due_on, NEW.recurrence);
  IF next_due IS NULL THEN
    RETURN NULL;
  END IF;

  next_remind := CASE
    WHEN NEW.remind_at IS NULL THEN NULL
    ELSE NEW.remind_at + (next_due - NEW.due_on) * interval '1 day'
  END;

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
    due_on, is_starred, sort_order, recurrence, remind_at,
    source_module, source_type, source_id, source_label
  )
  VALUES (
    NEW.organization_id, NEW.member_id, NEW.list_id, NEW.title, NEW.note,
    next_due, NEW.is_starred, NEW.sort_order, NEW.recurrence, next_remind,
    NEW.source_module, NEW.source_type, NEW.source_id, NEW.source_label
  );

  RETURN NULL;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  3. The schedule
-- ───────────────────────────────────────────────────────────────────────────
--
--  Guarded rather than assumed. `pg_cron` is available on Supabase and on most
--  managed Postgres, and absent on a plain local one - and a migration that
--  refuses to apply because an extension is missing is a migration nobody can
--  run on their laptop. Where it cannot be installed the sweep above still
--  exists and the application still calls it; what is lost is delivery while
--  nobody is signed in, which is a difference the product can state plainly.

DO $$
DECLARE
  have_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
    INTO have_cron;

  IF NOT have_cron THEN
    RAISE NOTICE 'pg_cron is not available here; to-do reminders will be swept by the application instead.';
    RETURN;
  END IF;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron could not be installed (%); to-do reminders will be swept by the application instead.', SQLERRM;
    RETURN;
  END;

  -- Unscheduled first so re-running the migration does not stack duplicate
  -- jobs under the same name.
  BEGIN
    PERFORM cron.unschedule('sweep-todo-reminders');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- no such job yet, which is the ordinary first run
  END;

  /**
   * Every minute.
   *
   * The sweep reads a partial index over the rows actually waiting, so the
   * common case - nothing due - is one index probe. A coarser schedule would
   * make "remind me at 9:00" mean "some time in the next quarter of an hour",
   * and a reminder that is not on time is not a reminder.
   */
  PERFORM cron.schedule(
    'sweep-todo-reminders',
    '* * * * *',
    $job$ SELECT public.sweep_todo_reminders(); $job$
  );

  RAISE NOTICE 'pg_cron: sweep-todo-reminders scheduled every minute.';
END $$;
