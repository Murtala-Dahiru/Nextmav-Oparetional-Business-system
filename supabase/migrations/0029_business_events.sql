-- ═══════════════════════════════════════════════════════════════════════════
--  0029 - Business events: the spine the performance layer reads from
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Phase 5 is performance, incentives and the HR layer above them. All of it
--  reads from one table, and this migration adds it and nothing else.
--
--  ── Why a new table, when two logs already exist ─────────────────────────
--
--  `audit_log` records which columns changed, for compliance, and is readable
--  only by administrators. `activity_log` records a human sentence for a feed.
--  Neither is a typed event: neither promises a payload shape, neither can be
--  replayed, and neither carries the figure a commission would be computed
--  from. Asking either of them "what did this person achieve last quarter"
--  means parsing prose.
--
--  ── Written by triggers, never by endpoints ──────────────────────────────
--
--  A deal becomes won through at least four paths today: the record sheet,
--  the pipeline drag, the close dialog, and `/api/crm/import/commit`, which
--  writes deals directly. A route that emits events catches three of them.
--  This follows `deal_stage_events` exactly: the trigger is the only writer,
--  and the table comment says so.
--
--  ── The two columns that are easy to collapse and must not be ────────────
--
--  `subject_member_id` is whose achievement this is. `actor_member_id` is who
--  caused it. A sales manager marking a colleague's deal won produces an
--  event belonging to the owner and an audit trail pointing at the manager.
--  One column means either the wrong person is paid or the wrong person is
--  blamed, and nobody finds out until a commission is disputed.
--
--  ── Why the payload is a snapshot ────────────────────────────────────────
--
--  `deals.value` is editable, for ever. A performance figure read from the
--  live row is the value the deal has today, not the value it was won at, and
--  an incentive computed from it silently changes an old payslip. The payload
--  freezes value, currency and the customer at the moment the event happened.
--  `deal_stage_events.value_at` already applies this reasoning; this extends
--  it to the number people are paid on.
--
--  The organisation's currency is copied in for the same reason: `deals` has
--  no currency column, `organizations.currency` can be changed in settings,
--  and a settings change must never rewrite what somebody already earned.
--
--  Idempotent: safe to re-run, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. The table
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_events (
  id                bigserial PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  /**
   * `text` with a CHECK rather than an enum, deliberately.
   *
   * New event types arrive with new features, and `ALTER TYPE ... ADD VALUE`
   * cannot run inside a transaction on every Postgres this chain supports.
   * A CHECK is altered in a migration like any other constraint, and greps
   * as readably as an enum does.
   */
  event_type        text NOT NULL CHECK (event_type IN (
                      'deal.won', 'deal.lost', 'deal.reopened',
                      'invoice.paid',
                      'lead.qualified', 'lead.converted'
                    )),

  /** The payload is a contract. Version it from the first row, not the first breakage. */
  event_version     int NOT NULL DEFAULT 1,

  subject_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  actor_member_id   uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  entity_type       text NOT NULL,
  entity_id         uuid NOT NULL,

  /** When it happened, which is not always when the row was written. */
  occurred_at       timestamptz NOT NULL DEFAULT now(),

  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,

  /**
   * One event per real-world occurrence.
   *
   * `deal:<id>:won:<closed_at>` means a deal that is reopened and won again
   * produces a second event, correctly, while a trigger that fires twice for
   * one transition produces one. Every writer below uses ON CONFLICT DO
   * NOTHING, so the second attempt is silent rather than an error.
   */
  idempotency_key   text NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, idempotency_key)
);

COMMENT ON TABLE public.business_events IS
  'Typed, append-only record of things that happened and count towards somebody''s performance. Written only by the emit_* triggers; no endpoint inserts here.';

CREATE INDEX IF NOT EXISTS idx_business_events_subject
  ON business_events (organization_id, subject_member_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_events_org_time
  ON business_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_events_entity
  ON business_events (entity_type, entity_id);

-- ───────────────────────────────────────────────────────────────────────────
--  2. Row-level security
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE business_events ENABLE ROW LEVEL SECURITY;

/**
 * FORCE, for the reason 0005 gives for every other table: without it, a
 * connection authenticating as the table owner reads across all tenants and
 * RLS is merely advisory. `db:verify` asserts this on every table.
 */
ALTER TABLE business_events FORCE ROW LEVEL SECURITY;

/**
 * Who may read an event.
 *
 * ── Why this is not simply "anyone who can read CRM" ─────────────────────
 *
 * An event carries a deal's value and the name of the person credited with
 * it. That is performance data about a colleague, and the organisation
 * already has one answer to who may see that: `auth_visible_member_ids`,
 * which returns everyone for owners, administrators and HR, a department
 * plus direct reports for a manager, and yourself for everybody else.
 *
 * Reusing it here means the visibility rule is stated once. A separate rule
 * invented for this table would be a second answer to the same question, and
 * the two would drift.
 *
 * Events with no subject - a deal won by a departed member, whose
 * `organization_members` row is kept but whose ownership was cleared - are
 * visible to those who can see the whole organisation, and to nobody else.
 */
DROP POLICY IF EXISTS business_events_select ON business_events;
CREATE POLICY business_events_select ON business_events FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      subject_member_id = ANY (public.auth_visible_member_ids(organization_id))
      OR (
        subject_member_id IS NULL
        AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      )
    )
  );

/**
 * INSERT exists only because the table is FORCE'd: the writers are SECURITY
 * DEFINER triggers, and under FORCE even the definer is held to the policies.
 * The check is the tenant and nothing else, because no endpoint posts here.
 *
 * There is deliberately no UPDATE and no DELETE policy. An event that can be
 * edited after an incentive was computed from it is not evidence.
 */
DROP POLICY IF EXISTS business_events_insert ON business_events;
CREATE POLICY business_events_insert ON business_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

-- ───────────────────────────────────────────────────────────────────────────
--  3. The writer
-- ───────────────────────────────────────────────────────────────────────────

/**
 * One place that knows how to write an event.
 *
 * Every trigger below funnels through here so that the idempotency behaviour,
 * the actor resolution and the version stamp exist once rather than five
 * times. `SECURITY DEFINER` because the caller is a salesperson whose own
 * grants do not include this table.
 */
CREATE OR REPLACE FUNCTION public.emit_business_event(
  p_org        uuid,
  p_type       text,
  p_subject    uuid,
  p_entity     text,
  p_entity_id  uuid,
  p_occurred   timestamptz,
  p_payload    jsonb,
  p_key        text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO business_events (
    organization_id, event_type, event_version,
    subject_member_id, actor_member_id,
    entity_type, entity_id, occurred_at, payload, idempotency_key
  )
  VALUES (
    p_org, p_type, 1,
    p_subject, public.auth_member_id(p_org),
    p_entity, p_entity_id, COALESCE(p_occurred, now()),
    COALESCE(p_payload, '{}'::jsonb), p_key
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
END;
$$;

/** The organisation's currency, frozen into a payload at write time. */
CREATE OR REPLACE FUNCTION public.org_currency(p_org uuid)
RETURNS char(3)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT currency FROM organizations WHERE id = p_org), 'USD')::char(3);
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  4. Deals
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Won, lost, and reopened.
 *
 * Fires after `stamp_deal_closure()` has settled `closed_at`, so the
 * timestamp in the idempotency key is the real one rather than whatever the
 * client sent. Trigger order within a table is alphabetical by name in
 * Postgres, and `trg_deal_events` sorts after `trg_stamp_deal_closure` for
 * BEFORE triggers by virtue of being an AFTER trigger; AFTER always follows
 * BEFORE regardless of name.
 *
 * A reopened deal is an event in its own right. Without it, a deal won in
 * January, reopened in February and won again in March looks from the event
 * stream like two unrelated wins, and any incentive rule that pays on
 * `deal.won` pays twice with nothing recording why.
 */
CREATE OR REPLACE FUNCTION public.emit_deal_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  body    jsonb;
  stamp   timestamptz;
  was_open boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  stamp := COALESCE(NEW.closed_at, now());

  body := jsonb_build_object(
    'deal_name',      NEW.name,
    'value',          COALESCE(NEW.value, 0),
    'currency',       public.org_currency(NEW.organization_id),
    'company_id',     NEW.company_id,
    'contact_id',     NEW.contact_id,
    'probability',    NEW.probability,
    'expected_close', NEW.expected_close,
    'stage_from',     CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage::text ELSE NULL END,
    'stage_to',       NEW.stage::text,
    'lost_reason',    NEW.lost_reason,
    /*
     * Reserved from the first row so the partner workspace can attribute
     * without reshaping the contract later. Always present, usually null.
     */
    'source_partner_id', NULL
  );

  was_open := TG_OP = 'UPDATE'
              AND OLD.stage NOT IN ('closed_won', 'closed_lost');

  IF NEW.stage = 'closed_won'
     AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage) THEN
    PERFORM public.emit_business_event(
      NEW.organization_id, 'deal.won', NEW.owner_id, 'deal', NEW.id, stamp, body,
      'deal:' || NEW.id || ':won:' || extract(epoch from stamp)::bigint
    );

  ELSIF NEW.stage = 'closed_lost'
     AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage) THEN
    PERFORM public.emit_business_event(
      NEW.organization_id, 'deal.lost', NEW.owner_id, 'deal', NEW.id, stamp, body,
      'deal:' || NEW.id || ':lost:' || extract(epoch from stamp)::bigint
    );

  ELSIF TG_OP = 'UPDATE'
     AND OLD.stage IN ('closed_won', 'closed_lost')
     AND NEW.stage NOT IN ('closed_won', 'closed_lost') THEN
    PERFORM public.emit_business_event(
      NEW.organization_id, 'deal.reopened', NEW.owner_id, 'deal', NEW.id, now(),
      body || jsonb_build_object('reopened_from', OLD.stage::text),
      'deal:' || NEW.id || ':reopened:' || extract(epoch from now())::bigint
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_events ON deals;
CREATE TRIGGER trg_deal_events
  AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.emit_deal_events();

-- ───────────────────────────────────────────────────────────────────────────
--  5. Invoices
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Money that actually arrived.
 *
 * This is what a commission on *collected* revenue pays from, as opposed to
 * `deal.won`, which is revenue booked. Both exist because both are legitimate
 * company policy and the choice belongs to whoever writes the incentive rule,
 * not to this migration.
 *
 * The subject is the invoice's owner. Attributing collected revenue to the
 * salesperson who won the deal needs `invoices.deal_id`, which 0030 adds;
 * until a deal is linked, the payload carries a null `deal_id` and a rule on
 * this basis simply has nothing to match, which is the honest failure.
 */
CREATE OR REPLACE FUNCTION public.emit_invoice_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  stamp timestamptz;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    stamp := COALESCE(NEW.paid_at, now());

    PERFORM public.emit_business_event(
      NEW.organization_id, 'invoice.paid', NEW.owner_id, 'invoice', NEW.id, stamp,
      jsonb_build_object(
        'invoice_number', NEW.invoice_number,
        'total',          COALESCE(NEW.total, 0),
        'amount_paid',    COALESCE(NEW.amount_paid, 0),
        'currency',       NEW.currency,
        'company_id',     NEW.company_id,
        'project_id',     NEW.project_id,
        'deal_id',        NULL,
        'source_partner_id', NULL
      ),
      'invoice:' || NEW.id || ':paid:' || extract(epoch from stamp)::bigint
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_events ON invoices;
CREATE TRIGGER trg_invoice_events
  AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.emit_invoice_events();

-- ───────────────────────────────────────────────────────────────────────────
--  6. Leads
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Qualification and conversion.
 *
 * Qualifying a lead is the one piece of top-of-funnel work that is
 * unambiguously an achievement rather than an activity: somebody decided this
 * prospect is real. It is also the natural unit for a marketer's or an
 * external partner's incentive, which is why it earns an event while
 * "contacted" does not.
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
    'source_partner_id', NULL
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

DROP TRIGGER IF EXISTS trg_lead_events ON leads;
CREATE TRIGGER trg_lead_events
  AFTER INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION public.emit_lead_events();

-- ───────────────────────────────────────────────────────────────────────────
--  7. Backfill
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Every deal that is already closed gets its event.
 *
 * Without this, a workspace that has been running for a year shows an empty
 * performance screen on the day this ships, and the first month of figures
 * would be wrong in a way nobody could see. The idempotency key is computed
 * the same way the trigger computes it, so the backfill and a later real
 * transition cannot both land.
 *
 * `closed_at` is null on deals closed before 0028 taught the product to stamp
 * it; those fall back to `updated_at`, which is the best evidence available
 * and is marked as such in the payload.
 */
INSERT INTO business_events (
  organization_id, event_type, event_version, subject_member_id, actor_member_id,
  entity_type, entity_id, occurred_at, payload, idempotency_key
)
SELECT
  d.organization_id,
  CASE WHEN d.stage = 'closed_won' THEN 'deal.won' ELSE 'deal.lost' END,
  1,
  d.owner_id,
  NULL,
  'deal',
  d.id,
  COALESCE(d.closed_at, d.updated_at),
  jsonb_build_object(
    'deal_name',      d.name,
    'value',          COALESCE(d.value, 0),
    'currency',       public.org_currency(d.organization_id),
    'company_id',     d.company_id,
    'contact_id',     d.contact_id,
    'probability',    d.probability,
    'expected_close', d.expected_close,
    'stage_from',     NULL,
    'stage_to',       d.stage::text,
    'lost_reason',    d.lost_reason,
    'source_partner_id', NULL,
    'backfilled',     true,
    'closed_at_inferred', d.closed_at IS NULL
  ),
  'deal:' || d.id
    || CASE WHEN d.stage = 'closed_won' THEN ':won:' ELSE ':lost:' END
    || extract(epoch from COALESCE(d.closed_at, d.updated_at))::bigint
FROM deals d
WHERE d.deleted_at IS NULL
  AND d.stage IN ('closed_won', 'closed_lost')
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

/** Leads already converted, on the same reasoning. */
INSERT INTO business_events (
  organization_id, event_type, event_version, subject_member_id, actor_member_id,
  entity_type, entity_id, occurred_at, payload, idempotency_key
)
SELECT
  l.organization_id, 'lead.converted', 1, l.owner_id, NULL,
  'lead', l.id, l.converted_at,
  jsonb_build_object(
    'lead_name',       btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')),
    'company_name',    l.company_name,
    'estimated_value', COALESCE(l.estimated_value, 0),
    'currency',        public.org_currency(l.organization_id),
    'source',          l.source,
    'score',           l.score,
    'converted_contact_id', l.converted_contact_id,
    'source_partner_id', NULL,
    'backfilled',      true
  ),
  'lead:' || l.id || ':converted:' || extract(epoch from l.converted_at)::bigint
FROM leads l
WHERE l.deleted_at IS NULL
  AND l.converted_at IS NOT NULL
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
--  8. Realtime
-- ───────────────────────────────────────────────────────────────────────────

/**
 * A dashboard that does not move when a deal is won is a report.
 *
 * Same loop 0020 uses, and `db:verify` asserts every subscribed table is both
 * in the publication and carries `REPLICA IDENTITY FULL` - without the latter
 * a filtered UPDATE arrives with no old row and subscribers cannot tell what
 * changed.
 */
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.business_events REPLICA IDENTITY FULL';

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'business_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.business_events';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  9. Grants
-- ───────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.org_currency(uuid) TO authenticated;

/*
 * `emit_business_event` is deliberately NOT granted to `authenticated`.
 *
 * It is called by triggers, which run as the definer regardless of the
 * caller's grants. Exposing it would let any signed-in member forge an
 * achievement for themselves, which is the one thing this table exists to
 * make impossible.
 */
REVOKE ALL ON FUNCTION public.emit_business_event(uuid, text, uuid, text, uuid, timestamptz, jsonb, text) FROM public;
REVOKE ALL ON FUNCTION public.emit_business_event(uuid, text, uuid, text, uuid, timestamptz, jsonb, text) FROM authenticated;
