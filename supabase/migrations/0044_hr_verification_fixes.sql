-- ═══════════════════════════════════════════════════════════════════════════
--  0044 - Three defects `hr:verify` found by driving 0039-0043
-- ═══════════════════════════════════════════════════════════════════════════
--
--  All three were invisible to `db:check`, `security:check` and `tsc`, and all
--  three appeared the first time a real session went through the real HTTP API.
--  That is the argument for the harness in one paragraph.
--
--  ── 1. Two policies pointing at each other ──────────────────────────────
--
--      infinite recursion detected in policy for relation "payroll_periods"
--
--  `payroll_periods_select` let an employee see a *paid* period they had an
--  item in, so it read `payroll_items`. `payroll_items_select` let an employee
--  see their own item once the period was paid, so it read `payroll_periods`.
--  Each policy is correct; together they are a loop, and Postgres refuses the
--  whole query rather than the row.
--
--  This is the same family as the trap in [[businessos-rls-returning-selfref]]:
--  a policy that reaches for another table whose policy reaches back. The fix
--  is the one that has worked every time here - move the question into a
--  SECURITY DEFINER function, which runs outside RLS and therefore ends the
--  recursion. The rules themselves are unchanged.
--
--  Worth stating plainly, because it will come up again: **any two tables whose
--  select policies reference each other will recurse.** It cannot be found by
--  reading either one.
--
--  ── 2. A CASE expression is text until you say otherwise ────────────────
--
--      column "lifecycle_stage" is of type employment_stage but expression is
--      of type text
--
--  `stage_exit()` assigned `CASE WHEN ... THEN 'offboarding' ELSE
--  'notice_period' END`. Postgres will coerce a bare literal to an enum, but
--  not the text-typed result of a CASE. So recording an exit failed outright -
--  which at least fails loudly; the same shape in a WHERE clause would have
--  silently matched nothing.
--
--  ── 3. A promotion that said the person had no title before ─────────────
--
--  `apply_employment_change()` recorded `title_before := m.job_title`, and
--  `organization_members.job_title` is NULL for everybody until their first
--  title change - 0039 introduced the column and nothing backfilled it,
--  correctly, because the profile's title is the person's own. So the first
--  promotion in every employment history read "→ Senior Engineer" from
--  nothing, when the person had been an Engineer all along.
--
--  Not a crash, and the most expensive of the three: a history that quietly
--  loses the first title is wrong for ever, and nobody looks at a promotion
--  record until they need it. The fallback is `profiles.job_title`, which is
--  exactly what `v_hr_people` already coalesces to.
--
--  Idempotent, additive, and the backfill corrects only the rows that carry
--  the defect.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
--  1. Breaking the payroll policy loop
-- ---------------------------------------------------------------------------

/**
 * Is this pay run paid, asked without RLS.
 *
 * SECURITY DEFINER, so reading `payroll_periods` here does not re-enter that
 * table's policy. It discloses nothing: a status is not a figure, and the
 * caller already holds the item id they are asking about.
 */
CREATE OR REPLACE FUNCTION public.payroll_period_is_paid(p uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM payroll_periods WHERE id = p AND status = 'paid');
$$;

/**
 * Does the caller have a payslip in this run.
 *
 * The other half of the loop, and the same reasoning: it answers only about the
 * caller's own membership, so a definer-rights read of `payroll_items` cannot
 * reveal anybody else's row.
 */
CREATE OR REPLACE FUNCTION public.has_payslip_in_period(p uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM payroll_items i
      JOIN payroll_periods pp ON pp.id = i.period_id
     WHERE i.period_id = p
       AND i.member_id = public.auth_member_id(pp.organization_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.payroll_period_is_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_payslip_in_period(uuid)  TO authenticated;

DROP POLICY IF EXISTS payroll_periods_select ON payroll_periods;
CREATE POLICY payroll_periods_select ON payroll_periods FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.can_see_compensation(organization_id)
      /* Identical rule to before; the read of payroll_items now happens
         outside this policy rather than inside it. */
      OR (status = 'paid' AND public.has_payslip_in_period(id))
    )
  );

DROP POLICY IF EXISTS payroll_items_select ON payroll_items;
CREATE POLICY payroll_items_select ON payroll_items FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.can_see_compensation(organization_id)
      OR (
        member_id = public.auth_member_id(organization_id)
        AND public.payroll_period_is_paid(period_id)
      )
    )
  );

DROP POLICY IF EXISTS payroll_lines_select ON payroll_lines;
CREATE POLICY payroll_lines_select ON payroll_lines FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM payroll_items i
       WHERE i.id = payroll_lines.item_id
         AND (
           public.can_see_compensation(i.organization_id)
           OR (
             i.member_id = public.auth_member_id(i.organization_id)
             AND public.payroll_period_is_paid(i.period_id)
           )
         )
    )
  );

-- ---------------------------------------------------------------------------
--  1b. A CASE does not shield a field that does not exist
-- ---------------------------------------------------------------------------

/**
 *     record "new" has no field "item_id"
 *
 * `guard_frozen_payroll_rows()` is attached to two tables and reached for the
 * right column with a `CASE TG_TABLE_NAME WHEN 'payroll_items' THEN
 * NEW.period_id ELSE (SELECT ... NEW.item_id) END`. Reading it, the ELSE
 * branch plainly never runs for `payroll_items`.
 *
 * But plpgsql prepares the whole assignment as one SQL statement and
 * substitutes every record reference in it *before* execution, so
 * `NEW.item_id` has to resolve on a row that has no such column - and the
 * statement fails before the CASE ever chooses a branch. A CASE is not a
 * guard here; `IF` is.
 *
 * The consequence was that calculating a pay run failed outright, since
 * inserting the first item tripped the trigger meant to protect approved runs.
 */
CREATE OR REPLACE FUNCTION public.guard_frozen_payroll_rows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  st  payroll_status;
  pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'payroll_items' THEN
    pid := COALESCE(NEW.period_id, OLD.period_id);
  ELSE
    SELECT period_id INTO pid
      FROM payroll_items
     WHERE id = COALESCE(NEW.item_id, OLD.item_id);
  END IF;

  SELECT status INTO st FROM payroll_periods WHERE id = pid;

  IF st IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'This payroll run has been approved; its figures are final.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
--  2. The enum cast
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.stage_exit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_members
     SET lifecycle_stage = CASE
           WHEN NEW.last_working_day <= current_date THEN 'offboarding'::employment_stage
           ELSE 'notice_period'::employment_stage
         END
   WHERE id = NEW.member_id AND status <> 'terminated';

  INSERT INTO employment_events (
    organization_id, member_id, kind, effective_on,
    stage_before, stage_after, reason, note, details, recorded_by
  )
  SELECT
    NEW.organization_id, NEW.member_id, 'offboarded', NEW.last_working_day,
    om.lifecycle_stage, om.lifecycle_stage,
    NEW.exit_type::text, NEW.reason,
    jsonb_build_object('exitId', NEW.id, 'exitType', NEW.exit_type),
    NEW.recorded_by
  FROM organization_members om WHERE om.id = NEW.member_id;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
--  3. The title somebody actually held
-- ---------------------------------------------------------------------------

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
  m       organization_members%ROWTYPE;
  actor   uuid;
  ev      employment_events%ROWTYPE;
  hop     uuid;
  guard   int := 0;
  /**
   * The title this employment is understood to hold right now.
   *
   * `organization_members.job_title` is NULL until HR first changes it, and
   * `profiles.job_title` is what the directory has always shown. Coalescing
   * here is what makes the *first* promotion record where the person came
   * from, and it is the same coalesce `v_hr_people` performs.
   */
  held    text;
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

  SELECT COALESCE(NULLIF(btrim(m.job_title), ''), p.job_title)
    INTO held
    FROM profiles p WHERE p.id = m.user_id;

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

  /**
   * The no-op test compares against the *held* title rather than the stored
   * one, or "promote them to the title they already have on their profile"
   * would be accepted and recorded as a change.
   */
  IF p_kind <> 'note'
     AND COALESCE(p_job_title, held)                    IS NOT DISTINCT FROM held
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
    held,               COALESCE(p_job_title, held),
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

/**
 * The same correction, applied to the history already written.
 *
 * 0039's backfill wrote `title_after` from `COALESCE(om.job_title,
 * p.job_title)` and was therefore right; the trigger that opens a *new*
 * employment record read `NEW.job_title` alone, which is NULL for an
 * invitation or a signup. Only those rows are touched.
 */
UPDATE employment_events e
   SET title_after = p.job_title
  FROM organization_members om
  JOIN profiles p ON p.id = om.user_id
 WHERE e.member_id = om.id
   AND e.kind = 'hired'
   AND e.title_after IS NULL
   AND p.job_title IS NOT NULL;

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
  SELECT
    NEW.organization_id, NEW.id, 'hired',
    COALESCE(NEW.hired_on, NEW.joined_at::date, current_date),
    COALESCE(NULLIF(btrim(NEW.job_title), ''), p.job_title),
    NEW.department_id, NEW.manager_id,
    NEW.employment_type, NEW.lifecycle_stage, 'Joined the organisation'
  FROM profiles p WHERE p.id = NEW.user_id;

  RETURN NEW;
END;
$$;
