-- ═══════════════════════════════════════════════════════════════════════════
--  0032 - HR: cycles, goals, reviews and the record of what people did
-- ═══════════════════════════════════════════════════════════════════════════
--
--  HR in this product is attendance, leave and an employee list. That is an
--  employee database, and the brief is explicit that it should not stay one.
--
--  ── The distinction the whole file turns on ──────────────────────────────
--
--  A goal is either **measured** or **assessed**, and both are first class.
--
--    · A measured goal names a metric and a number, and its progress is
--      derived from `business_events` with no human input. "Close forty
--      million this quarter" updates itself, and by the same arithmetic the
--      performance module already uses - not a second one.
--
--    · An assessed goal is judged by a person in a review. "Mentor two junior
--      sellers" has no event stream and never will.
--
--  Systems that support only the first become dashboards nobody trusts for
--  the human half of the job. Systems that support only the second are
--  spreadsheets with a login. This supports both, and marks which is which so
--  a screen never pretends a judgement is a measurement.
--
--  ── What "achievements" is, and is not ───────────────────────────────────
--
--  A record of things somebody did that are worth remembering at review time:
--  led a migration, saved an account, trained the new starter. Dated, written
--  by a person, optionally linked to the event that prompted it.
--
--  It is not badges, points, streaks or levels. The brief rules that out and
--  it is right to: a professional performance record is evidence somebody can
--  cite in a promotion case, and a scoreboard is not evidence.
--
--  ── Where compensation stops ─────────────────────────────────────────────
--
--  Nothing here holds salary. HR owns eligibility, the incentive ledger owns
--  what was earned, and Finance owns what was paid. The moment the first two
--  share a table, every manager who can see a commission can see a wage.
--
--  Idempotent: safe to re-run, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. Vocabulary
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cycle_status') THEN
    CREATE TYPE cycle_status AS ENUM ('planning', 'active', 'reviewing', 'closed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_kind') THEN
    CREATE TYPE goal_kind AS ENUM ('measured', 'assessed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_status') THEN
    CREATE TYPE goal_status AS ENUM ('draft', 'active', 'achieved', 'missed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status') THEN
    /**
     * The sequence a review actually moves through. `shared` is separate from
     * `closed` on purpose: the moment a manager's assessment becomes visible
     * to the person it is about is a real event with a real date, and a
     * system that conflates writing a review with delivering it cannot answer
     * "when was I told this".
     */
    CREATE TYPE review_status AS ENUM ('not_started', 'self_review', 'manager_review', 'shared', 'closed');
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  2. Cycles
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS performance_cycles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text NOT NULL DEFAULT '',
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  status          cycle_status NOT NULL DEFAULT 'planning',
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (organization_id, name)
);

COMMENT ON TABLE public.performance_cycles IS
  'A review period: what it is called, when it runs, and how far along it is.';

CREATE INDEX IF NOT EXISTS idx_cycles_org ON performance_cycles (organization_id, period_start DESC);

DROP TRIGGER IF EXISTS trg_cycles_updated ON performance_cycles;
CREATE TRIGGER trg_cycles_updated BEFORE UPDATE ON performance_cycles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  3. Goals
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS performance_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cycle_id        uuid REFERENCES performance_cycles(id) ON DELETE SET NULL,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  title           text NOT NULL CHECK (btrim(title) <> ''),
  description     text NOT NULL DEFAULT '',

  kind            goal_kind NOT NULL DEFAULT 'assessed',

  /**
   * Only meaningful for a measured goal, and enforced below.
   *
   * `target_id` links to the row `performance_targets` already holds rather
   * than restating the number here. One number, one place: a goal that said
   * "40m" while the target said "45m" would be two answers to the same
   * question, which is the failure this whole phase is built to avoid.
   */
  metric          target_metric,
  target_id       uuid REFERENCES performance_targets(id) ON DELETE SET NULL,

  /** How much of the review this goal accounts for. */
  weight          int NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),

  status          goal_status NOT NULL DEFAULT 'draft',

  /** Assessed goals only: what each side thinks, one to five. */
  self_rating     int CHECK (self_rating BETWEEN 1 AND 5),
  manager_rating  int CHECK (manager_rating BETWEEN 1 AND 5),
  self_comment    text NOT NULL DEFAULT '',
  manager_comment text NOT NULL DEFAULT '',

  due_on          date,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.performance_goals IS
  'What somebody is working towards. Measured goals read their progress from business_events; assessed goals are judged by a person.';

CREATE INDEX IF NOT EXISTS idx_goals_member
  ON performance_goals (organization_id, member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goals_cycle ON performance_goals (cycle_id);

DROP TRIGGER IF EXISTS trg_goals_updated ON performance_goals;
CREATE TRIGGER trg_goals_updated BEFORE UPDATE ON performance_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * A measured goal has to be measurable, and an assessed one must not pretend
 * to be measured.
 *
 * The failure this prevents is a goal marked `measured` with no metric, which
 * renders as a progress bar at zero for ever and reads as "this person has
 * done nothing" rather than "nobody said what to count".
 */
CREATE OR REPLACE FUNCTION public.check_performance_goal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kind = 'measured' AND NEW.metric IS NULL THEN
    RAISE EXCEPTION 'A measured goal needs something to measure. Choose a metric, or make it an assessed goal.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.kind = 'assessed' AND (NEW.metric IS NOT NULL OR NEW.target_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An assessed goal is judged, not counted. Remove the metric or make it a measured goal.'
      USING ERRCODE = 'check_violation';
  END IF;

  /* A rating is a review's business, not a draft's. */
  IF NEW.kind = 'measured' AND (NEW.self_rating IS NOT NULL OR NEW.manager_rating IS NOT NULL) THEN
    RAISE EXCEPTION 'A measured goal is scored by its numbers, not by a rating.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_performance_goal ON performance_goals;
CREATE TRIGGER trg_check_performance_goal
  BEFORE INSERT OR UPDATE ON performance_goals
  FOR EACH ROW EXECUTE FUNCTION public.check_performance_goal();

-- ───────────────────────────────────────────────────────────────────────────
--  4. Reviews
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS performance_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cycle_id        uuid NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  reviewer_id     uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  status          review_status NOT NULL DEFAULT 'not_started',

  self_comment    text NOT NULL DEFAULT '',
  manager_comment text NOT NULL DEFAULT '',
  /** One to five, and deliberately nullable until somebody commits to one. */
  overall_rating  int CHECK (overall_rating BETWEEN 1 AND 5),

  /**
   * Eligibility, not entitlement, and not an amount.
   *
   * Whether this person qualifies for the incentive scheme in the period the
   * review covers. What they actually earned lives in `incentive_entries` and
   * what they were paid lives in Finance. Three tables, three facts, one
   * owner each.
   */
  incentive_eligible boolean,
  eligibility_note   text NOT NULL DEFAULT '',

  shared_at       timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (cycle_id, member_id)
);

COMMENT ON TABLE public.performance_reviews IS
  'One person, one cycle. `shared_at` records when the assessment became visible to its subject, which is not the same moment it was written.';

CREATE INDEX IF NOT EXISTS idx_reviews_member
  ON performance_reviews (organization_id, member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_cycle ON performance_reviews (cycle_id, status);

DROP TRIGGER IF EXISTS trg_reviews_updated ON performance_reviews;
CREATE TRIGGER trg_reviews_updated BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * Stamp the two moments that matter, and refuse the one that cannot happen.
 */
CREATE OR REPLACE FUNCTION public.stamp_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'shared' AND (OLD.status IS DISTINCT FROM 'shared') THEN
    NEW.shared_at := COALESCE(NEW.shared_at, now());
  END IF;

  IF NEW.status = 'closed' AND (OLD.status IS DISTINCT FROM 'closed') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    /* A review nobody saw cannot be finished. */
    IF NEW.shared_at IS NULL THEN
      RAISE EXCEPTION 'Share the review with the person before closing it.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_review ON performance_reviews;
CREATE TRIGGER trg_stamp_review
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.stamp_review();

/** The person is told when their review is shared, and not before. */
CREATE OR REPLACE FUNCTION public.notify_review_shared()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'shared' AND OLD.status IS DISTINCT FROM 'shared' THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    VALUES (
      NEW.organization_id, NEW.member_id, 'review_shared',
      'Your review is ready',
      (SELECT name FROM performance_cycles WHERE id = NEW.cycle_id),
      'review', NEW.id,
      '/dashboard?module=hr&review=' || NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_review_shared ON performance_reviews;
CREATE TRIGGER trg_notify_review_shared
  AFTER UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.notify_review_shared();

-- ───────────────────────────────────────────────────────────────────────────
--  5. Achievements
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS performance_achievements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  title           text NOT NULL CHECK (btrim(title) <> ''),
  description     text NOT NULL DEFAULT '',

  /** Optional evidence: the event that prompted it, if there was one. */
  source_event_id bigint REFERENCES business_events(id) ON DELETE SET NULL,

  happened_on     date NOT NULL DEFAULT current_date,
  recorded_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.performance_achievements IS
  'Things worth remembering at review time. Written by a person, dated, citable. Not badges, points or levels.';

CREATE INDEX IF NOT EXISTS idx_achievements_member
  ON performance_achievements (organization_id, member_id, happened_on DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  6. Row-level security
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE performance_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_cycles FORCE ROW LEVEL SECURITY;

/** A cycle is company-wide news. Everybody may see when review season is. */
DROP POLICY IF EXISTS performance_cycles_select ON performance_cycles;
CREATE POLICY performance_cycles_select ON performance_cycles FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'hr')
  );

DROP POLICY IF EXISTS performance_cycles_write ON performance_cycles;
CREATE POLICY performance_cycles_write ON performance_cycles FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE performance_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_goals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS performance_goals_select ON performance_goals;
CREATE POLICY performance_goals_select ON performance_goals FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  );

/**
 * Your own goals are yours to update, and a manager's people's are theirs.
 *
 * An employee writing their own self-rating and self-comment is the ordinary
 * case in every review system, so `own` write access is deliberate. What
 * stops that being a way to award yourself a five is that a self-rating and a
 * manager rating are different columns, and the screen shows both.
 */
DROP POLICY IF EXISTS performance_goals_write ON performance_goals;
CREATE POLICY performance_goals_write ON performance_goals FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  );

ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews FORCE ROW LEVEL SECURITY;

/**
 * A review is readable by its subject only once it has been shared.
 *
 * This is the one policy in the phase that hides something from the person it
 * is about, and it is deliberate: a manager drafting an assessment needs to
 * be able to think out loud, and an employee reading a half-written review of
 * themselves is worse for both of them than waiting. `shared_at` is the
 * moment that ends, and the trigger above records it.
 */
DROP POLICY IF EXISTS performance_reviews_select ON performance_reviews;
CREATE POLICY performance_reviews_select ON performance_reviews FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      /* HR and administrators run the process and see it throughout. */
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      /* The reviewer, and anyone who manages this person. */
      OR reviewer_id = public.auth_member_id(organization_id)
      OR (
        member_id = ANY (public.auth_visible_member_ids(organization_id))
        AND member_id <> public.auth_member_id(organization_id)
      )
      /* The subject, once it has been shared with them. */
      OR (member_id = public.auth_member_id(organization_id) AND shared_at IS NOT NULL)
    )
  );

/**
 * Writing, split into INSERT, UPDATE and DELETE rather than FOR ALL.
 *
 * ── The trap this avoids, which it fell into once ────────────────────────
 *
 * A `FOR ALL` policy's `USING` clause applies to SELECT as well, and
 * permissive policies are OR'd together. So a write policy saying "you may
 * touch rows about people you can see" quietly granted every employee SELECT
 * on their own review - re-opening exactly what the select policy above was
 * written to hide, and doing it invisibly, because both policies looked
 * correct in isolation.
 *
 * Caught by driving it: an employee asked for their own unshared review and
 * got it. Any table whose read rule is narrower than its write rule needs
 * this split, and that is most of them.
 */
DROP POLICY IF EXISTS performance_reviews_write ON performance_reviews;

DROP POLICY IF EXISTS performance_reviews_insert ON performance_reviews;
CREATE POLICY performance_reviews_insert ON performance_reviews FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR reviewer_id = public.auth_member_id(organization_id)
      OR (
        member_id = ANY (public.auth_visible_member_ids(organization_id))
        AND member_id <> public.auth_member_id(organization_id)
      )
    )
  );

/**
 * The subject may update their own review only once it has been shared, and
 * that is how they write their self-assessment on a review they can see.
 * Before sharing it is the reviewer's document.
 */
DROP POLICY IF EXISTS performance_reviews_update ON performance_reviews;
CREATE POLICY performance_reviews_update ON performance_reviews FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR reviewer_id = public.auth_member_id(organization_id)
      OR (
        member_id = ANY (public.auth_visible_member_ids(organization_id))
        AND member_id <> public.auth_member_id(organization_id)
      )
      OR (member_id = public.auth_member_id(organization_id) AND shared_at IS NOT NULL)
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR reviewer_id = public.auth_member_id(organization_id)
      OR (
        member_id = ANY (public.auth_visible_member_ids(organization_id))
        AND member_id <> public.auth_member_id(organization_id)
      )
      OR (member_id = public.auth_member_id(organization_id) AND shared_at IS NOT NULL)
    )
  );

/** Only the people who run the process may remove one. */
DROP POLICY IF EXISTS performance_reviews_delete ON performance_reviews;
CREATE POLICY performance_reviews_delete ON performance_reviews FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE performance_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_achievements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS performance_achievements_select ON performance_achievements;
CREATE POLICY performance_achievements_select ON performance_achievements FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  );

/**
 * Recorded about somebody, by somebody else.
 *
 * Not writable for yourself: a record of accomplishments that people can add
 * to about themselves is a self-assessment, and this is meant to be evidence
 * a promotion case can cite. Managers, HR and administrators write it.
 */
DROP POLICY IF EXISTS performance_achievements_write ON performance_achievements;
CREATE POLICY performance_achievements_write ON performance_achievements FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id <> public.auth_member_id(organization_id)
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND member_id <> public.auth_member_id(organization_id)
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  );

-- ───────────────────────────────────────────────────────────────────────────
--  7. Realtime
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'performance_cycles', 'performance_goals',
    'performance_reviews', 'performance_achievements'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
