-- ═══════════════════════════════════════════════════════════════════════════
--  0034 - Project delivery: external resources, and dependencies that hold
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Phase 6 is the Projects module. Almost everything it needed was already in
--  the schema and simply unreachable from the screen - `tasks.milestone_id`,
--  `comments.parent_id`, `files.requires_approval` and the whole approval
--  chain. Those are fixed in the application, because the database was never
--  the thing that was wrong.
--
--  Two are genuinely missing, and this migration adds them.
--
--  ── 1. A project resource that is not a file ─────────────────────────────
--
--  A project's important material is not all bytes in a bucket. The design
--  lives in Figma, the spec in Google Docs, the staging build behind a URL.
--  Today those are pasted into the discussion, where they scroll away, and a
--  new person joining the project has no way to find them.
--
--  The answer is *not* a second table. A link and an upload answer the same
--  question - "where is the thing" - are filed in the same folders, are shared
--  with the client through the same switch, and are put forward for approval
--  in the same way. Two tables would mean two lists, two visibility rules and
--  two halves of one file panel that can never sort together.
--
--  So a link is a `files` row whose bytes live somewhere else. `bucket` is
--  the discriminator, `external_url` carries the address, and a CHECK keeps
--  the two honest in both directions.
--
--  ── 2. Dependencies that a second tenant cannot forge ────────────────────
--
--  `task_dependencies` has had a table, a self-reference guard and an RLS
--  policy since 0003, and nothing in the product has ever written a row. The
--  Projects phase gives it its first consumer - "blocked by" is the honest
--  answer to why a task has not started - which is the moment its policy gets
--  read properly for the first time.
--
--  It only checks one end:
--
--      USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND ...))
--
--  `depends_on_id` is unconstrained, so a member of organization A could make
--  their own task depend on a task belonging to organization B. The row would
--  be accepted, and the id of another tenant's task would then be readable
--  back out of it. It has never mattered because nothing wrote the table; it
--  would matter from the first release that did.
--
--  Cycles get a guard for the same reason: nothing has ever walked this graph,
--  and the first thing that does should not be able to walk it forever.
--
--  Everything here is additive and idempotent. No column is dropped, no
--  default changes, and every existing row satisfies the new constraints.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  1. External resources
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS external_url text;

COMMENT ON COLUMN public.files.external_url IS
  'For a resource stored outside the platform - a Figma file, a shared drive '
  'folder, a staging URL. Set if and only if bucket = ''link'', in which case '
  '`path` is a synthetic key under the organization''s prefix that exists only '
  'to satisfy the (bucket, path) uniqueness constraint, and nothing is ever '
  'signed or fetched from storage for this row.';

/**
 * The discriminator, enforced in both directions.
 *
 * Without the second half, a row could carry a link *and* claim a stored
 * object, and `GET /api/projects/files/[id]` would sign a path that has no
 * bytes behind it - failing with a storage error on a row that was never
 * meant to be signed. Stated as one constraint so a row cannot be half of
 * each.
 */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_external_url_bucket'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_external_url_bucket CHECK (
        (external_url IS NULL AND bucket <> 'link')
        OR (external_url IS NOT NULL AND bucket = 'link' AND btrim(external_url) <> '')
      );
  END IF;
END $$;

-- The file panel lists a project's resources newest first, links included.
CREATE INDEX IF NOT EXISTS idx_files_project_created
  ON files (project_id, created_at DESC) WHERE deleted_at IS NULL;


-- ───────────────────────────────────────────────────────────────────────────
--  2. Task dependencies
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Both ends of the edge, in the caller's organization.
 *
 * `FOR ALL` with a `USING` that names both tasks means a row is invisible as
 * well as unwritable if either end is out of reach, so a dependency created
 * before this migration against another tenant's task stops being readable
 * rather than needing a data fix.
 */
DROP POLICY IF EXISTS task_dependencies_all ON task_dependencies;
CREATE POLICY task_dependencies_all ON task_dependencies FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tasks t
             WHERE t.id = task_id
               AND t.organization_id = ANY (public.auth_org_ids()))
    AND EXISTS (SELECT 1 FROM tasks d
                 WHERE d.id = depends_on_id
                   AND d.organization_id = ANY (public.auth_org_ids()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tasks t
             WHERE t.id = task_id
               AND t.organization_id = ANY (public.auth_org_ids()))
    AND EXISTS (SELECT 1 FROM tasks d
                 WHERE d.id = depends_on_id
                   AND d.organization_id = ANY (public.auth_org_ids()))
  );

/**
 * "What is this task holding up?"
 *
 * The primary key indexes `(task_id, depends_on_id)`, which answers "what is
 * this waiting on". The reverse question is the one a person asks when they
 * finish something, and it had no index at all.
 */
CREATE INDEX IF NOT EXISTS idx_task_deps_reverse
  ON task_dependencies (depends_on_id);

-- The roadmap groups a project's tasks by phase.
CREATE INDEX IF NOT EXISTS idx_tasks_milestone
  ON tasks (milestone_id) WHERE deleted_at IS NULL AND milestone_id IS NOT NULL;

/**
 * A dependency cannot close a loop.
 *
 * `no_self_dependency` catches A → A. It cannot catch A → B → A, because a
 * CHECK sees one row. Two tasks each waiting for the other is not a schedule
 * anybody can act on, and it is the kind of state that gets created by
 * accident once and then confuses people for months.
 *
 * The walk starts at the *proposed* dependency and follows what that task is
 * itself waiting on. If it reaches the task being edited, the edge would
 * close a cycle. Depth is bounded by the graph, which is bounded by the
 * project - and every edge is visited once, because the recursive term joins
 * on the frontier rather than the whole table.
 */
CREATE OR REPLACE FUNCTION public.reject_dependency_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  loops boolean;
BEGIN
  WITH RECURSIVE upstream(id) AS (
    SELECT NEW.depends_on_id
    UNION
    SELECT d.depends_on_id
      FROM task_dependencies d
      JOIN upstream u ON d.task_id = u.id
  )
  SELECT EXISTS (SELECT 1 FROM upstream WHERE id = NEW.task_id) INTO loops;

  IF loops THEN
    RAISE EXCEPTION 'That would make two tasks wait for each other.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_dependency_cycle ON task_dependencies;
CREATE TRIGGER trg_reject_dependency_cycle
  BEFORE INSERT OR UPDATE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.reject_dependency_cycle();

COMMENT ON TABLE public.task_dependencies IS
  'Which task waits for which. `task_id` cannot start until `depends_on_id` is '
  'done. Both ends are checked against the caller''s organizations by the row '
  'policy, and a trigger refuses any edge that would close a cycle.';


-- ───────────────────────────────────────────────────────────────────────────
--  3. When a task was actually finished
-- ───────────────────────────────────────────────────────────────────────────

/**
 * `tasks.completed_at` has existed since 0003 and nothing has ever written it.
 *
 * A project timeline has to say *when* work was done, and the only other
 * candidate is `updated_at` - which moves when somebody fixes a typo in the
 * title, so a task finished in March appears on the timeline in August. The
 * same column is what makes "twelve tasks closed this week" answerable at all;
 * without it the only honest thing the delivery view could say was how many
 * are done in total, which never goes down and therefore never means anything.
 *
 * A trigger rather than the endpoint, for the reason every other stamp in this
 * schema is a trigger: `tasks` is written by the collection route, the record
 * route, the roadmap and the board, and a rule enforced in four places is a
 * rule that holds in three.
 *
 * Reopening clears it. A task that goes back to `in_progress` and keeps a
 * completion date is a row that claims to be both.
 */
CREATE OR REPLACE FUNCTION public.stamp_task_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'done' THEN
      -- A date sent deliberately with the same request wins; this only fills
      -- the gap where the caller said nothing.
      IF NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN
        NEW.completed_at := now();
      END IF;
    ELSE
      NEW.completed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_task_completion ON tasks;
CREATE TRIGGER trg_stamp_task_completion
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.stamp_task_completion();

/**
 * The rows that were already done when this arrived.
 *
 * Backfilled from `updated_at`, which for a completed task is usually the edit
 * that completed it. It is an estimate and it is the only evidence there is -
 * but leaving them null would mean every task finished before today vanishes
 * from the delivery view's history, which reads as data loss rather than as a
 * column that is new. Only rows that are `done` and have no date are touched.
 */
UPDATE tasks
   SET completed_at = updated_at
 WHERE status = 'done' AND completed_at IS NULL AND deleted_at IS NULL;

-- "What was finished recently", per organization.
CREATE INDEX IF NOT EXISTS idx_tasks_completed
  ON tasks (organization_id, completed_at DESC)
  WHERE deleted_at IS NULL AND completed_at IS NOT NULL;
