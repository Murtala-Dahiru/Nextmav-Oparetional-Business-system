-- ═══════════════════════════════════════════════════════════════════════════
--  0046 — Attendance integrity: the clock people can trust
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Employees reported three things: check-in sometimes does not work, it
--  sometimes records the wrong time, and the time shown is not the time the
--  server holds. None of the three was a button problem. This migration fixes
--  what was actually underneath them, and closes a hole found while looking.
--
--  ── 1. An employee could rewrite their own attendance ────────────────────
--
--  `attendance_update` in 0005 permits `member_id = auth_member_id(org)`, and
--  the 0004 trigger exempted any row where `adjusted_by IS NOT NULL` — a
--  column the same UPDATE may set. So one PostgREST PATCH, with `adjusted_by`
--  pointed at yourself, rewrote `checked_in_at`, `checked_out_at`,
--  `worked_minutes` and `status` to anything at all. This was verified against
--  the live database before being fixed, not inferred from reading.
--
--  The exemption is now the *authority* — `can_approve(org,'hr')` — rather
--  than a claim the writer makes about itself. Somebody who is not an approver
--  may change the note on their own row and nothing else: every other column
--  is put back to what it was, silently, so a forged write succeeds and
--  changes nothing rather than failing in a way that teaches whoever is
--  probing which field to try next.
--
--  ── 2. Two clicks produced one row holding the later time ────────────────
--
--  `clock_in()` tested for an existing check-in with a separate `EXISTS` and
--  then ran `INSERT … ON CONFLICT DO UPDATE SET checked_in_at = now_ts`. Two
--  requests — a double tap, a retry on a slow network, two devices — both
--  passed the test, and the second overwrote the first. No error was raised,
--  so the person saw a successful check-in stamped minutes after they actually
--  arrived. That is the "records incorrect times" report.
--
--  The test is now the conflict clause itself: `DO UPDATE … WHERE
--  attendance_records.checked_in_at IS NULL`. One statement, so there is no
--  window between deciding and writing. The loser updates nothing, returns no
--  row, and is told it has already checked in.
--
--  ── 3. A correction destroyed what it corrected ──────────────────────────
--
--  `adjusted_by` / `adjusted_at` / `adjustment_reason` recorded *that* a record
--  had been changed and by whom, but the previous times were overwritten in
--  place. `attendance_adjustments` keeps them: what it was, what it became,
--  who changed it, when, and why. Append-only — no INSERT, UPDATE or DELETE
--  policy exists for it at all — and written by a trigger, so every path that
--  can correct a record is covered, including a direct PostgREST write.
--
--  ── 4. Approving leave erased attendance that had already happened ───────
--
--  `apply_approved_leave()` upserted `on_leave, worked_minutes = 0` over
--  whatever was there. Approving a backdated request therefore deleted a day
--  the person had genuinely worked. It now leaves a clocked day alone.
--
--  ── The sanctioned-path flag ─────────────────────────────────────────────
--
--  `clock_in()`, `clock_out()` and the leave sync all write attendance on
--  somebody's behalf without being approvers of it. Rather than teaching the
--  trigger to recognise them by shape — which means encoding the same rule
--  twice and getting it wrong when a fourth path appears — they announce
--  themselves with a transaction-local `app.attendance_system` setting.
--
--  A client cannot set it: PostgREST executes no `set_config`, and it is made
--  with `is_local => true`, so it dies with the transaction that set it.
--
--  Each of the three clears it again the moment its own write is done, and
--  that is not tidiness. `is_local => true` means "until this transaction
--  ends", not "until this function returns" — so a transaction that called
--  `clock_in()` and then wrote attendance some other way would have carried
--  the exemption into the second write. PostgREST gives each request its own
--  transaction, so no HTTP path can reach that today; the integrity harness,
--  which runs everything inside one, walked straight into it and every check
--  after the first clock-in passed for the wrong reason. A flag that has to be
--  reasoned about to be safe is one that will eventually be reasoned about
--  wrongly.
--
--  Idempotent, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. The correction history
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  /**
   * SET NULL rather than CASCADE.
   *
   * Deleting an attendance record is an administrator-only act and a rare one,
   * but if it happens, the history of what was done to it is exactly what an
   * audit wants to keep. `member_id` and `work_date` are stored here too, so
   * the row still says who and when after its parent is gone.
   */
  attendance_id   uuid REFERENCES attendance_records(id) ON DELETE SET NULL,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  work_date       date NOT NULL,

  /** What it was. NULL throughout where there was nothing — an inserted record. */
  previous_status         attendance_status,
  previous_checked_in_at  timestamptz,
  previous_checked_out_at timestamptz,
  previous_worked_minutes int,

  /** What it became. */
  new_status         attendance_status NOT NULL,
  new_checked_in_at  timestamptz,
  new_checked_out_at timestamptz,
  new_worked_minutes int NOT NULL DEFAULT 0,

  /**
   * Why, and who.
   *
   * The reason is NOT NULL with a non-blank CHECK because a correction without
   * one is indistinguishable from tampering after the fact. The trigger below
   * refuses the write without it, so the column cannot fill up with empty
   * strings that satisfy the schema and answer nothing.
   */
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  adjusted_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.attendance_adjustments IS
  'Append-only history of every hand-written change to an attendance record: what it was, what it became, who did it and why. Written only by record_attendance_adjustment(); there is no INSERT policy for clients.';

CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_record
  ON attendance_adjustments (attendance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_member
  ON attendance_adjustments (organization_id, member_id, work_date DESC);

ALTER TABLE attendance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_adjustments FORCE ROW LEVEL SECURITY;

/**
 * Whoever may see the attendance record may see what was done to it.
 *
 * Reusing `auth_visible_member_ids` rather than inventing a rule: a correction
 * is data about the same person as the record it corrects, and a second answer
 * to "whose people-data may I read" would eventually contradict the first.
 *
 * It matters that the *employee* is inside that set. Being able to see that
 * your Tuesday was changed, by whom, and why is the entire point of keeping
 * this; a history only management can read is a management convenience rather
 * than an assurance to the person whose day it was.
 */
DROP POLICY IF EXISTS attendance_adjustments_select ON attendance_adjustments;
CREATE POLICY attendance_adjustments_select ON attendance_adjustments FOR SELECT TO authenticated
  USING (member_id = ANY (public.auth_visible_member_ids(organization_id)));

/**
 * No INSERT, UPDATE or DELETE policy, deliberately.
 *
 * The default is deny, so this table is unwritable by any client through
 * PostgREST. Its only writer is the SECURITY DEFINER trigger below, which runs
 * inside the same transaction as the change it records — so a correction and
 * its history cannot come apart.
 */

-- ───────────────────────────────────────────────────────────────────────────
--  2. Server-authoritative attendance times
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Was this write made by one of the sanctioned server-side paths?
 *
 * `current_setting(..., true)` returns NULL rather than raising when the
 * setting was never made, which is the ordinary case for a client write.
 */
CREATE OR REPLACE FUNCTION public.attendance_via_system()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(current_setting('app.attendance_system', true), '') = 'on';
$$;

/**
 * Recompute the derived minutes from the times on the row.
 *
 * A correction supplies times; everything counted from them — worked, break,
 * late, early — is arithmetic over the organisation's own working hours and
 * must not be accepted from a caller. The route used to compute
 * `worked_minutes` itself and got it wrong in a small way that mattered:
 * correcting only a check-in set it to zero, wiping the hours already recorded
 * for that day.
 */
CREATE OR REPLACE FUNCTION public.attendance_derive(rec attendance_records)
RETURNS attendance_records
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  o     organizations;
  local timestamp;
  gross int;
BEGIN
  SELECT * INTO o FROM organizations WHERE id = rec.organization_id;
  IF NOT FOUND THEN RETURN rec; END IF;

  IF rec.checked_in_at IS NOT NULL THEN
    local := rec.checked_in_at AT TIME ZONE o.timezone;
    rec.late_minutes  := GREATEST(0, EXTRACT(EPOCH FROM (local::time - o.work_start))::int / 60 - o.grace_minutes);
    rec.early_minutes := GREATEST(0, EXTRACT(EPOCH FROM (o.work_start - local::time))::int / 60);
  ELSE
    rec.late_minutes  := 0;
    rec.early_minutes := 0;
  END IF;

  IF rec.checked_in_at IS NOT NULL AND rec.checked_out_at IS NOT NULL THEN
    gross := GREATEST(0, EXTRACT(EPOCH FROM (rec.checked_out_at - rec.checked_in_at))::int / 60);
    IF gross > o.break_minutes * 2 THEN
      rec.worked_minutes := gross - o.break_minutes;
      rec.break_minutes  := o.break_minutes;
    ELSE
      rec.worked_minutes := gross;
      rec.break_minutes  := 0;
    END IF;
  ELSE
    /**
     * An open day keeps whatever it had.
     *
     * Zeroing here is what wiped a day's hours when only the check-in was
     * corrected: the record is mid-shift, not empty, and the figure it already
     * holds is the last one that was true.
     */
    rec.worked_minutes := COALESCE(rec.worked_minutes, 0);
  END IF;

  RETURN rec;
END;
$$;

/**
 * The gate on every hand-written attendance row.
 *
 * Replaces the 0004 version, whose exemption was `adjusted_by IS NOT NULL` — a
 * claim the writer could make about itself.
 */
CREATE OR REPLACE FUNCTION public.enforce_server_attendance_time()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  approver boolean;
  me       uuid;
BEGIN
  /* clock_in(), clock_out(), leave sync: already server-stamped. */
  IF public.attendance_via_system() THEN
    RETURN NEW;
  END IF;

  approver := public.can_approve(NEW.organization_id, 'hr');
  me       := public.auth_member_id(NEW.organization_id);

  -- ── Not an approver ────────────────────────────────────────────────────
  --
  -- The only column such a writer may change on their own record is the note.
  -- Everything else is restored rather than refused: a refusal names the
  -- column that was rejected, which is a map for whoever is probing, and no
  -- legitimate client reaches this branch at all.
  IF NOT approver THEN
    IF TG_OP = 'INSERT' THEN
      NEW.checked_in_at     := CASE WHEN NEW.checked_in_at  IS NOT NULL THEN now() END;
      NEW.checked_out_at    := CASE WHEN NEW.checked_out_at IS NOT NULL THEN now() END;
      NEW.worked_minutes    := 0;
      NEW.break_minutes     := 0;
      NEW.adjusted_by       := NULL;
      NEW.adjusted_at       := NULL;
      NEW.adjustment_reason := NULL;
      NEW                   := public.attendance_derive(NEW);
    ELSE
      NEW.member_id         := OLD.member_id;
      NEW.work_date         := OLD.work_date;
      NEW.checked_in_at     := OLD.checked_in_at;
      NEW.checked_out_at    := OLD.checked_out_at;
      NEW.status            := OLD.status;
      NEW.worked_minutes    := OLD.worked_minutes;
      NEW.break_minutes     := OLD.break_minutes;
      NEW.late_minutes      := OLD.late_minutes;
      NEW.early_minutes     := OLD.early_minutes;
      NEW.is_remote         := OLD.is_remote;
      NEW.adjusted_by       := OLD.adjusted_by;
      NEW.adjusted_at       := OLD.adjusted_at;
      NEW.adjustment_reason := OLD.adjustment_reason;
    END IF;
    RETURN NEW;
  END IF;

  -- ── An approver, writing by hand ───────────────────────────────────────
  --
  -- This is a correction, and one with no stated reason is indistinguishable
  -- from tampering. Refused loudly here, because the person doing it is
  -- authorised and needs to be told what is missing.
  IF NEW.adjustment_reason IS NULL OR btrim(NEW.adjustment_reason) = '' THEN
    RAISE EXCEPTION 'Say why this record is being corrected. A change with no reason cannot be audited.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.checked_in_at IS NOT NULL AND NEW.checked_out_at IS NOT NULL
     AND NEW.checked_out_at <= NEW.checked_in_at THEN
    RAISE EXCEPTION 'Check-out must be after check-in.' USING ERRCODE = 'check_violation';
  END IF;

  /* Attribution comes from the session, never from the payload. */
  NEW.adjusted_by := COALESCE(me, NEW.adjusted_by);
  NEW.adjusted_at := now();
  NEW.is_remote   := (NEW.status = 'remote');
  NEW             := public.attendance_derive(NEW);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_server_time ON attendance_records;
CREATE TRIGGER trg_attendance_server_time
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_server_attendance_time();

/**
 * Record what a correction changed, once it has been allowed.
 *
 * AFTER rather than BEFORE, so it writes the row that actually landed, and
 * SECURITY DEFINER because `attendance_adjustments` has no INSERT policy —
 * which is what makes the history unforgeable from a client.
 */
CREATE OR REPLACE FUNCTION public.record_attendance_adjustment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.attendance_via_system() THEN RETURN NEW; END IF;
  IF NEW.adjusted_at IS NULL THEN RETURN NEW; END IF;

  /* An UPDATE that moved nothing an audit cares about is not a correction. */
  IF TG_OP = 'UPDATE'
     AND NEW.checked_in_at  IS NOT DISTINCT FROM OLD.checked_in_at
     AND NEW.checked_out_at IS NOT DISTINCT FROM OLD.checked_out_at
     AND NEW.status         IS NOT DISTINCT FROM OLD.status
     AND NEW.worked_minutes IS NOT DISTINCT FROM OLD.worked_minutes THEN
    RETURN NEW;
  END IF;

  INSERT INTO attendance_adjustments (
    organization_id, attendance_id, member_id, work_date,
    previous_status, previous_checked_in_at, previous_checked_out_at, previous_worked_minutes,
    new_status, new_checked_in_at, new_checked_out_at, new_worked_minutes,
    reason, adjusted_by
  )
  VALUES (
    NEW.organization_id, NEW.id, NEW.member_id, NEW.work_date,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status         END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.checked_in_at  END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.checked_out_at END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.worked_minutes END,
    NEW.status, NEW.checked_in_at, NEW.checked_out_at, NEW.worked_minutes,
    COALESCE(NULLIF(btrim(NEW.adjustment_reason), ''), 'Recorded by HR'),
    NEW.adjusted_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_adjustment_log ON attendance_records;
CREATE TRIGGER trg_attendance_adjustment_log
  AFTER INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.record_attendance_adjustment();

-- ───────────────────────────────────────────────────────────────────────────
--  3. The clock, made atomic
-- ───────────────────────────────────────────────────────────────────────────

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

  PERFORM set_config('app.attendance_system', 'on', true);

  /**
   * One statement decides and writes.
   *
   * The `WHERE` on the conflict clause is the whole fix: a second concurrent
   * call finds `checked_in_at` already set, updates no row, and `RETURNING`
   * gives back nothing — so it raises, rather than quietly restamping the
   * arrival time to whenever the duplicate request happened to land.
   */
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
    WHERE attendance_records.checked_in_at IS NULL
  RETURNING * INTO rec;

  /* Handed back the moment the write is done — see the header. */
  PERFORM set_config('app.attendance_system', '', true);

  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'You have already checked in today.' USING ERRCODE = 'unique_violation';
  END IF;

  RETURN rec;
END;
$$;

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

  /**
   * Locked, not merely read.
   *
   * The old version read the row, decided, then updated — so two check-out
   * requests could both see an open day and the second would overwrite the
   * first's worked minutes. `FOR UPDATE` makes the second wait, and by the
   * time it looks, the day is closed and it is told so.
   */
  SELECT * INTO rec FROM attendance_records
  WHERE member_id = me AND work_date = today
  FOR UPDATE;

  IF rec.id IS NULL OR rec.checked_in_at IS NULL THEN
    RAISE EXCEPTION 'You have not checked in today.' USING ERRCODE = 'check_violation';
  END IF;
  IF rec.checked_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'You have already checked out today.' USING ERRCODE = 'check_violation';
  END IF;

  gross := GREATEST(0, EXTRACT(EPOCH FROM (now_ts - rec.checked_in_at))::int / 60);
  net   := CASE WHEN gross > o.break_minutes * 2 THEN gross - o.break_minutes ELSE gross END;

  PERFORM set_config('app.attendance_system', 'on', true);

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

  PERFORM set_config('app.attendance_system', '', true);

  RETURN rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_in(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clock_out(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_via_system() TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  4. Leave no longer erases a day that was worked
-- ───────────────────────────────────────────────────────────────────────────

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

  PERFORM set_config('app.attendance_system', 'on', true);

  d := NEW.start_date;
  WHILE d <= NEW.end_date LOOP
    IF EXTRACT(DOW FROM d)::int = ANY (o.work_days) THEN
      /**
       * A day somebody actually clocked is not overwritten.
       *
       * Approving a backdated request used to replace a worked day with
       * `on_leave, 0 minutes`, deleting attendance that had really happened
       * and the hours it had contributed. The leave day is still counted
       * against the balance below; only the register is left alone. A person
       * who worked a day they were also on leave for is a discrepancy HR
       * should see, not one the database should quietly resolve.
       */
      INSERT INTO attendance_records (organization_id, member_id, work_date, status, worked_minutes)
      VALUES (NEW.organization_id, NEW.member_id, d, 'on_leave', 0)
      ON CONFLICT (member_id, work_date) DO UPDATE
        SET status = 'on_leave', worked_minutes = 0
        WHERE attendance_records.checked_in_at IS NULL;
      days := days + CASE WHEN NEW.is_half_day THEN 0.5 ELSE 1 END;
    END IF;
    d := d + 1;
  END LOOP;

  PERFORM set_config('app.attendance_system', '', true);

  UPDATE leave_requests SET days_requested = days WHERE id = NEW.id;

  INSERT INTO leave_balances (organization_id, member_id, type, year, used_days)
  VALUES (NEW.organization_id, NEW.member_id, NEW.type, EXTRACT(YEAR FROM NEW.start_date)::int, days)
  ON CONFLICT (member_id, type, year)
  DO UPDATE SET used_days = leave_balances.used_days + days, updated_at = now();

  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  5. Realtime
-- ───────────────────────────────────────────────────────────────────────────
--
--  `attendance_records` has been in the publication since 0006. The history
--  joins it, so a correction reaches an open register without a reload, and
--  takes REPLICA IDENTITY FULL for the reason 0006 gives: without it an UPDATE
--  arrives carrying only its key columns and a subscriber cannot tell what
--  moved.

ALTER TABLE attendance_adjustments REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename = 'attendance_adjustments'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_adjustments;
  END IF;
END $$;
