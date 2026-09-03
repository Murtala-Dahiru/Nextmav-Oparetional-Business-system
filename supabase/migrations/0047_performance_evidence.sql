-- ═══════════════════════════════════════════════════════════════════════════
--  0047 — Performance evidence: the spine stops being a CRM spine
-- ═══════════════════════════════════════════════════════════════════════════
--
--  `business_events` has carried six event types since 0029 and every one of
--  them is a sale: a deal won, lost or reopened, an invoice paid, a lead
--  qualified or converted. That was right for what it was built for and it is
--  wrong for what the product now claims. "My performance" currently answers
--  "how are your deals going", so a developer, a designer, a support agent and
--  an accountant all open a screen that is permanently empty and correctly
--  conclude the feature is not for them.
--
--  This migration adds the two events that make the spine cross-module, and
--  deliberately stops there.
--
--  ── Why only two ────────────────────────────────────────────────────────
--
--  The temptation is to emit an event for everything that happens anywhere —
--  a check-in, a message, a login — and call the pile "evidence". That is the
--  activity score this work was explicitly told not to build, and it would
--  also break the rule 0029 set: an event exists to *freeze* a fact whose
--  source is editable afterwards.
--
--  That rule is the test, and only two things pass it:
--
--   · `task.completed` — `tasks.due_date` is editable for ever. Reading
--     "finished on time" from the live row lets somebody move a due date in
--     August and turn a task that was three weeks late in March into a task
--     that was early. Whether it was on time is a fact about March, and
--     nothing but an event can hold it.
--
--   · `goal.achieved` — `performance_goals` records *that* a goal reached
--     `achieved` and never *when*. `updated_at` moves when a manager fixes a
--     typo in the title, so the only available date drifts away from the
--     achievement it is supposed to date.
--
--  Everything else the evidence layer reports is read from the table that
--  already owns it, because that table is already authoritative and already
--  bounded by the same visibility rule:
--
--   · attendance      → `attendance_records`, whose corrections are kept by
--                       0046 and which is a *daily* fact. Emitting an event
--                       per check-in would add ~250 rows per person per year
--                       to the spine and create a second answer to "was she
--                       here on Tuesday".
--   · recognition     → `performance_achievements` (`happened_on` is its own
--                       date and is not derived from anything mutable).
--   · reviews         → `performance_reviews.closed_at`, likewise.
--   · project work    → derived from the task events above, which carry
--                       `project_id` and `milestone_id` in their payload.
--
--  A future module contributes evidence by emitting an event through
--  `emit_business_event()` and declaring itself in `lib/evidence.ts`. Neither
--  this file nor the Performance screens need to change for that to work,
--  which is the point of doing it this way rather than adding a column per
--  module.
--
--  ── What is deliberately NOT here ───────────────────────────────────────
--
--  `todos`. My Work is a private list whose RLS has no administrator override
--  on purpose, and turning somebody's private to-dos into evidence a manager
--  can read would quietly revoke that promise. Task evidence comes from
--  `tasks` — the shared tracker, where an assignment is already a statement
--  made to colleagues.
--
--  Idempotent, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. The organisation's clock
-- ───────────────────────────────────────────────────────────────────────────

/**
 * `org_currency()`'s counterpart, and needed for the same reason.
 *
 * "Was this finished on time" compares a `timestamptz` against a `date`, and
 * that comparison has no answer until somebody says which midnight. A task due
 * on the 3rd and completed at 23:40 UTC on the 3rd is on time in Lagos and
 * late in Auckland; picking UTC silently would make the figure wrong for every
 * organisation that is not in it.
 */
CREATE OR REPLACE FUNCTION public.org_timezone(p_org uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT timezone FROM organizations WHERE id = p_org), 'UTC');
$$;

GRANT EXECUTE ON FUNCTION public.org_timezone(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  2. The vocabulary widens
-- ───────────────────────────────────────────────────────────────────────────

/**
 * 0029 chose `text` with a CHECK over an enum precisely so this could happen
 * in an ordinary transactional migration. This is that being cashed in.
 *
 * Dropped and re-added rather than altered, because a CHECK cannot be widened
 * in place. `db:apply` replays every migration from the start, so 0029 will
 * re-create the six-value constraint and this file will widen it again a
 * moment later — which is why the order matters and why this is not written
 * as a conditional.
 */
ALTER TABLE business_events DROP CONSTRAINT IF EXISTS business_events_event_type_check;
ALTER TABLE business_events ADD CONSTRAINT business_events_event_type_check CHECK (
  event_type IN (
    'deal.won', 'deal.lost', 'deal.reopened',
    'invoice.paid',
    'lead.qualified', 'lead.converted',
    'task.completed',
    'goal.achieved'
  )
);

-- ───────────────────────────────────────────────────────────────────────────
--  3. Delivered work
-- ───────────────────────────────────────────────────────────────────────────

/**
 * A task reaching `done`, with the question "was it on time" answered now.
 *
 * AFTER, so `stamp_task_completion()` (0034) has already settled
 * `completed_at` and the timestamp in the idempotency key is the real one.
 *
 * `on_time` is a three-valued answer and the third value carries its weight:
 * NULL means the task never had a due date, which is not the same as being
 * late and must not be averaged in with tasks that did. Roughly half the tasks
 * in a real tracker have no due date, and counting those as failures would
 * make every delivery figure in the product wrong in the same direction.
 *
 * A reopened task that is completed again emits a second event, because it is
 * a second completion — the same reasoning `deal.reopened` was built on.
 */
CREATE OR REPLACE FUNCTION public.emit_task_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  stamp     timestamptz;
  zone      text;
  local_day date;
  punctual  boolean;
  proj_name text;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.status <> 'done' THEN
    RETURN NEW;
  END IF;

  /* Only the transition, not every later edit to a task that is already done. */
  IF TG_OP = 'UPDATE' AND OLD.status = 'done' THEN
    RETURN NEW;
  END IF;

  /**
   * An unassigned task is work nobody is credited with.
   *
   * It is still a real completion for the project, but this spine answers
   * "whose achievement", and a row with a NULL subject is readable only by
   * those who can see the whole organisation. Emitting it would put
   * unattributed rows in front of owners and nobody else, which is noise
   * rather than evidence.
   */
  IF NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  stamp := COALESCE(NEW.completed_at, now());
  zone  := public.org_timezone(NEW.organization_id);

  IF NEW.due_date IS NULL THEN
    punctual := NULL;
  ELSE
    local_day := (stamp AT TIME ZONE zone)::date;
    punctual  := local_day <= NEW.due_date;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    SELECT name INTO proj_name FROM projects WHERE id = NEW.project_id;
  END IF;

  PERFORM public.emit_business_event(
    NEW.organization_id,
    'task.completed',
    NEW.assignee_id,
    'task',
    NEW.id,
    stamp,
    jsonb_build_object(
      'title',        NEW.title,
      'priority',     NEW.priority::text,
      'project_id',   NEW.project_id,
      'project_name', proj_name,
      'milestone_id', NEW.milestone_id,
      'due_date',     NEW.due_date,
      'on_time',      punctual,
      /* Frozen because `estimated_hours` is edited long after the fact. */
      'estimated_hours', NEW.estimated_hours,
      'logged_hours',    NEW.logged_hours,
      'reporter_id',     NEW.reporter_id
    ),
    'task:' || NEW.id || ':completed:' || extract(epoch from stamp)::bigint
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_events ON tasks;
CREATE TRIGGER trg_task_events
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.emit_task_events();

-- ───────────────────────────────────────────────────────────────────────────
--  4. Goals reached
-- ───────────────────────────────────────────────────────────────────────────

/**
 * A goal moving to `achieved`, dated at the moment it did.
 *
 * `missed` is deliberately not an event. A goal that lapses is not a thing
 * that happened on a day — it is a status somebody set, often weeks later
 * during a review, and stamping it with that afternoon's date would put a
 * false date on the record. The goal row itself says it was missed, and the
 * review is where that is discussed.
 */
CREATE OR REPLACE FUNCTION public.emit_goal_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  stamp    timestamptz := now();
  zone     text;
  punctual boolean;
BEGIN
  IF NEW.status <> 'achieved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'achieved' THEN
    RETURN NEW;
  END IF;

  zone := public.org_timezone(NEW.organization_id);

  IF NEW.due_on IS NULL THEN
    punctual := NULL;
  ELSE
    punctual := (stamp AT TIME ZONE zone)::date <= NEW.due_on;
  END IF;

  PERFORM public.emit_business_event(
    NEW.organization_id,
    'goal.achieved',
    NEW.member_id,
    'performance_goal',
    NEW.id,
    stamp,
    jsonb_build_object(
      'title',    NEW.title,
      'kind',     NEW.kind::text,
      'weight',   NEW.weight,
      'cycle_id', NEW.cycle_id,
      'metric',   NEW.metric::text,
      'due_on',   NEW.due_on,
      'on_time',  punctual
    ),
    'goal:' || NEW.id || ':achieved:' || extract(epoch from stamp)::bigint
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_goal_events ON performance_goals;
CREATE TRIGGER trg_goal_events
  AFTER INSERT OR UPDATE ON performance_goals
  FOR EACH ROW EXECUTE FUNCTION public.emit_goal_events();

-- ───────────────────────────────────────────────────────────────────────────
--  5. Backfill
-- ───────────────────────────────────────────────────────────────────────────

/**
 * The work that was already finished when this shipped.
 *
 * Same reasoning as 0029's backfill: without it, every workspace that has been
 * running shows an empty evidence screen on the day this ships, and a person
 * who has closed two hundred tasks reads "no evidence recorded" — which is
 * worse than the CRM-only screen it replaces, because it is not empty by
 * omission but empty by apparent fact.
 *
 * `on_time` is computed here exactly as the trigger computes it, from the same
 * two columns, so a backfilled row and a live one are indistinguishable in
 * meaning. `backfilled: true` is in the payload regardless, because a figure
 * derived partly from reconstructed history should be able to say so.
 *
 * Note what is *not* reconstructed: `completed_at` for tasks finished before
 * 0034 was estimated from `updated_at` by 0034 itself and is marked there. The
 * estimate is inherited rather than compounded.
 */
INSERT INTO business_events (
  organization_id, event_type, event_version, subject_member_id, actor_member_id,
  entity_type, entity_id, occurred_at, payload, idempotency_key
)
SELECT
  t.organization_id, 'task.completed', 1, t.assignee_id, NULL,
  'task', t.id, t.completed_at,
  jsonb_build_object(
    'title',        t.title,
    'priority',     t.priority::text,
    'project_id',   t.project_id,
    'project_name', p.name,
    'milestone_id', t.milestone_id,
    'due_date',     t.due_date,
    'on_time',      CASE
                      WHEN t.due_date IS NULL THEN NULL
                      ELSE (t.completed_at AT TIME ZONE public.org_timezone(t.organization_id))::date <= t.due_date
                    END,
    'estimated_hours', t.estimated_hours,
    'logged_hours',    t.logged_hours,
    'reporter_id',     t.reporter_id,
    'backfilled',      true
  ),
  'task:' || t.id || ':completed:' || extract(epoch from t.completed_at)::bigint
FROM tasks t
LEFT JOIN projects p ON p.id = t.project_id
WHERE t.deleted_at IS NULL
  AND t.status = 'done'
  AND t.completed_at IS NOT NULL
  AND t.assignee_id IS NOT NULL
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

/**
 * Goals already marked achieved.
 *
 * `updated_at` is the only date these have, and it is the one this migration's
 * header calls unreliable. It is used anyway, marked `occurred_at_inferred`,
 * on the same reasoning 0029 used for deals closed before `closed_at` existed:
 * an approximate date that is labelled approximate beats dropping the row.
 */
INSERT INTO business_events (
  organization_id, event_type, event_version, subject_member_id, actor_member_id,
  entity_type, entity_id, occurred_at, payload, idempotency_key
)
SELECT
  g.organization_id, 'goal.achieved', 1, g.member_id, NULL,
  'performance_goal', g.id, g.updated_at,
  jsonb_build_object(
    'title',    g.title,
    'kind',     g.kind::text,
    'weight',   g.weight,
    'cycle_id', g.cycle_id,
    'metric',   g.metric::text,
    'due_on',   g.due_on,
    'on_time',  CASE
                  WHEN g.due_on IS NULL THEN NULL
                  ELSE (g.updated_at AT TIME ZONE public.org_timezone(g.organization_id))::date <= g.due_on
                END,
    'backfilled',            true,
    'occurred_at_inferred',  true
  ),
  'goal:' || g.id || ':achieved:' || extract(epoch from g.updated_at)::bigint
FROM performance_goals g
WHERE g.status = 'achieved'
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
