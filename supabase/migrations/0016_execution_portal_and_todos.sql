-- ═══════════════════════════════════════════════════════════════════════════
--  0016 — Project execution, the client portal, personal to-dos, and the
--         notification fan-out that connects them
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Four things the platform could not express before this migration, plus the
--  event plumbing that makes an action in one module visible in the others.
--
--  1. A roadmap. `milestones` existed but had no notion of a *phase* — every
--     milestone sat in an undifferentiated list, so "Planning → Development →
--     Testing → Review → Deployment" could only be conveyed by naming them
--     that way and hoping. A roadmap is the first thing anyone asks a project
--     for, and the plan is what progress should be measured against.
--
--  2. A client. `projects.client_company_id` has pointed at a company since
--     0003 and `org_role` has included 'client' since 0001, but nothing
--     connected a client *login* to the company it belongs to, and
--     `can_access_module` excludes clients from projects outright. A client
--     user could therefore sign in and see nothing at all.
--
--  3. Somewhere for an employee's own work. `tasks.project_id` is nullable,
--     which was used as "personal task" — but a personal to-do is not a
--     lightweight task, it is a different object. Forcing them into the same
--     table means a private reminder carries a status enum, an assignee, a
--     reporter, estimated and logged hours, a milestone and a sort order in a
--     project plan, and it shows up in every board, filter and report that
--     reads `tasks`. Sections below give them their own home with a
--     deliberately small shape: a title, a checkbox, and optionally a day.
--
--  4. Company holidays. `organizations.work_days` covered weekends, so a
--     public holiday consumed someone's annual leave and appeared on the
--     attendance register as a working day nobody attended.
--
--  Everything here is additive. No column is dropped, no existing default
--  changes, and every new table is empty until something writes to it, so an
--  organization that never opens these features behaves exactly as before.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  1. Company holidays
-- ───────────────────────────────────────────────────────────────────────────
--
--  Separate from `work_days` because the two answer different questions:
--  work_days is a weekly pattern, a holiday is a specific date. Recurring
--  holidays store the date they were first entered and match on month and day,
--  which is right for Christmas and New Year; movable feasts are entered per
--  year, which is the only correct way to record them anyway.

CREATE TABLE IF NOT EXISTS holidays (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  holiday_date    date NOT NULL,
  /** Same month and day every year: Christmas, Independence Day. */
  is_recurring    boolean NOT NULL DEFAULT false,
  /** Half-days exist (Christmas Eve in much of Europe) and are not absences. */
  is_half_day     boolean NOT NULL DEFAULT false,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, holiday_date)
);

COMMENT ON TABLE public.holidays IS
  'Non-working days for an organization, on top of the weekly work_days '
  'pattern. Read by is_working_day(), which the leave and attendance logic '
  'both use — so adding a holiday here immediately stops it consuming leave.';

CREATE INDEX IF NOT EXISTS idx_holidays_org_date
  ON holidays (organization_id, holiday_date);

/**
 * Is this date a working day for this organization?
 *
 * The single answer to that question. `apply_approved_leave` had the weekly
 * pattern inline, which meant a holiday could not be honoured without editing
 * a trigger, and any future caller would have reimplemented the rule slightly
 * differently.
 *
 * A half-day holiday is still a working day — people are expected in — so it
 * returns true. Callers that care about the half are looking at `is_half_day`.
 */
CREATE OR REPLACE FUNCTION public.is_working_day(org uuid, d date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  /**
   * The weekly pattern is tested inside an EXISTS, against the row.
   *
   * `x = ANY (SELECT work_days FROM organizations …)` reads naturally and is
   * wrong: that form treats the subquery as a *set of scalars* to compare
   * against, but `work_days` is one `int[]` value, so Postgres is asked for
   * `integer = integer[]` and refuses. Membership in an array needs
   * `= ANY (array_expression)`, which means having the row in scope — hence
   * the join rather than a scalar subquery.
   *
   * An organization that does not exist yields false: not a working day is the
   * conservative answer, and the foreign keys make it unreachable in practice.
   */
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = org
      AND EXTRACT(DOW FROM d)::int = ANY (o.work_days)
  )
  AND NOT EXISTS (
    SELECT 1 FROM holidays h
    WHERE h.organization_id = org
      AND h.is_half_day = false
      AND (
        h.holiday_date = d
        OR (h.is_recurring
            AND EXTRACT(MONTH FROM h.holiday_date) = EXTRACT(MONTH FROM d)
            AND EXTRACT(DAY   FROM h.holiday_date) = EXTRACT(DAY   FROM d))
      )
  );
$$;

/** Working days in a closed interval, holidays excluded. */
CREATE OR REPLACE FUNCTION public.working_days_between(org uuid, from_date date, to_date date)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::int
  FROM generate_series(from_date, to_date, interval '1 day') AS s(d)
  WHERE public.is_working_day(org, s.d::date);
$$;

GRANT EXECUTE ON FUNCTION public.is_working_day(uuid, date)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.working_days_between(uuid, date, date)    TO authenticated;

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays FORCE ROW LEVEL SECURITY;

-- Everyone needs to know when the office is shut; only admins decide it.
DROP POLICY IF EXISTS holidays_select ON holidays;
CREATE POLICY holidays_select ON holidays FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS holidays_write ON holidays;
CREATE POLICY holidays_write ON holidays FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

/**
 * Leave, respecting the holiday calendar.
 *
 * Replaces the 0004 version. The only change is that the working-day test is
 * now `is_working_day()` rather than an inline check of `work_days`, so a
 * public holiday inside a leave request no longer consumes a day of someone's
 * entitlement or appears on the register as authorised absence.
 *
 * Redefined in full rather than patched because a trigger function cannot be
 * partially replaced, and because the rest of it — the balance upsert, the
 * half-day arithmetic — must keep behaving identically.
 */
CREATE OR REPLACE FUNCTION public.apply_approved_leave()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d    date;
  days numeric := 0;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  d := NEW.start_date;
  WHILE d <= NEW.end_date LOOP
    IF public.is_working_day(NEW.organization_id, d) THEN
      INSERT INTO attendance_records (organization_id, member_id, work_date, status, worked_minutes)
      VALUES (NEW.organization_id, NEW.member_id, d, 'on_leave', 0)
      ON CONFLICT (member_id, work_date) DO UPDATE
        SET status = 'on_leave', worked_minutes = 0;
      days := days + CASE WHEN NEW.is_half_day THEN 0.5 ELSE 1 END;
    END IF;
    d := d + 1;
  END LOOP;

  UPDATE leave_requests SET days_requested = days WHERE id = NEW.id;

  INSERT INTO leave_balances (organization_id, member_id, type, year, used_days)
  VALUES (NEW.organization_id, NEW.member_id, NEW.type, EXTRACT(YEAR FROM NEW.start_date)::int, days)
  ON CONFLICT (member_id, type, year)
  DO UPDATE SET used_days = leave_balances.used_days + days, updated_at = now();

  RETURN NEW;
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
--  2. The roadmap
-- ───────────────────────────────────────────────────────────────────────────
--
--  A milestone gains the phase it belongs to, when it started, and its own
--  progress. `stage` is text with a CHECK rather than an enum: an organization
--  will eventually want its own phase names, and widening a CHECK is a
--  migration while adding a value to an enum used in a stored generated column
--  is a considerably worse one.

ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'planning';

ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS start_date date;

ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS progress_pct int NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestones_stage_valid') THEN
    ALTER TABLE public.milestones ADD CONSTRAINT milestones_stage_valid
      CHECK (stage IN ('planning','development','testing','review','deployment','completed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestones_progress_valid') THEN
    ALTER TABLE public.milestones ADD CONSTRAINT milestones_progress_valid
      CHECK (progress_pct BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestones_dates_valid') THEN
    ALTER TABLE public.milestones ADD CONSTRAINT milestones_dates_valid
      CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date);
  END IF;
END $$;

COMMENT ON COLUMN public.milestones.stage IS
  'Which phase of delivery this milestone belongs to. Groups the roadmap; the '
  'ordering of phases lives in the application, not here, because it is a '
  'presentation decision.';

COMMENT ON COLUMN public.milestones.progress_pct IS
  'Manually reported progress for a phase whose tasks do not tell the whole '
  'story. Advisory: v_project_health still counts completed milestones, '
  'because a phase reported at 90% for a month is exactly the case a status '
  'report must not smooth over.';

CREATE INDEX IF NOT EXISTS idx_milestones_project_stage
  ON milestones (project_id, stage, sort_order);

/**
 * Completing a milestone puts it in the final phase.
 *
 * Without this a roadmap ends up with milestones ticked complete while still
 * grouped under "Testing", and the phase columns stop meaning anything. The
 * reverse holds too: reopening one moves it back out of 'completed', because a
 * reopened phase is emphatically not complete.
 */
CREATE OR REPLACE FUNCTION public.sync_milestone_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND (OLD.completed_at IS NULL OR TG_OP = 'INSERT') THEN
    NEW.stage := 'completed';
    NEW.progress_pct := 100;
  ELSIF NEW.completed_at IS NULL AND OLD.completed_at IS NOT NULL THEN
    -- Reopened. Back to review rather than planning: the work happened.
    IF NEW.stage = 'completed' THEN NEW.stage := 'review'; END IF;
    IF NEW.progress_pct = 100 THEN NEW.progress_pct := 90; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_milestone_stage ON milestones;
CREATE TRIGGER trg_sync_milestone_stage
  BEFORE UPDATE OF completed_at ON milestones
  FOR EACH ROW EXECUTE FUNCTION public.sync_milestone_stage();

/**
 * Project health, now with a named verdict and the blockers behind it.
 *
 * `is_at_risk` was a boolean, which cannot distinguish "one task slipped" from
 * "the deadline passed a month ago and half the plan is blocked". A status
 * report needs the difference, and so does the client portal — which shows
 * this to the customer and must not describe a late project as fine.
 *
 * Every column the previous version had is still here with the same meaning,
 * so the projects endpoint and the reports keep working untouched.
 */
-- CASCADE: see the note in 0007. v_client_portal_projects (0016) depends on
-- this view, and is recreated by 0016 after this runs.
DROP VIEW IF EXISTS public.v_project_health CASCADE;

CREATE OR REPLACE VIEW public.v_project_health
WITH (security_invoker = true) AS
SELECT
  p.organization_id,
  p.id                                        AS project_id,
  p.name,
  p.status,
  p.priority,
  p.budget,
  p.start_date,
  p.end_date,

  COUNT(DISTINCT t.id)                        AS total_tasks,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done')     AS completed_tasks,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'blocked')  AS blocked_tasks,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.due_date < CURRENT_DATE AND t.status <> 'done'
  )                                           AS overdue_tasks,

  COUNT(DISTINCT m.id)                        AS total_milestones,
  COUNT(DISTINCT m.id) FILTER (WHERE m.completed_at IS NOT NULL) AS completed_milestones,
  COUNT(DISTINCT m.id) FILTER (
    WHERE m.due_date < CURRENT_DATE AND m.completed_at IS NULL
  )                                           AS overdue_milestones,

  CASE
    WHEN COUNT(DISTINCT m.id) > 0 THEN
      ROUND(
        COUNT(DISTINCT m.id) FILTER (WHERE m.completed_at IS NOT NULL)::numeric
        / COUNT(DISTINCT m.id) * 100, 1)
    WHEN COUNT(DISTINCT t.id) > 0 THEN
      ROUND(
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done')::numeric
        / COUNT(DISTINCT t.id) * 100, 1)
    ELSE 0
  END                                         AS progress_pct,

  (p.end_date - CURRENT_DATE)                 AS days_remaining,
  COALESCE(SUM(DISTINCT t.logged_hours), 0)   AS logged_hours,

  -- How many people are on it, so the board can show a team without a join.
  (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,

  (
    (p.end_date < CURRENT_DATE AND p.status NOT IN ('completed', 'cancelled', 'archived'))
    OR COUNT(DISTINCT t.id) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status <> 'done') > 0
    OR COUNT(DISTINCT m.id) FILTER (WHERE m.due_date < CURRENT_DATE AND m.completed_at IS NULL) > 0
    OR COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'blocked') > 0
  )                                           AS is_at_risk,

  /**
   * The verdict, in three grades.
   *
   *   off_track — the end date has passed, or a phase is overdue. Something
   *               someone committed to has already been missed.
   *   at_risk   — nothing missed yet, but work is overdue or blocked.
   *   on_track  — neither.
   *
   * A finished project is never at risk, however late its remaining tasks
   * look; closing it is the answer to those.
   */
  CASE
    WHEN p.status IN ('completed', 'cancelled', 'archived') THEN 'on_track'
    WHEN p.end_date < CURRENT_DATE
      OR COUNT(DISTINCT m.id) FILTER (WHERE m.due_date < CURRENT_DATE AND m.completed_at IS NULL) > 0
      THEN 'off_track'
    WHEN COUNT(DISTINCT t.id) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status <> 'done') > 0
      OR COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'blocked') > 0
      THEN 'at_risk'
    ELSE 'on_track'
  END                                         AS health

FROM projects p
LEFT JOIN tasks t
  ON t.project_id = p.id AND t.deleted_at IS NULL
LEFT JOIN milestones m
  ON m.project_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.organization_id, p.name, p.status, p.priority,
         p.budget, p.start_date, p.end_date;

COMMENT ON VIEW public.v_project_health IS
  'One row per live project with its task and milestone counts, progress, '
  'time remaining, team size and a three-grade health verdict. The single '
  'definition of "progress" and "health" — read by the projects endpoint, the '
  'reports and the client portal, so none of them can disagree.';


-- ───────────────────────────────────────────────────────────────────────────
--  3. Project discussions and deliverables
-- ───────────────────────────────────────────────────────────────────────────
--
--  `comments` already has `project_id` and `files` already has `project_id`;
--  both were unreachable because no endpoint read them and, for comments, the
--  RLS policy was generated under the 'workspace' module — so an employee with
--  project access but no workspace access could not comment on their own
--  project, and a client never could.

/**
 * Whether a file may be shown outside the company.
 *
 * Defaults to false, which is the only safe default: a deliverable is
 * published deliberately, and a project's internal working files vastly
 * outnumber the ones a client should see.
 */
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS is_client_visible boolean NOT NULL DEFAULT false;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS folder text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.files.is_client_visible IS
  'Published to the client portal. False by default — a deliverable is shared '
  'on purpose, never by omission.';

COMMENT ON COLUMN public.files.folder IS
  'Slash-delimited path within a project''s files, e.g. "designs/final". Text '
  'rather than a folder table because a project''s file tree is small, is '
  'renamed wholesale more often than restructured, and needs no identity of '
  'its own.';

CREATE INDEX IF NOT EXISTS idx_files_project_visible
  ON files (project_id, is_client_visible) WHERE deleted_at IS NULL;

/**
 * A comment can be addressed to the client.
 *
 * The same thread serves both audiences: an internal note and a message to
 * the customer belong in one chronology, or the team ends up reading two
 * histories of the same project. Mirrors `ticket_comments.is_internal`, which
 * already works this way — but inverted, because internal is the default here.
 */
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS is_client_visible boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_comments_project
  ON comments (project_id, created_at) WHERE deleted_at IS NULL;

-- Comments on a project follow the project, not the wiki. Replaces the
-- generated 'workspace' policy for the project case.
DROP POLICY IF EXISTS comments_select ON comments;
CREATE POLICY comments_select ON comments FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      -- Internal readers: whichever module the comment hangs off.
      (project_id IS NOT NULL AND public.can_access_module(organization_id, 'projects'))
      OR (task_id    IS NOT NULL AND public.can_access_module(organization_id, 'projects'))
      OR (page_id    IS NOT NULL AND public.can_access_module(organization_id, 'workspace'))
      OR (deal_id    IS NOT NULL AND public.can_access_module(organization_id, 'crm'))
      OR (ticket_id  IS NOT NULL AND public.can_access_module(organization_id, 'support'))
      OR (project_id IS NULL AND task_id IS NULL AND page_id IS NULL
          AND deal_id IS NULL AND ticket_id IS NULL
          AND public.can_access_module(organization_id, 'workspace'))
    )
  );

-- INSERT policies take WITH CHECK only; a USING clause on one is a syntax
-- error ("only WITH CHECK expression allowed for INSERT"), since there is no
-- existing row to test.
DROP POLICY IF EXISTS comments_insert ON comments;
CREATE POLICY comments_insert ON comments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    -- You may only post as yourself. Without this, any member could author a
    -- comment under a colleague's name.
    AND author_id = public.auth_member_id(organization_id)
  );

DROP POLICY IF EXISTS comments_update ON comments;
CREATE POLICY comments_update ON comments FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND author_id = public.auth_member_id(organization_id)
  )
  WITH CHECK (author_id = public.auth_member_id(organization_id));

-- Authors retract their own; admins moderate.
DROP POLICY IF EXISTS comments_delete ON comments;
CREATE POLICY comments_delete ON comments FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (author_id = public.auth_member_id(organization_id)
         OR public.is_org_admin(organization_id))
  );


-- ───────────────────────────────────────────────────────────────────────────
--  4. Personal to-dos
-- ───────────────────────────────────────────────────────────────────────────
--
--  Deliberately not `tasks`, and deliberately smaller than `tasks`.
--
--  A project task is work the organization is tracking: it has an assignee, a
--  reporter, a status the team agreed on, an estimate, a place in a plan, and
--  it appears in reports. A to-do is a private note somebody wrote to
--  themselves — "call the client back", "read the contract". Modelling the
--  second as a degenerate case of the first is what produces software where
--  ticking off "buy milk" moves a burndown chart.
--
--  So: no assignee (they are always yours), no status enum (done or not), no
--  estimate, no logged hours, no milestone, no reporter, no soft delete. What
--  is left is a title, a checkbox, and optionally a day and a list.
--
--  The one connection is `linked_task_id`: an employee can pin an assigned
--  project task onto their own list to plan their day, without the to-do
--  becoming that task or vice versa.

CREATE TABLE IF NOT EXISTS todo_lists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  /** Whose list. There is no sharing: a list belongs to one person, always. */
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  /** A colour key resolved by the client, not a CSS value. */
  color           text NOT NULL DEFAULT 'slate',
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, name)
);

COMMENT ON TABLE public.todo_lists IS
  'A person''s own groupings for their to-dos ("Today", "Follow-ups"). Never '
  'shared, never assigned, invisible to everyone else including admins.';

CREATE TABLE IF NOT EXISTS todos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  /** Nullable: an unfiled to-do is the common case and must not need a list. */
  list_id         uuid REFERENCES todo_lists(id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  note            text NOT NULL DEFAULT '',
  is_done         boolean NOT NULL DEFAULT false,
  completed_at    timestamptz,
  /** A day, not a timestamp: "Thursday" is how people schedule their own work. */
  due_on          date,
  is_starred      boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  /**
   * Optionally points at a project task this to-do is about.
   *
   * SET NULL rather than CASCADE: if the task is deleted the personal reminder
   * is still the person's own note, and silently removing something from
   * somebody's list because a project changed is exactly the surprise this
   * table exists to avoid.
   */
  linked_task_id  uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.todos IS
  'Private personal to-dos. Intentionally not `tasks`: no assignee, no status '
  'vocabulary, no estimates, no place in a project plan, and invisible to '
  'reports. Ticking one off must never move a project metric.';

CREATE INDEX IF NOT EXISTS idx_todos_member_open
  ON todos (member_id, sort_order) WHERE is_done = false;
CREATE INDEX IF NOT EXISTS idx_todos_member_due
  ON todos (member_id, due_on) WHERE is_done = false;
CREATE INDEX IF NOT EXISTS idx_todos_list
  ON todos (list_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_todo_lists_member
  ON todo_lists (member_id, sort_order);

/** The checkbox stamps the time; a client must not choose when it happened. */
CREATE OR REPLACE FUNCTION public.stamp_todo_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_done AND (TG_OP = 'INSERT' OR NOT OLD.is_done) THEN
    NEW.completed_at := now();
  ELSIF NOT NEW.is_done THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_todo_completion ON todos;
CREATE TRIGGER trg_stamp_todo_completion
  BEFORE INSERT OR UPDATE OF is_done ON todos
  FOR EACH ROW EXECUTE FUNCTION public.stamp_todo_completion();

DROP TRIGGER IF EXISTS trg_set_updated_at ON todos;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON todo_lists;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON todo_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON holidays;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE todos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos      FORCE  ROW LEVEL SECURITY;
ALTER TABLE todo_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_lists FORCE  ROW LEVEL SECURITY;

/**
 * Yours and only yours.
 *
 * Note there is no administrator exception, unlike every other table in this
 * schema. An owner can read the company's finances and every employee's HR
 * file, because those are company records. A private checklist is not, and a
 * personal to-do list that a manager can read is one nobody will use honestly
 * — which makes the feature worthless rather than merely intrusive.
 */
DROP POLICY IF EXISTS todos_own ON todos;
CREATE POLICY todos_own ON todos FOR ALL TO authenticated
  USING (member_id = public.auth_member_id(organization_id))
  WITH CHECK (member_id = public.auth_member_id(organization_id));

DROP POLICY IF EXISTS todo_lists_own ON todo_lists;
CREATE POLICY todo_lists_own ON todo_lists FOR ALL TO authenticated
  USING (member_id = public.auth_member_id(organization_id))
  WITH CHECK (member_id = public.auth_member_id(organization_id));


-- ───────────────────────────────────────────────────────────────────────────
--  5. The client portal
-- ───────────────────────────────────────────────────────────────────────────
--
--  A client login is an `organization_members` row with role 'client', which
--  already existed — but nothing tied it to a customer record, so the system
--  had no way to answer "which projects are this person's?". That link is the
--  whole portal: everything a client sees is derived from it.

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS client_company_id uuid
    REFERENCES companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.organization_members.client_company_id IS
  'For role = client: the customer this login represents. Everything the '
  'portal shows is scoped through this one column, so leaving it null means a '
  'client sees nothing — the safe failure.';

CREATE INDEX IF NOT EXISTS idx_org_members_client_company
  ON organization_members (client_company_id) WHERE client_company_id IS NOT NULL;

/**
 * The company a client login speaks for. NULL for employees.
 *
 * SECURITY DEFINER for the same reason as every other helper here: policies
 * that query `organization_members` directly recurse against its own policy.
 */
CREATE OR REPLACE FUNCTION public.auth_client_company_id(org uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT client_company_id FROM organization_members
  WHERE user_id = auth.uid() AND organization_id = org
    AND is_active = true AND role = 'client'
  LIMIT 1;
$$;

/** Is this project the caller's, as a client? False for every employee. */
CREATE OR REPLACE FUNCTION public.is_client_project(proj uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = proj
      AND p.deleted_at IS NULL
      AND p.client_company_id IS NOT NULL
      AND p.client_company_id = public.auth_client_company_id(p.organization_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_client_company_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_project(uuid)      TO authenticated;

/**
 * Announcements: the one thing the organization pushes at people rather than
 * them going to look for it.
 *
 * `audience` decides who: staff, clients, or both. A client-facing
 * announcement is how "we are closed next Monday" reaches a customer without
 * anybody writing an email, and it is the portal's news feed.
 */
CREATE TABLE IF NOT EXISTS announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  body            text NOT NULL DEFAULT '',
  audience        text NOT NULL DEFAULT 'staff'
                    CHECK (audience IN ('staff', 'clients', 'everyone')),
  /** Optional narrowing: an announcement about one project, not the company. */
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  is_pinned       boolean NOT NULL DEFAULT false,
  published_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  author_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_org_time
  ON announcements (organization_id, published_at DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_set_updated_at ON announcements;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcements_select ON announcements;
CREATE POLICY announcements_select ON announcements FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND deleted_at IS NULL
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      CASE
        WHEN public.auth_role_in(organization_id) = 'client'
          THEN audience IN ('clients', 'everyone')
               -- A project-specific notice only reaches that project's client.
               AND (project_id IS NULL OR public.is_client_project(project_id))
        ELSE audience IN ('staff', 'everyone')
      END
    )
  );

DROP POLICY IF EXISTS announcements_write ON announcements;
CREATE POLICY announcements_write ON announcements FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- ── Client read access ────────────────────────────────────────────────────
--
--  `can_access_module` excludes clients from projects, and correctly so: a
--  client must never reach the projects module. These policies are additive
--  and narrower — SELECT only, one company's projects only, and never the
--  internal task list.

DROP POLICY IF EXISTS projects_client_select ON projects;
CREATE POLICY projects_client_select ON projects FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND client_company_id IS NOT NULL
    AND client_company_id = public.auth_client_company_id(organization_id)
  );

/**
 * A client may read the company record that *is* them.
 *
 * Easy to miss, and it broke the whole portal. The generated `companies_select`
 * policy requires `can_access_module(organization_id, 'crm')`, and a client has
 * no CRM access — correctly, since the CRM is the company's sales pipeline. But
 * that also denied them the one row describing themselves, so the portal
 * endpoint resolved their company id, failed to read the row, and returned
 * "That client does not exist in this organization" — a 404 that looked like
 * the link had not been made, when it had.
 *
 * Exactly one row: the company this login is attached to. Not the customer
 * list, not sibling companies.
 */
DROP POLICY IF EXISTS companies_client_select ON companies;
CREATE POLICY companies_client_select ON companies FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND id = public.auth_client_company_id(organization_id)
  );

/**
 * The roadmap is the client-facing artefact.
 *
 * Milestones are what a customer was promised, so the whole plan is visible —
 * including phases that are late. Hiding those would make the portal a
 * marketing page rather than a status report, and the client finds out anyway.
 */
DROP POLICY IF EXISTS milestones_client_select ON milestones;
CREATE POLICY milestones_client_select ON milestones FOR SELECT TO authenticated
  USING (public.is_client_project(project_id));

-- Published deliverables only. Confidential files are excluded twice over.
DROP POLICY IF EXISTS files_client_select ON files;
CREATE POLICY files_client_select ON files FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_client_visible = true
    AND is_confidential = false
    AND project_id IS NOT NULL
    AND public.is_client_project(project_id)
  );

-- Messages addressed to the client, on their own projects.
DROP POLICY IF EXISTS comments_client_select ON comments;
CREATE POLICY comments_client_select ON comments FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_client_visible = true
    AND project_id IS NOT NULL
    AND public.is_client_project(project_id)
  );

/**
 * A client may reply on their own project.
 *
 * Insert-only, always client-visible, and always authored as themselves — so
 * the portal is a conversation rather than a noticeboard, without giving an
 * external account any way to write into internal threads.
 */
DROP POLICY IF EXISTS comments_client_insert ON comments;
CREATE POLICY comments_client_insert ON comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = public.auth_member_id(organization_id)
    AND is_client_visible = true
    AND project_id IS NOT NULL
    AND public.is_client_project(project_id)
    AND task_id IS NULL AND page_id IS NULL AND deal_id IS NULL AND ticket_id IS NULL
  );

/**
 * Their own invoices.
 *
 * Drafts are excluded: an unsent invoice is an internal working document, and
 * showing a customer a figure before anybody agreed to send it is how a
 * portal creates a dispute out of nothing.
 */
DROP POLICY IF EXISTS invoices_client_select ON invoices;
CREATE POLICY invoices_client_select ON invoices FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND status <> 'draft'
    AND company_id IS NOT NULL
    AND company_id = public.auth_client_company_id(organization_id)
  );

DROP POLICY IF EXISTS invoice_line_items_client_select ON invoice_line_items;
CREATE POLICY invoice_line_items_client_select ON invoice_line_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_id
      AND i.status <> 'draft'
      AND i.company_id IS NOT NULL
      AND i.company_id = public.auth_client_company_id(i.organization_id)
  ));

/**
 * Their own project's calendar.
 *
 * Meeting history is one of the things a client portal is genuinely useful
 * for — "when did we last speak" should not require asking.
 */
DROP POLICY IF EXISTS calendar_events_client_select ON calendar_events;
CREATE POLICY calendar_events_client_select ON calendar_events FOR SELECT TO authenticated
  USING (
    project_id IS NOT NULL
    AND public.is_client_project(project_id)
  );

/**
 * Everything the portal shows about a project, in one row.
 *
 * A view rather than a query in the route so the portal and any future report
 * agree on what "a client's project" means, and so the client-visible column
 * list is written down in exactly one place. `security_invoker` means the
 * policies above still apply — a client reading this view gets their own
 * projects and an employee gets whatever they could see anyway.
 */
CREATE OR REPLACE VIEW public.v_client_portal_projects
WITH (security_invoker = true) AS
SELECT
  p.organization_id,
  p.id                    AS project_id,
  p.name,
  p.description,
  p.status,
  p.start_date,
  p.end_date,
  p.client_company_id,
  c.name                  AS client_name,
  h.progress_pct,
  h.health,
  h.total_milestones,
  h.completed_milestones,
  h.overdue_milestones,
  h.days_remaining,
  -- Deliberately not task counts: a client is shown the plan, not the backlog.
  (SELECT COUNT(*) FROM files f
     WHERE f.project_id = p.id AND f.deleted_at IS NULL
       AND f.is_client_visible AND NOT f.is_confidential) AS deliverable_count,
  (SELECT COUNT(*) FROM comments cm
     WHERE cm.project_id = p.id AND cm.deleted_at IS NULL
       AND cm.is_client_visible)                          AS message_count,
  owner_p.full_name       AS owner_name,
  owner_p.avatar_url      AS owner_avatar_url
FROM projects p
LEFT JOIN companies c              ON c.id = p.client_company_id
LEFT JOIN v_project_health h       ON h.project_id = p.id
LEFT JOIN organization_members owm ON owm.id = p.owner_id
LEFT JOIN profiles owner_p         ON owner_p.id = owm.user_id
WHERE p.deleted_at IS NULL
  AND p.client_company_id IS NOT NULL;

COMMENT ON VIEW public.v_client_portal_projects IS
  'The client-facing shape of a project: plan, progress, health, deliverable '
  'and message counts. Excludes task counts and budget by design — the '
  'portal is a status report, not a window into internal execution.';


-- ───────────────────────────────────────────────────────────────────────────
--  6. Notification fan-out
-- ───────────────────────────────────────────────────────────────────────────
--
--  Three notifications existed: task assignment, leave decision, and message
--  mentions. Everything else happened silently, which is what makes a suite of
--  modules feel like separate applications — you find out an invoice was
--  raised by going to look at invoices.
--
--  Recipients are resolved by role or relationship, in the database, so the
--  rule holds no matter which client performs the write. Two conventions
--  throughout: never notify the actor about their own action, and never let a
--  failing notification abort the business write that triggered it.

/**
 * Deliver to a set of members, skipping the actor and de-duplicating.
 *
 * Takes an array rather than being called per recipient so a single INSERT
 * covers a team, and so "and not the person who did it" is expressed once.
 */
CREATE OR REPLACE FUNCTION public.notify_members(
  org         uuid,
  recipients  uuid[],
  ntype       text,
  ntitle      text,
  nbody       text DEFAULT '',
  etype       text DEFAULT NULL,
  eid         uuid DEFAULT NULL,
  nlink       text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor    uuid := public.auth_member_id(org);
  inserted int  := 0;
BEGIN
  IF recipients IS NULL OR array_length(recipients, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH targets AS (
    SELECT DISTINCT r AS recipient_id
    FROM unnest(recipients) AS r
    WHERE r IS NOT NULL
      AND (actor IS NULL OR r <> actor)
      -- A membership that has been removed or deactivated is not a mailbox.
      AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.id = r AND om.organization_id = org AND om.is_active = true
      )
  ),
  ins AS (
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    SELECT org, recipient_id, ntype, ntitle, COALESCE(nbody, ''), etype, eid, nlink
    FROM targets
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO inserted FROM ins;

  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_members(uuid, uuid[], text, text, text, text, uuid, text)
  TO authenticated;

/** Members holding any of these roles — the audience for a role-based event. */
CREATE OR REPLACE FUNCTION public.members_with_roles(org uuid, roles org_role[])
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  FROM organization_members
  WHERE organization_id = org AND is_active = true AND role = ANY (roles);
$$;

/** Everyone attached to a project: its owner plus its team. */
CREATE OR REPLACE FUNCTION public.project_audience(proj uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT m), ARRAY[]::uuid[])
  FROM (
    SELECT owner_id AS m FROM projects WHERE id = proj AND owner_id IS NOT NULL
    UNION
    SELECT member_id    FROM project_members WHERE project_id = proj
  ) s
  WHERE m IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.members_with_roles(uuid, org_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_audience(uuid)               TO authenticated;

-- ── Projects ──────────────────────────────────────────────────────────────

/**
 * A project's status or dates changed.
 *
 * Only these two: a project record is edited constantly — description,
 * budget, priority — and notifying the team each time trains everyone to
 * ignore the bell. A status change and a moved deadline are the two edits that
 * change what other people should do.
 */
CREATE OR REPLACE FUNCTION public.notify_project_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.notify_members(
      NEW.organization_id, public.project_audience(NEW.id),
      'project_status',
      NEW.name || ' is now ' || replace(NEW.status::text, '_', ' '),
      'The project status changed from ' || replace(OLD.status::text, '_', ' ') || '.',
      'project', NEW.id, '/dashboard?module=projects&project=' || NEW.id
    );
  END IF;

  IF NEW.end_date IS DISTINCT FROM OLD.end_date AND NEW.end_date IS NOT NULL THEN
    PERFORM public.notify_members(
      NEW.organization_id, public.project_audience(NEW.id),
      'project_deadline',
      'Deadline moved on ' || NEW.name,
      'The end date is now ' || to_char(NEW.end_date, 'DD Mon YYYY') || '.',
      'project', NEW.id, '/dashboard?module=projects&project=' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_project_change ON projects;
CREATE TRIGGER trg_notify_project_change
  AFTER UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_change();

-- ── Tasks ─────────────────────────────────────────────────────────────────

/**
 * Work finished, or got stuck.
 *
 * Told to whoever raised it and whoever owns the project — the people waiting
 * on it. `blocked` matters as much as `done`: a blocked task that nobody is
 * told about is the single most common way a deadline is missed quietly.
 *
 * Personal tasks (no project) are excluded: nobody needs an alert that they
 * finished their own note to themselves.
 */
CREATE OR REPLACE FUNCTION public.notify_task_progress()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  audience uuid[];
BEGIN
  IF NEW.project_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'done' THEN
    audience := ARRAY[NEW.reporter_id] || public.project_audience(NEW.project_id);
    PERFORM public.notify_members(
      NEW.organization_id, audience, 'task_completed',
      'Completed: ' || NEW.title, '',
      'task', NEW.id, '/dashboard?module=projects&task=' || NEW.id
    );
  ELSIF NEW.status = 'blocked' THEN
    audience := ARRAY[NEW.reporter_id] || public.project_audience(NEW.project_id);
    PERFORM public.notify_members(
      NEW.organization_id, audience, 'task_blocked',
      'Blocked: ' || NEW.title,
      'This task cannot proceed and needs attention.',
      'task', NEW.id, '/dashboard?module=projects&task=' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_progress ON tasks;
CREATE TRIGGER trg_notify_task_progress
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_progress();

-- ── Leave ─────────────────────────────────────────────────────────────────

/**
 * A leave request needs somebody to look at it.
 *
 * 0004 notified the employee of the *decision* but nothing told the approver a
 * request existed, so approval depended on someone opening the HR module
 * speculatively. Routed to the requester's own manager where there is one, and
 * to HR either way — a request that reaches nobody is the failure mode here.
 */
CREATE OR REPLACE FUNCTION public.notify_leave_requested()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requester_name text;
  approvers      uuid[];
  mgr            uuid;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT p.full_name, om.manager_id INTO requester_name, mgr
  FROM organization_members om
  JOIN profiles p ON p.id = om.user_id
  WHERE om.id = NEW.member_id;

  approvers := public.members_with_roles(
    NEW.organization_id, ARRAY['owner','administrator','hr_staff']::org_role[]);
  IF mgr IS NOT NULL THEN approvers := approvers || mgr; END IF;

  PERFORM public.notify_members(
    NEW.organization_id, approvers, 'leave_requested',
    COALESCE(requester_name, 'An employee') || ' requested leave',
    replace(NEW.type::text, '_', ' ') || ' from '
      || to_char(NEW.start_date, 'DD Mon') || ' to '
      || to_char(NEW.end_date, 'DD Mon YYYY') || '.',
    'leave_request', NEW.id, '/dashboard?module=hr&tab=leave'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_leave_requested ON leave_requests;
CREATE TRIGGER trg_notify_leave_requested
  AFTER INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_leave_requested();

-- ── Finance ───────────────────────────────────────────────────────────────

/**
 * Money moved.
 *
 * Sending an invoice and being paid for it are both events finance needs
 * without going to look, and the owner cares about the second. Draft creation
 * is not an event — it is somebody typing.
 */
CREATE OR REPLACE FUNCTION public.notify_invoice_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  finance uuid[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  finance := public.members_with_roles(
    NEW.organization_id, ARRAY['owner','administrator','finance_staff']::org_role[]);
  IF NEW.owner_id IS NOT NULL THEN finance := finance || NEW.owner_id; END IF;

  IF NEW.status = 'paid' THEN
    PERFORM public.notify_members(
      NEW.organization_id, finance, 'invoice_paid',
      'Invoice ' || NEW.invoice_number || ' paid',
      'Settled in full: ' || NEW.currency || ' ' || to_char(NEW.total, 'FM999,999,999.00') || '.',
      'invoice', NEW.id, '/dashboard?module=finance&invoice=' || NEW.id
    );
  ELSIF NEW.status = 'sent' AND OLD.status = 'draft' THEN
    PERFORM public.notify_members(
      NEW.organization_id, finance, 'invoice_sent',
      'Invoice ' || NEW.invoice_number || ' sent',
      NEW.currency || ' ' || to_char(NEW.total, 'FM999,999,999.00') || ' is now outstanding.',
      'invoice', NEW.id, '/dashboard?module=finance&invoice=' || NEW.id
    );
  ELSIF NEW.status = 'overdue' THEN
    PERFORM public.notify_members(
      NEW.organization_id, finance, 'invoice_overdue',
      'Invoice ' || NEW.invoice_number || ' is overdue',
      'Payment was due on ' || to_char(NEW.due_date, 'DD Mon YYYY') || '.',
      'invoice', NEW.id, '/dashboard?module=finance&invoice=' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_invoice_change ON invoices;
CREATE TRIGGER trg_notify_invoice_change
  AFTER UPDATE OF status ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_change();

/** An expense claim waiting on somebody. Same reasoning as leave. */
CREATE OR REPLACE FUNCTION public.notify_expense_submitted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimant text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  /**
   * The claimant is `submitted_by`, not `member_id`.
   *
   * `expenses` has no `member_id` column — the earlier draft of this trigger
   * assumed one by analogy with `leave_requests`, and because a trigger
   * function's body is not resolved until it fires, that mistake compiled
   * cleanly and then made *every* expense insert fail at runtime with a 500.
   * Nothing short of actually creating an expense would have caught it.
   */
  SELECT p.full_name INTO claimant
  FROM organization_members om JOIN profiles p ON p.id = om.user_id
  WHERE om.id = NEW.submitted_by;

  PERFORM public.notify_members(
    NEW.organization_id,
    public.members_with_roles(NEW.organization_id,
      ARRAY['owner','administrator','finance_staff']::org_role[]),
    'expense_submitted',
    COALESCE(NULLIF(btrim(claimant), ''), 'An employee') || ' submitted an expense',
    NEW.category || ': ' || to_char(NEW.amount, 'FM999,999,999.00'),
    'expense', NEW.id, '/dashboard?module=finance&tab=expenses'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_expense_submitted ON expenses;
CREATE TRIGGER trg_notify_expense_submitted
  AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.notify_expense_submitted();

-- ── Support ───────────────────────────────────────────────────────────────

/**
 * A ticket was assigned, resolved, or someone replied.
 *
 * The requester is told when their ticket is resolved — the one notification a
 * customer actually wants — and the assignee is told when it lands on them.
 */
CREATE OR REPLACE FUNCTION public.notify_ticket_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id AND NEW.assignee_id IS NOT NULL THEN
    PERFORM public.notify_members(
      NEW.organization_id, ARRAY[NEW.assignee_id], 'ticket_assigned',
      'Ticket ' || NEW.ticket_number || ' assigned to you',
      NEW.subject,
      'ticket', NEW.id, '/dashboard?module=support&ticket=' || NEW.id
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('resolved', 'closed')
     AND NEW.requester_id IS NOT NULL THEN
    PERFORM public.notify_members(
      NEW.organization_id, ARRAY[NEW.requester_id], 'ticket_resolved',
      'Ticket ' || NEW.ticket_number || ' ' || NEW.status::text,
      NEW.subject,
      'ticket', NEW.id, '/dashboard?module=support&ticket=' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ticket_change ON support_tickets;
CREATE TRIGGER trg_notify_ticket_change
  AFTER UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_change();

-- ── Comments and mentions ─────────────────────────────────────────────────

/**
 * Somebody said something on your project, or named you.
 *
 * Mentions are notified wherever the comment hangs; the project team is
 * notified only for project threads, because a project discussion is the one
 * place where "there is a new message" is worth a bell on its own.
 */
CREATE OR REPLACE FUNCTION public.notify_comment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  author_name text;
  project_name text;
BEGIN
  SELECT p.full_name INTO author_name
  FROM organization_members om JOIN profiles p ON p.id = om.user_id
  WHERE om.id = NEW.author_id;

  IF array_length(NEW.mentions, 1) IS NOT NULL THEN
    PERFORM public.notify_members(
      NEW.organization_id, NEW.mentions, 'mention',
      COALESCE(author_name, 'Someone') || ' mentioned you',
      left(NEW.body, 200),
      'comment', NEW.id, NULL
    );
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    SELECT name INTO project_name FROM projects WHERE id = NEW.project_id;
    PERFORM public.notify_members(
      NEW.organization_id,
      -- Mentioned people were told above; telling them twice is noise.
      ARRAY(
        SELECT m FROM unnest(public.project_audience(NEW.project_id)) AS m
        WHERE NOT (m = ANY (NEW.mentions))
      ),
      'project_comment',
      'New message on ' || COALESCE(project_name, 'a project'),
      left(NEW.body, 200),
      'project', NEW.project_id,
      '/dashboard?module=projects&project=' || NEW.project_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_comment ON comments;
CREATE TRIGGER trg_notify_comment
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_comment();

-- ── Announcements ─────────────────────────────────────────────────────────

/** An announcement is a broadcast; the bell is how people learn it exists. */
CREATE OR REPLACE FUNCTION public.notify_announcement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  audience uuid[];
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.published_at > now() THEN RETURN NEW; END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO audience
  FROM organization_members
  WHERE organization_id = NEW.organization_id
    AND is_active = true
    AND CASE NEW.audience
          WHEN 'staff'    THEN role <> 'client'
          WHEN 'clients'  THEN role =  'client'
          ELSE true
        END;

  PERFORM public.notify_members(
    NEW.organization_id, audience, 'announcement',
    NEW.title, left(NEW.body, 200), 'announcement', NEW.id, NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_announcement ON announcements;
CREATE TRIGGER trg_notify_announcement
  AFTER INSERT ON announcements
  FOR EACH ROW EXECUTE FUNCTION public.notify_announcement();


-- ───────────────────────────────────────────────────────────────────────────
--  7. Notification housekeeping
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Clients need their own notifications too.
 *
 * The 0005 policy admits rows where the recipient is the caller, which already
 * covers this — but `notifications` had no INSERT policy for anyone, so every
 * notification written from a route handler depended on the caller's own
 * rights. The fan-out functions above are SECURITY DEFINER and bypass that;
 * this policy is for the app-level inserts that remain (project membership,
 * milestone completion), which write to *other* people's mailboxes and
 * legitimately need to.
 */
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    -- Only staff may raise a notification for someone else. A client account
    -- must never be able to write into an employee's tray.
    AND public.auth_role_in(organization_id) <> 'client'
  );

/**
 * A member-level preference blob.
 *
 * Which categories reach whom is a personal setting, not an organizational
 * one — the org-wide `notifications` key in org_settings sets the default and
 * this overrides it per person. jsonb because the set of categories will grow
 * with every module, and a column per category is a migration per feature.
 */
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organization_members.notification_prefs IS
  'Per-person overrides of the organization notification defaults, keyed by '
  'notification type. Empty means "inherit", which is what everyone starts as.';


-- ───────────────────────────────────────────────────────────────────────────
--  7b. Storage: clients read published deliverables, nothing else
-- ───────────────────────────────────────────────────────────────────────────
--
--  A gap opened by the portal, and worth stating plainly.
--
--  The 0006 read policy admits any object whose leading path segment is an
--  organization the caller belongs to. A client login *is* an
--  `organization_members` row, so `auth_org_ids()` returns the company's id
--  for them — which means that as soon as a client account exists, it can read
--  every document, attachment and receipt in the workspace, given a path.
--  That was harmless while no client could sign in. It is not harmless now.
--
--  Replaces the policy with the same rule for staff, plus a narrow one for
--  clients: an object is readable only if a `files` row points at it, marks it
--  client-visible and not confidential, and hangs it off one of their own
--  projects. The signed-URL endpoint applies the same test against the
--  metadata; this is the layer that holds if that endpoint is ever wrong.

DROP POLICY IF EXISTS "org members read own files" ON storage.objects;

CREATE POLICY "org members read own files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('documents','attachments','receipts','hr-documents')
    AND public.storage_org_id(name) = ANY (public.auth_org_ids())
    AND (
      CASE
        WHEN public.auth_role_in(public.storage_org_id(name)) = 'client' THEN
          bucket_id IN ('documents','attachments')
          AND EXISTS (
            SELECT 1 FROM files f
            WHERE f.bucket = storage.objects.bucket_id
              AND f.path   = storage.objects.name
              AND f.deleted_at IS NULL
              AND f.is_client_visible
              AND NOT f.is_confidential
              AND f.project_id IS NOT NULL
              AND public.is_client_project(f.project_id)
          )
        ELSE
          -- Unchanged for staff: HR documents stay restricted to HR and the
          -- subject, whose membership id is the second path segment.
          bucket_id <> 'hr-documents'
          OR public.has_org_role(public.storage_org_id(name),
                                 ARRAY['owner','administrator','hr_staff']::org_role[])
          OR split_part(name, '/', 2) = public.auth_member_id(public.storage_org_id(name))::text
      END
    )
  );

-- Clients upload nothing. The 0006 insert policy allows any member of the
-- organization, which now includes them.
DROP POLICY IF EXISTS "org members upload own files" ON storage.objects;

CREATE POLICY "org members upload own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.storage_org_id(name) = ANY (public.auth_org_ids())
    AND public.auth_role_in(public.storage_org_id(name)) <> 'client'
    AND (
      bucket_id <> 'hr-documents'
      OR public.has_org_role(public.storage_org_id(name),
                             ARRAY['owner','administrator','hr_staff']::org_role[])
    )
  );


-- ───────────────────────────────────────────────────────────────────────────
--  8. Directory view for people pickers
-- ───────────────────────────────────────────────────────────────────────────
--
--  Every assignee dropdown in the product was reading `/api/admin/users`,
--  which requires the admin module. Managers, HR staff, support staff and
--  employees are all refused it, so those dropdowns were empty for everyone
--  except owners and administrators — and the rows it returns are shaped for
--  the administration table, not for a picker.
--
--  This view is the picker's own shape: active colleagues, no employment or
--  reporting detail, and no client accounts (you cannot assign work to a
--  customer). Readable by any member, because knowing who your colleagues are
--  is not privileged information inside a company.

CREATE OR REPLACE VIEW public.v_assignable_members
WITH (security_invoker = true) AS
SELECT
  om.id            AS member_id,
  om.organization_id,
  om.role,
  om.department_id,
  d.name           AS department_name,
  p.id             AS user_id,
  /**
   * A name that is never blank.
   *
   * `profiles.full_name` is `GENERATED ALWAYS AS (btrim(first_name || ' ' ||
   * last_name))`, so an account provisioned without a name — which is every
   * account created straight through the admin API, and any invitation
   * accepted without filling the fields in — yields an empty string, or NULL
   * if either half is null.
   *
   * A picker rendering that shows a selectable row with no label: visually
   * identical to the "undefined undefined" bug this view was added to fix, and
   * just as impossible to choose deliberately. The local part of the email is
   * a poor name but an unambiguous one, and it is always present because the
   * column is NOT NULL.
   */
  COALESCE(NULLIF(btrim(p.full_name), ''), split_part(p.email::text, '@', 1))
                   AS full_name,
  p.email,
  p.avatar_url,
  p.job_title
FROM organization_members om
JOIN profiles p         ON p.id = om.user_id
LEFT JOIN departments d ON d.id = om.department_id
WHERE om.is_active = true
  AND om.role <> 'client';

/**
 * The administration directory gains the client link.
 *
 * `v_org_directory` is what `/api/admin/users` returns and what the user
 * management screen edits. Without `client_company_id` on it, the new client
 * picker in that form had nothing to initialise from: a client already linked
 * to a customer still rendered "Not linked yet", and saving the form would
 * quietly unlink them. The contract harness caught exactly this — the screen
 * declared a field the endpoint never sent.
 *
 * Appended rather than inserted, and via CREATE OR REPLACE rather than a drop:
 * Postgres permits adding columns to the end of a view definition but not
 * reordering or removing them, and a DROP would fail against dependents.
 */
CREATE OR REPLACE VIEW public.v_org_directory
WITH (security_invoker = true) AS
SELECT
  om.id                AS member_id,
  om.organization_id,
  om.role,
  om.employee_number,
  om.employment_type,
  om.hired_on,
  om.is_active,
  p.id                 AS user_id,
  p.email,
  p.full_name,
  p.avatar_url,
  p.job_title,
  p.phone,
  p.last_seen_at,
  d.id                 AS department_id,
  d.name               AS department_name,
  mgr_p.full_name      AS manager_name,
  om.manager_id,
  om.status,
  om.terminated_on,
  p.force_password_change,
  p.password_changed_at,
  -- Added in 0016. Null for every employee; set only on client logins.
  om.client_company_id
FROM organization_members om
JOIN profiles p              ON p.id = om.user_id
LEFT JOIN departments d      ON d.id = om.department_id
LEFT JOIN organization_members mgr ON mgr.id = om.manager_id
LEFT JOIN profiles mgr_p     ON mgr_p.id = mgr.user_id;

COMMENT ON VIEW public.v_assignable_members IS
  'Colleagues who can be assigned work or added to a project. The shape every '
  'people picker needs, readable by any member — unlike v_org_directory, '
  'which is the administration table''s row and is admin-only.';

GRANT SELECT ON public.v_assignable_members     TO authenticated;
GRANT SELECT ON public.v_client_portal_projects TO authenticated;
