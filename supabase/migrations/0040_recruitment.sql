-- ═══════════════════════════════════════════════════════════════════════════
--  0040 - Recruitment: from an opening to a colleague
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The HR module has had a "Recruitment & Onboarding" tab since the beginning.
--  It renders three people - Marcus Vance, Emily Chen, David Ross - from a
--  `useState` array, with progress bars that are integers somebody typed. The
--  "Add Candidate" button is not wired to anything. Every organisation on the
--  platform sees the same three names.
--
--  That is the most expensive shape a fake can take, and this repository has
--  the receipts: the CRM's export button downloaded a string literal of two
--  invented rows for every tenant, and it survived for months precisely
--  because it looked convincing. A screen that demonstrates a feature nobody
--  can use is worse than an empty state, because the empty state gets fixed.
--
--  -- What a hiring pipeline actually needs -------------------------------
--
--  Four nouns, and they are not interchangeable:
--
--    * an **opening** is a job the company is trying to fill,
--    * a **candidate** is a person, who may apply to several openings over
--      several years,
--    * an **application** is one person against one opening - the thing that
--      has a stage,
--    * an **offer** is what the company committed to, and it carries money.
--
--  Collapsing candidate into application is the mistake most small ATSs make,
--  and it costs you the only question worth asking of a hiring database: have
--  we spoken to this person before?
--
--  -- Where the money stops -----------------------------------------------
--
--  `job_offers` holds a number, because an offer without one is not an offer.
--  It is therefore the only table here that HR alone can read: a hiring
--  manager runs the interviews, reads the feedback and makes the
--  recommendation, and does not see what the company decided to pay. That
--  split is the same one 0032 drew when it kept salary out of the performance
--  tables, for the same reason.
--
--  -- Two things this deliberately is not ---------------------------------
--
--  Not a careers site: there is no public application form, no anonymous
--  write path, and no `anon` grant anywhere in this file. Applications are
--  entered by the people doing the hiring.
--
--  Not a scheduling product: an interview writes a real `calendar_events` row
--  through a trigger, so it appears in the Calendar module beside everything
--  else. Building a second calendar inside HR is how a suite stops being one.
--
--  Idempotent, additive, and nothing here fabricates a row.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
--  1. Vocabulary
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'opening_status') THEN
    CREATE TYPE opening_status AS ENUM ('draft', 'open', 'on_hold', 'closed', 'filled');
  END IF;

  /**
   * Where an application has reached. Position only - never an outcome.
   *
   * "Rejected" is not a stage, it is what happened to an application that was
   * in one. Keeping them in separate columns is what lets the pipeline answer
   * "how many people did we turn down at technical interview", which a single
   * column collapses into a number nobody can decompose.
   */
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_stage') THEN
    CREATE TYPE application_stage AS ENUM (
      'applied', 'screening', 'interview', 'assessment', 'offer', 'hired'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
    CREATE TYPE application_status AS ENUM ('active', 'hired', 'rejected', 'withdrawn');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interview_kind') THEN
    CREATE TYPE interview_kind AS ENUM (
      'screening', 'technical', 'panel', 'culture', 'final', 'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interview_status') THEN
    CREATE TYPE interview_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
  END IF;

  /**
   * Four values, no middle.
   *
   * A five-point scale with a neutral centre is where interview panels go to
   * avoid deciding. The scale is deliberately even, and the wording is a
   * recommendation rather than a score, because "would you work with them" is
   * the question a hiring meeting can actually use.
   */
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hire_recommendation') THEN
    CREATE TYPE hire_recommendation AS ENUM ('strong_no', 'no', 'yes', 'strong_yes');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offer_status') THEN
    CREATE TYPE offer_status AS ENUM (
      'draft', 'approved', 'sent', 'accepted', 'declined', 'withdrawn', 'expired'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
--  2. Openings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS job_openings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  /* JOB-000001, from the same counter that numbers invoices and tickets. */
  reference       text,

  title           text NOT NULL CHECK (btrim(title) <> ''),
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  /* Whose team this is. They run the pipeline; HR runs the process. */
  hiring_manager_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  recruiter_id    uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  employment_type employment_type NOT NULL DEFAULT 'full_time',
  work_mode       text NOT NULL DEFAULT 'onsite'
                  CHECK (work_mode IN ('onsite', 'hybrid', 'remote')),
  location        text NOT NULL DEFAULT '',

  /* More than one person can be hired against one opening. */
  positions       int NOT NULL DEFAULT 1 CHECK (positions >= 1),

  description     text NOT NULL DEFAULT '',
  requirements    text NOT NULL DEFAULT '',

  status          opening_status NOT NULL DEFAULT 'draft',
  opened_on       date,
  target_start_on date,
  closed_on       date,

  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, reference)
);

COMMENT ON TABLE public.job_openings IS
  'A job the company is trying to fill. Distinct from the applications against it: an opening outlives every one of them.';

CREATE INDEX IF NOT EXISTS idx_openings_org
  ON job_openings (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openings_manager
  ON job_openings (hiring_manager_id) WHERE hiring_manager_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.stamp_job_opening()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    NEW.reference := public.next_document_number(NEW.organization_id, 'JOB');
  END IF;

  /* The date it went live, and the date it stopped being live. Both are
     facts a report will be asked for and neither is recoverable later. */
  IF NEW.status = 'open' AND NEW.opened_on IS NULL THEN
    NEW.opened_on := current_date;
  END IF;
  IF NEW.status IN ('closed', 'filled') AND NEW.closed_on IS NULL THEN
    NEW.closed_on := current_date;
  END IF;
  IF NEW.status NOT IN ('closed', 'filled') THEN
    NEW.closed_on := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_job_opening ON job_openings;
CREATE TRIGGER trg_stamp_job_opening
  BEFORE INSERT OR UPDATE ON job_openings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_job_opening();

DROP TRIGGER IF EXISTS trg_openings_updated ON job_openings;
CREATE TRIGGER trg_openings_updated BEFORE UPDATE ON job_openings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
--  3. Candidates - people, not applications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  full_name       text NOT NULL CHECK (btrim(full_name) <> ''),
  email           citext,
  phone           text,
  headline        text NOT NULL DEFAULT '',
  location        text NOT NULL DEFAULT '',

  source          text NOT NULL DEFAULT 'direct'
                  CHECK (source IN ('direct', 'referral', 'agency', 'careers_site', 'sourced', 'other')),
  /* Who referred them, when the source is a referral. */
  referred_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  profile_url     text,

  /**
   * The CV, in the file table everything else uses.
   *
   * Not a new documents table: `files` already carries the tenant, the
   * uploader, the storage path and `is_confidential`, and a CV is exactly the
   * kind of thing that must inherit all four rather than reimplement them.
   */
  resume_file_id  uuid REFERENCES files(id) ON DELETE SET NULL,

  notes           text NOT NULL DEFAULT '',

  /**
   * Set when this candidate became an employee. The link that makes "where did
   * this person come from" answerable from the employee's own profile.
   */
  hired_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.candidates IS
  'A person the company has considered hiring. Survives every application they make, so "have we spoken to them before" has an answer.';

/* One record per person per organisation, where we have an address for them. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_org_email
  ON candidates (organization_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_org
  ON candidates (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_name
  ON candidates USING gin (full_name gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_candidates_updated ON candidates;
CREATE TRIGGER trg_candidates_updated BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
--  4. Applications - one person against one opening
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS job_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opening_id      uuid NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  candidate_id    uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,

  stage           application_stage NOT NULL DEFAULT 'applied',
  status          application_status NOT NULL DEFAULT 'active',

  applied_on      date NOT NULL DEFAULT current_date,

  /**
   * The panel's view, one to five, written by whoever runs the pipeline.
   *
   * Deliberately nullable and deliberately not computed from the feedback
   * rows: averaging four people's recommendations into a decimal is how a
   * hiring decision stops being a conversation. The feedback is on the
   * screen next to it.
   */
  rating          int CHECK (rating BETWEEN 1 AND 5),

  /* Terminal facts. A rejection with no reason is not a record. */
  outcome_reason  text NOT NULL DEFAULT '',
  decided_at      timestamptz,
  decided_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  hired_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  notes           text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  /* The same person cannot be in one pipeline twice. */
  UNIQUE (opening_id, candidate_id),

  /**
   * The two columns cannot contradict each other.
   *
   * `hired` in one and `active` in the other is the state that makes a funnel
   * chart disagree with the list beneath it, and the cheapest place to make it
   * impossible is here.
   */
  CONSTRAINT application_outcome_consistent CHECK (
    (status = 'hired' AND stage = 'hired')
    OR (status <> 'hired' AND stage <> 'hired')
  )
);

COMMENT ON TABLE public.job_applications IS
  'One candidate against one opening. `stage` is where it reached; `status` is what happened to it. Never the same column.';

CREATE INDEX IF NOT EXISTS idx_applications_opening
  ON job_applications (opening_id, stage, status);
CREATE INDEX IF NOT EXISTS idx_applications_candidate
  ON job_applications (candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_org
  ON job_applications (organization_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_applications_updated ON job_applications;
CREATE TRIGGER trg_applications_updated BEFORE UPDATE ON job_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
--  5. How the pipeline moved
-- ---------------------------------------------------------------------------

/**
 * Modelled on `deal_stage_events` (0028), for the reason given there: time in
 * stage and conversion between stages are the two questions a pipeline is for,
 * and neither is answerable from a single mutable `stage` column. Written only
 * by the trigger below; no endpoint inserts here.
 */
CREATE TABLE IF NOT EXISTS application_stage_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  from_stage      application_stage,
  to_stage        application_stage NOT NULL,
  from_status     application_status,
  to_status       application_status NOT NULL,
  member_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_stage_events_app
  ON application_stage_events (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_application_stage_events_org
  ON application_stage_events (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_application_movement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO application_stage_events (
      organization_id, application_id, from_stage, to_stage,
      from_status, to_status, member_id
    )
    VALUES (
      NEW.organization_id, NEW.id, NULL, NEW.stage,
      NULL, NEW.status, public.auth_member_id(NEW.organization_id)
    );
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO application_stage_events (
      organization_id, application_id, from_stage, to_stage,
      from_status, to_status, member_id, note
    )
    VALUES (
      NEW.organization_id, NEW.id, OLD.stage, NEW.stage,
      OLD.status, NEW.status, public.auth_member_id(NEW.organization_id),
      COALESCE(NEW.outcome_reason, '')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_application_movement ON job_applications;
CREATE TRIGGER trg_record_application_movement
  AFTER INSERT OR UPDATE OF stage, status ON job_applications
  FOR EACH ROW EXECUTE FUNCTION public.record_application_movement();

/** A terminal application records when it ended and who ended it. */
CREATE OR REPLACE FUNCTION public.stamp_application_decision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'active' AND (TG_OP = 'INSERT' OR OLD.status = 'active') THEN
    NEW.decided_at := COALESCE(NEW.decided_at, now());
    NEW.decided_by := COALESCE(NEW.decided_by, public.auth_member_id(NEW.organization_id));
  ELSIF NEW.status = 'active' THEN
    NEW.decided_at := NULL;
    NEW.decided_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_application_decision ON job_applications;
CREATE TRIGGER trg_stamp_application_decision
  BEFORE INSERT OR UPDATE OF status ON job_applications
  FOR EACH ROW EXECUTE FUNCTION public.stamp_application_decision();

-- ---------------------------------------------------------------------------
--  6. Interviews, in the calendar everybody already uses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS interviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,

  kind            interview_kind NOT NULL DEFAULT 'screening',
  title           text NOT NULL DEFAULT '',

  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  location        text NOT NULL DEFAULT '',
  meeting_url     text,

  status          interview_status NOT NULL DEFAULT 'scheduled',

  /**
   * The calendar row this interview is.
   *
   * Written by trigger, kept in step by trigger, and removed with the
   * interview. HR does not get its own calendar - an interview is a meeting,
   * and a meeting belongs in the module that shows people their week.
   */
  calendar_event_id uuid REFERENCES calendar_events(id) ON DELETE SET NULL,

  agenda          text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT interview_interval_valid CHECK (ends_at > starts_at)
);

COMMENT ON TABLE public.interviews IS
  'A scheduled conversation with a candidate. Mirrored into calendar_events by trigger so it appears in Calendar with everything else.';

CREATE INDEX IF NOT EXISTS idx_interviews_application
  ON interviews (application_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_org_when
  ON interviews (organization_id, starts_at);

DROP TRIGGER IF EXISTS trg_interviews_updated ON interviews;
CREATE TRIGGER trg_interviews_updated BEFORE UPDATE ON interviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * The panel.
 *
 * Carries `organization_id` even though it is derivable through the interview,
 * because `db:check` treats a join table without a tenant column as a
 * cross-tenant leak waiting to happen, and it is right: every policy that has
 * to reach two tables to establish tenancy is one join away from being wrong.
 */
CREATE TABLE IF NOT EXISTS interview_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_id    uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  is_lead         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_participants_member
  ON interview_participants (member_id);

/**
 * The calendar entry, written from the interview and kept in step with it.
 *
 * The candidate's name is deliberately *not* in the title of an
 * organisation-visible event. `visibility = 'private'` on the event plus the
 * opening's title is what an interviewer needs to see in their week; who is
 * being interviewed is in HR, where the access rules are.
 */
CREATE OR REPLACE FUNCTION public.mirror_interview_to_calendar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  label text;
  ev    uuid;
BEGIN
  SELECT 'Interview - ' || o.title
    INTO label
    FROM job_applications a
    JOIN job_openings o ON o.id = a.opening_id
   WHERE a.id = NEW.application_id;

  label := COALESCE(NULLIF(btrim(NEW.title), ''), label, 'Interview');

  IF TG_OP = 'INSERT' OR NEW.calendar_event_id IS NULL THEN
    INSERT INTO calendar_events (
      organization_id, title, description, starts_at, ends_at,
      location, visibility, created_by
    )
    VALUES (
      NEW.organization_id, label, NEW.agenda, NEW.starts_at, NEW.ends_at,
      COALESCE(NULLIF(NEW.location, ''), NEW.meeting_url), 'private', NEW.created_by
    )
    RETURNING id INTO ev;

    NEW.calendar_event_id := ev;
  ELSE
    UPDATE calendar_events
       SET title      = label,
           description = NEW.agenda,
           starts_at  = NEW.starts_at,
           ends_at    = NEW.ends_at,
           location   = COALESCE(NULLIF(NEW.location, ''), NEW.meeting_url)
     WHERE id = NEW.calendar_event_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_interview_to_calendar ON interviews;
CREATE TRIGGER trg_mirror_interview_to_calendar
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, location, meeting_url, title, agenda
  ON interviews
  FOR EACH ROW EXECUTE FUNCTION public.mirror_interview_to_calendar();

/** Removing the interview removes the meeting it put in everyone's week. */
CREATE OR REPLACE FUNCTION public.unmirror_interview_from_calendar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.calendar_event_id IS NOT NULL THEN
    DELETE FROM calendar_events WHERE id = OLD.calendar_event_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_unmirror_interview ON interviews;
CREATE TRIGGER trg_unmirror_interview
  AFTER DELETE ON interviews
  FOR EACH ROW EXECUTE FUNCTION public.unmirror_interview_from_calendar();

/**
 * An interviewer is an attendee, and is told they are expected.
 *
 * Both halves matter: `event_attendees` is what makes the meeting appear on
 * their calendar rather than merely existing in the organisation's, and the
 * notification is what makes them look.
 */
CREATE OR REPLACE FUNCTION public.notify_interview_participant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  iv interviews%ROWTYPE;
  label text;
BEGIN
  SELECT * INTO iv FROM interviews WHERE id = NEW.interview_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF iv.calendar_event_id IS NOT NULL THEN
    INSERT INTO event_attendees (event_id, member_id)
    VALUES (iv.calendar_event_id, NEW.member_id)
    ON CONFLICT (event_id, member_id) DO NOTHING;
  END IF;

  SELECT c.full_name || ' - ' || o.title
    INTO label
    FROM job_applications a
    JOIN job_openings o ON o.id = a.opening_id
    JOIN candidates   c ON c.id = a.candidate_id
   WHERE a.id = iv.application_id;

  INSERT INTO notifications (
    organization_id, recipient_id, type, title, body, entity_type, entity_id, link
  )
  VALUES (
    iv.organization_id, NEW.member_id, 'interview_scheduled',
    'You are interviewing',
    COALESCE(label, 'A candidate') || ' - ' || to_char(iv.starts_at, 'Mon DD, HH24:MI'),
    'interview', iv.id,
    '/dashboard?module=hr&tab=recruitment&interview=' || iv.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_interview_participant ON interview_participants;
CREATE TRIGGER trg_notify_interview_participant
  AFTER INSERT ON interview_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_interview_participant();

-- ---------------------------------------------------------------------------
--  7. Feedback - one per interviewer, and theirs alone until submitted
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS interview_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_id    uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  recommendation  hire_recommendation,
  rating          int CHECK (rating BETWEEN 1 AND 5),
  strengths       text NOT NULL DEFAULT '',
  concerns        text NOT NULL DEFAULT '',
  notes           text NOT NULL DEFAULT '',

  /**
   * Until this is stamped, the feedback is a draft and only its author reads
   * it. Panels that can see each other's notes before writing their own do not
   * produce four opinions, they produce one opinion four times.
   */
  submitted_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, member_id)
);

COMMENT ON TABLE public.interview_feedback IS
  'One interviewer, one interview. Invisible to the rest of the panel until submitted_at is stamped.';

CREATE INDEX IF NOT EXISTS idx_interview_feedback_interview
  ON interview_feedback (interview_id);

DROP TRIGGER IF EXISTS trg_feedback_updated ON interview_feedback;
CREATE TRIGGER trg_feedback_updated BEFORE UPDATE ON interview_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.stamp_feedback_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  /* Submitting is a one-way door: the recommendation the panel saw is the
     record, and letting an author revise it after reading the others is
     exactly what the draft state exists to prevent. */
  IF TG_OP = 'UPDATE' AND OLD.submitted_at IS NOT NULL THEN
    NEW.submitted_at := OLD.submitted_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_feedback_submission ON interview_feedback;
CREATE TRIGGER trg_stamp_feedback_submission
  BEFORE UPDATE ON interview_feedback
  FOR EACH ROW EXECUTE FUNCTION public.stamp_feedback_submission();

-- ---------------------------------------------------------------------------
--  8. Offers - the one table with a number in it
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS job_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,

  status          offer_status NOT NULL DEFAULT 'draft',

  /* What is being offered. These become the employment record on acceptance. */
  job_title       text NOT NULL CHECK (btrim(job_title) <> ''),
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  manager_id      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  start_on        date,
  probation_months int CHECK (probation_months IS NULL OR probation_months BETWEEN 0 AND 24),

  /**
   * The money. Annual gross in the organisation's currency unless the row says
   * otherwise, because a number with no period attached is the most reliable
   * way to pay somebody twelve times what you meant to.
   */
  base_amount     numeric(14,2) CHECK (base_amount IS NULL OR base_amount >= 0),
  currency        text NOT NULL DEFAULT 'NGN',
  pay_period      text NOT NULL DEFAULT 'annual'
                  CHECK (pay_period IN ('annual', 'monthly', 'weekly', 'daily', 'hourly')),
  /* Anything on top: signing bonus, relocation, allowances agreed up front. */
  notes           text NOT NULL DEFAULT '',

  expires_on      date,
  /* The signed letter, in the files table, confidential by construction. */
  document_file_id uuid REFERENCES files(id) ON DELETE SET NULL,

  approved_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  sent_at         timestamptz,
  decided_at      timestamptz,
  decline_reason  text NOT NULL DEFAULT '',

  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_offers IS
  'What the company committed to. The only recruitment table carrying money, and therefore the only one a hiring manager cannot read.';

CREATE INDEX IF NOT EXISTS idx_offers_application
  ON job_offers (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_org
  ON job_offers (organization_id, status);

DROP TRIGGER IF EXISTS trg_offers_updated ON job_offers;
CREATE TRIGGER trg_offers_updated BEFORE UPDATE ON job_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * The dates an offer's life is made of, and the one refusal.
 *
 * An offer cannot be sent before somebody approved it. Everything else here is
 * stamping: `sent_at` and `decided_at` are facts a dispute will turn on, and a
 * client that supplies its own is a client that can backdate them.
 */
CREATE OR REPLACE FUNCTION public.stamp_offer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    NEW.approved_at := COALESCE(NEW.approved_at, now());
    NEW.approved_by := COALESCE(NEW.approved_by, public.auth_member_id(NEW.organization_id));
  END IF;

  IF NEW.status = 'sent' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'sent') THEN
    IF NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'Approve the offer before sending it.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.sent_at := COALESCE(NEW.sent_at, now());
  END IF;

  IF NEW.status IN ('accepted', 'declined', 'withdrawn', 'expired')
     AND (TG_OP = 'INSERT' OR OLD.status <> NEW.status) THEN
    NEW.decided_at := COALESCE(NEW.decided_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_offer ON job_offers;
CREATE TRIGGER trg_stamp_offer
  BEFORE INSERT OR UPDATE ON job_offers
  FOR EACH ROW EXECUTE FUNCTION public.stamp_offer();

/**
 * An accepted or declined offer moves the application with it.
 *
 * Not the other way round, and not both ways: one direction of propagation is
 * a rule, two is a loop. The application is the pipeline's record and the
 * offer is the commitment, so the commitment being decided is the event.
 */
CREATE OR REPLACE FUNCTION public.apply_offer_decision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status IN ('draft', 'approved', 'sent') THEN
    UPDATE job_applications
       SET stage = 'offer'
     WHERE id = NEW.application_id AND status = 'active' AND stage <> 'offer';

  ELSIF NEW.status IN ('declined', 'withdrawn', 'expired') THEN
    UPDATE job_applications
       SET status = 'withdrawn',
           outcome_reason = COALESCE(NULLIF(NEW.decline_reason, ''), 'Offer ' || NEW.status)
     WHERE id = NEW.application_id AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_offer_decision ON job_offers;
CREATE TRIGGER trg_apply_offer_decision
  AFTER UPDATE OF status ON job_offers
  FOR EACH ROW EXECUTE FUNCTION public.apply_offer_decision();

-- ---------------------------------------------------------------------------
--  9. Completing a hire
-- ---------------------------------------------------------------------------

/**
 * Tie a new membership back to the application that produced it.
 *
 * The membership itself is created by the provisioning endpoint, which needs
 * the service role to make an auth account - so this deliberately does *not*
 * create people. It closes the pipeline: the application becomes `hired`, the
 * candidate remembers which employee they became, the opening fills when its
 * last position is taken, and the employment record starts at `onboarding`
 * rather than `active`, because somebody who starts on Monday is not yet an
 * employee doing the job.
 *
 * SECURITY DEFINER, and it checks the caller before touching anything.
 */
CREATE OR REPLACE FUNCTION public.complete_hire(
  p_application uuid,
  p_member      uuid
)
RETURNS job_applications
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  app    job_applications%ROWTYPE;
  hired  int;
  slots  int;
BEGIN
  SELECT * INTO app FROM job_applications WHERE id = p_application;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That application does not exist.' USING ERRCODE = 'no_data_found';
  END IF;

  IF public.auth_role_in(app.organization_id) NOT IN ('owner', 'administrator', 'hr_staff') THEN
    RAISE EXCEPTION 'Only HR and administrators may complete a hire.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE id = p_member AND organization_id = app.organization_id
  ) THEN
    RAISE EXCEPTION 'That employee belongs to another organisation.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF app.status <> 'active' THEN
    RAISE EXCEPTION 'This application is already %.', app.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE job_applications
     SET stage = 'hired', status = 'hired', hired_member_id = p_member
   WHERE id = p_application
   RETURNING * INTO app;

  UPDATE candidates SET hired_member_id = p_member WHERE id = app.candidate_id;

  UPDATE job_offers SET status = 'accepted'
   WHERE application_id = p_application AND status IN ('sent', 'approved');

  UPDATE organization_members
     SET lifecycle_stage = 'onboarding'
   WHERE id = p_member AND lifecycle_stage = 'active';

  /* Fill the opening when every position it advertised is taken. */
  SELECT positions INTO slots FROM job_openings WHERE id = app.opening_id;
  SELECT count(*) INTO hired FROM job_applications
   WHERE opening_id = app.opening_id AND status = 'hired';

  IF hired >= COALESCE(slots, 1) THEN
    UPDATE job_openings SET status = 'filled'
     WHERE id = app.opening_id AND status NOT IN ('closed', 'filled');
  END IF;

  RETURN app;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_hire(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.complete_hire(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
--  10. Who may see recruitment
-- ---------------------------------------------------------------------------

/**
 * Hiring is not self-service.
 *
 * Every HR table before this one is readable by the person it is about,
 * because attendance and leave are that person's own records. Recruitment has
 * no such subject inside the company: a candidate is not a user, and an
 * employee has no standing to read the pipeline. So the rule is a named set
 * rather than `auth_visible_member_ids()` - HR and administrators run it, and
 * a hiring manager or interviewer sees the pipeline they are part of.
 */
CREATE OR REPLACE FUNCTION public.runs_recruitment(org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.auth_role_in(org) IN ('owner', 'administrator', 'hr_staff');
$$;

/**
 * True when the caller is involved in this specific opening: its hiring
 * manager, its recruiter, or somebody sitting on one of its interview panels.
 * Everything a manager sees in recruitment resolves through this.
 */
CREATE OR REPLACE FUNCTION public.involved_in_opening(opening uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM job_openings o
     WHERE o.id = opening
       AND (
         public.runs_recruitment(o.organization_id)
         OR o.hiring_manager_id = public.auth_member_id(o.organization_id)
         OR o.recruiter_id      = public.auth_member_id(o.organization_id)
         OR EXISTS (
           SELECT 1
             FROM job_applications a
             JOIN interviews i             ON i.application_id = a.id
             JOIN interview_participants p ON p.interview_id = i.id
            WHERE a.opening_id = o.id
              AND p.member_id = public.auth_member_id(o.organization_id)
         )
       )
  );
$$;

GRANT EXECUTE ON FUNCTION public.runs_recruitment(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.involved_in_opening(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
--  11. Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE job_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_openings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_openings_select ON job_openings;
CREATE POLICY job_openings_select ON job_openings FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.runs_recruitment(organization_id)
      OR hiring_manager_id = public.auth_member_id(organization_id)
      OR recruiter_id      = public.auth_member_id(organization_id)
    )
  );

/**
 * Split rather than FOR ALL, for the reason 0032 documents at length: a FOR
 * ALL policy's USING clause also grants SELECT, and permissive policies are
 * OR'd. Writing is narrower than reading here, so the split is required or the
 * write rule quietly widens the read rule.
 */
DROP POLICY IF EXISTS job_openings_write ON job_openings;
DROP POLICY IF EXISTS job_openings_insert ON job_openings;
CREATE POLICY job_openings_insert ON job_openings FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

DROP POLICY IF EXISTS job_openings_update ON job_openings;
CREATE POLICY job_openings_update ON job_openings FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

DROP POLICY IF EXISTS job_openings_delete ON job_openings;
CREATE POLICY job_openings_delete ON job_openings FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates FORCE ROW LEVEL SECURITY;

/**
 * A candidate is readable by recruitment, and by anyone involved in an opening
 * they have applied to. Not by the whole company: an applicant's name, address
 * and CV are the most sensitive thing in this file after the offer amount, and
 * a person who has not been hired never consented to the staff directory
 * seeing them.
 */
DROP POLICY IF EXISTS candidates_select ON candidates;
CREATE POLICY candidates_select ON candidates FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.runs_recruitment(organization_id)
      OR EXISTS (
        SELECT 1 FROM job_applications a
         WHERE a.candidate_id = candidates.id
           AND public.involved_in_opening(a.opening_id)
      )
    )
  );

DROP POLICY IF EXISTS candidates_insert ON candidates;
CREATE POLICY candidates_insert ON candidates FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

DROP POLICY IF EXISTS candidates_update ON candidates;
CREATE POLICY candidates_update ON candidates FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

DROP POLICY IF EXISTS candidates_delete ON candidates;
CREATE POLICY candidates_delete ON candidates FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_applications_select ON job_applications;
CREATE POLICY job_applications_select ON job_applications FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.involved_in_opening(opening_id)
  );

DROP POLICY IF EXISTS job_applications_insert ON job_applications;
CREATE POLICY job_applications_insert ON job_applications FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

/**
 * Moving an application is the hiring manager's job as much as HR's, so update
 * is the wider of the two rules here - anyone involved in the opening may move
 * their own pipeline. Creating and deleting stay with recruitment.
 */
DROP POLICY IF EXISTS job_applications_update ON job_applications;
CREATE POLICY job_applications_update ON job_applications FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.involved_in_opening(opening_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.involved_in_opening(opening_id)
  );

DROP POLICY IF EXISTS job_applications_delete ON job_applications;
CREATE POLICY job_applications_delete ON job_applications FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

ALTER TABLE application_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_stage_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS application_stage_events_select ON application_stage_events;
CREATE POLICY application_stage_events_select ON application_stage_events FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM job_applications a
       WHERE a.id = application_stage_events.application_id
         AND public.involved_in_opening(a.opening_id)
    )
  );

/* Present only because the table is FORCE'd and the writer is a trigger; see
   `deal_stage_events` in 0028. No UPDATE or DELETE policy, ever. */
DROP POLICY IF EXISTS application_stage_events_insert ON application_stage_events;
CREATE POLICY application_stage_events_insert ON application_stage_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interviews_select ON interviews;
CREATE POLICY interviews_select ON interviews FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM job_applications a
       WHERE a.id = interviews.application_id
         AND public.involved_in_opening(a.opening_id)
    )
  );

DROP POLICY IF EXISTS interviews_write ON interviews;
CREATE POLICY interviews_write ON interviews FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM job_applications a
       WHERE a.id = interviews.application_id
         AND public.involved_in_opening(a.opening_id)
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM job_applications a
       WHERE a.id = interviews.application_id
         AND public.involved_in_opening(a.opening_id)
    )
  );

ALTER TABLE interview_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_participants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interview_participants_all ON interview_participants;
CREATE POLICY interview_participants_all ON interview_participants FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM interviews i
        JOIN job_applications a ON a.id = i.application_id
       WHERE i.id = interview_participants.interview_id
         AND public.involved_in_opening(a.opening_id)
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM interviews i
        JOIN job_applications a ON a.id = i.application_id
       WHERE i.id = interview_participants.interview_id
         AND public.involved_in_opening(a.opening_id)
    )
  );

ALTER TABLE interview_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_feedback FORCE ROW LEVEL SECURITY;

/**
 * Your own draft, and everybody's submitted.
 *
 * This is a read rule strictly narrower than the write rule beneath it, which
 * is precisely the shape 0032 found the FOR ALL trap in - so the write side is
 * split into INSERT and UPDATE and there is no FOR ALL policy on this table.
 */
DROP POLICY IF EXISTS interview_feedback_select ON interview_feedback;
CREATE POLICY interview_feedback_select ON interview_feedback FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      member_id = public.auth_member_id(organization_id)
      OR (
        submitted_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM interviews i
            JOIN job_applications a ON a.id = i.application_id
           WHERE i.id = interview_feedback.interview_id
             AND public.involved_in_opening(a.opening_id)
        )
      )
    )
  );

/* Feedback is written about a conversation you were in, by you, about you
   having been there. Nobody writes somebody else's assessment. */
DROP POLICY IF EXISTS interview_feedback_insert ON interview_feedback;
CREATE POLICY interview_feedback_insert ON interview_feedback FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
  );

DROP POLICY IF EXISTS interview_feedback_update ON interview_feedback;
CREATE POLICY interview_feedback_update ON interview_feedback FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
  );

DROP POLICY IF EXISTS interview_feedback_delete ON interview_feedback;
CREATE POLICY interview_feedback_delete ON interview_feedback FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
    AND submitted_at IS NULL
  );

ALTER TABLE job_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_offers FORCE ROW LEVEL SECURITY;

/**
 * HR and administrators only, at every command.
 *
 * The hiring manager who ran the process does not see the number. That is not
 * an oversight to be relaxed later - it is the reason this table is separate
 * from `job_applications` at all.
 */
DROP POLICY IF EXISTS job_offers_select ON job_offers;
CREATE POLICY job_offers_select ON job_offers FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

DROP POLICY IF EXISTS job_offers_write ON job_offers;
CREATE POLICY job_offers_write ON job_offers FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.runs_recruitment(organization_id)
  );

-- ---------------------------------------------------------------------------
--  12. Realtime
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_openings', 'candidates', 'job_applications',
    'interviews', 'interview_feedback', 'job_offers'
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
