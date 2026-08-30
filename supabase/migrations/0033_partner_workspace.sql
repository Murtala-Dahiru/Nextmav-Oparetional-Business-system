-- ═══════════════════════════════════════════════════════════════════════════
--  0033 - The external lead workspace, and closing the door it opens
-- ═══════════════════════════════════════════════════════════════════════════
--
--  External salespeople need somewhere to work their own prospects, and the
--  approved ones need to reach the company's CRM with attribution intact.
--
--  ── The decision the whole file rests on ─────────────────────────────────
--
--  A partner never holds a row in `leads`. They get their own table,
--  `partner_leads`, which they own outright; on approval the system *creates*
--  a lead and stamps `source_partner_id` on it. The partner receives no
--  SELECT on `leads`, `deals`, `contacts` or `companies` at any point.
--
--  The alternative - filtered access to the real CRM tables - puts the
--  company's entire customer base one policy mistake away from an external
--  account. This codebase has already reasoned its way to the right answer
--  once: the client portal is a rendering of other modules' data rather than
--  a view onto them, and `client` holds no CRM grant whatsoever.
--
--  ── The door adding a role opens ─────────────────────────────────────────
--
--  `can_access_module()` ends in `ELSE auth_role_in(org) <> 'client'`. Add
--  `partner` to `org_role` and that single line grants the new external role
--  Workspace, Communication, Calendar, Projects, HR, Inventory and Admin -
--  everything, because the fallback was written when `client` was the only
--  external role and "not a client" meant "an employee".
--
--  So this migration inverts the default for externals: they are answered
--  from an explicit list and refused otherwise. The internal fallback is left
--  as it was, because for employees "everything not otherwise restricted" is
--  the correct reading and changing it would silently close modules that
--  work today.
--
--  Idempotent: safe to re-run, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. The role
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'org_role' AND e.enumlabel = 'partner'
  ) THEN
    ALTER TYPE org_role ADD VALUE 'partner';
  END IF;
END $$;

/*
 * `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds
 * it on older Postgres, and the statement above may be in one. Everything
 * that *compares* against 'partner' below is therefore written as text, which
 * is safe in every version and costs nothing at this scale.
 */

-- ───────────────────────────────────────────────────────────────────────────
--  2. Where a partner's prospects live
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'partner_lead_status') THEN
    /**
     * `draft` is the partner's own workspace: theirs to edit, invisible to
     * the company. `submitted` hands it over. After that it is the company's
     * decision, and the partner can only watch.
     */
    CREATE TYPE partner_lead_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS partner_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  /** The external person who found this. */
  partner_id      uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  first_name      text NOT NULL DEFAULT '',
  last_name       text NOT NULL DEFAULT '',
  email           citext,
  phone           text,
  company_name    text,
  job_title       text,
  note            text NOT NULL DEFAULT '',
  estimated_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),

  status          partner_lead_status NOT NULL DEFAULT 'draft',

  submitted_at    timestamptz,
  decided_at      timestamptz,
  decided_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  decision_note   text NOT NULL DEFAULT '',

  /** Set on approval. The link back into the company's own CRM. */
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (
    btrim(coalesce(first_name, '') || coalesce(last_name, '')) <> ''
    OR coalesce(company_name, '') <> ''
  )
);

COMMENT ON TABLE public.partner_leads IS
  'An external partner''s own prospects. Approving one creates a row in `leads`; the partner never reads `leads` itself.';

CREATE INDEX IF NOT EXISTS idx_partner_leads_partner
  ON partner_leads (organization_id, partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_leads_queue
  ON partner_leads (organization_id, status, submitted_at DESC);

DROP TRIGGER IF EXISTS trg_partner_leads_updated ON partner_leads;
CREATE TRIGGER trg_partner_leads_updated BEFORE UPDATE ON partner_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/** Attribution, carried on the company's own lead. */
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_partner_id uuid
  REFERENCES organization_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_source_partner
  ON leads (source_partner_id) WHERE source_partner_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  3. Row-level security
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE partner_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_leads FORCE ROW LEVEL SECURITY;

/**
 * A partner sees their own rows. The company sees the ones submitted to it.
 *
 * A draft is genuinely private: somebody typing a half-remembered name into
 * their own workspace has not told the company anything yet, and a queue full
 * of other people's unfinished notes is worse than useless to a sales manager.
 */
DROP POLICY IF EXISTS partner_leads_select ON partner_leads;
CREATE POLICY partner_leads_select ON partner_leads FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      partner_id = public.auth_member_id(organization_id)
      OR (
        status <> 'draft'
        AND public.auth_role_in(organization_id)::text NOT IN ('client', 'partner')
        AND public.can_access_module(organization_id, 'crm')
      )
    )
  );

/** A partner writes their own, and only while it is still theirs. */
DROP POLICY IF EXISTS partner_leads_insert ON partner_leads;
CREATE POLICY partner_leads_insert ON partner_leads FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND partner_id = public.auth_member_id(organization_id)
  );

/**
 * Two writers, with different reach.
 *
 * The partner may edit their own row up to the point they submit it. After
 * that it is the company's, and only somebody with CRM access can move it -
 * which is what makes "approved" mean something rather than being a state the
 * submitter can set for themselves.
 */
DROP POLICY IF EXISTS partner_leads_update ON partner_leads;
CREATE POLICY partner_leads_update ON partner_leads FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      (partner_id = public.auth_member_id(organization_id) AND status = 'draft')
      OR (
        public.auth_role_in(organization_id)::text NOT IN ('client', 'partner')
        AND public.can_access_module(organization_id, 'crm')
      )
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      partner_id = public.auth_member_id(organization_id)
      OR (
        public.auth_role_in(organization_id)::text NOT IN ('client', 'partner')
        AND public.can_access_module(organization_id, 'crm')
      )
    )
  );

DROP POLICY IF EXISTS partner_leads_delete ON partner_leads;
CREATE POLICY partner_leads_delete ON partner_leads FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND partner_id = public.auth_member_id(organization_id)
    AND status = 'draft'
  );

-- ───────────────────────────────────────────────────────────────────────────
--  4. Approval
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Turn a submitted partner lead into one of the company's own.
 *
 * A function rather than a route doing two writes, because the two writes
 * must not come apart: a `partner_leads` row marked approved with no lead
 * behind it is a promise to somebody's commission that nothing will keep.
 *
 * `SECURITY DEFINER` because it writes to `leads`, and the caller may be a
 * sales manager whose grant covers that - but the *partner* never calls this,
 * and the guard below is what makes sure of it.
 */
CREATE OR REPLACE FUNCTION public.approve_partner_lead(
  p_partner_lead uuid,
  p_owner        uuid DEFAULT NULL,
  p_note         text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pl      partner_leads%ROWTYPE;
  actor   uuid;
  role    text;
  new_id  uuid;
BEGIN
  SELECT * INTO pl FROM partner_leads WHERE id = p_partner_lead;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That submission no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;

  actor := public.auth_member_id(pl.organization_id);
  role  := public.auth_role_in(pl.organization_id)::text;

  /* Externals cannot approve anything, least of all their own submission. */
  IF role IS NULL OR role IN ('client', 'partner') THEN
    RAISE EXCEPTION 'Only the company can approve a submitted lead.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_access_module(pl.organization_id, 'crm') THEN
    RAISE EXCEPTION 'You do not have access to the CRM.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF pl.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted lead can be approved.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO leads (
    organization_id, first_name, last_name, email, phone,
    company_name, job_title, source, status, estimated_value,
    owner_id, notes, source_partner_id
  )
  VALUES (
    pl.organization_id, pl.first_name, pl.last_name, pl.email, pl.phone,
    pl.company_name, pl.job_title, 'partner', 'new', pl.estimated_value,
    COALESCE(p_owner, actor), pl.note, pl.partner_id
  )
  RETURNING id INTO new_id;

  UPDATE partner_leads
  SET status = 'approved',
      lead_id = new_id,
      decided_at = now(),
      decided_by = actor,
      decision_note = COALESCE(p_note, '')
  WHERE id = p_partner_lead;

  /* The partner is told, because it is their commission that depends on it. */
  INSERT INTO notifications (
    organization_id, recipient_id, type, title, body, entity_type, entity_id, link
  )
  VALUES (
    pl.organization_id, pl.partner_id, 'partner_lead_approved',
    'Your lead was accepted',
    btrim(COALESCE(pl.first_name, '') || ' ' || COALESCE(pl.last_name, ''))
      || CASE WHEN pl.company_name IS NULL THEN '' ELSE ' - ' || pl.company_name END,
    'partner_lead', p_partner_lead, '/dashboard?module=portal'
  );

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_partner_lead(uuid, uuid, text) TO authenticated;

/**
 * Attribution follows the lead into the event stream.
 *
 * `emit_lead_events` already writes `source_partner_id: null` into every lead
 * payload; now that the column exists it writes the real value, so an
 * incentive rule on `lead.qualified` or `lead.converted` can pay the partner
 * who found it without the ledger needing to know anything about partners.
 */
CREATE OR REPLACE FUNCTION public.emit_lead_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  body jsonb;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  body := jsonb_build_object(
    'lead_name',       btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')),
    'company_name',    NEW.company_name,
    'estimated_value', COALESCE(NEW.estimated_value, 0),
    'currency',        public.org_currency(NEW.organization_id),
    'source',          NEW.source,
    'score',           NEW.score,
    'source_partner_id', NEW.source_partner_id
  );

  IF NEW.status = 'qualified'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.emit_business_event(
      NEW.organization_id, 'lead.qualified', NEW.owner_id, 'lead', NEW.id, now(), body,
      'lead:' || NEW.id || ':qualified'
    );
  END IF;

  IF NEW.converted_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.converted_at IS DISTINCT FROM NEW.converted_at) THEN
    PERFORM public.emit_business_event(
      NEW.organization_id, 'lead.converted', NEW.owner_id, 'lead', NEW.id, NEW.converted_at,
      body || jsonb_build_object('converted_contact_id', NEW.converted_contact_id),
      'lead:' || NEW.id || ':converted:' || extract(epoch from NEW.converted_at)::bigint
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  5. The module gate, with externals answered from a list
-- ───────────────────────────────────────────────────────────────────────────

/**
 * External roles are refused unless named; internal roles keep the fallback.
 *
 * The old shape put every role through one CASE whose last line was
 * `auth_role_in(org) <> 'client'`. That was correct while `client` was the
 * only external role and became a hole the moment a second one existed:
 * `partner` is not `client`, so it would have matched the fallback and
 * received every module the CASE did not explicitly restrict.
 *
 * Externals now fall through to `false`. Internals keep the permissive
 * fallback, which is right for them and which changing would silently close
 * modules that work today.
 */
CREATE OR REPLACE FUNCTION public.can_access_module(org uuid, module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.auth_role_in(org) IS NULL THEN false

    -- ── External roles: named, or refused ────────────────────────────────
    WHEN public.auth_role_in(org)::text = 'client' THEN
      module IN ('portal', 'support', 'projects')
    WHEN public.auth_role_in(org)::text = 'partner' THEN
      -- The lead workspace is rendered inside the portal, which is the whole
      -- of an external person's product. Nothing else, ever.
      module = 'portal'

    -- ── Internal roles ───────────────────────────────────────────────────
    WHEN public.auth_role_in(org)::text IN ('owner', 'administrator') THEN true
    WHEN module = 'crm'         THEN public.auth_role_in(org)::text IN ('manager','sales_staff','finance_staff','support_staff')
    WHEN module = 'finance'     THEN public.auth_role_in(org)::text IN ('manager','finance_staff')
    WHEN module = 'performance' THEN true
    WHEN module = 'inventory'   THEN public.auth_role_in(org)::text IN ('manager','finance_staff','sales_staff')
    WHEN module = 'support'     THEN public.auth_role_in(org)::text IN ('manager','support_staff')
    ELSE true
  END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_module(uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  6. Realtime
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.partner_leads REPLICA IDENTITY FULL';

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'partner_leads'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_leads';
  END IF;
END $$;
