-- ═══════════════════════════════════════════════════════════════════════════
--  Milestones: an owner, and a place in the progress calculation
-- ═══════════════════════════════════════════════════════════════════════════
--
--  `milestones` and `project_members` have existed since the first migrations,
--  complete with RLS policies and a foreign key from `tasks.milestone_id`.
--  Nothing ever read or wrote either of them, because no endpoint existed — so
--  a project could not be divided into phases, could hold only one person, and
--  every task's `milestone_id` was permanently null.
--
--  The API for both is added in this change. Two things were genuinely missing
--  from the schema to support it.

-- ── 1. A milestone needs an owner ─────────────────────────────────────────
--
-- "Who is accountable for this phase?" is the first question asked of a
-- roadmap, and the table had nowhere to record the answer.
--
-- ON DELETE SET NULL rather than CASCADE: when someone leaves the company the
-- milestone does not disappear with them. It becomes unowned, which is a
-- visible prompt to reassign it — deleting the phase would quietly remove work
-- from the plan.

ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS owner_id uuid
    REFERENCES organization_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.milestones.owner_id IS
  'Who is accountable for this phase. Nulled rather than cascaded when a '
  'membership is removed, so the milestone survives the person leaving.';

CREATE INDEX IF NOT EXISTS idx_milestones_owner
  ON milestones (owner_id) WHERE completed_at IS NULL;

-- ── 2. Progress should count phases, not only tasks ───────────────────────
--
-- `v_project_health` computed progress purely from completed tasks. That is
-- the wrong answer for a project run to a plan: a project with ten small tasks
-- done and its final milestone outstanding is not finished, and one with no
-- tasks recorded at all reported 0% however many phases had shipped.
--
-- The view keeps every column it had — `progress_pct` still means the same
-- thing and the projects endpoint still reads it — and gains the milestone
-- counts alongside. Existing readers are unaffected.

DROP VIEW IF EXISTS public.v_project_health;

CREATE VIEW public.v_project_health
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

  /**
   * Progress, preferring the plan over the task list.
   *
   * Milestones are the better signal when a project has them: they are the
   * deliverables someone agreed to, whereas task counts treat "rename a
   * button" and "ship the API" as equal weight. Projects without milestones
   * fall back to tasks, which is what this column has always meant, so no
   * existing project's number changes until phases are added to it.
   */
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

  /**
   * At risk: past its end date and unfinished, or carrying overdue work.
   *
   * Blocked tasks now count too. A project inside its dates with work nobody
   * can proceed on is exactly the case a status report should surface early,
   * and it was previously invisible.
   */
  (
    (p.end_date < CURRENT_DATE AND p.status NOT IN ('completed', 'cancelled', 'archived'))
    OR COUNT(DISTINCT t.id) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status <> 'done') > 0
    OR COUNT(DISTINCT m.id) FILTER (WHERE m.due_date < CURRENT_DATE AND m.completed_at IS NULL) > 0
    OR COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'blocked') > 0
  )                                           AS is_at_risk

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
  'time remaining and an at-risk flag. The single definition of "progress" — '
  'read by the projects endpoint and the reports, so the board and the report '
  'can never disagree.';
