-- ═══════════════════════════════════════════════════════════════════════════
--  0004 — Business logic: audit, numbering, attendance clock, stock ledger
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Rules that must hold no matter which client performs the write live here,
--  in the database. Anything enforced only in a route handler is enforced only
--  for callers who happen to use that route handler — and this platform now
--  has three write paths (Next.js routes, supabase-js from the browser, and
--  the SQL editor).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  Audit and activity
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id              bigserial PRIMARY KEY,
  -- Deliberately nullable, unlike every other table: some audited events
  -- (sign-in, sign-out, account changes) happen before or outside any
  -- organization context, and forcing a value would mean inventing one.
  --
  -- Safe because the read policy is `is_org_admin(organization_id)`, and
  -- is_org_admin(NULL) evaluates to NULL — which RLS treats as false. Rows
  -- with no organization are therefore visible to nobody rather than to
  -- everybody; the failure mode is closed. Read them with the service role.
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action          audit_action NOT NULL,
  table_name      text NOT NULL,
  record_id       uuid,
  -- Only the columns that changed, so the log stays readable and small.
  changed_fields  text[],
  old_values      jsonb,
  new_values      jsonb,
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_time  ON audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record    ON audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_log (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_log (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  module          text NOT NULL,
  action          text NOT NULL,
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  entity_type     text,
  entity_id       uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_org_time ON activity_log (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  type            text NOT NULL DEFAULT 'general',
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  -- Where clicking the notification should go.
  entity_type     text,
  entity_id       uuid,
  link            text,
  is_read         boolean NOT NULL DEFAULT false,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The unread badge query, which runs on every page load.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (recipient_id, created_at DESC) WHERE is_read = false;

/**
 * Generic audit trigger.
 *
 * Attached to every table that matters. Records only changed columns on
 * update: storing whole rows makes the log enormous and buries the one field
 * somebody actually altered.
 */
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  org      uuid;
  changed  text[];
  old_j    jsonb;
  new_j    jsonb;
BEGIN
  old_j := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_j := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;

  -- Tenant of the row being changed. Wrapped because not every audited table
  -- has the column, and a failing audit must never block a legitimate write.
  BEGIN
    org := COALESCE((new_j ->> 'organization_id')::uuid, (old_j ->> 'organization_id')::uuid);
  EXCEPTION WHEN others THEN
    org := NULL;
  END;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key) INTO changed
    FROM jsonb_each(new_j)
    WHERE new_j -> key IS DISTINCT FROM old_j -> key
      -- updated_at changes on every write and is noise in a diff.
      AND key <> 'updated_at';

    -- Nothing of substance changed; do not record it.
    IF changed IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO audit_log (
    organization_id, actor_id, action, table_name, record_id,
    changed_fields, old_values, new_values
  )
  VALUES (
    org,
    auth.uid(),
    lower(TG_OP)::audit_action,
    TG_TABLE_NAME,
    COALESCE((new_j ->> 'id')::uuid, (old_j ->> 'id')::uuid),
    changed,
    CASE WHEN TG_OP = 'UPDATE'
         THEN (SELECT jsonb_object_agg(k, old_j -> k) FROM unnest(changed) AS k)
         ELSE old_j END,
    CASE WHEN TG_OP = 'UPDATE'
         THEN (SELECT jsonb_object_agg(k, new_j -> k) FROM unnest(changed) AS k)
         ELSE new_j END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','organization_members','departments','teams','invitations',
    'attendance_records','leave_requests',
    'leads','contacts','companies','deals',
    'projects','tasks',
    'support_tickets','invoices','expenses','payments',
    'products','stock_movements','purchase_orders'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()', t);
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  Document numbering
-- ───────────────────────────────────────────────────────────────────────────
--
--  Per-organization sequences. A global sequence would leak volume between
--  tenants — a customer can infer how many invoices every other customer has
--  issued from the gaps in their own numbering.

CREATE TABLE IF NOT EXISTS document_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type        text NOT NULL,
  last_number     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, doc_type)
);

/**
 * Next number for a document type, e.g. next_document_number(org,'INV') →
 * 'INV-000042'.
 *
 * The UPDATE takes a row lock, so two concurrent invoices cannot receive the
 * same number. `MAX(...)+1` in application code cannot make that guarantee.
 */
CREATE OR REPLACE FUNCTION public.next_document_number(org uuid, doc_type text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n bigint;
BEGIN
  INSERT INTO document_counters (organization_id, doc_type, last_number)
  VALUES (org, doc_type, 1)
  ON CONFLICT (organization_id, doc_type)
  DO UPDATE SET last_number = document_counters.last_number + 1
  RETURNING last_number INTO n;

  RETURN doc_type || '-' || lpad(n::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_ticket_number()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR btrim(NEW.ticket_number) = '' THEN
    NEW.ticket_number := public.next_document_number(NEW.organization_id, 'TKT');
  END IF;

  -- SLA target from priority. Set here so every write path agrees on what the
  -- promise was, rather than each client inventing its own.
  IF NEW.due_at IS NULL THEN
    NEW.due_at := now() + CASE NEW.priority
      WHEN 'critical' THEN interval '4 hours'
      WHEN 'high'     THEN interval '8 hours'
      WHEN 'medium'   THEN interval '2 days'
      ELSE                 interval '5 days'
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_number ON support_tickets;
CREATE TRIGGER trg_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.assign_ticket_number();

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR btrim(NEW.invoice_number) = '' THEN
    NEW.invoice_number := public.next_document_number(NEW.organization_id, 'INV');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_number ON invoices;
CREATE TRIGGER trg_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();

CREATE OR REPLACE FUNCTION public.assign_po_number()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := public.next_document_number(NEW.organization_id, 'PO');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_number ON purchase_orders;
CREATE TRIGGER trg_po_number
  BEFORE INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_po_number();

-- ═══════════════════════════════════════════════════════════════════════════
--  ATTENDANCE — server-authoritative clock
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Every timestamp is `now()`, evaluated by Postgres. The client never
--  supplies a time, and the trigger below overwrites one if it tries: a device
--  clock is under the user's control, so accepting it makes attendance
--  self-reported.

/**
 * Overwrite client-supplied attendance times with server time.
 *
 * Belt and braces alongside the RPCs: even a direct PostgREST insert cannot
 * backdate attendance. Adjustments by HR are exempt — correcting a forgotten
 * check-out is a legitimate supervised action, and it is attributed.
 */
CREATE OR REPLACE FUNCTION public.enforce_server_attendance_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.adjusted_by IS NOT NULL THEN
    RETURN NEW;   -- supervised correction, times are intentional
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.checked_in_at IS NOT NULL THEN NEW.checked_in_at := now(); END IF;
    IF NEW.checked_out_at IS NOT NULL THEN NEW.checked_out_at := now(); END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Once written, a check-in time is immutable outside an adjustment.
    IF NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at AND OLD.checked_in_at IS NOT NULL THEN
      NEW.checked_in_at := OLD.checked_in_at;
    END IF;
    IF NEW.checked_out_at IS DISTINCT FROM OLD.checked_out_at AND OLD.checked_out_at IS NULL THEN
      NEW.checked_out_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_server_time ON attendance_records;
CREATE TRIGGER trg_attendance_server_time
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_server_attendance_time();

/**
 * Clock in.
 *
 * Refuses when the caller is on approved leave — clocking in on an authorised
 * absence is almost always a mistake, and allowing it silently corrupts both
 * the leave record and the attendance report.
 *
 * Classification is against the organization's own working hours, so "late" is
 * a company policy rather than a global constant.
 */
CREATE OR REPLACE FUNCTION public.clock_in(org uuid, remote boolean DEFAULT false)
RETURNS attendance_records
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me        uuid;
  rec       attendance_records;
  o         organizations;
  today     date;
  now_ts    timestamptz := now();
  local_now timestamp;
  late_by   int;
  early_by  int;
  st        attendance_status;
BEGIN
  me := public.auth_member_id(org);
  IF me IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this organization.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO o FROM organizations WHERE id = org;
  local_now := now_ts AT TIME ZONE o.timezone;
  today     := local_now::date;

  IF EXISTS (
    SELECT 1 FROM attendance_records
    WHERE member_id = me AND work_date = today AND checked_in_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'You have already checked in today.' USING ERRCODE = 'unique_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM leave_requests
    WHERE member_id = me AND status = 'approved'
      AND today BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'You are on approved leave today.' USING ERRCODE = 'check_violation';
  END IF;

  late_by  := GREATEST(0, EXTRACT(EPOCH FROM (local_now::time - o.work_start))::int / 60 - o.grace_minutes);
  early_by := GREATEST(0, EXTRACT(EPOCH FROM (o.work_start - local_now::time))::int / 60);

  st := CASE
    WHEN remote        THEN 'remote'::attendance_status
    WHEN late_by  > 0  THEN 'late'::attendance_status
    WHEN early_by > 0  THEN 'early'::attendance_status
    ELSE                    'present'::attendance_status
  END;

  INSERT INTO attendance_records (
    organization_id, member_id, work_date, checked_in_at,
    status, late_minutes, early_minutes, is_remote
  )
  VALUES (org, me, today, now_ts, st, late_by, early_by, remote)
  ON CONFLICT (member_id, work_date) DO UPDATE
    SET checked_in_at = now_ts,
        status        = st,
        late_minutes  = late_by,
        early_minutes = early_by,
        is_remote     = remote
  RETURNING * INTO rec;

  RETURN rec;
END;
$$;

/**
 * Clock out. Worked minutes are computed from the stored check-in and server
 * time, less the organization's unpaid break on a shift long enough to have
 * taken one.
 */
CREATE OR REPLACE FUNCTION public.clock_out(org uuid)
RETURNS attendance_records
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me      uuid;
  rec     attendance_records;
  o       organizations;
  today   date;
  now_ts  timestamptz := now();
  gross   int;
  net     int;
BEGIN
  me := public.auth_member_id(org);
  IF me IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this organization.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO o FROM organizations WHERE id = org;
  today := (now_ts AT TIME ZONE o.timezone)::date;

  SELECT * INTO rec FROM attendance_records WHERE member_id = me AND work_date = today;

  IF rec.id IS NULL OR rec.checked_in_at IS NULL THEN
    RAISE EXCEPTION 'You have not checked in today.' USING ERRCODE = 'check_violation';
  END IF;
  IF rec.checked_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'You have already checked out today.' USING ERRCODE = 'check_violation';
  END IF;

  gross := GREATEST(0, EXTRACT(EPOCH FROM (now_ts - rec.checked_in_at))::int / 60);
  net   := CASE WHEN gross > o.break_minutes * 2 THEN gross - o.break_minutes ELSE gross END;

  UPDATE attendance_records
  SET checked_out_at = now_ts,
      worked_minutes = net,
      break_minutes  = CASE WHEN gross > o.break_minutes * 2 THEN o.break_minutes ELSE 0 END,
      status = CASE
        WHEN net < 240 AND status NOT IN ('remote') THEN 'half_day'::attendance_status
        ELSE status
      END
  WHERE id = rec.id
  RETURNING * INTO rec;

  RETURN rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_in(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clock_out(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_document_number(uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  Leave — keep attendance and balances consistent
-- ───────────────────────────────────────────────────────────────────────────

/**
 * When leave is approved, write the covered working days into attendance as
 * `on_leave` and consume the balance.
 *
 * Without this the attendance report shows an approved absence as `absent`,
 * and the two modules tell different stories about the same person.
 */
CREATE OR REPLACE FUNCTION public.apply_approved_leave()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o    organizations;
  d    date;
  days numeric := 0;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO o FROM organizations WHERE id = NEW.organization_id;

  d := NEW.start_date;
  WHILE d <= NEW.end_date LOOP
    -- Only working days consume leave or appear on the register.
    IF EXTRACT(DOW FROM d)::int = ANY (o.work_days) THEN
      INSERT INTO attendance_records (organization_id, member_id, work_date, status, worked_minutes)
      VALUES (NEW.organization_id, NEW.member_id, d, 'on_leave', 0)
      ON CONFLICT (member_id, work_date) DO UPDATE
        SET status = 'on_leave', worked_minutes = 0;
      days := days + CASE WHEN NEW.is_half_day THEN 0.5 ELSE 1 END;
    END IF;
    d := d + 1;
  END LOOP;

  UPDATE leave_requests SET days_requested = days WHERE id = NEW.id;

  INSERT INTO leave_balances (organization_id, member_id, type, year, used_days)
  VALUES (NEW.organization_id, NEW.member_id, NEW.type, EXTRACT(YEAR FROM NEW.start_date)::int, days)
  ON CONFLICT (member_id, type, year)
  DO UPDATE SET used_days = leave_balances.used_days + days, updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_approved_leave ON leave_requests;
CREATE TRIGGER trg_apply_approved_leave
  AFTER UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.apply_approved_leave();

/**
 * Nobody approves their own leave.
 *
 * A separation-of-duties rule that holds even for managers and owners. In the
 * database because it must hold regardless of which client is writing.
 */
CREATE OR REPLACE FUNCTION public.prevent_self_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.member_id THEN
      RAISE EXCEPTION 'You cannot approve your own request. It must be decided by someone else.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_no_self_approval ON leave_requests;
CREATE TRIGGER trg_leave_no_self_approval
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_approval();

CREATE OR REPLACE FUNCTION public.prevent_expense_self_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.submitted_by THEN
      RAISE EXCEPTION 'You cannot approve your own expense claim.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_no_self_approval ON expenses;
CREATE TRIGGER trg_expense_no_self_approval
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_self_approval();

-- ───────────────────────────────────────────────────────────────────────────
--  Inventory — stock ledger
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Record a stock movement and apply it to on-hand quantity.
 *
 * One function so the ledger row and the balance are written together. The
 * product row is locked FOR UPDATE, so two concurrent movements cannot both
 * validate against the same stale balance and drive stock negative.
 */
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  org uuid,
  product uuid,
  qty int,
  movement_type stock_movement_type DEFAULT 'adjustment',
  reason text DEFAULT '',
  reference text DEFAULT ''
)
RETURNS stock_movements
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur      int;
  new_bal  int;
  p_name   text;
  mv       stock_movements;
BEGIN
  IF NOT public.is_org_member(org) THEN
    RAISE EXCEPTION 'You are not a member of this organization.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF qty = 0 THEN
    RAISE EXCEPTION 'Quantity cannot be zero.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT stock, name INTO cur, p_name
  FROM products WHERE id = product AND organization_id = org
  FOR UPDATE;

  IF cur IS NULL THEN
    RAISE EXCEPTION 'Product not found in this organization.' USING ERRCODE = 'no_data_found';
  END IF;

  new_bal := cur + qty;
  IF new_bal < 0 THEN
    RAISE EXCEPTION 'Cannot remove % unit(s) from "%": only % on hand.', abs(qty), p_name, cur
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE products SET stock = new_bal WHERE id = product;

  INSERT INTO stock_movements (
    organization_id, product_id, type, quantity, balance_after,
    reason, reference, member_id
  )
  VALUES (org, product, movement_type, qty, new_bal, reason, reference, public.auth_member_id(org))
  RETURNING * INTO mv;

  RETURN mv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_movement(uuid, uuid, int, stock_movement_type, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  Finance — keep invoice totals honest
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Recompute an invoice from its line items and payments.
 *
 * Totals are never taken from the client: they determine what the business
 * believes it is owed. Derived from the rows that justify them instead.
 */
CREATE OR REPLACE FUNCTION public.recalculate_invoice(inv_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  sub  numeric(14,2);
  paid numeric(14,2);
  inv  invoices;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = inv_id;
  IF inv.id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(sum(line_total), 0) INTO sub
  FROM invoice_line_items WHERE invoice_id = inv_id;

  SELECT COALESCE(sum(amount), 0) INTO paid
  FROM payments WHERE invoice_id = inv_id;

  UPDATE invoices
  SET subtotal    = sub,
      tax_amount  = round(sub * tax_rate / 100, 2),
      total       = round(sub + (sub * tax_rate / 100) - discount, 2),
      amount_paid = paid,
      status = CASE
        WHEN status IN ('draft','cancelled')                     THEN status
        WHEN paid >= round(sub + (sub * tax_rate/100) - discount, 2) - 0.01
                                                                 THEN 'paid'::invoice_status
        WHEN paid > 0                                            THEN 'partially_paid'::invoice_status
        WHEN due_date < current_date                             THEN 'overdue'::invoice_status
        ELSE status
      END,
      paid_at = CASE
        WHEN paid >= round(sub + (sub * tax_rate/100) - discount, 2) - 0.01 AND paid_at IS NULL
        THEN now() ELSE paid_at END
  WHERE id = inv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recalculate_invoice()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.recalculate_invoice(
    COALESCE(NEW.invoice_id, OLD.invoice_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_line_items_recalc ON invoice_line_items;
CREATE TRIGGER trg_line_items_recalc
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalculate_invoice();

DROP TRIGGER IF EXISTS trg_payments_recalc ON payments;
CREATE TRIGGER trg_payments_recalc
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalculate_invoice();

-- ───────────────────────────────────────────────────────────────────────────
--  Notifications from workflow events
-- ───────────────────────────────────────────────────────────────────────────
--
--  Raised by the database so a notification cannot be missed just because a
--  write came in through a different client.

CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
    -- Assigning something to yourself does not warrant telling you about it.
    IF NEW.assignee_id <> COALESCE(public.auth_member_id(NEW.organization_id), '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications (organization_id, recipient_id, type, title, body, entity_type, entity_id)
      VALUES (NEW.organization_id, NEW.assignee_id, 'task_assigned',
              'New task assigned', NEW.title, 'task', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_assignment ON tasks;
CREATE TRIGGER trg_notify_task_assignment
  AFTER INSERT OR UPDATE OF assignee_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignment();

CREATE OR REPLACE FUNCTION public.notify_leave_decision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved','rejected') THEN
    INSERT INTO notifications (organization_id, recipient_id, type, title, body, entity_type, entity_id)
    VALUES (NEW.organization_id, NEW.member_id, 'leave_' || NEW.status,
            'Leave request ' || NEW.status,
            NEW.type::text || ' · ' || NEW.start_date::text || ' to ' || NEW.end_date::text,
            'leave_request', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_leave_decision ON leave_requests;
CREATE TRIGGER trg_notify_leave_decision
  AFTER UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_leave_decision();

/** Mentions in a message notify the people named. */
CREATE OR REPLACE FUNCTION public.notify_message_mentions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE m uuid;
BEGIN
  FOREACH m IN ARRAY NEW.mentions LOOP
    IF m <> NEW.sender_id THEN
      INSERT INTO notifications (organization_id, recipient_id, type, title, body, entity_type, entity_id)
      VALUES (NEW.organization_id, m, 'mention', 'You were mentioned',
              left(NEW.body, 140), 'message', NEW.id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mentions ON messages;
CREATE TRIGGER trg_notify_mentions
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_message_mentions();
