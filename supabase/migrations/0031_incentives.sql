-- ═══════════════════════════════════════════════════════════════════════════
--  0031 - Incentives: configurable rules, and a ledger that does not change
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The requirement that shapes every decision in this file is the one about
--  people rather than money: an employee must be able to understand how their
--  incentive was calculated. That is not a help page. It is a data structure
--  decision, and it is met by storing the workings next to the amount.
--
--  ── Two tables, two different kinds of thing ─────────────────────────────
--
--  `incentive_rules` is policy. It is versioned rather than edited, because a
--  rule that changes underneath an entry makes that entry unexplainable.
--
--  `incentive_entries` is a ledger. It is append-only in spirit and in
--  practice: an amount, once computed, is never recalculated. A deal whose
--  value is corrected produces a *reversal* row and a fresh row, and the
--  person sees both. An entry that silently changes value is the fastest way
--  to destroy trust in a commission system and it is trivially avoidable.
--
--  ── Why entries are written by a trigger and can also be rebuilt ─────────
--
--  The trigger writes them in the same transaction as the event, so a deal
--  won at half past four has its pending commission by half past four. But
--  unlike `business_events`, an incentive entry is *derived* - it can always
--  be recomputed from the event that caused it - so `recompute_incentives()`
--  exists for the cases a trigger cannot cover: a rule added after the fact,
--  a rate corrected, a bug fixed. Idempotent, via a unique key on
--  (rule, source event), so re-running it can only fill gaps.
--
--  ── What is deliberately not here ────────────────────────────────────────
--
--  Salary. HR holds eligibility and bands, this holds what was earned, and
--  Finance holds what was paid. The moment the first two share a table, every
--  manager who can see a commission can see a wage.
--
--  Idempotent: safe to re-run, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. Vocabulary
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incentive_basis') THEN
    /**
     * What the calculation is applied to.
     *
     * `booked_revenue` pays when a deal is won and motivates closing.
     * `collected_revenue` pays when the money arrives and protects the company
     * from paying out on revenue that never does. Both are legitimate company
     * policy, so the choice belongs to whoever writes the rule.
     * `per_event` is for flat amounts: a bonus per qualified lead, where there
     * is no sum to take a percentage of.
     */
    CREATE TYPE incentive_basis AS ENUM ('booked_revenue', 'collected_revenue', 'per_event');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incentive_status') THEN
    /**
     * `pending` -> `approved` -> `paid`, with `rejected` and `reversed` as the
     * two ways out. Two approvals in sequence: a manager approves the
     * performance claim, Finance approves the payment.
     */
    CREATE TYPE incentive_status AS ENUM ('pending', 'approved', 'rejected', 'paid', 'reversed');
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  2. Rules
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incentive_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text NOT NULL DEFAULT '',

  /** Bumped whenever the terms change. Entries pin the version they used. */
  version         int NOT NULL DEFAULT 1 CHECK (version > 0),

  basis           incentive_basis NOT NULL DEFAULT 'booked_revenue',
  trigger_event   text NOT NULL CHECK (trigger_event IN (
                    'deal.won', 'invoice.paid', 'lead.qualified', 'lead.converted'
                  )),

  /**
   * Who it applies to. All null means everybody in the organisation.
   *
   * Three nullable columns rather than a polymorphic pair, because each is a
   * real foreign key the database can enforce, and because the matching query
   * stays readable: a rule applies if each stated condition holds.
   */
  applies_to_role       org_role,
  applies_to_department uuid REFERENCES departments(id) ON DELETE CASCADE,
  applies_to_member     uuid REFERENCES organization_members(id) ON DELETE CASCADE,

  /**
   * The sums, as JSON, because the shapes genuinely differ:
   *
   *   {"kind":"percentage","rate":2.5}
   *   {"kind":"tiered","tiers":[{"from":0,"rate":1},{"from":10000000,"rate":2.5}]}
   *   {"kind":"fixed","amount":50000}
   *
   * Validated by `check_incentive_rule()` below rather than by a CHECK
   * constraint, so the message a person gets says which part is wrong.
   */
  calculation     jsonb NOT NULL,

  effective_from  date NOT NULL DEFAULT current_date,
  effective_to    date,

  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE public.incentive_rules IS
  'How incentives are calculated. Versioned rather than edited: an entry pins the version it used, so a later change cannot rewrite an old payslip.';

CREATE INDEX IF NOT EXISTS idx_incentive_rules_active
  ON incentive_rules (organization_id, trigger_event, is_active)
  WHERE is_active;

DROP TRIGGER IF EXISTS trg_incentive_rules_updated ON incentive_rules;
CREATE TRIGGER trg_incentive_rules_updated
  BEFORE UPDATE ON incentive_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * The calculation has to make sense before anybody is paid from it.
 *
 * Checked in a trigger rather than a CHECK constraint so the refusal can name
 * the problem: "a percentage rule needs a rate above zero" is actionable,
 * "violates check constraint incentive_rules_calculation_check" is not.
 */
CREATE OR REPLACE FUNCTION public.check_incentive_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  kind  text;
  tier  jsonb;
  prev  numeric := -1;
BEGIN
  kind := NEW.calculation->>'kind';

  IF kind IS NULL OR kind NOT IN ('percentage', 'tiered', 'fixed') THEN
    RAISE EXCEPTION 'A rule is a percentage, a tiered percentage or a fixed amount'
      USING ERRCODE = 'check_violation';
  END IF;

  IF kind = 'percentage' THEN
    IF COALESCE((NEW.calculation->>'rate')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'A percentage rule needs a rate above zero'
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF kind = 'fixed' THEN
    IF COALESCE((NEW.calculation->>'amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'A fixed rule needs an amount above zero'
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF kind = 'tiered' THEN
    IF jsonb_typeof(NEW.calculation->'tiers') <> 'array'
       OR jsonb_array_length(NEW.calculation->'tiers') = 0 THEN
      RAISE EXCEPTION 'A tiered rule needs at least one tier'
        USING ERRCODE = 'check_violation';
    END IF;

    /* Ascending thresholds, so "the highest tier reached" is unambiguous. */
    FOR tier IN SELECT * FROM jsonb_array_elements(NEW.calculation->'tiers') LOOP
      IF COALESCE((tier->>'from')::numeric, -1) <= prev THEN
        RAISE EXCEPTION 'Tiers have to start at zero and rise'
          USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE((tier->>'rate')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'Every tier needs a rate above zero'
          USING ERRCODE = 'check_violation';
      END IF;
      prev := (tier->>'from')::numeric;
    END LOOP;
  END IF;

  /* A percentage of nothing is nothing. */
  IF kind IN ('percentage', 'tiered') AND NEW.basis = 'per_event' THEN
    RAISE EXCEPTION 'A percentage needs an amount to apply to. Choose booked or collected revenue.'
      USING ERRCODE = 'check_violation';
  END IF;

  /* Changing the terms is a new version, not an edit in place. */
  IF TG_OP = 'UPDATE'
     AND (NEW.calculation IS DISTINCT FROM OLD.calculation OR NEW.basis IS DISTINCT FROM OLD.basis)
     AND NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_incentive_rule ON incentive_rules;
CREATE TRIGGER trg_check_incentive_rule
  BEFORE INSERT OR UPDATE ON incentive_rules
  FOR EACH ROW EXECUTE FUNCTION public.check_incentive_rule();

-- ───────────────────────────────────────────────────────────────────────────
--  3. The ledger
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incentive_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  rule_id         uuid NOT NULL REFERENCES incentive_rules(id) ON DELETE RESTRICT,
  /** Pinned. A later rule change cannot rewrite what this entry was worth. */
  rule_version    int NOT NULL,
  rule_name       text NOT NULL DEFAULT '',

  source_event_id bigint REFERENCES business_events(id) ON DELETE SET NULL,

  basis_amount    numeric(14,2) NOT NULL DEFAULT 0,
  currency        char(3) NOT NULL DEFAULT 'USD',
  amount          numeric(14,2) NOT NULL,

  status          incentive_status NOT NULL DEFAULT 'pending',

  /**
   * The workings, in full.
   *
   * Mandatory in practice: every writer below populates it, and the screen
   * renders it as a sentence a person can check - "11,600,000 booked x 2.5%
   * (tier 2, above 10m) = 290,000". Without this the ledger is a number with
   * a name on it, and the requirement that people understand their own
   * incentive is unmeetable.
   */
  explanation     jsonb NOT NULL DEFAULT '{}'::jsonb,

  /** Set on a reversal, pointing at what it undoes. */
  reverses_entry_id uuid REFERENCES incentive_entries(id) ON DELETE SET NULL,

  approved_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  paid_by         uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  paid_at         timestamptz,
  paid_reference  text,
  note            text NOT NULL DEFAULT '',

  earned_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.incentive_entries IS
  'What each person earned, why, and where it is in the approval chain. Amounts are never recalculated; a correction is a reversal plus a new entry.';

/**
 * One entry per rule per event.
 *
 * Partial, so reversals are exempt: a reversal is a second row against the
 * same event by design, and including it would make correcting anything
 * impossible.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_incentive_entries_once
  ON incentive_entries (organization_id, rule_id, source_event_id)
  WHERE reverses_entry_id IS NULL AND source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incentive_entries_member
  ON incentive_entries (organization_id, member_id, earned_at DESC);

CREATE INDEX IF NOT EXISTS idx_incentive_entries_status
  ON incentive_entries (organization_id, status, earned_at DESC);

DROP TRIGGER IF EXISTS trg_incentive_entries_updated ON incentive_entries;
CREATE TRIGGER trg_incentive_entries_updated
  BEFORE UPDATE ON incentive_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * What may change on an entry after it is written.
 *
 * The status, and who moved it. Never the amount, the basis, the rule or the
 * event: those are what the entry *is*, and a system where they can be edited
 * cannot answer "why was I paid this" a month later. Correcting an amount
 * means reversing the entry and writing a new one, which is what
 * `reverse_incentive_entry()` does.
 */
CREATE OR REPLACE FUNCTION public.guard_incentive_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.basis_amount IS DISTINCT FROM OLD.basis_amount
     OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.rule_version IS DISTINCT FROM OLD.rule_version
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
     OR NEW.explanation IS DISTINCT FROM OLD.explanation THEN
    RAISE EXCEPTION 'An incentive entry cannot be edited. Reverse it and write a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  /* A paid entry is finished. */
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'That has already been paid.'
      USING ERRCODE = 'check_violation';
  END IF;

  /* Stamp the transitions, so the ledger records when as well as who. */
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    NEW.approved_at := COALESCE(NEW.approved_at, now());
    NEW.approved_by := COALESCE(NEW.approved_by, public.auth_member_id(NEW.organization_id));
  END IF;

  IF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    NEW.paid_at := COALESCE(NEW.paid_at, now());
    NEW.paid_by := COALESCE(NEW.paid_by, public.auth_member_id(NEW.organization_id));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_incentive_entry ON incentive_entries;
CREATE TRIGGER trg_guard_incentive_entry
  BEFORE UPDATE ON incentive_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_incentive_entry();

/**
 * Nobody approves their own.
 *
 * The platform already has `prevent_self_approval` for expenses; this is the
 * same rule for the same reason. A salesperson who could sign off their own
 * commission is not a control at all.
 */
CREATE OR REPLACE FUNCTION public.prevent_incentive_self_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('approved', 'paid')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.member_id = public.auth_member_id(NEW.organization_id) THEN
    RAISE EXCEPTION 'You cannot approve your own incentive.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_incentive_self_approval ON incentive_entries;
CREATE TRIGGER trg_prevent_incentive_self_approval
  BEFORE UPDATE ON incentive_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_incentive_self_approval();

-- ───────────────────────────────────────────────────────────────────────────
--  4. Row-level security
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE incentive_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_rules FORCE ROW LEVEL SECURITY;

/**
 * Everybody may read the rules.
 *
 * Deliberately, and it is the most important policy in this file. A
 * commission scheme people cannot read is not a scheme, it is a rumour, and
 * the brief's requirement that employees understand how their incentives are
 * calculated cannot be met by a table only administrators can see.
 */
DROP POLICY IF EXISTS incentive_rules_select ON incentive_rules;
CREATE POLICY incentive_rules_select ON incentive_rules FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'performance')
  );

/** Written by administrators and HR. Compensation policy is not a manager's. */
DROP POLICY IF EXISTS incentive_rules_write ON incentive_rules;
CREATE POLICY incentive_rules_write ON incentive_rules FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE incentive_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_entries FORCE ROW LEVEL SECURITY;

/**
 * Your own always; your people's if you manage them; everyone's if you pay
 * them.
 *
 * `finance_staff` is named explicitly rather than folded into
 * `auth_visible_member_ids`, because Finance's need here is real and narrow:
 * they approve payment, so they must see every entry, and they have no
 * business in `business_events` or anybody's pipeline.
 */
DROP POLICY IF EXISTS incentive_entries_select ON incentive_entries;
CREATE POLICY incentive_entries_select ON incentive_entries FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      member_id = ANY (public.auth_visible_member_ids(organization_id))
      OR public.auth_role_in(organization_id) = 'finance_staff'
    )
  );

/**
 * Moving an entry along the chain.
 *
 * INSERT is not granted to anyone: entries are written by the SECURITY
 * DEFINER functions below, which run as the definer and are unaffected by
 * this policy's absence. There is no endpoint that posts an entry, because an
 * incentive somebody can type in is not a calculated one.
 *
 * No DELETE policy either. Rejecting is a status, not a deletion.
 */
DROP POLICY IF EXISTS incentive_entries_update ON incentive_entries;
CREATE POLICY incentive_entries_update ON incentive_entries FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff', 'finance_staff')
      OR (
        public.auth_role_in(organization_id) = 'manager'
        AND member_id = ANY (public.auth_visible_member_ids(organization_id))
      )
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff', 'finance_staff')
      OR (
        public.auth_role_in(organization_id) = 'manager'
        AND member_id = ANY (public.auth_visible_member_ids(organization_id))
      )
    )
  );

/* Needed under FORCE so the definer functions below can write. */
DROP POLICY IF EXISTS incentive_entries_insert ON incentive_entries;
CREATE POLICY incentive_entries_insert ON incentive_entries FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

-- ───────────────────────────────────────────────────────────────────────────
--  5. The calculation
-- ───────────────────────────────────────────────────────────────────────────

/**
 * What a rule pays on an amount, and the workings that produced it.
 *
 * Returns both together because they must never disagree: computing the
 * number in one place and describing it in another is how a screen ends up
 * explaining a figure it did not produce.
 */
CREATE OR REPLACE FUNCTION public.incentive_amount(
  p_calculation jsonb,
  p_basis_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  kind      text := p_calculation->>'kind';
  rate      numeric;
  amount    numeric;
  tier      jsonb;
  hit       jsonb;
  hit_index int := 0;
  i         int := 0;
BEGIN
  IF kind = 'fixed' THEN
    amount := (p_calculation->>'amount')::numeric;
    RETURN jsonb_build_object(
      'amount', round(amount, 2),
      'kind', 'fixed',
      'fixed_amount', amount
    );
  END IF;

  IF kind = 'percentage' THEN
    rate := (p_calculation->>'rate')::numeric;
    amount := p_basis_amount * rate / 100.0;
    RETURN jsonb_build_object(
      'amount', round(amount, 2),
      'kind', 'percentage',
      'basis_amount', p_basis_amount,
      'rate', rate
    );
  END IF;

  IF kind = 'tiered' THEN
    /**
     * The highest tier the amount reaches, applied to the whole amount.
     *
     * Not marginal banding. This is the commoner commercial arrangement -
     * "close over ten million and the whole deal pays 2.5%" - and, more to the
     * point, it is the one a salesperson can predict in their head. A rule
     * that needs a spreadsheet to anticipate is a rule that does not motivate.
     */
    FOR tier IN SELECT * FROM jsonb_array_elements(p_calculation->'tiers') LOOP
      i := i + 1;
      IF p_basis_amount >= (tier->>'from')::numeric THEN
        hit := tier;
        hit_index := i;
      END IF;
    END LOOP;

    IF hit IS NULL THEN
      RETURN jsonb_build_object(
        'amount', 0, 'kind', 'tiered', 'basis_amount', p_basis_amount,
        'reason', 'Below the first tier'
      );
    END IF;

    rate := (hit->>'rate')::numeric;
    amount := p_basis_amount * rate / 100.0;
    RETURN jsonb_build_object(
      'amount', round(amount, 2),
      'kind', 'tiered',
      'basis_amount', p_basis_amount,
      'rate', rate,
      'tier', hit_index,
      'tier_from', (hit->>'from')::numeric
    );
  END IF;

  RETURN jsonb_build_object('amount', 0, 'kind', COALESCE(kind, 'unknown'));
END;
$$;

/**
 * Every entry a single event earns.
 *
 * Called by the trigger below and by `recompute_incentives()`, so the matching
 * and the arithmetic exist once. `ON CONFLICT DO NOTHING` against the partial
 * unique index makes it safe to call twice for the same event, which is what
 * lets the recompute be a repair tool rather than a duplicator.
 */
CREATE OR REPLACE FUNCTION public.apply_incentive_rules(p_event_id bigint)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ev        business_events%ROWTYPE;
  r         incentive_rules%ROWTYPE;
  basis     numeric;
  workings  jsonb;
  subject   organization_members%ROWTYPE;
  occurred  date;
  written   int := 0;
  inserted  int := 0;
BEGIN
  SELECT * INTO ev FROM business_events WHERE id = p_event_id;
  IF NOT FOUND OR ev.subject_member_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO subject FROM organization_members WHERE id = ev.subject_member_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  occurred := (ev.occurred_at AT TIME ZONE 'UTC')::date;

  FOR r IN
    SELECT * FROM incentive_rules
    WHERE organization_id = ev.organization_id
      AND is_active
      AND trigger_event = ev.event_type
      AND effective_from <= occurred
      AND (effective_to IS NULL OR effective_to >= occurred)
      /* Each stated condition has to hold; an unstated one matches everybody. */
      AND (applies_to_role IS NULL OR applies_to_role = subject.role)
      AND (applies_to_department IS NULL OR applies_to_department = subject.department_id)
      AND (applies_to_member IS NULL OR applies_to_member = subject.id)
  LOOP
    basis := CASE r.basis
      WHEN 'booked_revenue'    THEN COALESCE((ev.payload->>'value')::numeric, 0)
      WHEN 'collected_revenue' THEN COALESCE((ev.payload->>'amount_paid')::numeric,
                                             (ev.payload->>'total')::numeric, 0)
      ELSE 0
    END;

    workings := public.incentive_amount(r.calculation, basis);

    /* A rule that works out to nothing writes nothing, rather than a zero row. */
    CONTINUE WHEN COALESCE((workings->>'amount')::numeric, 0) <= 0;

    INSERT INTO incentive_entries (
      organization_id, member_id, rule_id, rule_version, rule_name,
      source_event_id, basis_amount, currency, amount, status,
      explanation, earned_at
    )
    VALUES (
      ev.organization_id, ev.subject_member_id, r.id, r.version, r.name,
      ev.id, basis,
      COALESCE(ev.payload->>'currency', public.org_currency(ev.organization_id))::char(3),
      (workings->>'amount')::numeric,
      'pending',
      workings || jsonb_build_object(
        'rule_name', r.name,
        'rule_version', r.version,
        'basis', r.basis::text,
        'event_type', ev.event_type,
        'subject', COALESCE(ev.payload->>'deal_name', ev.payload->>'lead_name',
                            ev.payload->>'invoice_number', 'Record'),
        'occurred_at', ev.occurred_at
      ),
      ev.occurred_at
    )
    ON CONFLICT DO NOTHING;

    /*
     * Count what was actually inserted, not what was considered.
     *
     * ON CONFLICT DO NOTHING means the common case for a recompute is that
     * every row already exists, and a function that reports "wrote 40" having
     * written nothing makes the repair tool impossible to trust.
     */
    GET DIAGNOSTICS inserted = ROW_COUNT;
    written := written + inserted;
  END LOOP;

  RETURN written;
END;
$$;

/**
 * A reversal: the entry stays, and a mirror row cancels it.
 *
 * Used when a won deal is reopened. The original is marked `reversed` rather
 * than deleted, and the negative row carries the same explanation with the
 * reason attached, so a person reading their ledger sees what happened rather
 * than a number that quietly disappeared.
 */
CREATE OR REPLACE FUNCTION public.reverse_incentive_entries(
  p_event_id bigint,
  p_reason   text
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e       incentive_entries%ROWTYPE;
  n       int := 0;
BEGIN
  FOR e IN
    SELECT * FROM incentive_entries
    WHERE source_event_id = p_event_id
      AND reverses_entry_id IS NULL
      AND status <> 'reversed'
  LOOP
    /* Paid money is not clawed back by a trigger. Somebody has to decide. */
    CONTINUE WHEN e.status = 'paid';

    INSERT INTO incentive_entries (
      organization_id, member_id, rule_id, rule_version, rule_name,
      source_event_id, basis_amount, currency, amount, status,
      explanation, reverses_entry_id, earned_at, note
    )
    VALUES (
      e.organization_id, e.member_id, e.rule_id, e.rule_version, e.rule_name,
      e.source_event_id, -e.basis_amount, e.currency, -e.amount, 'reversed',
      e.explanation || jsonb_build_object('reversal', true, 'reason', p_reason),
      e.id, now(), p_reason
    );

    UPDATE incentive_entries SET status = 'reversed', note = p_reason WHERE id = e.id;
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  6. The trigger
-- ───────────────────────────────────────────────────────────────────────────

/**
 * An event arrives; whatever it earns is written in the same transaction.
 *
 * A reopened deal reverses what its win earned. The win event is found by
 * entity rather than by key, because the reopen carries no reference to the
 * event it undoes and searching for the most recent unreversed win for that
 * deal is what "undo the last win" actually means.
 */
CREATE OR REPLACE FUNCTION public.on_business_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior bigint;
BEGIN
  IF NEW.event_type = 'deal.reopened' THEN
    SELECT id INTO prior
    FROM business_events
    WHERE organization_id = NEW.organization_id
      AND entity_type = 'deal'
      AND entity_id = NEW.entity_id
      AND event_type = 'deal.won'
      AND id < NEW.id
    ORDER BY id DESC
    LIMIT 1;

    IF prior IS NOT NULL THEN
      PERFORM public.reverse_incentive_entries(prior, 'The deal was reopened');
    END IF;

    RETURN NEW;
  END IF;

  PERFORM public.apply_incentive_rules(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_business_event ON business_events;
CREATE TRIGGER trg_on_business_event
  AFTER INSERT ON business_events
  FOR EACH ROW EXECUTE FUNCTION public.on_business_event();

/**
 * Rebuild entries for a window, filling only what is missing.
 *
 * The repair tool. A rule written after the quarter began, a rate corrected,
 * a bug fixed: all of them leave events with no entry, and none of them can
 * be fixed by a trigger that has already not fired. Safe to run repeatedly,
 * because `apply_incentive_rules` conflicts on (rule, event) and does nothing.
 *
 * Deliberately never *removes* an entry. Deciding that something already
 * granted should not have been is a human act with a reversal attached, not a
 * silent tidy-up.
 */
CREATE OR REPLACE FUNCTION public.recompute_incentives(
  p_org  uuid,
  p_from timestamptz DEFAULT now() - interval '1 year',
  p_to   timestamptz DEFAULT now()
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ev bigint;
  n  int := 0;
BEGIN
  FOR ev IN
    SELECT id FROM business_events
    WHERE organization_id = p_org
      AND occurred_at BETWEEN p_from AND p_to
      AND event_type <> 'deal.reopened'
    ORDER BY id
  LOOP
    n := n + public.apply_incentive_rules(ev);
  END LOOP;
  RETURN n;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  7. Notifications
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Told when it is approved, not when it is calculated.
 *
 * A pending entry is an arithmetic result, and a notification for every one
 * would be noise on a busy day. Approval is the moment something became true
 * for the person, and that is worth interrupting them for.
 */
CREATE OR REPLACE FUNCTION public.notify_incentive_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status IN ('approved', 'paid', 'rejected') THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    VALUES (
      NEW.organization_id, NEW.member_id,
      'incentive_' || NEW.status::text,
      CASE NEW.status
        WHEN 'approved' THEN 'Incentive approved'
        WHEN 'paid'     THEN 'Incentive paid'
        ELSE 'Incentive not approved'
      END,
      COALESCE(NEW.explanation->>'subject', NEW.rule_name),
      'incentive', NULL,
      '/dashboard?module=performance'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_incentive_change ON incentive_entries;
CREATE TRIGGER trg_notify_incentive_change
  AFTER UPDATE ON incentive_entries
  FOR EACH ROW EXECUTE FUNCTION public.notify_incentive_change();

-- ───────────────────────────────────────────────────────────────────────────
--  8. Realtime and grants
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incentive_rules', 'incentive_entries'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.incentive_amount(jsonb, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_incentives(uuid, timestamptz, timestamptz) TO authenticated;

/*
 * The two writers stay closed, for the reason `emit_business_event` does:
 * they run as the definer inside triggers, and a member who could call them
 * directly could grant themselves an entry.
 */
REVOKE ALL ON FUNCTION public.apply_incentive_rules(bigint) FROM public, authenticated;
REVOKE ALL ON FUNCTION public.reverse_incentive_entries(bigint, text) FROM public, authenticated;
