-- ═══════════════════════════════════════════════════════════════════════════
--  0042 - Compensation, and a payroll that could work in another country
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The HR module has a "Run Payroll Batch" button. It is attached to nothing.
--  Under it sits a table of three people with dollar salaries typed into a
--  `useState` array, and a "Next Pay Date" of August 1st that will still say
--  August 1st in December. Every organisation on the platform sees the same
--  three salaries.
--
--  -- Two disciplines, borrowed from work already done here ---------------
--
--  **Compensation is effective-dated, never overwritten.** A pay rise is a new
--  row with a start date, and the row it supersedes is closed rather than
--  edited. "What was she earning in March" is the question a payroll dispute
--  turns on, and a mutable `salary` column cannot answer it. This is 0039's
--  rule about employment applied to money.
--
--  **A payroll line, once approved, is never recalculated.** The workings are
--  frozen onto the item as JSONB at the moment it is computed, and a trigger
--  refuses any write to a period that has been approved or paid. Correcting an
--  approved run means a new run, exactly as correcting an incentive entry in
--  0031 means a reversal and a replacement. An amount that silently changes
--  after somebody has been paid it is how a payroll system loses the only
--  thing it has.
--
--  -- The part that decides whether this can leave one country ------------
--
--  There is no tax logic in this schema and none in the application either.
--  A `payroll_rulesets` row holds an ordered list of declarative steps -
--  fixed, percentage or banded, over a named basis - and the engine in
--  `lib/payroll.ts` evaluates them. Nigerian PAYE, a flat-rate contribution
--  and a UK-style banded system are three rulesets, not three code paths.
--
--  And the honest half, which matters more: **`is_statutory_complete` defaults
--  to false**, every screen reads it, and a run against a ruleset that has not
--  been marked complete says so on its face. The brief is explicit - do not
--  claim a payroll calculation is legally compliant for a jurisdiction unless
--  the rules actually exist - and a boolean nobody can miss is the only way
--  that survives contact with a demo.
--
--  -- Where the money stops being HR's ------------------------------------
--
--  A paid period writes exactly one row into Finance: an `expenses` record for
--  the total, with no person named on it. Finance needs the number for the
--  books and has no business seeing the payslips, and this is the only
--  connection between them.
--
--  -- Who may read any of this -------------------------------------------
--
--  Owner, administrator and HR. Not managers - `auth_visible_member_ids()`
--  gives a department head their team's records, and their team's *salaries*
--  is a different question with a different answer. The one exception is a
--  person's own: your compensation is yours to read, and your payslip becomes
--  yours the day the run is marked paid.
--
--  Idempotent and additive.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
--  1. Vocabulary
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pay_period') THEN
    CREATE TYPE pay_period AS ENUM ('annual', 'monthly', 'weekly', 'daily', 'hourly');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'comp_change_reason') THEN
    CREATE TYPE comp_change_reason AS ENUM (
      'hire', 'promotion', 'merit', 'market_adjustment',
      'role_change', 'correction', 'demotion', 'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pay_component_kind') THEN
    /**
     * `employer_cost` is neither an earning nor a deduction: it is what the
     * company pays on top of the wage - the employer half of a pension, a
     * payroll levy. It never touches net pay and it always belongs in the
     * total the business budgets for, so it cannot be either of the others.
     */
    CREATE TYPE pay_component_kind AS ENUM ('earning', 'deduction', 'employer_cost');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_status') THEN
    CREATE TYPE payroll_status AS ENUM (
      'draft', 'calculated', 'approved', 'paid', 'cancelled'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
--  2. Compensation, effective-dated
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compensation_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  effective_from  date NOT NULL DEFAULT current_date,
  /** NULL means "still in force". Closed by trigger when a successor starts. */
  effective_to    date,

  base_amount     numeric(14,2) NOT NULL CHECK (base_amount >= 0),
  currency        text NOT NULL DEFAULT 'NGN',
  pay_period      pay_period NOT NULL DEFAULT 'monthly',

  change_reason   comp_change_reason NOT NULL DEFAULT 'other',
  note            text NOT NULL DEFAULT '',

  approved_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  recorded_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comp_period_valid CHECK (effective_to IS NULL OR effective_to >= effective_from),
  /* Two rises on the same day is a correction, not two facts. */
  UNIQUE (member_id, effective_from)
);

COMMENT ON TABLE public.compensation_records IS
  'What somebody is paid, from when. Superseded rows are closed, never edited: this is the salary history.';

CREATE INDEX IF NOT EXISTS idx_compensation_member
  ON compensation_records (organization_id, member_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_compensation_current
  ON compensation_records (organization_id, member_id) WHERE effective_to IS NULL;

DROP TRIGGER IF EXISTS trg_compensation_updated ON compensation_records;
CREATE TRIGGER trg_compensation_updated BEFORE UPDATE ON compensation_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * A new record closes the one it supersedes, and writes the employment event.
 *
 * The event carries no amount - deliberately. `employment_events` is readable
 * by anyone who can see the person's records, which includes their manager,
 * and 0039 says in its header that money never goes in `details` for exactly
 * this reason. What the history records is that pay changed, on what date and
 * why; what it changed to is in this table, behind this table's rules.
 */
CREATE OR REPLACE FUNCTION public.close_previous_compensation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE compensation_records
     SET effective_to = NEW.effective_from - 1
   WHERE member_id = NEW.member_id
     AND id <> NEW.id
     AND effective_from < NEW.effective_from
     AND (effective_to IS NULL OR effective_to >= NEW.effective_from);

  INSERT INTO employment_events (
    organization_id, member_id, kind, effective_on,
    reason, note, details, recorded_by
  )
  VALUES (
    NEW.organization_id, NEW.member_id, 'compensation_change', NEW.effective_from,
    NEW.change_reason::text, NEW.note,
    jsonb_build_object('compensationId', NEW.id),
    NEW.recorded_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_previous_compensation ON compensation_records;
CREATE TRIGGER trg_close_previous_compensation
  AFTER INSERT ON compensation_records
  FOR EACH ROW EXECUTE FUNCTION public.close_previous_compensation();

/**
 * Recurring allowances and deductions attached to a person.
 *
 * Separate from the base because they change independently of it: a transport
 * allowance is granted and withdrawn without anybody's salary moving, and
 * folding it into `base_amount` loses both the reason and the ability to stop
 * it. Effective-dated for the same reason the base is.
 */
CREATE TABLE IF NOT EXISTS compensation_components (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  code            text NOT NULL CHECK (btrim(code) <> ''),
  label           text NOT NULL CHECK (btrim(label) <> ''),
  kind            pay_component_kind NOT NULL DEFAULT 'earning',

  /**
   * Fixed money, or a percentage of the base. Two shapes cover every recurring
   * allowance a company writes into a contract; anything more elaborate is a
   * ruleset step, not a per-person component.
   */
  calculation     text NOT NULL DEFAULT 'fixed'
                  CHECK (calculation IN ('fixed', 'percent_of_base')),
  amount          numeric(14,2) CHECK (amount IS NULL OR amount >= 0),
  rate            numeric(7,4)  CHECK (rate IS NULL OR (rate >= 0 AND rate <= 10)),

  /** Whether an earning enters the basis a tax step is computed over. */
  is_taxable      boolean NOT NULL DEFAULT true,

  effective_from  date NOT NULL DEFAULT current_date,
  effective_to    date,
  note            text NOT NULL DEFAULT '',

  recorded_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comp_component_period_valid
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  /* A shape that names neither a number nor a rate computes nothing. */
  CONSTRAINT comp_component_has_value CHECK (
    (calculation = 'fixed'           AND amount IS NOT NULL)
    OR (calculation = 'percent_of_base' AND rate IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_comp_components_member
  ON compensation_components (organization_id, member_id, effective_from DESC);

DROP TRIGGER IF EXISTS trg_comp_components_updated ON compensation_components;
CREATE TRIGGER trg_comp_components_updated BEFORE UPDATE ON compensation_components
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
--  3. Rulesets - the reason this is not a Nigerian payroll product
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_rulesets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            text NOT NULL CHECK (btrim(name) <> ''),
  /** ISO 3166-1 alpha-2. Documentation and grouping, never a code branch. */
  country_code    char(2) NOT NULL DEFAULT 'NG',
  currency        text NOT NULL DEFAULT 'NGN',

  /**
   * The steps, in order.
   *
   *   { "roundTo": 2,
   *     "steps": [
   *       { "code": "PENSION_EE", "label": "Pension (employee)",
   *         "kind": "deduction", "method": "percent",
   *         "basis": "base", "rate": 0.08 },
   *       { "code": "PAYE", "label": "Income tax",
   *         "kind": "deduction", "method": "bands", "basis": "taxable_gross",
   *         "annualise": true,
   *         "reliefs": [ { "kind": "percent_of_basis", "rate": 0.2 } ],
   *         "bands": [ { "upTo": 300000, "rate": 0.07 },
   *                    { "upTo": null,   "rate": 0.24 } ] }
   *     ] }
   *
   * `basis` names `base`, `gross`, `taxable_gross`, `net_so_far`, or the code
   * of an earlier step - which is what lets one contribution be computed on
   * another. Evaluated by `lib/payroll.ts`; the shape is validated there and
   * the schema deliberately does not constrain it further, because a schema
   * that encodes one country's tax structure is the thing this avoids.
   */
  rules           jsonb NOT NULL DEFAULT '{"steps": []}'::jsonb,

  /**
   * Whether somebody has actually implemented this jurisdiction's statutory
   * rules in the steps above.
   *
   * False by default and false until a human says otherwise. Every screen that
   * shows a payroll figure reads it, and says plainly when it is false. A
   * payroll product that implies compliance it does not have is worse than one
   * that computes nothing.
   */
  is_statutory_complete boolean NOT NULL DEFAULT false,
  statutory_note  text NOT NULL DEFAULT '',

  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, name)
);

COMMENT ON TABLE public.payroll_rulesets IS
  'A jurisdiction''s payroll arithmetic as ordered declarative steps. No tax rule is hard-coded anywhere in this product.';

CREATE INDEX IF NOT EXISTS idx_payroll_rulesets_org
  ON payroll_rulesets (organization_id, country_code) WHERE is_active;

DROP TRIGGER IF EXISTS trg_payroll_rulesets_updated ON payroll_rulesets;
CREATE TRIGGER trg_payroll_rulesets_updated BEFORE UPDATE ON payroll_rulesets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
--  4. Periods
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            text NOT NULL CHECK (btrim(name) <> ''),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  pay_date        date NOT NULL,

  ruleset_id      uuid REFERENCES payroll_rulesets(id) ON DELETE RESTRICT,
  currency        text NOT NULL DEFAULT 'NGN',
  /** How many of these a year, which is what annualised bands divide by. */
  periods_per_year int NOT NULL DEFAULT 12 CHECK (periods_per_year BETWEEN 1 AND 366),

  status          payroll_status NOT NULL DEFAULT 'draft',

  /* Totals, stored because a paid run's totals must not move when a person's
     compensation is later corrected. Written by the recompute trigger below. */
  total_gross     numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_net       numeric(14,2) NOT NULL DEFAULT 0,
  total_employer_cost numeric(14,2) NOT NULL DEFAULT 0,
  employee_count  int NOT NULL DEFAULT 0,

  approved_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  paid_at         timestamptz,

  /** The single row Finance sees. Nobody is named on it. */
  expense_id      uuid REFERENCES expenses(id) ON DELETE SET NULL,

  notes           text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payroll_period_valid CHECK (period_end >= period_start),
  UNIQUE (organization_id, name)
);

COMMENT ON TABLE public.payroll_periods IS
  'One pay run. Frozen once approved: an approved or paid period refuses every write except its own status advancing.';

CREATE INDEX IF NOT EXISTS idx_payroll_periods_org
  ON payroll_periods (organization_id, period_start DESC);

DROP TRIGGER IF EXISTS trg_payroll_periods_updated ON payroll_periods;
CREATE TRIGGER trg_payroll_periods_updated BEFORE UPDATE ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
--  5. Items and lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_id       uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  base_amount     numeric(14,2) NOT NULL DEFAULT 0,
  gross           numeric(14,2) NOT NULL DEFAULT 0,
  taxable_gross   numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  net             numeric(14,2) NOT NULL DEFAULT 0,
  employer_cost   numeric(14,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'NGN',

  /** Held back from this run without removing them from the company. */
  is_held         boolean NOT NULL DEFAULT false,
  hold_reason     text NOT NULL DEFAULT '',

  /**
   * Everything the calculation was given and everything it decided, frozen.
   *
   * Not a convenience: the compensation record it read can be superseded, the
   * ruleset can be edited and the allowances can be withdrawn, and a payslip
   * that recomputes to a different number a year later is a payslip nobody can
   * defend. This is the same reason `business_events` snapshots a deal's value
   * rather than joining to it.
   */
  workings        jsonb NOT NULL DEFAULT '{}'::jsonb,

  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (period_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_period
  ON payroll_items (period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_member
  ON payroll_items (organization_id, member_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_payroll_items_updated ON payroll_items;
CREATE TRIGGER trg_payroll_items_updated BEFORE UPDATE ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS payroll_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES payroll_items(id) ON DELETE CASCADE,

  code            text NOT NULL,
  label           text NOT NULL,
  kind            pay_component_kind NOT NULL,
  amount          numeric(14,2) NOT NULL DEFAULT 0,

  /** Where this line came from, so a payslip can explain itself. */
  source          text NOT NULL DEFAULT 'rule'
                  CHECK (source IN ('base', 'component', 'rule', 'manual')),
  /** How it was arrived at, in words the person receiving it can read. */
  explanation     text NOT NULL DEFAULT '',
  sequence        int NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_lines_item
  ON payroll_lines (item_id, sequence);

-- ---------------------------------------------------------------------------
--  6. Freezing an approved run
-- ---------------------------------------------------------------------------

/**
 * An approved or paid period is a record of what was decided.
 *
 * The only write it accepts is its own status moving forward - approved to
 * paid, or either to cancelled - and its `expense_id` and `paid_at` being
 * stamped. Everything else raises, including on the items and lines beneath
 * it, which is where a recalculation would actually land.
 */
CREATE OR REPLACE FUNCTION public.guard_frozen_payroll_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status NOT IN ('approved', 'paid') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('paid', 'cancelled')
     AND ROW(
           NEW.name, NEW.period_start, NEW.period_end, NEW.pay_date,
           NEW.ruleset_id, NEW.total_gross, NEW.total_deductions,
           NEW.total_net, NEW.total_employer_cost, NEW.employee_count
         ) IS NOT DISTINCT FROM ROW(
           OLD.name, OLD.period_start, OLD.period_end, OLD.pay_date,
           OLD.ruleset_id, OLD.total_gross, OLD.total_deductions,
           OLD.total_net, OLD.total_employer_cost, OLD.employee_count
         )
  THEN
    RETURN NEW;
  END IF;

  /* Stamping the audit columns on an unchanged run is allowed. */
  IF ROW(
       NEW.status, NEW.name, NEW.period_start, NEW.period_end, NEW.pay_date,
       NEW.ruleset_id, NEW.total_gross, NEW.total_deductions,
       NEW.total_net, NEW.total_employer_cost, NEW.employee_count
     ) IS NOT DISTINCT FROM ROW(
       OLD.status, OLD.name, OLD.period_start, OLD.period_end, OLD.pay_date,
       OLD.ruleset_id, OLD.total_gross, OLD.total_deductions,
       OLD.total_net, OLD.total_employer_cost, OLD.employee_count
     )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This payroll run has been approved and cannot be changed. Cancel it and create a new run.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_frozen_payroll_period ON payroll_periods;
CREATE TRIGGER trg_guard_frozen_payroll_period
  BEFORE UPDATE ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_payroll_period();

CREATE OR REPLACE FUNCTION public.guard_frozen_payroll_rows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  st payroll_status;
  pid uuid;
BEGIN
  pid := CASE TG_TABLE_NAME
    WHEN 'payroll_items' THEN COALESCE(NEW.period_id, OLD.period_id)
    ELSE (SELECT period_id FROM payroll_items
           WHERE id = COALESCE(NEW.item_id, OLD.item_id))
  END;

  SELECT status INTO st FROM payroll_periods WHERE id = pid;

  IF st IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'This payroll run has been approved; its figures are final.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_frozen_payroll_items ON payroll_items;
CREATE TRIGGER trg_guard_frozen_payroll_items
  BEFORE INSERT OR UPDATE OR DELETE ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_payroll_rows();

DROP TRIGGER IF EXISTS trg_guard_frozen_payroll_lines ON payroll_lines;
CREATE TRIGGER trg_guard_frozen_payroll_lines
  BEFORE INSERT OR UPDATE OR DELETE ON payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_payroll_rows();

/**
 * The period's totals are the sum of its items, always.
 *
 * Computed here rather than by the endpoint that writes the items, because a
 * total the client calculates is a total that disagrees with the list under it
 * the first time a request is retried.
 */
CREATE OR REPLACE FUNCTION public.retotal_payroll_period()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pid uuid := COALESCE(NEW.period_id, OLD.period_id);
BEGIN
  UPDATE payroll_periods p
     SET total_gross         = COALESCE(t.gross, 0),
         total_deductions    = COALESCE(t.deductions, 0),
         total_net           = COALESCE(t.net, 0),
         total_employer_cost = COALESCE(t.employer_cost, 0),
         employee_count      = COALESCE(t.n, 0)
    FROM (
      SELECT sum(gross) AS gross, sum(total_deductions) AS deductions,
             sum(net) AS net, sum(employer_cost) AS employer_cost,
             count(*) AS n
        FROM payroll_items WHERE period_id = pid AND is_held = false
    ) t
   WHERE p.id = pid;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_retotal_payroll_period ON payroll_items;
CREATE TRIGGER trg_retotal_payroll_period
  AFTER INSERT OR UPDATE OR DELETE ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.retotal_payroll_period();

/**
 * Approving and paying: the stamps, the notification, and Finance's one row.
 *
 * The expense carries the total and the period's name. It names nobody, has no
 * line items and is not derivable back to a payslip - which is exactly the
 * boundary the header describes.
 */
CREATE OR REPLACE FUNCTION public.settle_payroll_period()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  exp uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.approved_at := COALESCE(NEW.approved_at, now());
    NEW.approved_by := COALESCE(NEW.approved_by, public.auth_member_id(NEW.organization_id));
  END IF;

  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    IF NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'Approve the payroll run before marking it paid.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.paid_at := COALESCE(NEW.paid_at, now());

    IF NEW.expense_id IS NULL THEN
      INSERT INTO expenses (
        organization_id, title, amount, currency, category,
        expense_date, status, submitted_by, approved_by, decided_at, notes
      )
      VALUES (
        NEW.organization_id,
        'Payroll - ' || NEW.name,
        NEW.total_gross + NEW.total_employer_cost,
        NEW.currency, 'payroll',
        NEW.pay_date, 'approved',
        NEW.created_by, NEW.approved_by, now(),
        NEW.employee_count || ' employees. Individual pay is not recorded here.'
      )
      RETURNING id INTO exp;
      NEW.expense_id := exp;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_payroll_period ON payroll_periods;
CREATE TRIGGER trg_settle_payroll_period
  BEFORE UPDATE OF status ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.settle_payroll_period();

/** A paid run tells each person their payslip is available. */
CREATE OR REPLACE FUNCTION public.notify_payslips()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    SELECT NEW.organization_id, i.member_id, 'payslip_available',
           'Your payslip is ready', NEW.name,
           'payroll_item', i.id,
           '/dashboard?module=hr&tab=pay&item=' || i.id
      FROM payroll_items i
     WHERE i.period_id = NEW.id AND i.is_held = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payslips ON payroll_periods;
CREATE TRIGGER trg_notify_payslips
  AFTER UPDATE OF status ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.notify_payslips();

-- ---------------------------------------------------------------------------
--  7. Who may see money
-- ---------------------------------------------------------------------------

/**
 * The compensation gate.
 *
 * Deliberately *not* `auth_visible_member_ids()`. That function answers "whose
 * records may I see", and a manager's answer includes their department - which
 * is right for attendance, leave, goals and reviews, and wrong for salary. A
 * separate function rather than an inlined role list so the rule has one
 * definition and one place to be audited.
 */
CREATE OR REPLACE FUNCTION public.can_see_compensation(org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.auth_role_in(org) IN ('owner', 'administrator', 'hr_staff');
$$;

GRANT EXECUTE ON FUNCTION public.can_see_compensation(uuid) TO authenticated;

ALTER TABLE compensation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE compensation_records FORCE ROW LEVEL SECURITY;

/* Yours, or everybody's if you are HR. Nothing in between. */
DROP POLICY IF EXISTS compensation_records_select ON compensation_records;
CREATE POLICY compensation_records_select ON compensation_records FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.can_see_compensation(organization_id)
      OR member_id = public.auth_member_id(organization_id)
    )
  );

/**
 * Split from the read rule, and narrower: reading includes your own, writing
 * never does. A FOR ALL policy here would have re-granted every employee the
 * ability to set their own salary, which is the 0032 trap in its most
 * expensive form.
 */
DROP POLICY IF EXISTS compensation_records_write ON compensation_records;
DROP POLICY IF EXISTS compensation_records_insert ON compensation_records;
CREATE POLICY compensation_records_insert ON compensation_records FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS compensation_records_update ON compensation_records;
CREATE POLICY compensation_records_update ON compensation_records FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS compensation_records_delete ON compensation_records;
CREATE POLICY compensation_records_delete ON compensation_records FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

ALTER TABLE compensation_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE compensation_components FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compensation_components_select ON compensation_components;
CREATE POLICY compensation_components_select ON compensation_components FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.can_see_compensation(organization_id)
      OR member_id = public.auth_member_id(organization_id)
    )
  );

DROP POLICY IF EXISTS compensation_components_insert ON compensation_components;
CREATE POLICY compensation_components_insert ON compensation_components FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS compensation_components_update ON compensation_components;
CREATE POLICY compensation_components_update ON compensation_components FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS compensation_components_delete ON compensation_components;
CREATE POLICY compensation_components_delete ON compensation_components FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

ALTER TABLE payroll_rulesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_rulesets FORCE ROW LEVEL SECURITY;

/**
 * A ruleset is policy, and 0031 made the same call about incentive rules for
 * the same reason: a scheme people cannot read is a rumour. It holds rates and
 * bands, not anybody's pay.
 */
DROP POLICY IF EXISTS payroll_rulesets_select ON payroll_rulesets;
CREATE POLICY payroll_rulesets_select ON payroll_rulesets FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'hr')
  );

DROP POLICY IF EXISTS payroll_rulesets_write ON payroll_rulesets;
DROP POLICY IF EXISTS payroll_rulesets_insert ON payroll_rulesets;
CREATE POLICY payroll_rulesets_insert ON payroll_rulesets FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS payroll_rulesets_update ON payroll_rulesets;
CREATE POLICY payroll_rulesets_update ON payroll_rulesets FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS payroll_rulesets_delete ON payroll_rulesets;
CREATE POLICY payroll_rulesets_delete ON payroll_rulesets FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods FORCE ROW LEVEL SECURITY;

/**
 * A period is visible to HR throughout, and to an employee once it is paid -
 * because that is the header on their own payslip and they need to know which
 * month it is.
 */
DROP POLICY IF EXISTS payroll_periods_select ON payroll_periods;
CREATE POLICY payroll_periods_select ON payroll_periods FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.can_see_compensation(organization_id)
      OR (
        status = 'paid'
        AND EXISTS (
          SELECT 1 FROM payroll_items i
           WHERE i.period_id = payroll_periods.id
             AND i.member_id = public.auth_member_id(organization_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS payroll_periods_insert ON payroll_periods;
CREATE POLICY payroll_periods_insert ON payroll_periods FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS payroll_periods_update ON payroll_periods;
CREATE POLICY payroll_periods_update ON payroll_periods FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS payroll_periods_delete ON payroll_periods;
CREATE POLICY payroll_periods_delete ON payroll_periods FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
    AND status IN ('draft', 'calculated', 'cancelled')
  );

ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items FORCE ROW LEVEL SECURITY;

/**
 * Your payslip becomes yours when the run is paid, and not a moment before.
 *
 * A draft run is a working document in which somebody's pay may be wrong for
 * an afternoon, and the person seeing that figure cannot unsee it.
 */
DROP POLICY IF EXISTS payroll_items_select ON payroll_items;
CREATE POLICY payroll_items_select ON payroll_items FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.can_see_compensation(organization_id)
      OR (
        member_id = public.auth_member_id(organization_id)
        AND EXISTS (
          SELECT 1 FROM payroll_periods p
           WHERE p.id = payroll_items.period_id AND p.status = 'paid'
        )
      )
    )
  );

DROP POLICY IF EXISTS payroll_items_write ON payroll_items;
DROP POLICY IF EXISTS payroll_items_insert ON payroll_items;
CREATE POLICY payroll_items_insert ON payroll_items FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS payroll_items_update ON payroll_items;
CREATE POLICY payroll_items_update ON payroll_items FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

DROP POLICY IF EXISTS payroll_items_delete ON payroll_items;
CREATE POLICY payroll_items_delete ON payroll_items FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

ALTER TABLE payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_lines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_lines_select ON payroll_lines;
CREATE POLICY payroll_lines_select ON payroll_lines FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM payroll_items i
       WHERE i.id = payroll_lines.item_id
         AND (
           public.can_see_compensation(i.organization_id)
           OR (
             i.member_id = public.auth_member_id(i.organization_id)
             AND EXISTS (
               SELECT 1 FROM payroll_periods p
                WHERE p.id = i.period_id AND p.status = 'paid'
             )
           )
         )
    )
  );

DROP POLICY IF EXISTS payroll_lines_write ON payroll_lines;
CREATE POLICY payroll_lines_write ON payroll_lines FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_see_compensation(organization_id)
  );

-- ---------------------------------------------------------------------------
--  8. Realtime
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'compensation_records', 'compensation_components',
    'payroll_periods', 'payroll_items'
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
