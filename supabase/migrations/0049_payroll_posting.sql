-- ═══════════════════════════════════════════════════════════════════════════
--  0049 — What a pay run owes, in the shape Finance will need
-- ═══════════════════════════════════════════════════════════════════════════
--
--  0042 already draws the line in the right place: when a run is marked paid it
--  writes **one** expense row carrying the total, naming nobody, with no line
--  items and no way back to a payslip. That is the correct privacy boundary and
--  this migration does not move it.
--
--  What it does not do is say what the total is *made of*, and that is the part
--  Finance cannot reconstruct:
--
--    total_gross + total_employer_cost
--
--  is a single number that conflates three obligations with three different
--  counterparties and three different settlement dates:
--
--    · **net pay** — owed to the employees, on the pay date;
--    · **employee deductions** — withheld from them and owed to somebody else
--      (a revenue authority, a pension provider), usually later;
--    · **employer contributions** — the company's own cost, owed to those same
--      third parties on top of the gross.
--
--  A finance team given one figure has to take the payroll apart again to file
--  anything, and taking it apart means reading individual pay — which is the
--  disclosure the single-row boundary exists to prevent. So the split has to be
--  produced *here*, where the individual amounts are legitimately readable, and
--  handed over already aggregated.
--
--  ── What this is not ────────────────────────────────────────────────────
--
--  **It is not a ledger and it is not double-entry.** There are no accounts, no
--  debits and credits, no balances, and nothing here posts to anything. It is a
--  statement of what one run owes and to whom, frozen at approval. Finance owns
--  accounting; this owns saying what payroll produced. Building a second
--  accounting system inside HR is the specific thing this work was told not to
--  do, and a posting table that grew a `debit_account` column would be exactly
--  that.
--
--  Nothing in the Finance module is modified by this migration. The one row it
--  already receives is unchanged.
--
--  ── Why at approval rather than at payment ──────────────────────────────
--
--  Approval is when the obligation becomes real: somebody with authority has
--  said this run is what the company owes. Payment is a later, separate fact —
--  and today "paid" is an assertion a person makes in the product, not a
--  confirmation from a bank. The posting therefore records what was *approved*,
--  and a future payment integration reconciles against it rather than creating
--  it. That is the seam §12 asks to be left in the right place.
--
--  Idempotent, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. The posting
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_postings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_id       uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,

  /**
   * Three categories, and there will not be a fourth without a migration.
   *
   * `text` with a CHECK for the reason 0029 gives: a new category arrives with
   * a feature, and a CHECK is altered in a migration like any other constraint.
   */
  category        text NOT NULL CHECK (category IN (
                    'net_pay', 'employee_deductions', 'employer_contributions'
                  )),

  /**
   * Who ends up with the money.
   *
   * Kept separately from `category` because it is the question Finance
   * actually asks — "what leaves the account on the pay date, and what is
   * held" — and deriving it from the category in three different consumers is
   * how two of them eventually disagree.
   */
  owed_to         text NOT NULL CHECK (owed_to IN ('employees', 'third_parties')),

  /**
   * The cost centre, frozen.
   *
   * `department_id` can be reassigned and a department can be renamed or
   * deleted; a posting that reported last quarter's costs differently after a
   * reorganisation would be worse than one with no departments at all. The id
   * is kept for joining while it still resolves, and the name is kept because
   * it is what the figure meant at the time.
   */
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  department_name text NOT NULL DEFAULT 'Unassigned',

  amount          numeric(14,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'NGN',
  /** How many people this line covers. Never who. */
  employee_count  int NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),

  /** One line per category per department per run. */
  UNIQUE (period_id, category, department_id)
);

COMMENT ON TABLE public.payroll_postings IS
  'What one approved pay run owes, split by obligation and cost centre and aggregated so that no individual pay is derivable. Written by a trigger at approval; there is no INSERT policy for clients. Not a ledger: no accounts, no double entry, nothing posts.';

CREATE INDEX IF NOT EXISTS idx_payroll_postings_period
  ON payroll_postings (period_id, category);
CREATE INDEX IF NOT EXISTS idx_payroll_postings_org
  ON payroll_postings (organization_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  2. Producing it
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Build the posting for a run, once, at approval.
 *
 * ── Why held items are excluded ─────────────────────────────────────────
 *
 * `payroll_items.is_held` means somebody is in the run but is not being paid
 * in it — a starter whose bank details have not arrived, a query on an
 * allowance. Including them would state an obligation that is not being
 * settled, and Finance would file a liability for money that stays where it
 * is. They rejoin whichever run actually pays them.
 *
 * ── Why a single aggregate query per category ───────────────────────────
 *
 * `employee_count` comes from the same GROUP BY that produces the amount, so
 * the two cannot disagree. Counting people separately is how a report ends up
 * saying eleven employees cost the total of twelve.
 */
CREATE OR REPLACE FUNCTION public.build_payroll_posting(p_period uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p payroll_periods;
BEGIN
  SELECT * INTO p FROM payroll_periods WHERE id = p_period;
  IF NOT FOUND THEN RETURN; END IF;

  /* Rebuilt rather than appended to, so a re-approval cannot double it. */
  DELETE FROM payroll_postings WHERE period_id = p_period;

  INSERT INTO payroll_postings (
    organization_id, period_id, category, owed_to,
    department_id, department_name, amount, currency, employee_count
  )
  SELECT
    p.organization_id, p.id, x.category, x.owed_to,
    x.department_id,
    COALESCE(d.name, 'Unassigned'),
    SUM(x.amount),
    p.currency,
    COUNT(DISTINCT x.member_id)
  FROM (
    SELECT i.member_id, m.department_id, 'net_pay' AS category,
           'employees' AS owed_to, i.net AS amount
      FROM payroll_items i
      JOIN organization_members m ON m.id = i.member_id
     WHERE i.period_id = p.id AND i.is_held = false

    UNION ALL

    SELECT i.member_id, m.department_id, 'employee_deductions',
           'third_parties', i.total_deductions
      FROM payroll_items i
      JOIN organization_members m ON m.id = i.member_id
     WHERE i.period_id = p.id AND i.is_held = false

    UNION ALL

    /**
     * The employer's own cost, over and above the gross.
     *
     * `employer_cost` is stored on the item as the additional amount, so it is
     * used as it stands. If it ever comes to mean "gross plus employer cost",
     * this line has to change with it — which is why the payroll engine's own
     * definition is the one place that decides, and this reads it rather than
     * recomputing it from the lines.
     */
    SELECT i.member_id, m.department_id, 'employer_contributions',
           'third_parties', i.employer_cost
      FROM payroll_items i
      JOIN organization_members m ON m.id = i.member_id
     WHERE i.period_id = p.id AND i.is_held = false
  ) x
  LEFT JOIN departments d ON d.id = x.department_id
  GROUP BY x.category, x.owed_to, x.department_id, d.name
  HAVING SUM(x.amount) <> 0;
END;
$$;

/**
 * Approval produces the posting.
 *
 * AFTER, so the period's own totals have already been settled by
 * `retotal_payroll_period()` and the posting is built from a run that agrees
 * with itself.
 */
CREATE OR REPLACE FUNCTION public.post_approved_payroll()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('approved', 'paid') AND OLD.status NOT IN ('approved', 'paid') THEN
    PERFORM public.build_payroll_posting(NEW.id);
  END IF;

  /**
   * A cancelled run owes nothing.
   *
   * Removed rather than kept with a zero, because a cancelled run is not a run
   * that cost nothing — it is a run that did not happen, and a nil posting in
   * a monthly report reads as the former.
   */
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    DELETE FROM payroll_postings WHERE period_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_approved_payroll ON payroll_periods;
CREATE TRIGGER trg_post_approved_payroll
  AFTER UPDATE OF status ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.post_approved_payroll();

-- ───────────────────────────────────────────────────────────────────────────
--  3. A defect in the row Finance already receives
-- ───────────────────────────────────────────────────────────────────────────
--
--  `expenses` has carried this since 0003:
--
--      CONSTRAINT expense_decision_attributed
--        CHECK (status IN ('pending','cancelled') OR approved_by IS NOT NULL)
--
--  — Finance's own rule that an approved expense must say who approved it. It
--  is a good rule and this migration does not touch it.
--
--  `settle_payroll_period()` (0042) breaks it. It inserts the payroll expense
--  with `status = 'approved'` and `approved_by = NEW.approved_by`, and that
--  column is `ON DELETE SET NULL` against `organization_members`. So a pay run
--  approved by somebody who has since left the company cannot be marked paid:
--  the insert fails, and it fails with `violates check constraint
--  "expense_decision_attributed"` — a message naming a Finance constraint, on a
--  screen about payroll, to somebody who did nothing wrong.
--
--  Found by building a pay run in a harness, where `auth_member_id()` is null
--  and `approved_by` therefore stayed null. That is an artificial route to it;
--  the departure route is not.
--
--  The function is replaced rather than patched around, in the same shape 0046
--  used to replace 0004's trigger. Two changes:
--
--   · fall back to whoever created the run, then to whoever is doing the
--     marking — an attribution that is true and available is better than a
--     failure;
--   · if there is genuinely nobody left to name, refuse in a sentence rather
--     than as a constraint violation.
--
--  Everything else about it is unchanged, including the boundary it draws: one
--  expense, carrying the total, naming nobody it was paid to.

CREATE OR REPLACE FUNCTION public.settle_payroll_period()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  exp      uuid;
  attrib   uuid;
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
      attrib := COALESCE(
        NEW.approved_by,
        NEW.created_by,
        public.auth_member_id(NEW.organization_id)
      );

      IF attrib IS NULL THEN
        RAISE EXCEPTION 'This run has nobody left on it to attribute the expense to. Reassign the approver before marking it paid.'
          USING ERRCODE = 'check_violation';
      END IF;

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
        COALESCE(NEW.created_by, attrib), attrib, now(),
        NEW.employee_count || ' employees. Individual pay is not recorded here.'
      )
      RETURNING id INTO exp;
      NEW.expense_id := exp;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  4. Who may read the posting
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_postings FORCE  ROW LEVEL SECURITY;

/**
 * HR, and Finance.
 *
 * `finance_staff` appears here and nowhere else in the payroll schema, and
 * that is the whole point of the table: it is the one payroll artefact Finance
 * is *supposed* to read, precisely because it carries no individual pay. A
 * department line covering three people and a total does not disclose what any
 * of the three earns.
 *
 * A manager is deliberately not admitted. Their department's total salary cost
 * with a headcount beside it is close enough to individual pay in a team of
 * three to be the same disclosure, and `can_see_compensation()` already draws
 * that line for every other payroll table.
 *
 * There is no INSERT, UPDATE or DELETE policy: the trigger is the only writer,
 * so a posting cannot be adjusted to make a month look different from the run
 * it came from.
 */
DROP POLICY IF EXISTS payroll_postings_select ON payroll_postings;
CREATE POLICY payroll_postings_select ON payroll_postings FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN
        ('owner', 'administrator', 'hr_staff', 'finance_staff')
  );

-- ───────────────────────────────────────────────────────────────────────────
--  5. Backfill
-- ───────────────────────────────────────────────────────────────────────────
--
--  Runs that were already approved or paid when this shipped. Same reasoning as
--  every other backfill in this chain: a boundary that only works for runs made
--  after today is one nobody can rely on for the current quarter.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM payroll_periods WHERE status IN ('approved', 'paid')
  LOOP
    PERFORM public.build_payroll_posting(r.id);
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  6. Realtime
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_postings REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename = 'payroll_postings'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payroll_postings;
  END IF;
END $$;
