-- ═══════════════════════════════════════════════════════════════════════════
--  0018 — Progress that means something, and the client sign-off that feeds it
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ── What was wrong with progress ─────────────────────────────────────────
--
--  `v_project_health.progress_pct` was already the single definition of the
--  number — the board, the dashboard, the reports and the client portal all
--  read it, which is why they never disagreed. The problem was the definition
--  itself:
--
--      CASE WHEN milestones > 0 THEN completed_milestones / milestones
--           WHEN tasks      > 0 THEN completed_tasks      / tasks
--           ELSE 0 END
--
--  Four things follow from that, all of them visible to a customer:
--
--   1. A project still in `planning` reported progress. Someone drafting a
--      backlog and ticking two throwaway tasks showed 40% delivered on work
--      that had not started.
--
--   2. A project marked `completed` did not report 100%. Closing a project
--      with one milestone left un-ticked left it at 66.7% for ever — and the
--      portal showed the client a finished engagement as two-thirds done.
--
--   3. The two signals were mutually exclusive rather than combined. Adding a
--      single milestone to a project with ninety completed tasks dropped it
--      from 100% to 0%, because the milestone branch wins whenever any
--      milestone exists.
--
--   4. `milestones.progress_pct` — a whole column, with a CHECK constraint and
--      an editor behind it — was read by nothing. A phase honestly reported at
--      half done contributed exactly as much as one not started.
--
--  Section 2 replaces the expression. Every column the view already had keeps
--  its name and meaning, so the endpoints, reports and portal are untouched;
--  three new columns are added for the deliverable signal.
--
--  ── Why deliverables need a sign-off ─────────────────────────────────────
--
--  "Deliverables approved" cannot be a progress input while nothing records an
--  approval. `files.is_client_visible` says a customer may see a file; it says
--  nothing about whether they accepted it. Section 1 adds that, and it is worth
--  having for its own sake: the portal could show a client what had been
--  produced but gave them no way to respond to it, so acceptance happened in
--  email and the project record never learned the outcome.
--
--  Everything here is additive. No column is dropped, no default changes, and
--  the new columns are null on every existing row — a file nobody has marked as
--  requiring approval does not affect any project's progress.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  1. Deliverables, and their approval
-- ───────────────────────────────────────────────────────────────────────────
--
--  `requires_approval` is deliberately opt-in and defaults to false.
--
--  Without it, every client-visible file would be a deliverable, and progress
--  would fall each time someone shared a screenshot. A deliverable is a thing
--  the team put forward for acceptance; a shared file is not. Making the team
--  say which is which keeps the denominator meaningful.

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES organization_members(id) ON DELETE SET NULL;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS approval_note text NOT NULL DEFAULT '';

/**
 * Rejection is a first-class outcome, not the absence of approval.
 *
 * "Not yet reviewed" and "reviewed and sent back" are different states and a
 * status report that cannot tell them apart is the one a client complains
 * about. `approval_decision` carries which, and `approved_at` is the timestamp
 * of whichever decision was made, so one column answers "has this been dealt
 * with".
 */
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS approval_decision text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_approval_decision_valid') THEN
    ALTER TABLE public.files ADD CONSTRAINT files_approval_decision_valid
      CHECK (
        approval_decision IS NULL
        OR approval_decision IN ('approved', 'rejected')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.files.requires_approval IS
  'This file is a deliverable put forward for client acceptance. Opt-in: only '
  'these count toward the deliverable component of project progress, so that '
  'sharing an incidental file does not move the number.';

COMMENT ON COLUMN public.files.approval_decision IS
  'approved | rejected | NULL (awaiting a decision). Rejection is recorded '
  'rather than left as an absence, because "not looked at" and "sent back" are '
  'different things to report.';

CREATE INDEX IF NOT EXISTS idx_files_deliverables
  ON files (project_id, requires_approval)
  WHERE deleted_at IS NULL AND is_client_visible = true;


-- ───────────────────────────────────────────────────────────────────────────
--  2. Progress, weighted across the signals a project actually has
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── The model ────────────────────────────────────────────────────────────
--
--  Three signals, each answering a different question:
--
--    plan        (milestones)    — how much of what we agreed is done?
--    execution   (tasks)         — how much of the work is done?
--    acceptance  (deliverables)  — how much has the client signed off?
--
--  They are weighted 50 / 30 / 20 and renormalised over whichever ones the
--  project actually has, so a project with no roadmap is scored purely on its
--  tasks and adding a roadmap later shifts the number rather than resetting it.
--  The plan carries the most weight because it is what was committed to; task
--  completion is the leading indicator beneath it; client acceptance is what
--  ultimately closes a phase, but only a minority of files are deliverables so
--  it cannot dominate.
--
--  Partial credit, and why it is discounted:
--
--    · a milestone in flight contributes `progress_pct / 2`. The column is
--      self-reported, and a phase that has claimed 90% for a month is exactly
--      what a status report must not smooth over — that was the stated reason
--      for ignoring it entirely. Halving it keeps the caution and still lets
--      honest partial progress show, which is strictly better than a column
--      nothing reads.
--
--    · a task in `review` contributes half. The work is done and awaiting
--      someone; reporting it as untouched is as wrong as reporting it complete.
--
--  Status gates the ends, because they are not derivable from counts:
--
--    planning              → 0.   Nothing has begun, whatever is in the
--                                 backlog. This is what the specification
--                                 means by "Planning 0%".
--    active / on_hold      → at least 10. Work has begun, and a team that has
--                                 started deserves better than 0% on the board.
--                                 `on_hold` keeps whatever it earned rather
--                                 than resetting: a pause is not a rewind.
--    completed             → 100. Closing a project is the authoritative
--                                 statement that it is done.
--    cancelled / archived  → whatever it earned, with no floor. A cancelled
--                                 project should read as what was achieved.

-- CASCADE: v_client_portal_projects (0016) and v_dashboard_stats depend on this
-- view. Both are recreated below, in dependency order.
DROP VIEW IF EXISTS public.v_project_health CASCADE;

CREATE OR REPLACE VIEW public.v_project_health
WITH (security_invoker = true) AS
WITH signals AS (
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
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'review')   AS review_tasks,
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'blocked')  AS blocked_tasks,
    COUNT(DISTINCT t.id) FILTER (
      WHERE t.due_date < CURRENT_DATE AND t.status <> 'done'
    )                                           AS overdue_tasks,

    COUNT(DISTINCT m.id)                        AS total_milestones,
    COUNT(DISTINCT m.id) FILTER (WHERE m.completed_at IS NOT NULL) AS completed_milestones,
    COUNT(DISTINCT m.id) FILTER (
      WHERE m.due_date < CURRENT_DATE AND m.completed_at IS NULL
    )                                           AS overdue_milestones,

    /**
     * The plan's weighted credit, in milestone-equivalents.
     *
     * A completed phase counts 1. One in flight counts half of what it claims.
     *
     * A scalar subquery, not a SUM over the join. `tasks` and `milestones` are
     * both one-to-many from `projects`, so the join emits one row per pair:
     * a project with four tasks and two phases produces eight rows, and any
     * plain aggregate over them counts each phase four times. Every COUNT here
     * is `COUNT(DISTINCT …)` for exactly that reason — a SUM has no such
     * defence, and the first version of this expression reported a two-phase
     * plan at 280% before `LEAST(100, …)` flattened it to a permanent 100.
     */
    (SELECT COALESCE(SUM(
              CASE
                WHEN m2.completed_at IS NOT NULL THEN 1.0
                ELSE COALESCE(m2.progress_pct, 0) / 200.0
              END
            ), 0)
       FROM milestones m2 WHERE m2.project_id = p.id) AS milestone_credit,

    (p.end_date - CURRENT_DATE)                 AS days_remaining,

    /**
     * Hours logged against the project.
     *
     * Also a subquery, and this one is a fix rather than a precaution.
     * `SUM(DISTINCT t.logged_hours)` has been here since 0007: `DISTINCT`
     * inside an aggregate de-duplicates *values*, not rows, so two tasks each
     * logging four hours reported four. It was presumably added to undo the row
     * multiplication described above, and it does — by discarding every
     * duplicate figure, which is only correct when no two tasks ever log the
     * same number of hours. Verified against the tasks table: 4h + 4h reported
     * 4h.
     */
    (SELECT COALESCE(SUM(t2.logged_hours), 0)
       FROM tasks t2
      WHERE t2.project_id = p.id AND t2.deleted_at IS NULL) AS logged_hours,

    -- How many people are on it, so the board can show a team without a join.
    (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,

    /**
     * Deliverables and their acceptance.
     *
     * Subqueries rather than another LEFT JOIN: joining a third one-to-many
     * table to the same GROUP BY multiplies the task and milestone rows against
     * it, and every COUNT(DISTINCT ...) above would still be correct while
     * SUM(DISTINCT t.logged_hours) quietly stopped being. Two cheap indexed
     * lookups are worth more than that trap.
     */
    (SELECT COUNT(*) FROM files f
       WHERE f.project_id = p.id AND f.deleted_at IS NULL
         AND f.is_client_visible AND f.requires_approval)     AS total_deliverables,
    (SELECT COUNT(*) FROM files f
       WHERE f.project_id = p.id AND f.deleted_at IS NULL
         AND f.is_client_visible AND f.requires_approval
         AND f.approval_decision = 'approved')                AS approved_deliverables,
    (SELECT COUNT(*) FROM files f
       WHERE f.project_id = p.id AND f.deleted_at IS NULL
         AND f.is_client_visible AND f.requires_approval
         AND f.approval_decision IS NULL)                     AS pending_deliverables

  FROM projects p
  LEFT JOIN tasks t
    ON t.project_id = p.id AND t.deleted_at IS NULL
  LEFT JOIN milestones m
    ON m.project_id = p.id
  WHERE p.deleted_at IS NULL
  GROUP BY p.id, p.organization_id, p.name, p.status, p.priority,
           p.budget, p.start_date, p.end_date
),
scored AS (
  SELECT
    s.*,
    -- Each signal's own score, or NULL when the project has no such signal.
    CASE WHEN s.total_milestones > 0
      THEN LEAST(100, s.milestone_credit / s.total_milestones * 100) END AS plan_score,
    CASE WHEN s.total_tasks > 0
      THEN (s.completed_tasks + s.review_tasks / 2.0) / s.total_tasks * 100 END AS execution_score,
    CASE WHEN s.total_deliverables > 0
      THEN s.approved_deliverables::numeric / s.total_deliverables * 100 END AS acceptance_score
  FROM signals s
),
blended AS (
  SELECT
    sc.*,
    /**
     * Renormalised over the signals present.
     *
     * The denominator is the sum of the weights that actually applied, so a
     * project with tasks but no roadmap scores 0–100 on tasks alone rather than
     * being capped at 30.
     */
    CASE
      WHEN COALESCE(
             CASE WHEN sc.plan_score       IS NOT NULL THEN 50 ELSE 0 END +
             CASE WHEN sc.execution_score  IS NOT NULL THEN 30 ELSE 0 END +
             CASE WHEN sc.acceptance_score IS NOT NULL THEN 20 ELSE 0 END, 0) = 0
      THEN 0
      ELSE (
        COALESCE(sc.plan_score,       0) * (CASE WHEN sc.plan_score       IS NOT NULL THEN 50 ELSE 0 END) +
        COALESCE(sc.execution_score,  0) * (CASE WHEN sc.execution_score  IS NOT NULL THEN 30 ELSE 0 END) +
        COALESCE(sc.acceptance_score, 0) * (CASE WHEN sc.acceptance_score IS NOT NULL THEN 20 ELSE 0 END)
      ) / (
        CASE WHEN sc.plan_score       IS NOT NULL THEN 50 ELSE 0 END +
        CASE WHEN sc.execution_score  IS NOT NULL THEN 30 ELSE 0 END +
        CASE WHEN sc.acceptance_score IS NOT NULL THEN 20 ELSE 0 END
      )
    END AS earned_pct
  FROM scored sc
)
SELECT
  b.organization_id,
  b.project_id,
  b.name,
  b.status,
  b.priority,
  b.budget,
  b.start_date,
  b.end_date,

  b.total_tasks,
  b.completed_tasks,
  b.blocked_tasks,
  b.overdue_tasks,
  b.review_tasks,

  b.total_milestones,
  b.completed_milestones,
  b.overdue_milestones,

  b.total_deliverables,
  b.approved_deliverables,
  b.pending_deliverables,

  -- Kept for anything that wants the raw signals rather than the verdict.
  ROUND(COALESCE(b.plan_score, 0), 1)       AS plan_pct,
  ROUND(COALESCE(b.execution_score, 0), 1)  AS execution_pct,
  ROUND(COALESCE(b.acceptance_score, 0), 1) AS acceptance_pct,

  /**
   * The number every screen shows.
   *
   * Same column name and type as before, so the projects endpoint, the
   * dashboard, the reports and the client portal keep reading it unchanged —
   * they simply get an answer that is now true at both ends of a project's life.
   */
  CASE
    WHEN b.status = 'completed' THEN 100.0
    WHEN b.status = 'planning'  THEN 0.0
    WHEN b.status IN ('active', 'on_hold') THEN GREATEST(10.0, ROUND(b.earned_pct, 1))
    ELSE ROUND(b.earned_pct, 1)
  END                                       AS progress_pct,

  b.days_remaining,
  b.logged_hours,
  b.member_count,

  (
    (b.end_date < CURRENT_DATE AND b.status NOT IN ('completed', 'cancelled', 'archived'))
    OR b.overdue_tasks > 0
    OR b.overdue_milestones > 0
    OR b.blocked_tasks > 0
  )                                         AS is_at_risk,

  /**
   * The verdict, in three grades. Unchanged from 0016 except that a deliverable
   * the client sent back now counts as a reason to look.
   *
   *   off_track — the end date has passed, or a phase is overdue.
   *   at_risk   — nothing missed yet, but work is overdue, blocked, or a
   *               deliverable was rejected.
   *   on_track  — neither.
   *
   * A finished project is never at risk, however late its remaining tasks look.
   */
  CASE
    WHEN b.status IN ('completed', 'cancelled', 'archived') THEN 'on_track'
    WHEN b.end_date < CURRENT_DATE OR b.overdue_milestones > 0 THEN 'off_track'
    WHEN b.overdue_tasks > 0
      OR b.blocked_tasks > 0
      OR (b.total_deliverables - b.approved_deliverables - b.pending_deliverables) > 0
      THEN 'at_risk'
    ELSE 'on_track'
  END                                       AS health

FROM blended b;

COMMENT ON VIEW public.v_project_health IS
  'One row per live project with its task, milestone and deliverable counts, a '
  'weighted progress figure, time remaining, team size and a three-grade health '
  'verdict. Progress blends plan (milestones, 50), execution (tasks, 30) and '
  'client acceptance (deliverables, 20), renormalised over whichever signals '
  'the project has, and is gated by status at both ends: planning reports 0, a '
  'completed project reports 100. The single definition of "progress" and '
  '"health" — read by the projects endpoint, the dashboard, the reports and the '
  'client portal, so none of them can disagree.';


-- ───────────────────────────────────────────────────────────────────────────
--  3. The views that depended on it, recreated unchanged but for the additions
-- ───────────────────────────────────────────────────────────────────────────

/**
 * The client-facing shape of a project.
 *
 * Verbatim from 0016 apart from the deliverable counts, which are exactly what
 * a client needs to see: how many things are waiting on *them*. A portal that
 * shows a deliverable without saying it is awaiting your approval is how a
 * project stalls for a fortnight with both sides believing the other is moving.
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
  h.total_deliverables,
  h.approved_deliverables,
  h.pending_deliverables,
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
  'and message counts, and how many deliverables await their decision. '
  'Excludes task counts and budget by design — the portal is a status report, '
  'not a window into internal execution.';

/**
 * Re-granted, because DROP ... CASCADE takes the grants with the view.
 *
 * 0015 and 0016 both dropped and recreated `v_project_health` without
 * restoring the GRANT that 0007 gave it, and it kept working only because
 * Supabase sets default privileges on the `public` schema. Relying on that
 * means the view is readable by accident rather than by intent, and a project
 * configured without those defaults would find the board empty with no
 * indication why.
 */
GRANT SELECT ON public.v_project_health         TO authenticated;
GRANT SELECT ON public.v_client_portal_projects TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  4. A client may record a decision on their own deliverables
-- ───────────────────────────────────────────────────────────────────────────
--
--  The narrowest possible grant. A client can already SELECT these rows; this
--  lets them write the three approval columns and nothing else, on a file that
--  is a deliverable, on a project belonging to their company.
--
--  Column-level restriction is not expressible in a policy, so the route is
--  what limits *which* columns are written, and this policy is what limits
--  which rows. The pair is the boundary; neither alone is.

DROP POLICY IF EXISTS files_client_decide ON public.files;
CREATE POLICY files_client_decide ON public.files
  FOR UPDATE TO authenticated
  USING (
    requires_approval
    AND is_client_visible
    AND NOT is_confidential
    AND deleted_at IS NULL
    AND project_id IN (
      SELECT p.id FROM projects p
      WHERE p.organization_id = files.organization_id
        AND p.client_company_id = public.auth_client_company_id(p.organization_id)
        AND p.deleted_at IS NULL
    )
  )
  WITH CHECK (
    requires_approval
    AND is_client_visible
    AND NOT is_confidential
    AND project_id IN (
      SELECT p.id FROM projects p
      WHERE p.organization_id = files.organization_id
        AND p.client_company_id = public.auth_client_company_id(p.organization_id)
        AND p.deleted_at IS NULL
    )
  );


-- ───────────────────────────────────────────────────────────────────────────
--  5. Telling the team a decision was made
-- ───────────────────────────────────────────────────────────────────────────
--
--  A client approving a deliverable that nobody hears about is the same as no
--  approval at all — the project sits waiting on a decision that has already
--  been made. Follows the conventions established in 0016: recipients resolved
--  in the database, never notify the actor, and never let a failing
--  notification abort the write.

CREATE OR REPLACE FUNCTION public.notify_deliverable_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  recipients uuid[];
  proj       record;
  verb       text;
BEGIN
  IF NEW.approval_decision IS NULL
     OR NEW.approval_decision IS NOT DISTINCT FROM OLD.approval_decision THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.name, p.owner_id INTO proj
  FROM projects p WHERE p.id = NEW.project_id;

  IF proj.id IS NULL THEN RETURN NEW; END IF;

  -- The project's team, plus its owner. The owner is not always a member row.
  SELECT ARRAY(
    SELECT pm.member_id FROM project_members pm WHERE pm.project_id = proj.id
    UNION
    SELECT proj.owner_id WHERE proj.owner_id IS NOT NULL
  ) INTO recipients;

  verb := CASE WHEN NEW.approval_decision = 'approved' THEN 'approved' ELSE 'sent back' END;

  BEGIN
    PERFORM public.notify_members(
      NEW.organization_id,
      recipients,
      'deliverable_' || NEW.approval_decision,
      'Deliverable ' || verb,
      NEW.filename || ' was ' || verb || ' on ' || proj.name
        || CASE WHEN COALESCE(NEW.approval_note, '') <> ''
                THEN ' — "' || NEW.approval_note || '"' ELSE '' END,
      'project',
      proj.id,
      '/dashboard?module=projects&project=' || proj.id
    );
  EXCEPTION WHEN OTHERS THEN
    -- A notification must never be the reason an approval fails to record.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_deliverable_decision ON public.files;
CREATE TRIGGER trg_notify_deliverable_decision
  AFTER UPDATE OF approval_decision ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.notify_deliverable_decision();


-- ───────────────────────────────────────────────────────────────────────────
--  6. Progress is a live figure, so the tables behind it must broadcast
-- ───────────────────────────────────────────────────────────────────────────
--
--  `supabase_realtime` has carried messages, notifications, tasks, projects,
--  attendance, comments and tickets since 0006 — and nothing in the browser
--  ever subscribed to it, so the whole mechanism was inert. The frontend half
--  is `hooks/use-realtime.ts`; this is the rest of the tables it needs.
--
--  Which tables, and why each one:
--
--    milestones      — completing a phase is the single largest move a
--                      project's progress makes.
--    files           — a deliverable approved by a client changes progress and
--                      the health verdict.
--    leave_requests  — "leave approved, and the dashboard updates instantly".
--    invoices        — likewise for finance.
--    expenses        — a claim decided is the same shape of event.
--    channels        — a channel created, renamed or archived changes the
--                      sidebar of everyone in it.
--    channel_members — being added to a channel should make it appear without
--                      a reload; unread counts hang off `last_read_at` here.
--    announcements   — the one thing the organisation pushes at people; an
--                      announcement nobody sees until tomorrow is pointless.
--
--  Still deliberately excluded: the CRM and inventory tables. Two people
--  editing the same lead is rare, the cost is a stale field rather than a wrong
--  number, and publishing a table means every write fans out to every connected
--  client to be discarded by RLS. 0006's reasoning, unchanged.
--
--  `ALTER PUBLICATION ... ADD TABLE` errors if the table is already a member,
--  and `REPLICA IDENTITY FULL` is what makes `filter: project_id=eq.…` work on
--  an UPDATE — without it the event carries only the primary key and a
--  per-project subscription receives nothing. Both are guarded on the table
--  existing, because the chain has to stay re-runnable.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'tasks', 'milestones', 'files', 'comments',
    'leave_requests', 'invoices', 'expenses',
    'channels', 'channel_members', 'announcements'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;
