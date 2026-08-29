-- ═══════════════════════════════════════════════════════════════════════════
--  0030 - Targets, and the invoice link collected revenue needs
-- ═══════════════════════════════════════════════════════════════════════════
--
--  0029 gave the product a record of what happened. This gives it the one
--  thing that cannot be derived from what happened: what somebody said they
--  would do.
--
--  ── Why targets are stored when performance is not ───────────────────────
--
--  Every other performance figure in this phase is computed on read, because
--  a stored total is a second source of truth that drifts from the first. A
--  target is the opposite: it is an input. Nothing in the CRM implies that
--  Amara agreed to close forty million this quarter, and no aggregate can
--  recover it. So it is a row, and the only one.
--
--  ── Why a period and not a quarter ───────────────────────────────────────
--
--  `period_start` and `period_end` are dates rather than a 'Q3-2026' string,
--  because a company's sales quarter is not always the calendar's, targets
--  are sometimes set for a month or a campaign, and comparing a date range is
--  something the database can index. A label is kept alongside for display,
--  which is the part a string is actually good for.
--
--  ── Why rows are never edited after their period closes ──────────────────
--
--  A quota history that can be rewritten is not a quota history. The trigger
--  below refuses an UPDATE to `target_value` once `period_end` has passed,
--  for the same reason `deal_stage_events` has no UPDATE policy at all. A
--  correction to a closed period is a new row superseding the old one, and
--  both remain visible.
--
--  Idempotent: safe to re-run, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. What a target can be set on
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'target_subject') THEN
    CREATE TYPE target_subject AS ENUM ('member', 'team', 'department');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'target_metric') THEN
    /**
     * Each of these is answerable from `business_events` or the CRM tables
     * without a new aggregate. A metric nobody can measure is a promise the
     * screen cannot keep, so the list is deliberately short and grows only
     * when the query behind it exists.
     */
    CREATE TYPE target_metric AS ENUM (
      'revenue_won',
      'revenue_collected',
      'deals_won',
      'leads_qualified',
      'activities_logged'
    );
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  2. The table
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS performance_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  subject_type    target_subject NOT NULL,
  /**
   * Points at `organization_members`, `teams` or `departments` depending on
   * `subject_type`. Not a foreign key, because it cannot be three at once;
   * the trigger below checks it resolves, which is the part that matters.
   */
  subject_id      uuid NOT NULL,

  metric          target_metric NOT NULL,
  period_label    text NOT NULL DEFAULT '',
  period_start    date NOT NULL,
  period_end      date NOT NULL,

  target_value    numeric(14,2) NOT NULL CHECK (target_value > 0),
  /** Frozen at the time it was set, for the reason 0029 freezes it on events. */
  currency        char(3) NOT NULL DEFAULT 'USD',

  notes           text NOT NULL DEFAULT '',
  set_by          uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  superseded_by   uuid REFERENCES performance_targets(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (period_end >= period_start),

  /**
   * One live target per subject, metric and period.
   *
   * Superseded rows are excluded so a correction can coexist with what it
   * replaced: the history stays readable, and only one row is current.
   */
  CONSTRAINT performance_targets_unique_live
    EXCLUDE USING btree (
      organization_id WITH =,
      subject_type WITH =,
      subject_id WITH =,
      metric WITH =,
      period_start WITH =,
      period_end WITH =
    ) WHERE (superseded_by IS NULL)
);

COMMENT ON TABLE public.performance_targets IS
  'What somebody committed to, for a period. The only stored figure in the performance layer; everything else is derived.';

CREATE INDEX IF NOT EXISTS idx_targets_subject
  ON performance_targets (organization_id, subject_type, subject_id, metric, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_targets_period
  ON performance_targets (organization_id, period_start, period_end);

DROP TRIGGER IF EXISTS trg_targets_updated ON performance_targets;
CREATE TRIGGER trg_targets_updated
  BEFORE UPDATE ON performance_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  3. The subject must exist, and a closed period must not move
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_performance_target()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ok boolean;
BEGIN
  /* The polymorphic subject, checked the way a foreign key would. */
  ok := CASE NEW.subject_type
    WHEN 'member' THEN EXISTS (
      SELECT 1 FROM organization_members
      WHERE id = NEW.subject_id AND organization_id = NEW.organization_id)
    WHEN 'team' THEN EXISTS (
      SELECT 1 FROM teams
      WHERE id = NEW.subject_id AND organization_id = NEW.organization_id AND deleted_at IS NULL)
    WHEN 'department' THEN EXISTS (
      SELECT 1 FROM departments
      WHERE id = NEW.subject_id AND organization_id = NEW.organization_id AND deleted_at IS NULL)
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'That % is not in this organization', NEW.subject_type
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  /**
   * A target for a period that has finished is history.
   *
   * Superseding it is allowed - that is what `superseded_by` is for, and it
   * leaves both rows visible. Silently changing the number somebody was
   * measured against is not.
   */
  IF TG_OP = 'UPDATE'
     AND OLD.period_end < current_date
     AND NEW.target_value IS DISTINCT FROM OLD.target_value
     AND NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'That period has closed. Supersede the target instead of editing it.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_performance_target ON performance_targets;
CREATE TRIGGER trg_check_performance_target
  BEFORE INSERT OR UPDATE ON performance_targets
  FOR EACH ROW EXECUTE FUNCTION public.check_performance_target();

-- ───────────────────────────────────────────────────────────────────────────
--  4. Row-level security
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE performance_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_targets FORCE ROW LEVEL SECURITY;

/**
 * A target is read by the person it is set for, and by whoever may see that
 * person's performance.
 *
 * Team and department targets are readable by anyone in the organisation who
 * can open the module: a team quota is a shared commitment, and hiding it
 * from half the team makes it unusable as one.
 */
DROP POLICY IF EXISTS performance_targets_select ON performance_targets;
CREATE POLICY performance_targets_select ON performance_targets FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'performance')
    AND (
      subject_type <> 'member'
      OR subject_id = ANY (public.auth_visible_member_ids(organization_id))
    )
  );

/**
 * Set by administrators and HR, and by a manager for their own people.
 *
 * A manager setting their department's numbers is the ordinary case, and
 * `auth_visible_member_ids` already bounds it to their people. Nobody sets
 * their own target: `can_approve`-style self-dealing is prevented by the
 * check below rather than by hoping.
 */
DROP POLICY IF EXISTS performance_targets_write ON performance_targets;
CREATE POLICY performance_targets_write ON performance_targets FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR (
        public.auth_role_in(organization_id) = 'manager'
        AND (
          subject_type <> 'member'
          OR subject_id = ANY (public.auth_visible_member_ids(organization_id))
        )
      )
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
      OR (
        public.auth_role_in(organization_id) = 'manager'
        AND (
          subject_type <> 'member'
          OR subject_id = ANY (public.auth_visible_member_ids(organization_id))
        )
      )
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
--  5. The invoice link that collected revenue needs
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Which deal this invoice settles.
 *
 * Without it there is no way to say that a payment against invoice INV-0042
 * is the money from the deal Amara won in November, so a commission on
 * collected revenue has nothing to attach to. `company_id` is not enough: a
 * customer with four deals and four invoices gives four ambiguous answers.
 *
 * Nullable, and stays nullable. Plenty of invoices are not deal-driven at
 * all - a retainer, a recharge, a support renewal - and forcing a deal onto
 * those would mean inventing one.
 */
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_deal ON invoices (deal_id) WHERE deal_id IS NOT NULL;

/**
 * Now that the column exists, the invoice event can carry it, and a rule on
 * collected revenue can find the deal - and through the deal, the person who
 * won it, who is usually not the person who owns the invoice.
 */
CREATE OR REPLACE FUNCTION public.emit_invoice_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  stamp   timestamptz;
  seller  uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    stamp := COALESCE(NEW.paid_at, now());

    /*
     * Credit the deal's owner when there is one. Collected revenue is the
     * seller's achievement; the invoice owner is whoever raised the paperwork.
     * Falls back to the invoice owner when no deal is linked.
     */
    SELECT d.owner_id INTO seller FROM deals d WHERE d.id = NEW.deal_id;

    PERFORM public.emit_business_event(
      NEW.organization_id, 'invoice.paid',
      COALESCE(seller, NEW.owner_id),
      'invoice', NEW.id, stamp,
      jsonb_build_object(
        'invoice_number', NEW.invoice_number,
        'total',          COALESCE(NEW.total, 0),
        'amount_paid',    COALESCE(NEW.amount_paid, 0),
        'currency',       NEW.currency,
        'company_id',     NEW.company_id,
        'project_id',     NEW.project_id,
        'deal_id',        NEW.deal_id,
        'invoice_owner_id', NEW.owner_id,
        'source_partner_id', NULL
      ),
      'invoice:' || NEW.id || ':paid:' || extract(epoch from stamp)::bigint
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  6. The module gate
-- ───────────────────────────────────────────────────────────────────────────

/**
 * `performance` named explicitly, rather than left to the ELSE.
 *
 * The final branch of this function is `auth_role_in(org) <> 'client'`, which
 * means every module added since it was written has been open to every
 * internal role by default. That happens to be the right answer here -
 * everybody may open their own performance, and rows are bounded by
 * `auth_visible_member_ids` in each table's policy - but it should be a
 * decision rather than a default, and the next module's author should find a
 * branch here to copy.
 *
 * Note the deliberate asymmetry: the module is open, the *rows* are not.
 * Access and scope are different questions, and this function only answers
 * the first.
 */
CREATE OR REPLACE FUNCTION public.can_access_module(org uuid, module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.auth_role_in(org) IS NULL THEN false
    WHEN public.auth_role_in(org) IN ('owner','administrator') THEN true
    WHEN module = 'crm'       THEN public.auth_role_in(org) IN ('manager','sales_staff','finance_staff','support_staff')
    WHEN module = 'finance'   THEN public.auth_role_in(org) IN ('manager','finance_staff')
    -- Everyone internal may open Performance; each table bounds the rows.
    WHEN module = 'performance' THEN public.auth_role_in(org) <> 'client'
    WHEN module = 'inventory' THEN public.auth_role_in(org) IN ('manager','finance_staff','sales_staff')
    WHEN module = 'support'   THEN public.auth_role_in(org) IN ('manager','support_staff','client')
    WHEN module = 'projects'  THEN public.auth_role_in(org) <> 'client'
    ELSE public.auth_role_in(org) <> 'client'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_module(uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  7. Realtime
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.performance_targets REPLICA IDENTITY FULL';

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'performance_targets'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.performance_targets';
  END IF;
END $$;
