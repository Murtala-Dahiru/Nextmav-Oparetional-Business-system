-- ═══════════════════════════════════════════════════════════════════════════
--  0039 - People: the employment record
-- ═══════════════════════════════════════════════════════════════════════════
--
--  HR knows who works here today. It has never known *how they got here*.
--
--  `organization_members` is a single mutable row: change somebody's
--  department and the fact that they used to be in Sales is gone, along with
--  the date it changed and the person who decided it. A promotion is an UPDATE
--  that overwrites the thing a promotion is evidence of. Every question an HR
--  system is actually asked - when was she promoted, who did he report to in
--  March, how long has this team existed in its current shape - is
--  unanswerable, and no amount of screen work fixes that, because the data was
--  never written down.
--
--  -- The line this file draws --------------------------------------------
--
--  **The membership row is the present tense. `employment_events` is the
--  past.** They are written together or not at all, by one function, so they
--  cannot disagree.
--
--  That is the same discipline 0031 applied to incentives - an amount, once
--  computed, is never recalculated - applied to employment instead of money.
--  A promotion produces a row, not an edit.
--
--  -- Three columns move onto the membership, and why ----------------------
--
--  * `job_title`. It lives on `profiles` today, which is the *account*, not
--    the employment. Two consequences, both real: a person who belongs to two
--    organisations has one title across both, and - decisively - the
--    `profiles_update` policy is `id = auth.uid()`, so **HR cannot change
--    anybody's job title**. A People system whose head of HR cannot record a
--    promotion is not a People system. The membership's title wins where it is
--    set; `profiles.job_title` remains what a person calls themselves and is
--    the fallback, so nothing that reads the old column breaks.
--
--  * `lifecycle_stage`. Descriptive, never an access decision. `is_active`
--    remains the gate and `status` remains the identity lifecycle
--    (0012/0025); a trigger keeps the stage from contradicting either. The
--    stage exists because "active" and "serving notice" are the same row to
--    the security model and completely different to the people running the
--    company.
--
--  * `probation_ends_on` / `work_location`. Two facts every employment record
--    carries that this one could not hold at all.
--
--  -- What this file does not do ------------------------------------------
--
--  It stores no salary. Compensation arrives in 0042 with its own permission
--  rule, because the moment a wage shares a table with a department, everyone
--  who can see the org chart can see the payroll.
--
--  Idempotent, like every migration in this chain. No column is dropped, no
--  default changes, and the backfill is a real fact (when each person joined),
--  not an invented one.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
--  1. Vocabulary
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  /**
   * Where somebody is in the employee journey.
   *
   * `candidate` and `offer` are here so that a person who exists in
   * recruitment (0040) and a person who exists in the directory are describable
   * by one vocabulary - but a membership row is never created at those stages.
   * Hiring is what creates the membership, and it starts at `onboarding`.
   */
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_stage') THEN
    CREATE TYPE employment_stage AS ENUM (
      'candidate', 'offer', 'onboarding', 'active',
      'on_leave', 'notice_period', 'offboarding', 'former'
    );
  END IF;

  /**
   * What happened, in the vocabulary a person would use.
   *
   * Deliberately not one `changed` kind with a diff: "promoted" and
   * "transferred" mean different things to the company even when the columns
   * they touch overlap, and a history that cannot tell them apart is a
   * changelog rather than a record.
   */
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_event_kind') THEN
    CREATE TYPE employment_event_kind AS ENUM (
      'hired', 'promoted', 'transferred', 'title_change', 'manager_change',
      'employment_type_change', 'stage_change', 'compensation_change',
      'offboarded', 'rehired', 'note'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
--  2. The present tense
-- ---------------------------------------------------------------------------

ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS job_title         text,
  ADD COLUMN IF NOT EXISTS lifecycle_stage   employment_stage NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS probation_ends_on date,
  ADD COLUMN IF NOT EXISTS work_location     text;

COMMENT ON COLUMN organization_members.job_title IS
  'The employment title, which HR may change. profiles.job_title is the account own value and remains the fallback.';
COMMENT ON COLUMN organization_members.lifecycle_stage IS
  'Descriptive only. is_active is the access gate and status is the identity lifecycle; this says where the person is in the employee journey.';

CREATE INDEX IF NOT EXISTS idx_org_members_stage
  ON organization_members (organization_id, lifecycle_stage);

/**
 * The stage may not contradict the gate.
 *
 * A terminated membership is `former` whatever anybody typed, and a membership
 * that comes back from termination stops being `former`. Everything between
 * those two is HR's to choose, which is the point - the trigger removes only
 * the combinations that would make the screen lie about access.
 */
CREATE OR REPLACE FUNCTION public.sync_lifecycle_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'terminated' THEN
    NEW.lifecycle_stage := 'former';
  ELSIF NEW.lifecycle_stage = 'former' THEN
    /* Reinstated: fall back to active rather than guessing at onboarding. */
    NEW.lifecycle_stage := 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lifecycle_stage ON organization_members;
CREATE TRIGGER trg_sync_lifecycle_stage
  BEFORE INSERT OR UPDATE OF status, lifecycle_stage ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_lifecycle_stage();

/**
 * The trigger only fires on a write, and every membership that predates this
 * file has already had its last one. Without this, nineteen terminated people
 * in the demo workspace read as `active` - the column's first appearance would
 * have been a screen stating the opposite of the truth.
 */
UPDATE organization_members
   SET lifecycle_stage = 'former'
 WHERE status = 'terminated' AND lifecycle_stage <> 'former';

-- ---------------------------------------------------------------------------
--  3. The past
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  kind            employment_event_kind NOT NULL,

  /**
   * The date the change takes effect, which is not the date it was typed.
   *
   * A promotion agreed in March and effective in April is one row with two
   * dates, and reporting that cannot tell them apart will always disagree with
   * payroll.
   */
  effective_on    date NOT NULL DEFAULT current_date,

  /* Before and after, for the facts an employment is made of. */
  title_before            text,
  title_after             text,
  department_before       uuid REFERENCES departments(id) ON DELETE SET NULL,
  department_after        uuid REFERENCES departments(id) ON DELETE SET NULL,
  manager_before          uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  manager_after           uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  employment_type_before  employment_type,
  employment_type_after   employment_type,
  stage_before            employment_stage,
  stage_after             employment_stage,

  reason          text NOT NULL DEFAULT '',
  note            text NOT NULL DEFAULT '',

  /**
   * Anything a kind needs that the columns above do not hold - the offer this
   * hire came from, the case that prompted an exit. Never the amount of
   * anything: money is 0042's, and a JSONB blob is where a salary ends up
   * leaking into a table everybody can read.
   */
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,

  recorded_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employment_events IS
  'Append-only employment history. Written with the membership row it changes, by apply_employment_change(), so the two can never disagree.';

CREATE INDEX IF NOT EXISTS idx_employment_events_member
  ON employment_events (organization_id, member_id, effective_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employment_events_org_kind
  ON employment_events (organization_id, kind, effective_on DESC);

-- ---------------------------------------------------------------------------
--  4. The one writer
-- ---------------------------------------------------------------------------

/**
 * Apply an employment change and record it, in one transaction.
 *
 * SECURITY DEFINER because it writes `organization_members`, whose update
 * policy is administrative - so it checks the caller itself, first, and
 * refuses before touching anything. Every NULL argument means "leave this
 * alone", which is what makes one function serve a promotion, a transfer, a
 * stage change and a plain note.
 *
 * Three refusals worth naming:
 *
 *   * A no-op. Recording that nothing happened fills the history with noise
 *     and makes the real events harder to find.
 *   * Somebody managing themselves, and any cycle in the reporting line. A
 *     cycle makes `auth_visible_member_ids()` and every org chart non-
 *     terminating, and the cheapest place to refuse it is here.
 *   * A manager or department from another organisation. The foreign key
 *     permits it; tenancy does not.
 */
CREATE OR REPLACE FUNCTION public.apply_employment_change(
  p_member          uuid,
  p_kind            employment_event_kind,
  p_effective       date              DEFAULT current_date,
  p_job_title       text              DEFAULT NULL,
  p_department      uuid              DEFAULT NULL,
  p_manager         uuid              DEFAULT NULL,
  p_employment_type employment_type   DEFAULT NULL,
  p_stage           employment_stage  DEFAULT NULL,
  p_reason          text              DEFAULT '',
  p_note            text              DEFAULT '',
  p_details         jsonb             DEFAULT '{}'::jsonb
)
RETURNS employment_events
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m      organization_members%ROWTYPE;
  actor  uuid;
  ev     employment_events%ROWTYPE;
  hop    uuid;
  guard  int := 0;
BEGIN
  SELECT * INTO m FROM organization_members WHERE id = p_member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That employee does not exist.' USING ERRCODE = 'no_data_found';
  END IF;

  IF public.auth_role_in(m.organization_id) NOT IN ('owner', 'administrator', 'hr_staff') THEN
    RAISE EXCEPTION 'Only HR and administrators may change an employment record.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  actor := public.auth_member_id(m.organization_id);

  IF p_manager IS NOT NULL THEN
    IF p_manager = p_member THEN
      RAISE EXCEPTION 'Somebody cannot report to themselves.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM organization_members
      WHERE id = p_manager AND organization_id = m.organization_id
    ) THEN
      RAISE EXCEPTION 'That manager is not a member of this organisation.'
        USING ERRCODE = 'check_violation';
    END IF;

    /* Walk up from the proposed manager; meeting this person is a cycle. */
    hop := p_manager;
    WHILE hop IS NOT NULL AND guard < 64 LOOP
      IF hop = p_member THEN
        RAISE EXCEPTION 'That reporting line loops back on itself.'
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT manager_id INTO hop FROM organization_members WHERE id = hop;
      guard := guard + 1;
    END LOOP;
  END IF;

  IF p_department IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM departments
    WHERE id = p_department AND organization_id = m.organization_id
  ) THEN
    RAISE EXCEPTION 'That department belongs to another organisation.'
      USING ERRCODE = 'check_violation';
  END IF;

  /* A change that changes nothing is not history. `note` is exempt: it is the
     kind whose entire purpose is to carry text and no column change. */
  IF p_kind <> 'note'
     AND COALESCE(p_job_title, m.job_title)             IS NOT DISTINCT FROM m.job_title
     AND COALESCE(p_department, m.department_id)        IS NOT DISTINCT FROM m.department_id
     AND COALESCE(p_manager, m.manager_id)              IS NOT DISTINCT FROM m.manager_id
     AND COALESCE(p_employment_type, m.employment_type) IS NOT DISTINCT FROM m.employment_type
     AND COALESCE(p_stage, m.lifecycle_stage)           IS NOT DISTINCT FROM m.lifecycle_stage
  THEN
    RAISE EXCEPTION 'Nothing about this employment would change.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO employment_events (
    organization_id, member_id, kind, effective_on,
    title_before, title_after,
    department_before, department_after,
    manager_before, manager_after,
    employment_type_before, employment_type_after,
    stage_before, stage_after,
    reason, note, details, recorded_by
  )
  VALUES (
    m.organization_id, p_member, p_kind, COALESCE(p_effective, current_date),
    m.job_title,        COALESCE(p_job_title, m.job_title),
    m.department_id,    COALESCE(p_department, m.department_id),
    m.manager_id,       COALESCE(p_manager, m.manager_id),
    m.employment_type,  COALESCE(p_employment_type, m.employment_type),
    m.lifecycle_stage,  COALESCE(p_stage, m.lifecycle_stage),
    COALESCE(p_reason, ''), COALESCE(p_note, ''), COALESCE(p_details, '{}'::jsonb), actor
  )
  RETURNING * INTO ev;

  UPDATE organization_members
     SET job_title       = COALESCE(p_job_title, job_title),
         department_id   = COALESCE(p_department, department_id),
         manager_id      = COALESCE(p_manager, manager_id),
         employment_type = COALESCE(p_employment_type, employment_type),
         lifecycle_stage = COALESCE(p_stage, lifecycle_stage)
   WHERE id = p_member;

  /**
   * The person is told what changed about their own employment.
   *
   * Not for `note`, which is HR's private annotation, and not for a stage
   * change alone - moving somebody from `onboarding` to `active` is
   * bookkeeping, and a notification for it is the notification spam the brief
   * rules out.
   */
  IF p_kind IN ('promoted', 'transferred', 'title_change', 'manager_change',
                'employment_type_change', 'rehired') THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    VALUES (
      m.organization_id, p_member, 'employment_change',
      CASE p_kind
        WHEN 'promoted'    THEN 'You have been promoted'
        WHEN 'transferred' THEN 'Your team has changed'
        WHEN 'rehired'     THEN 'Welcome back'
        ELSE 'Your employment record was updated'
      END,
      COALESCE(NULLIF(p_reason, ''), ev.title_after, 'See your profile for details.'),
      'employment_event', ev.id,
      '/dashboard?module=hr&tab=people&member=' || p_member
    );
  END IF;

  RETURN ev;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_employment_change(
  uuid, employment_event_kind, date, text, uuid, uuid,
  employment_type, employment_stage, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_employment_change(
  uuid, employment_event_kind, date, text, uuid, uuid,
  employment_type, employment_stage, text, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
--  5. Every employment starts somewhere
-- ---------------------------------------------------------------------------

/**
 * A new membership opens its own history.
 *
 * Written by trigger for the same reason `business_events` is: a person
 * becomes an employee through at least four paths - invitation acceptance,
 * administrative provisioning, signup, and the hire endpoint in 0040 - and a
 * record that only one of them writes is a record with holes in it.
 */
CREATE OR REPLACE FUNCTION public.open_employment_record()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO employment_events (
    organization_id, member_id, kind, effective_on,
    title_after, department_after, manager_after,
    employment_type_after, stage_after, reason
  )
  VALUES (
    NEW.organization_id, NEW.id, 'hired',
    COALESCE(NEW.hired_on, NEW.joined_at::date, current_date),
    NEW.job_title, NEW.department_id, NEW.manager_id,
    NEW.employment_type, NEW.lifecycle_stage, 'Joined the organisation'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_open_employment_record ON organization_members;
CREATE TRIGGER trg_open_employment_record
  AFTER INSERT ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.open_employment_record();

/**
 * Backfill: one `hired` row for every membership that predates this file.
 *
 * The date is `hired_on` where HR recorded one and `joined_at` otherwise -
 * both are facts already in the table. Nothing is invented, and a second run
 * adds nothing because the NOT EXISTS is on the member, not on the row.
 */
INSERT INTO employment_events (
  organization_id, member_id, kind, effective_on,
  title_after, department_after, manager_after,
  employment_type_after, stage_after, reason
)
SELECT
  om.organization_id, om.id, 'hired',
  COALESCE(om.hired_on, om.joined_at::date, current_date),
  COALESCE(om.job_title, p.job_title), om.department_id, om.manager_id,
  om.employment_type, om.lifecycle_stage, 'Joined the organisation'
FROM organization_members om
JOIN profiles p ON p.id = om.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM employment_events e WHERE e.member_id = om.id
);

-- ---------------------------------------------------------------------------
--  6. What a People screen reads
-- ---------------------------------------------------------------------------

/**
 * The directory, plus the employment facts the directory has never carried.
 *
 * A new view rather than a wider `v_org_directory`, for a mechanical reason
 * this repository has already paid for once: `db:apply` replays every
 * migration, and a later `CREATE OR REPLACE VIEW` that appends columns makes
 * the earlier statement that created the narrower version fail on the next
 * run with "cannot drop columns from view". A new name has no such coupling.
 *
 * `security_invoker`, so it is exactly as restricted as the tables beneath it.
 */
DROP VIEW IF EXISTS public.v_hr_people;
CREATE VIEW public.v_hr_people
WITH (security_invoker = true) AS
SELECT
  om.id                       AS member_id,
  om.organization_id,
  om.user_id,
  p.email,
  p.full_name,
  p.avatar_url,
  p.phone,
  COALESCE(NULLIF(btrim(om.job_title), ''), p.job_title) AS job_title,
  om.role,
  om.employee_number,
  om.employment_type,
  om.lifecycle_stage,
  om.status,
  om.is_active,
  om.hired_on,
  om.joined_at,
  om.terminated_on,
  om.probation_ends_on,
  om.work_location,
  om.department_id,
  d.name                      AS department_name,
  om.manager_id,
  mgr_p.full_name             AS manager_name,
  mgr_p.avatar_url            AS manager_avatar_url,
  /* Whole months of service, from the date the employment actually began. */
  CASE
    WHEN COALESCE(om.hired_on, om.joined_at::date) IS NULL THEN NULL
    ELSE GREATEST(0, (
      (EXTRACT(YEAR  FROM age(current_date, COALESCE(om.hired_on, om.joined_at::date))) * 12)
    + (EXTRACT(MONTH FROM age(current_date, COALESCE(om.hired_on, om.joined_at::date))))
    )::int)
  END                         AS tenure_months,
  p.account_origin,
  p.last_seen_at,
  p.last_active_at,
  public.presence_of(
    p.presence_status, p.presence_beat_at, p.last_active_at,
    COALESCE((s.value ->> 'awayAfterMinutes')::int, 5),
    COALESCE((s.value ->> 'offlineAfterSeconds')::int, 120)
  )                           AS presence
FROM organization_members om
JOIN profiles p                    ON p.id = om.user_id
LEFT JOIN departments d            ON d.id = om.department_id
LEFT JOIN organization_members mgr ON mgr.id = om.manager_id
LEFT JOIN profiles mgr_p           ON mgr_p.id = mgr.user_id
LEFT JOIN org_settings s           ON s.organization_id = om.organization_id
                                  AND s.key = 'presence_policy'
WHERE om.deleted_at IS NULL;

COMMENT ON VIEW public.v_hr_people IS
  'The employee directory as HR needs it: the membership own job title, lifecycle stage, probation, location and tenure alongside the profile.';

-- ---------------------------------------------------------------------------
--  7. Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE employment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE employment_events FORCE ROW LEVEL SECURITY;

/**
 * You may read the history of anybody whose records you may already see -
 * which is yourself, your department and reports if you manage, everybody if
 * you are HR. `auth_visible_member_ids()` has answered this question since
 * 0005 and answering it a second way here is how the two come to disagree.
 */
DROP POLICY IF EXISTS employment_events_select ON employment_events;
CREATE POLICY employment_events_select ON employment_events FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  );

/**
 * Nobody writes this table directly.
 *
 * There is no INSERT, UPDATE or DELETE policy, deliberately: every row comes
 * from `apply_employment_change()` or the hire trigger, both SECURITY DEFINER.
 * An append-only history that a client can append to is not a history, and one
 * it can amend is worse than none.
 */

-- ---------------------------------------------------------------------------
--  8. Realtime
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employment_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
