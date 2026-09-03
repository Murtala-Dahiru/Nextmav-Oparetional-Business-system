-- ═══════════════════════════════════════════════════════════════════════════
--  0043 - The HR case desk, and employee documents
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The module's "Internal HR Case & Incident Desk" is three rows in a
--  `useState` array. Submitting a case pushes a fourth onto it and toasts
--  "Internal HR Case submitted successfully". Reload the page and the case is
--  gone. "Avg Resolution Time: 18 Hours" and "SLA Compliance: 98.2%" are string
--  literals.
--
--  The submission dialogue's own words are "Private, confidential case
--  submission directly to the HR Management team", which is the part that
--  makes this worse than an ordinary fake: somebody could type a grievance
--  into it. Nothing receives it and nothing stores it, and the person is told
--  it worked.
--
--  -- Two audiences, one table ---------------------------------------------
--
--  An HR case has a subject, a raiser, an owner and a category, and in one
--  category - a grievance about a colleague - the subject must not be able to
--  read it. That is `is_restricted`: a boolean the raiser sets, after which
--  the case is visible to HR and to the person who filed it, and to nobody
--  else. Without it, "raise a concern about your manager" is a feature that
--  emails your manager.
--
--  Notes carry the same split at a finer grain. `is_internal` marks HR's own
--  working notes, which the employee never sees, from the correspondence,
--  which is the case's conversation with them.
--
--  -- Documents: no second file system -------------------------------------
--
--  `files` has carried `member_id` and `is_confidential` since 0003, and the
--  `files_select` policy has always said: a confidential file is readable by
--  its subject and by owner, administrator and HR, and by nobody else. That is
--  precisely the HR document rule, already enforced, already covering storage
--  paths, uploads, tenancy and soft deletion.
--
--  So this file adds one column - `hr_category`, which says what a document
--  *is* - and one more attachment target, and stops. A parallel
--  `hr_documents` table would have been a second implementation of a policy
--  that already works, which is this repository's most expensive habit.
--
--  Idempotent and additive.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
--  1. Vocabulary
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hr_case_category') THEN
    CREATE TYPE hr_case_category AS ENUM (
      'request', 'inquiry', 'policy', 'payroll', 'benefits',
      'document_request', 'employee_relations', 'workplace_incident',
      'grievance', 'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hr_case_status') THEN
    /**
     * `waiting_on_employee` exists because the alternative is a case that
     * looks stalled when it is actually waiting for a reply - and a queue
     * whose ageing figures blame HR for the other party's delay is a queue
     * people learn to ignore.
     */
    CREATE TYPE hr_case_status AS ENUM (
      'open', 'in_progress', 'waiting_on_employee', 'resolved', 'closed'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
--  2. Cases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  /* HRC-000001, from the counter that numbers invoices, tickets and openings. */
  reference       text,

  category        hr_case_category NOT NULL DEFAULT 'inquiry',
  subject         text NOT NULL CHECK (btrim(subject) <> ''),
  description     text NOT NULL DEFAULT '',

  /** Who filed it. Never null: an anonymous case has no reply address. */
  raised_by       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  /** Who it is about, which is usually but not always the raiser. */
  member_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  /** The HR person who owns it. NULL means it is still in the queue. */
  assigned_to     uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  priority        priority_level NOT NULL DEFAULT 'medium',
  status          hr_case_status NOT NULL DEFAULT 'open',

  /**
   * Restricted: HR and the raiser, and nobody else - not the subject, not the
   * assignee's colleagues, not a manager.
   *
   * Set by whoever files the case. A grievance is the reason the column
   * exists, and the default is false because most cases are somebody asking
   * for a letter.
   */
  is_restricted   boolean NOT NULL DEFAULT false,

  resolution      text NOT NULL DEFAULT '',
  resolved_at     timestamptz,
  closed_at       timestamptz,
  /** When HR first answered. The only honest input to a response-time figure. */
  first_response_at timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, reference)
);

COMMENT ON TABLE public.hr_cases IS
  'An employee matter HR owns. `is_restricted` is what makes raising a grievance about a colleague possible.';

CREATE INDEX IF NOT EXISTS idx_hr_cases_org
  ON hr_cases (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_cases_assignee
  ON hr_cases (assigned_to, status) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_cases_raiser
  ON hr_cases (raised_by, created_at DESC);

DROP TRIGGER IF EXISTS trg_hr_cases_updated ON hr_cases;
CREATE TRIGGER trg_hr_cases_updated BEFORE UPDATE ON hr_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.stamp_hr_case()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    NEW.reference := public.next_document_number(NEW.organization_id, 'HRC');
  END IF;

  IF NEW.status = 'resolved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'resolved') THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  END IF;

  IF NEW.status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;

  /* Reopening clears the stamps rather than leaving a resolution date on an
     open case, which is how "resolved in -3 days" gets into a report. */
  IF NEW.status IN ('open', 'in_progress', 'waiting_on_employee') THEN
    NEW.resolved_at := NULL;
    NEW.closed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_hr_case ON hr_cases;
CREATE TRIGGER trg_stamp_hr_case
  BEFORE INSERT OR UPDATE ON hr_cases
  FOR EACH ROW EXECUTE FUNCTION public.stamp_hr_case();

-- ---------------------------------------------------------------------------
--  3. Notes - the conversation, and HR's own margin
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_case_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id         uuid NOT NULL REFERENCES hr_cases(id) ON DELETE CASCADE,
  author_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  body            text NOT NULL CHECK (btrim(body) <> ''),
  /**
   * An internal note is HR talking to HR. The employee sees the case, its
   * status and every note that is not marked internal.
   */
  is_internal     boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_case_notes_case
  ON hr_case_notes (case_id, created_at);

DROP TRIGGER IF EXISTS trg_hr_case_notes_updated ON hr_case_notes;
CREATE TRIGGER trg_hr_case_notes_updated BEFORE UPDATE ON hr_case_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * The first note by somebody other than the raiser is the first response.
 *
 * Stamped rather than computed, so the figure survives the note being edited
 * or deleted - and so "average time to first response" is a fact about what
 * happened rather than a query over whatever notes still exist.
 */
CREATE OR REPLACE FUNCTION public.stamp_case_first_response()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE hr_cases
     SET first_response_at = now()
   WHERE id = NEW.case_id
     AND first_response_at IS NULL
     AND NEW.author_id IS DISTINCT FROM raised_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_case_first_response ON hr_case_notes;
CREATE TRIGGER trg_stamp_case_first_response
  AFTER INSERT ON hr_case_notes
  FOR EACH ROW EXECUTE FUNCTION public.stamp_case_first_response();

-- ---------------------------------------------------------------------------
--  4. What happened to the case
-- ---------------------------------------------------------------------------

/**
 * The audit trail the brief asks for, written by trigger and editable by
 * nobody - the same shape as `deal_stage_events` and
 * `application_stage_events`. An HR case's history is the part a dispute turns
 * on, so it is the part a client must not be able to author.
 */
CREATE TABLE IF NOT EXISTS hr_case_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id         uuid NOT NULL REFERENCES hr_cases(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  from_value      text,
  to_value        text,
  member_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_case_events_case
  ON hr_case_events (case_id, created_at);

CREATE OR REPLACE FUNCTION public.record_hr_case_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid := public.auth_member_id(NEW.organization_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO hr_case_events (organization_id, case_id, kind, to_value, member_id)
    VALUES (NEW.organization_id, NEW.id, 'raised', NEW.status::text, actor);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO hr_case_events (organization_id, case_id, kind, from_value, to_value, member_id)
    VALUES (NEW.organization_id, NEW.id, 'status', OLD.status::text, NEW.status::text, actor);
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO hr_case_events (organization_id, case_id, kind, from_value, to_value, member_id)
    VALUES (
      NEW.organization_id, NEW.id, 'assignment',
      (SELECT p.full_name FROM organization_members om JOIN profiles p ON p.id = om.user_id
        WHERE om.id = OLD.assigned_to),
      (SELECT p.full_name FROM organization_members om JOIN profiles p ON p.id = om.user_id
        WHERE om.id = NEW.assigned_to),
      actor
    );
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO hr_case_events (organization_id, case_id, kind, from_value, to_value, member_id)
    VALUES (NEW.organization_id, NEW.id, 'priority', OLD.priority::text, NEW.priority::text, actor);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_hr_case_event ON hr_cases;
CREATE TRIGGER trg_record_hr_case_event
  AFTER INSERT OR UPDATE OF status, assigned_to, priority ON hr_cases
  FOR EACH ROW EXECUTE FUNCTION public.record_hr_case_event();

/**
 * Two notifications, and deliberately not more.
 *
 * The assignee is told when a case becomes theirs, and the raiser is told when
 * it is resolved. Every intermediate status change firing a notification is
 * the spam the brief rules out, and a case desk that pings on every keystroke
 * teaches people to mute HR.
 */
CREATE OR REPLACE FUNCTION public.notify_hr_case()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    VALUES (
      NEW.organization_id, NEW.assigned_to, 'hr_case_assigned',
      'An HR case is yours', NEW.reference || ' - ' || NEW.subject,
      'hr_case', NEW.id, '/dashboard?module=hr&tab=cases&case=' || NEW.id
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('resolved', 'closed')
     AND OLD.status NOT IN ('resolved', 'closed')
     AND NEW.raised_by IS DISTINCT FROM public.auth_member_id(NEW.organization_id) THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    VALUES (
      NEW.organization_id, NEW.raised_by, 'hr_case_resolved',
      'Your HR case was ' || NEW.status, NEW.reference || ' - ' || NEW.subject,
      'hr_case', NEW.id, '/dashboard?module=hr&tab=cases&case=' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_hr_case ON hr_cases;
CREATE TRIGGER trg_notify_hr_case
  AFTER INSERT OR UPDATE OF assigned_to, status ON hr_cases
  FOR EACH ROW EXECUTE FUNCTION public.notify_hr_case();

-- ---------------------------------------------------------------------------
--  5. Who may see a case
-- ---------------------------------------------------------------------------

/**
 * One function, so the rule has one definition.
 *
 * A restricted case: HR, and the person who filed it. An ordinary case: those
 * two plus its subject and its assignee. Nobody's manager, in either shape -
 * a department head is not in their team's HR correspondence, and 0032 already
 * made the same call about reviews.
 */
CREATE OR REPLACE FUNCTION public.can_see_hr_case(c uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM hr_cases h
     WHERE h.id = c
       AND h.organization_id = ANY (public.auth_org_ids())
       AND (
         public.auth_role_in(h.organization_id) IN ('owner', 'administrator', 'hr_staff')
         OR h.raised_by = public.auth_member_id(h.organization_id)
         OR (
           h.is_restricted = false
           AND (
             h.member_id   = public.auth_member_id(h.organization_id)
             OR h.assigned_to = public.auth_member_id(h.organization_id)
           )
         )
       )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_see_hr_case(uuid) TO authenticated;

ALTER TABLE hr_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_cases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_cases_select ON hr_cases;
CREATE POLICY hr_cases_select ON hr_cases FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR raised_by = public.auth_member_id(organization_id)
      OR (
        is_restricted = false
        AND (
          member_id   = public.auth_member_id(organization_id)
          OR assigned_to = public.auth_member_id(organization_id)
        )
      )
    )
  );

/**
 * Anybody may raise one about themselves. Nobody may raise one *as* somebody
 * else: `raised_by` must be the caller, which is what keeps the audit trail
 * meaningful.
 */
DROP POLICY IF EXISTS hr_cases_insert ON hr_cases;
CREATE POLICY hr_cases_insert ON hr_cases FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'hr')
    AND raised_by = public.auth_member_id(organization_id)
  );

/**
 * Working a case is HR's. The raiser may withdraw their own by closing it, and
 * that is the whole of their write access - deliberately narrower than the
 * read rule above, which is why this is not a FOR ALL policy.
 */
DROP POLICY IF EXISTS hr_cases_update ON hr_cases;
CREATE POLICY hr_cases_update ON hr_cases FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR assigned_to = public.auth_member_id(organization_id)
      OR raised_by = public.auth_member_id(organization_id)
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR assigned_to = public.auth_member_id(organization_id)
      OR raised_by = public.auth_member_id(organization_id)
    )
  );

DROP POLICY IF EXISTS hr_cases_delete ON hr_cases;
CREATE POLICY hr_cases_delete ON hr_cases FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE hr_case_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_case_notes FORCE ROW LEVEL SECURITY;

/* You may read a note if you may read its case - and an internal one only if
   you are HR or you wrote it. */
DROP POLICY IF EXISTS hr_case_notes_select ON hr_case_notes;
CREATE POLICY hr_case_notes_select ON hr_case_notes FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_hr_case(case_id)
    AND (
      is_internal = false
      OR author_id = public.auth_member_id(organization_id)
      OR public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
    )
  );

DROP POLICY IF EXISTS hr_case_notes_insert ON hr_case_notes;
CREATE POLICY hr_case_notes_insert ON hr_case_notes FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_hr_case(case_id)
    AND author_id = public.auth_member_id(organization_id)
  );

DROP POLICY IF EXISTS hr_case_notes_update ON hr_case_notes;
CREATE POLICY hr_case_notes_update ON hr_case_notes FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND author_id = public.auth_member_id(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND author_id = public.auth_member_id(organization_id)
  );

DROP POLICY IF EXISTS hr_case_notes_delete ON hr_case_notes;
CREATE POLICY hr_case_notes_delete ON hr_case_notes FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      author_id = public.auth_member_id(organization_id)
      OR public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
    )
  );

ALTER TABLE hr_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_case_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_case_events_select ON hr_case_events;
CREATE POLICY hr_case_events_select ON hr_case_events FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_hr_case(case_id)
  );

/* Present only because the table is FORCE'd and the writer is a trigger. There
   is no UPDATE and no DELETE policy: an audit trail somebody can edit is not
   an audit trail. */
DROP POLICY IF EXISTS hr_case_events_insert ON hr_case_events;
CREATE POLICY hr_case_events_insert ON hr_case_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

-- ---------------------------------------------------------------------------
--  6. Employee documents, in the file table that already has the rule
-- ---------------------------------------------------------------------------

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS hr_category text,
  ADD COLUMN IF NOT EXISTS hr_case_id  uuid REFERENCES hr_cases(id) ON DELETE CASCADE;

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_hr_category_valid;
ALTER TABLE files
  ADD CONSTRAINT files_hr_category_valid CHECK (
    hr_category IS NULL OR hr_category IN (
      'contract', 'offer_letter', 'policy', 'identification', 'certificate',
      'performance', 'onboarding', 'offboarding', 'payroll', 'case', 'other'
    )
  );

COMMENT ON COLUMN public.files.hr_category IS
  'What an HR document is. Access is unchanged: is_confidential plus member_id, enforced by files_select since 0005.';

CREATE INDEX IF NOT EXISTS idx_files_hr_member
  ON files (organization_id, member_id, hr_category)
  WHERE hr_category IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_hr_case
  ON files (hr_case_id) WHERE hr_case_id IS NOT NULL AND deleted_at IS NULL;

/**
 * A case attachment follows its case, not the general file rule.
 *
 * `files_select` (0005, narrowed in 0023) admits a confidential file to its
 * subject and to HR. A case attachment needs the case's own audience - which
 * includes the assignee, and excludes the subject when the case is restricted
 * - so the policy is extended rather than replaced: everything that was
 * visible stays visible, and a file carrying `hr_case_id` is additionally
 * gated on the case.
 *
 * Restated in full because `CREATE POLICY` has no way to amend one, and the
 * 0023 clause about channels must survive.
 */
DROP POLICY IF EXISTS files_select ON files;
CREATE POLICY files_select ON files FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      is_confidential = false
      OR member_id = public.auth_member_id(organization_id)
      OR public.has_org_role(organization_id, ARRAY['owner','administrator','hr_staff']::org_role[])
    )
    AND (channel_id IS NULL OR public.can_see_channel(channel_id))
    AND (hr_case_id IS NULL OR public.can_see_hr_case(hr_case_id))
  );

-- ---------------------------------------------------------------------------
--  7. Realtime
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr_cases', 'hr_case_notes'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
