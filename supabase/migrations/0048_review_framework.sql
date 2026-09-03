-- ═══════════════════════════════════════════════════════════════════════════
--  0048 — The formal review: competencies, 360 feedback, calibration,
--         and readiness
-- ═══════════════════════════════════════════════════════════════════════════
--
--  0032 built the spine of a review process — cycles, goals, a review that
--  cannot be closed before the person has seen it — and stopped there. What it
--  left out is everything a review is actually made of once more than one
--  person is involved:
--
--   · a **competency framework**, so "communication" means the same thing in
--     two departments and a rating can be compared at all;
--   · **feedback from colleagues**, because a manager sees a fraction of what
--     somebody does and a review written from that fraction is a review of
--     the fraction;
--   · **calibration**, because a 4 from a generous manager and a 4 from a
--     severe one are not the same 4, and the correction has to be recorded
--     rather than quietly applied;
--   · **promotion readiness**, recorded as a judgement somebody made and
--     signed, never as a number the system computed.
--
--  ── The line this migration will not cross ──────────────────────────────
--
--  Nothing here scores anybody automatically. `lib/evidence.ts` refuses to
--  produce a composite number and this schema refuses to store one: there is
--  no `overall_score` column, no weighting of competencies into a total, and
--  promotion readiness is an enum a person selects with a written note beside
--  it. The evidence layer (0047) tells a manager what happened; this tells
--  them what other people thought; the judgement in between stays human and
--  stays attributable.
--
--  ── Who may read 360 feedback ───────────────────────────────────────────
--
--  The subject of a review **cannot read the feedback rows at all**, and that
--  is the design rather than an omission.
--
--  The alternative was to show it to them anonymously after the review was
--  shared. Anonymity in a small team is a promise the data cannot keep: three
--  responses, one of which mentions a project only two people worked on, and
--  the author is identified. Colleagues who work that out stop writing
--  anything worth reading, which destroys the instrument for everybody.
--
--  So feedback informs the manager's written assessment, and the assessment is
--  what the person reads — attributable to the manager, who signed it. That is
--  also what makes it answerable: there is a named person to discuss it with.
--
--  Idempotent, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. Vocabulary
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feedback_relationship') THEN
    /**
     * How the respondent knows the subject.
     *
     * Stored because it changes how the answer should be read, not to rank
     * the answers: a direct report describing how somebody delegates is
     * evidence a peer cannot give, and a manager's view of the same is a
     * third thing again.
     */
    CREATE TYPE feedback_relationship AS ENUM
      ('peer', 'report', 'manager', 'stakeholder');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feedback_status') THEN
    /**
     * `declined` is a real outcome, not a failure to respond.
     *
     * Somebody who has not worked with the subject should say so rather than
     * invent an opinion, and a request that sits at `pending` for ever is
     * indistinguishable from one that was never seen.
     */
    CREATE TYPE feedback_status AS ENUM ('pending', 'submitted', 'declined');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'promotion_readiness') THEN
    /**
     * Deliberately not a number.
     *
     * A 1-5 readiness scale invites averaging, and an averaged readiness is a
     * promotion decision made by arithmetic. These are four statements a
     * person can defend in a room.
     */
    CREATE TYPE promotion_readiness AS ENUM
      ('too_early', 'developing', 'ready_within_a_year', 'ready_now');
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  2. The competency framework
-- ───────────────────────────────────────────────────────────────────────────

/**
 * What this organisation assesses people on.
 *
 * Org-owned rather than global: "ownership" means something different in a
 * hospital and an agency, and a built-in list would be wrong for both. Empty
 * until somebody defines it, and the review screens say so rather than
 * inventing five plausible-sounding competencies — a framework nobody wrote
 * is one nobody will stand behind in a review.
 */
CREATE TABLE IF NOT EXISTS competencies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text NOT NULL DEFAULT '',
  /** Free text rather than an enum: an organisation's own grouping. */
  category        text NOT NULL DEFAULT '',

  /**
   * Retired rather than deleted.
   *
   * A competency that has been rated in a closed review is part of that
   * review's meaning for ever. Dropping the row would leave the rating
   * pointing at nothing, so the framework is changed by deactivating and
   * adding, exactly as the incentive rules are versioned rather than edited.
   */
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,

  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_competencies_org
  ON competencies (organization_id, is_active, sort_order);

DROP TRIGGER IF EXISTS trg_competencies_updated ON competencies;
CREATE TRIGGER trg_competencies_updated BEFORE UPDATE ON competencies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.competencies IS
  'What this organization assesses people on. Retired with is_active rather than deleted, because a rating in a closed review must keep pointing at something.';

/**
 * One competency, rated inside one review.
 *
 * Self and manager ratings side by side and never merged, for the reason 0032
 * gives for goals: the gap between the two *is* the conversation, and an
 * average of them describes nobody.
 */
CREATE TABLE IF NOT EXISTS review_competencies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id       uuid NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  competency_id   uuid NOT NULL REFERENCES competencies(id) ON DELETE RESTRICT,

  self_rating     int CHECK (self_rating BETWEEN 1 AND 5),
  manager_rating  int CHECK (manager_rating BETWEEN 1 AND 5),
  self_comment    text NOT NULL DEFAULT '',
  manager_comment text NOT NULL DEFAULT '',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (review_id, competency_id)
);

CREATE INDEX IF NOT EXISTS idx_review_competencies_review
  ON review_competencies (review_id);

DROP TRIGGER IF EXISTS trg_review_competencies_updated ON review_competencies;
CREATE TRIGGER trg_review_competencies_updated BEFORE UPDATE ON review_competencies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  3. Feedback from colleagues
-- ───────────────────────────────────────────────────────────────────────────

/**
 * A request for feedback and the answer to it, in one row.
 *
 * One row rather than a request table and a response table: the two are
 * strictly one-to-one, and splitting them buys nothing except the possibility
 * of a response with no request, which is the thing that must not exist.
 */
CREATE TABLE IF NOT EXISTS review_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id       uuid NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,

  /** Who is being described, denormalised so the row stands alone in a query. */
  subject_id      uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  respondent_id   uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  relationship    feedback_relationship NOT NULL DEFAULT 'peer',

  status          feedback_status NOT NULL DEFAULT 'pending',

  /**
   * Two questions, not a form.
   *
   * "What should they keep doing" and "what would make the biggest
   * difference" are the two a person can answer honestly about a colleague in
   * five minutes. A ten-field rubric produces ten empty fields.
   */
  strengths       text NOT NULL DEFAULT '',
  improvements    text NOT NULL DEFAULT '',

  /**
   * Optional, and optional on purpose.
   *
   * A colleague's overall number is the least useful thing they can give and
   * the easiest to give thoughtlessly. The prose is the point; this is here
   * because some organisations require it and refusing outright would push
   * them to record it somewhere worse.
   */
  rating          int CHECK (rating BETWEEN 1 AND 5),

  requested_by    uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  due_on          date,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  /** One request per person per review. Asking twice is asking again, not twice. */
  UNIQUE (review_id, respondent_id),

  /** Nobody reviews themselves through this instrument; that is `self_comment`. */
  CHECK (respondent_id <> subject_id)
);

CREATE INDEX IF NOT EXISTS idx_review_feedback_review
  ON review_feedback (review_id, status);
CREATE INDEX IF NOT EXISTS idx_review_feedback_respondent
  ON review_feedback (organization_id, respondent_id, status);

DROP TRIGGER IF EXISTS trg_review_feedback_updated ON review_feedback;
CREATE TRIGGER trg_review_feedback_updated BEFORE UPDATE ON review_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.review_feedback IS
  'A request for feedback on somebody, and the answer. The subject of the review cannot read these rows: see the header of migration 0048 for why anonymity in a small team is a promise the data cannot keep.';

/**
 * Submitting stamps the date, and a submission has to say something.
 *
 * An empty submission is worse than a pending one: it looks like an answer in
 * every count and tells the manager nothing. `declined` is the honest route
 * for somebody who has nothing to say, and it stays open to them.
 */
CREATE OR REPLACE FUNCTION public.stamp_review_feedback()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted' THEN
    IF btrim(NEW.strengths) = '' AND btrim(NEW.improvements) = '' THEN
      RAISE EXCEPTION 'Write something before submitting, or decline the request instead.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.submitted_at := COALESCE(NEW.submitted_at, now());
  END IF;

  /**
   * Reverting to pending clears the date.
   *
   * Same reasoning as reopening a task: a row that is pending and carries a
   * submission date claims two things at once.
   */
  IF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
    NEW.submitted_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_review_feedback ON review_feedback;
CREATE TRIGGER trg_stamp_review_feedback
  BEFORE UPDATE ON review_feedback
  FOR EACH ROW EXECUTE FUNCTION public.stamp_review_feedback();

/** The respondent is told they have been asked, in the tray they already read. */
CREATE OR REPLACE FUNCTION public.notify_feedback_requested()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  who text;
BEGIN
  SELECT p.full_name INTO who
  FROM organization_members m
  JOIN profiles p ON p.id = m.user_id
  WHERE m.id = NEW.subject_id;

  INSERT INTO notifications (
    organization_id, recipient_id, type, title, body, entity_type, entity_id, link
  )
  VALUES (
    NEW.organization_id, NEW.respondent_id, 'feedback_requested',
    'Feedback asked of you',
    'About ' || COALESCE(who, 'a colleague'),
    'review_feedback', NEW.id,
    '/dashboard?module=hr&feedback=' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_feedback_requested ON review_feedback;
CREATE TRIGGER trg_notify_feedback_requested
  AFTER INSERT ON review_feedback
  FOR EACH ROW EXECUTE FUNCTION public.notify_feedback_requested();

-- ───────────────────────────────────────────────────────────────────────────
--  4. Readiness, and calibration
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE performance_reviews
  ADD COLUMN IF NOT EXISTS promotion_readiness promotion_readiness,
  ADD COLUMN IF NOT EXISTS readiness_note      text NOT NULL DEFAULT '',
  /**
   * Why the overall rating was last moved.
   *
   * Its own column rather than borrowing `eligibility_note`, which answers a
   * different question (whether this person qualifies for an incentive) and
   * would end up holding two unrelated sentences that nobody could tell apart
   * six months later. This is the exact shape of `adjustment_reason` on
   * `attendance_records`, and it is read by the trigger below in the same way.
   */
  ADD COLUMN IF NOT EXISTS calibration_reason  text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.performance_reviews.promotion_readiness IS
  'A judgement a named person made, never a computed figure. Null means not assessed, which is different from not ready.';

/**
 * Every change a calibration session made to a rating.
 *
 * ── Why a table and not two columns ─────────────────────────────────────
 *
 * Calibration happens more than once — a manager round, then a leadership
 * round — and `rating_before_calibration` can only remember the first. This is
 * the same shape as `attendance_adjustments` (0046) and for the same reason:
 * a correction that overwrites what it corrected leaves nothing to audit, and
 * "why is my rating a 3 when my manager wrote 4" is precisely the question a
 * person is entitled to an answer to.
 *
 * Append-only. There is no UPDATE and no DELETE policy.
 */
CREATE TABLE IF NOT EXISTS review_calibrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id       uuid NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,

  previous_rating int CHECK (previous_rating BETWEEN 1 AND 5),
  new_rating      int CHECK (new_rating BETWEEN 1 AND 5),

  /**
   * NOT NULL and non-blank, for the reason 0046 gives for a correction
   * reason: a rating moved without a stated reason is indistinguishable from
   * a rating moved to fit a distribution, which is the failure mode
   * calibration is accused of and has to be able to disprove.
   */
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  calibrated_by   uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_calibrations_review
  ON review_calibrations (review_id, created_at DESC);

COMMENT ON TABLE public.review_calibrations IS
  'Append-only record of every rating change made during calibration: what it was, what it became, who moved it and why. Written by a trigger; there is no INSERT policy for clients.';

/**
 * Record a rating change once the review is being calibrated.
 *
 * Only fires once a review has reached `manager_review` or beyond: a manager
 * revising their own draft before anybody has seen it is drafting, not
 * calibrating, and logging every keystroke of that would bury the changes
 * that matter.
 */
CREATE OR REPLACE FUNCTION public.record_review_calibration()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.overall_rating IS NOT DISTINCT FROM OLD.overall_rating THEN
    RETURN NEW;
  END IF;

  /**
   * Drafting is not calibrating.
   *
   * A reviewer moving their own figure before anybody has seen it is writing,
   * and logging every revision of a draft would bury the two changes that
   * actually matter under twenty that do not. The first rating is likewise
   * not a change — there is nothing it moved from.
   */
  IF OLD.status IN ('not_started', 'self_review') OR OLD.overall_rating IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO review_calibrations (
    organization_id, review_id, previous_rating, new_rating, reason, calibrated_by
  )
  VALUES (
    NEW.organization_id, NEW.id, OLD.overall_rating, NEW.overall_rating,
    btrim(NEW.calibration_reason),
    public.auth_member_id(NEW.organization_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_review_calibration ON performance_reviews;
CREATE TRIGGER trg_record_review_calibration
  AFTER UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.record_review_calibration();

/**
 * Moving a settled rating requires a reason, and the refusal is loud.
 *
 * BEFORE, so the write never lands rather than landing and failing to log.
 * Loud because the person doing it is authorised and needs to be told what is
 * missing — the same division 0046 draws between an unauthorised write, which
 * is silently neutered, and an authorised one that is incomplete.
 *
 * `review_calibrations.reason` is NOT NULL with a non-blank CHECK, so without
 * this the insert above would fail with a constraint error naming a table the
 * caller has never heard of. This turns that into a sentence.
 */
CREATE OR REPLACE FUNCTION public.require_calibration_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.overall_rating IS DISTINCT FROM OLD.overall_rating
     AND OLD.overall_rating IS NOT NULL
     AND OLD.status NOT IN ('not_started', 'self_review')
     AND btrim(COALESCE(NEW.calibration_reason, '')) = '' THEN
    RAISE EXCEPTION 'Say why this rating is changing. A rating moved without a reason cannot be explained to the person it is about.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_calibration_reason ON performance_reviews;
CREATE TRIGGER trg_require_calibration_reason
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.require_calibration_reason();

-- ───────────────────────────────────────────────────────────────────────────
--  5. The self-review stage, made reachable
-- ───────────────────────────────────────────────────────────────────────────
--
--  `performance_reviews_select` (0032) lets the subject read their own review
--  only once `shared_at IS NOT NULL`. The status before that is called
--  `self_review` and the screen labels it "With the employee" — but the
--  employee could not read the row, so they could not write their own account
--  of the period and could not rate themselves against anything. The stage
--  existed in the enum and was unreachable in practice.
--
--  Widening the policy alone would leak the other half: a manager who had
--  already typed a rating would have it visible to the person before the
--  conversation. So the two changes below only make sense together —
--
--    · the subject may read their own review while it is theirs to fill in;
--    · nobody may write the manager's half while it is at that stage.
--
--  The second is a workflow rule worth having on its own account. Assessing
--  somebody before reading what they said about themselves is the thing the
--  self-review stage exists to prevent.

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
      /* The subject: while it is their turn, and once it has been shared. */
      OR (
        member_id = public.auth_member_id(organization_id)
        AND (shared_at IS NOT NULL OR status = 'self_review')
      )
    )
  );

/**
 * The manager's half stays shut while the review is with the employee.
 *
 * Enforced here rather than by the screen not showing the field, because the
 * policy above now makes those columns readable to the subject at that stage
 * and "nobody would send that request" is not a security property.
 *
 * `not_started` is not covered: a reviewer setting up a review before handing
 * it over is ordinary preparation, and the subject cannot read the row then.
 */
CREATE OR REPLACE FUNCTION public.guard_self_review_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'self_review' OR OLD.status <> 'self_review' THEN
    RETURN NEW;
  END IF;

  IF NEW.overall_rating IS DISTINCT FROM OLD.overall_rating
     OR NEW.manager_comment IS DISTINCT FROM OLD.manager_comment
     OR NEW.promotion_readiness IS DISTINCT FROM OLD.promotion_readiness THEN
    RAISE EXCEPTION 'This review is still with % — move it on before assessing it.',
      COALESCE((SELECT p.full_name FROM organization_members m
                JOIN profiles p ON p.id = m.user_id WHERE m.id = NEW.member_id),
               'the employee')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_self_review_stage ON performance_reviews;
CREATE TRIGGER trg_guard_self_review_stage
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_self_review_stage();

/**
 * And the subject writes their own half.
 *
 * 0032 gave `performance_reviews` an UPDATE policy for HR and the reviewer.
 * The subject was never admitted, which is the other half of why the
 * self-review stage did not work. They may write their own account and
 * nothing else: every other column is put back, silently, in the same shape
 * 0046 uses for an attendance row somebody is not entitled to change.
 */
CREATE OR REPLACE FUNCTION public.restrict_self_review_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.auth_member_id(NEW.organization_id) IS DISTINCT FROM NEW.member_id THEN
    RETURN NEW;
  END IF;
  IF public.auth_role_in(NEW.organization_id) IN ('owner', 'administrator', 'hr_staff') THEN
    RETURN NEW;
  END IF;

  /* The subject writing on their own review: only `self_comment` moves. */
  NEW.status              := OLD.status;
  NEW.reviewer_id         := OLD.reviewer_id;
  NEW.manager_comment     := OLD.manager_comment;
  NEW.overall_rating      := OLD.overall_rating;
  NEW.promotion_readiness := OLD.promotion_readiness;
  NEW.readiness_note      := OLD.readiness_note;
  NEW.incentive_eligible  := OLD.incentive_eligible;
  NEW.eligibility_note    := OLD.eligibility_note;
  NEW.shared_at           := OLD.shared_at;
  NEW.closed_at           := OLD.closed_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restrict_self_review_write ON performance_reviews;
CREATE TRIGGER trg_restrict_self_review_write
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.restrict_self_review_write();

DROP POLICY IF EXISTS performance_reviews_self_update ON performance_reviews;
CREATE POLICY performance_reviews_self_update ON performance_reviews FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
    AND status = 'self_review'
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
--  6. Row-level security
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE competencies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competencies         FORCE  ROW LEVEL SECURITY;
ALTER TABLE review_competencies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_competencies  FORCE  ROW LEVEL SECURITY;
ALTER TABLE review_feedback      ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_feedback      FORCE  ROW LEVEL SECURITY;
ALTER TABLE review_calibrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_calibrations  FORCE  ROW LEVEL SECURITY;

/**
 * The framework is readable by everybody in the organisation.
 *
 * Being assessed against a standard you are not allowed to read is the
 * complaint every competency framework attracts, and it is a fair one.
 */
DROP POLICY IF EXISTS competencies_select ON competencies;
CREATE POLICY competencies_select ON competencies FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids()));

/** Writing it is HR's: a competency framework is a policy, not a team preference. */
DROP POLICY IF EXISTS competencies_write ON competencies;
CREATE POLICY competencies_write ON competencies FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

/**
 * A competency rating is readable by exactly whoever may read its review.
 *
 * Stated as a subquery against `performance_reviews` rather than copied out,
 * because 0032's rule is intricate — HR, the reviewer, anyone who manages the
 * person, and the subject once it is shared — and a second copy of it here is
 * a second thing to keep correct. If that rule changes, this follows.
 */
DROP POLICY IF EXISTS review_competencies_select ON review_competencies;
CREATE POLICY review_competencies_select ON review_competencies FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (SELECT 1 FROM performance_reviews r WHERE r.id = review_id)
  );

/**
 * Writing one is the reviewer's or HR's — with one deliberate exception.
 *
 * The subject writes their own self-rating, and only while the review is at
 * `self_review`. After that the assessment has moved on and reopening their
 * own ratings would let somebody edit the thing their manager has already
 * responded to.
 */
DROP POLICY IF EXISTS review_competencies_write ON review_competencies;
CREATE POLICY review_competencies_write ON review_competencies FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM performance_reviews r
      WHERE r.id = review_id
        AND (
          public.auth_role_in(r.organization_id) IN ('owner', 'administrator', 'hr_staff')
          OR r.reviewer_id = public.auth_member_id(r.organization_id)
          OR (r.member_id = public.auth_member_id(r.organization_id) AND r.status = 'self_review')
        )
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM performance_reviews r
      WHERE r.id = review_id
        AND (
          public.auth_role_in(r.organization_id) IN ('owner', 'administrator', 'hr_staff')
          OR r.reviewer_id = public.auth_member_id(r.organization_id)
          OR (r.member_id = public.auth_member_id(r.organization_id) AND r.status = 'self_review')
        )
    )
  );

/**
 * Feedback: the respondent, the reviewer, and HR. Not the subject.
 *
 * The subject's absence from this list is the whole privacy design of the
 * instrument and is argued in the migration header. It is enforced here, in
 * the database, rather than by not rendering a component — the rule survives
 * a client that asks for the rows directly.
 *
 * Note what is *not* written: `auth_visible_member_ids()`. That function
 * answers "whose people-data may I read", and it would hand every manager the
 * feedback written about everyone beneath them, including feedback about their
 * own conduct written by their reports. The named reviewer is the right
 * boundary here, and it is narrower than the usual one on purpose.
 */
DROP POLICY IF EXISTS review_feedback_select ON review_feedback;
CREATE POLICY review_feedback_select ON review_feedback FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      respondent_id = public.auth_member_id(organization_id)
      OR public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR EXISTS (
        SELECT 1 FROM performance_reviews r
        WHERE r.id = review_id
          AND r.reviewer_id = public.auth_member_id(organization_id)
      )
    )
  );

/** Asking for feedback is the reviewer's or HR's act. */
DROP POLICY IF EXISTS review_feedback_insert ON review_feedback;
CREATE POLICY review_feedback_insert ON review_feedback FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR EXISTS (
        SELECT 1 FROM performance_reviews r
        WHERE r.id = review_id
          AND r.reviewer_id = public.auth_member_id(organization_id)
      )
    )
  );

/**
 * Answering it is the respondent's, and nobody else's.
 *
 * HR is excluded from UPDATE deliberately, which is unusual in this schema.
 * HR administering the process must not be able to edit what a colleague
 * wrote about somebody: feedback that its author cannot vouch for is not
 * feedback. HR can see it, chase it, and delete an ill-judged request; they
 * cannot put words in somebody's mouth.
 */
DROP POLICY IF EXISTS review_feedback_update ON review_feedback;
CREATE POLICY review_feedback_update ON review_feedback FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND respondent_id = public.auth_member_id(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND respondent_id = public.auth_member_id(organization_id)
  );

/** Withdrawing a request that should not have been made. */
DROP POLICY IF EXISTS review_feedback_delete ON review_feedback;
CREATE POLICY review_feedback_delete ON review_feedback FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR EXISTS (
        SELECT 1 FROM performance_reviews r
        WHERE r.id = review_id
          AND r.reviewer_id = public.auth_member_id(organization_id)
      )
    )
  );

/**
 * A calibration record is readable by whoever may read the review — including
 * the subject, once it has been shared with them.
 *
 * That inclusion is the point of keeping it. "My manager rated me 4 and the
 * sheet says 3" is the exact question this table exists to answer, and an
 * audit trail only management can read answers it for the wrong person.
 *
 * No INSERT, UPDATE or DELETE policy: the trigger is the only writer.
 */
DROP POLICY IF EXISTS review_calibrations_select ON review_calibrations;
CREATE POLICY review_calibrations_select ON review_calibrations FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (SELECT 1 FROM performance_reviews r WHERE r.id = review_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
--  7. Realtime
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE review_competencies REPLICA IDENTITY FULL;
ALTER TABLE review_feedback     REPLICA IDENTITY FULL;
ALTER TABLE review_calibrations REPLICA IDENTITY FULL;
ALTER TABLE competencies        REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['competencies', 'review_competencies', 'review_feedback', 'review_calibrations']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;
