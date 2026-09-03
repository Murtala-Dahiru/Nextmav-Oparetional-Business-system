/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Attendance integrity, proved against the real database.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *      npm run test:attendance
 *
 *  ── Why this is not an HTTP harness ──────────────────────────────────────
 *
 *  Every rule it checks lives in Postgres — in a trigger, a policy, or the
 *  atomicity of a single statement. Driving them through the API would prove
 *  that the API is one client that obeys them, which is the weaker claim and
 *  the one already covered by `hr:verify`. What matters here is that a client
 *  going *around* the API cannot get a different answer, so the test is the
 *  attacker: it authenticates as an ordinary employee and writes straight to
 *  the table.
 *
 *  ── Why it leaves nothing behind ─────────────────────────────────────────
 *
 *  The whole run is one transaction that is rolled back. `hr:verify` needs
 *  `hr:cleanup` afterwards because it proves things about records that are
 *  deliberately permanent; nothing here is, so nothing has to be swept up.
 *  Each expected failure gets its own savepoint, because a raised exception
 *  aborts the transaction it happened in and every later statement would
 *  otherwise fail for the wrong reason.
 *
 *  It picks a real organisation and two real members out of the database
 *  rather than creating them: the rules under test are about who somebody is,
 *  and a fixture invented by the test can be given exactly the shape that
 *  makes the test pass.
 */
import { readFileSync } from 'node:fs';
import { connect } from './db-connect.mjs';

const env = key => {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};

const url = process.env.DIRECT_URL || env('DIRECT_URL');
if (!url) {
  console.error('  DIRECT_URL is not set. See DEPLOYMENT.md.');
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (cond, msg, detail) => {
  if (cond) { pass++; console.log(`  PASS | ${msg}`); }
  else { fail++; console.log(`  FAIL | ${msg}${detail ? `  (${detail})` : ''}`); }
};

const { client } = await connect(url, { statement_timeout: 60_000 });
const q = async (sql, params) => (await client.query(sql, params)).rows;

/** Run `fn` as `userId`, undoing whatever it did. Returns its rows or its error. */
async function as(userId, sql, params) {
  await q('SAVEPOINT sp');
  try {
    await q('SET LOCAL ROLE authenticated');
    await q(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    const rows = await q(sql, params);
    await q('RESET ROLE');
    await q('RELEASE SAVEPOINT sp');
    return { rows, error: null };
  } catch (e) {
    await q('ROLLBACK TO SAVEPOINT sp');
    await q('RESET ROLE');
    return { rows: [], error: e.message };
  }
}

/** As above, but keeps what it did (still inside the outer transaction). */
async function asKeep(userId, sql, params) {
  await q('SAVEPOINT sk');
  try {
    await q('SET LOCAL ROLE authenticated');
    await q(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    const rows = await q(sql, params);
    await q('RESET ROLE');
    await q('RELEASE SAVEPOINT sk');
    return { rows, error: null };
  } catch (e) {
    await q('ROLLBACK TO SAVEPOINT sk');
    await q('RESET ROLE');
    return { rows: [], error: e.message };
  }
}

/**
 * Write as one of the sanctioned server paths would.
 *
 * Needed only to move a timestamp so a later assertion has something to see.
 * `now()` is the *transaction's* start time and the whole run is one
 * transaction, so a check-in and a check-out made here land on the same
 * instant and trip the `checked_out_at > checked_in_at` constraint. In
 * production the two are separate requests, and therefore separate
 * transactions, minutes or hours apart.
 *
 * The flag is cleared again immediately, for the same reason the clock
 * functions clear it: it lasts as long as the transaction, not as long as the
 * statement, and leaving it on would exempt every later write in this file
 * from the very trigger under test — which is exactly how the first draft of
 * this harness passed ten checks it had not actually made.
 */
async function asSystem(sql, params) {
  await q(`SELECT set_config('app.attendance_system', 'on', true)`);
  try {
    return await q(sql, params);
  } finally {
    await q(`SELECT set_config('app.attendance_system', '', true)`);
  }
}

await q('BEGIN');

try {
  // ── Fixtures: a real organisation with a real employee and a real approver ──
  const [org] = await q(`
    SELECT o.id, o.name, o.timezone, o.work_start, o.break_minutes
    FROM organizations o
    WHERE EXISTS (SELECT 1 FROM organization_members m
                  WHERE m.organization_id = o.id AND m.role = 'employee' AND m.is_active)
      AND EXISTS (SELECT 1 FROM organization_members m
                  WHERE m.organization_id = o.id AND m.role IN ('owner','administrator','hr_staff')
                    AND m.is_active)
    ORDER BY o.created_at
    LIMIT 1`);

  if (!org) {
    console.log('  SKIP | no organisation with both an employee and an HR approver');
    await q('ROLLBACK'); await client.end(); process.exit(0);
  }

  const [emp] = await q(`
    SELECT m.id, m.user_id FROM organization_members m
    WHERE m.organization_id = $1 AND m.role = 'employee' AND m.is_active
      AND m.user_id IS NOT NULL
    ORDER BY m.created_at LIMIT 1`, [org.id]);
  const [hr] = await q(`
    SELECT m.id, m.user_id FROM organization_members m
    WHERE m.organization_id = $1 AND m.role IN ('owner','administrator','hr_staff') AND m.is_active
      AND m.user_id IS NOT NULL
    ORDER BY m.created_at LIMIT 1`, [org.id]);

  if (!emp || !hr) {
    console.log('  SKIP | fixture members have no auth user');
    await q('ROLLBACK'); await client.end(); process.exit(0);
  }

  console.log(`\n  organisation: ${org.name} (${org.timezone})\n`);

  const today = (await q(
    `SELECT (now() AT TIME ZONE $1)::date AS d`, [org.timezone]))[0].d;

  /* A clean slate for today, and no approved leave in the way. */
  await q(`DELETE FROM attendance_records WHERE member_id = $1 AND work_date = $2`, [emp.id, today]);
  await q(`UPDATE leave_requests SET status = 'pending'
           WHERE member_id = $1 AND status = 'approved' AND $2 BETWEEN start_date AND end_date`,
    [emp.id, today]);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('THE CLOCK IS THE ONLY WAY IN');
  // ═════════════════════════════════════════════════════════════════════════

  const first = await asKeep(emp.user_id, `SELECT * FROM public.clock_in($1, false)`, [org.id]);
  ok(!first.error && first.rows[0]?.checked_in_at, 'an employee can check in', first.error);
  const firstAt = first.rows[0]?.checked_in_at;

  const second = await as(emp.user_id, `SELECT * FROM public.clock_in($1, false)`, [org.id]);
  ok(
    !!second.error && /already checked in/i.test(second.error),
    'a second check-in is refused rather than silently restamping the arrival',
    second.error ?? 'it succeeded',
  );

  const [afterSecond] = await q(
    `SELECT checked_in_at FROM attendance_records WHERE member_id = $1 AND work_date = $2`,
    [emp.id, today]);
  ok(
    afterSecond && String(afterSecond.checked_in_at) === String(firstAt),
    'the arrival time after a duplicate request is still the first one',
    `${firstAt} -> ${afterSecond?.checked_in_at}`,
  );

  /* Back-date the arrival so the check-out below has a shift to measure. */
  await asSystem(
    `UPDATE attendance_records SET checked_in_at = now() - interval '7 hours'
     WHERE member_id = $1 AND work_date = $2`, [emp.id, today]);

  const out1 = await asKeep(emp.user_id, `SELECT * FROM public.clock_out($1)`, [org.id]);
  ok(!out1.error && out1.rows[0]?.checked_out_at, 'an employee can check out', out1.error);

  const out2 = await as(emp.user_id, `SELECT * FROM public.clock_out($1)`, [org.id]);
  ok(
    !!out2.error && /already checked out/i.test(out2.error),
    'a second check-out is refused',
    out2.error ?? 'it succeeded',
  );

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\nAN EMPLOYEE CANNOT REWRITE THEIR OWN ATTENDANCE');
  // ═════════════════════════════════════════════════════════════════════════

  const [before] = await q(
    `SELECT id, checked_in_at, checked_out_at, status, worked_minutes, late_minutes
     FROM attendance_records WHERE member_id = $1 AND work_date = $2`, [emp.id, today]);

  const forgeDerived = await asKeep(emp.user_id, `
    UPDATE attendance_records
    SET worked_minutes = 999, status = 'present', late_minutes = 0
    WHERE id = $1 RETURNING worked_minutes, status, late_minutes`, [before.id]);
  ok(
    forgeDerived.rows[0]?.worked_minutes === before.worked_minutes
      && forgeDerived.rows[0]?.status === before.status
      && forgeDerived.rows[0]?.late_minutes === before.late_minutes,
    'worked minutes, status and lateness are put back',
    JSON.stringify(forgeDerived.rows[0]),
  );

  /* The 0004 hole: claim to be your own auditor, then write any time you like. */
  const forgeTimes = await asKeep(emp.user_id, `
    UPDATE attendance_records
    SET checked_in_at = now() - interval '9 hours',
        checked_out_at = now(),
        worked_minutes = 480,
        adjusted_by = $2, adjusted_at = now(), adjustment_reason = 'mine now'
    WHERE id = $1
    RETURNING checked_in_at, checked_out_at, worked_minutes, adjusted_by`,
    [before.id, emp.id]);
  ok(
    String(forgeTimes.rows[0]?.checked_in_at) === String(before.checked_in_at)
      && forgeTimes.rows[0]?.adjusted_by === null,
    'setting adjusted_by to yourself no longer unlocks the timestamps',
    JSON.stringify(forgeTimes.rows[0]),
  );

  const note = await asKeep(emp.user_id,
    `UPDATE attendance_records SET note = 'worked from the Lagos office' WHERE id = $1 RETURNING note`,
    [before.id]);
  ok(
    note.rows[0]?.note === 'worked from the Lagos office',
    'the note is still the employee’s own to write',
    note.error ?? JSON.stringify(note.rows[0]),
  );

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\nA CORRECTION IS ATTRIBUTED, EXPLAINED AND KEPT');
  // ═════════════════════════════════════════════════════════════════════════

  const noReason = await as(hr.user_id,
    `UPDATE attendance_records SET status = 'absent' WHERE id = $1 RETURNING id`, [before.id]);
  ok(
    !!noReason.error && /why this record is being corrected/i.test(noReason.error),
    'an approver correcting a record with no reason is refused',
    noReason.error ?? 'it succeeded',
  );

  /* Nine hours apart, so the derived minutes are unmistakable arithmetic. */
  const fixed = await asKeep(hr.user_id, `
    UPDATE attendance_records
    SET checked_in_at = (($3::date + time '09:00') AT TIME ZONE $4),
        checked_out_at = (($3::date + time '18:00') AT TIME ZONE $4),
        status = 'present',
        adjustment_reason = 'Forgot to clock out',
        adjusted_by = $2
    WHERE id = $1
    RETURNING worked_minutes, break_minutes, adjusted_by, adjusted_at, adjustment_reason`,
    [before.id, emp.id /* deliberately the wrong auditor */, today, org.timezone]);

  const expectWorked = 9 * 60 - org.break_minutes;
  ok(
    fixed.rows[0]?.worked_minutes === expectWorked,
    `worked minutes are recomputed by the database (${expectWorked} for a nine-hour day less break)`,
    `${fixed.rows[0]?.worked_minutes} — ${fixed.error ?? ''}`,
  );
  ok(
    fixed.rows[0]?.adjusted_by === hr.id,
    'the auditor is taken from the session, not from the payload',
    `payload said ${emp.id}, row says ${fixed.rows[0]?.adjusted_by}`,
  );

  const [hist] = await q(`
    SELECT previous_checked_in_at, previous_worked_minutes,
           new_checked_in_at, new_worked_minutes, reason, adjusted_by
    FROM attendance_adjustments
    WHERE attendance_id = $1 ORDER BY created_at DESC LIMIT 1`, [before.id]);
  ok(!!hist, 'the correction wrote a history row');
  ok(
    hist && String(hist.previous_checked_in_at) === String(before.checked_in_at),
    'the history keeps the time that was replaced',
    hist ? `${hist.previous_checked_in_at} vs ${before.checked_in_at}` : 'no row',
  );
  ok(
    hist && hist.reason === 'Forgot to clock out' && hist.adjusted_by === hr.id,
    'the history keeps the reason and who gave it',
    hist ? `${hist.reason} / ${hist.adjusted_by}` : 'no row',
  );

  /* The commonest correction of all: fix the check-in, leave the rest alone. */
  const [beforePartial] = await q(
    `SELECT worked_minutes FROM attendance_records WHERE id = $1`, [before.id]);
  const partial = await asKeep(hr.user_id, `
    UPDATE attendance_records
    SET checked_in_at = (($2::date + time '08:30') AT TIME ZONE $3),
        adjustment_reason = 'Arrived earlier than recorded'
    WHERE id = $1 RETURNING worked_minutes`,
    [before.id, today, org.timezone]);
  ok(
    partial.rows[0]?.worked_minutes > 0
      && partial.rows[0]?.worked_minutes !== beforePartial.worked_minutes,
    'correcting only the check-in recomputes the day rather than zeroing it',
    `was ${beforePartial.worked_minutes}, now ${partial.rows[0]?.worked_minutes}`,
  );

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\nTHE HISTORY IS APPEND-ONLY AND READABLE BY ITS SUBJECT');
  // ═════════════════════════════════════════════════════════════════════════

  const mine = await as(emp.user_id,
    `SELECT id FROM attendance_adjustments WHERE attendance_id = $1`, [before.id]);
  ok(mine.rows.length > 0, 'an employee can read what was done to their own record', mine.error);

  const forgeHistory = await as(emp.user_id, `
    INSERT INTO attendance_adjustments
      (organization_id, attendance_id, member_id, work_date, new_status, reason)
    VALUES ($1, $2, $3, $4, 'present', 'invented') RETURNING id`,
    [org.id, before.id, emp.id, today]);
  ok(
    !!forgeHistory.error || forgeHistory.rows.length === 0,
    'nobody can insert a history row directly',
    forgeHistory.error ?? 'the insert succeeded',
  );

  const rewriteHistory = await as(hr.user_id,
    `UPDATE attendance_adjustments SET reason = 'something else' WHERE attendance_id = $1 RETURNING id`,
    [before.id]);
  ok(
    rewriteHistory.rows.length === 0,
    'not even HR can rewrite a history row',
    rewriteHistory.error ?? `${rewriteHistory.rows.length} rows changed`,
  );

  const deleteHistory = await as(hr.user_id,
    `DELETE FROM attendance_adjustments WHERE attendance_id = $1 RETURNING id`, [before.id]);
  ok(
    deleteHistory.rows.length === 0,
    'and nobody can delete one',
    deleteHistory.error ?? `${deleteHistory.rows.length} rows deleted`,
  );

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\nAPPROVING LEAVE DOES NOT ERASE A DAY THAT WAS WORKED');
  // ═════════════════════════════════════════════════════════════════════════

  const [clocked] = await q(
    `SELECT checked_in_at, worked_minutes, status FROM attendance_records WHERE id = $1`, [before.id]);

  const [req] = await q(`
    INSERT INTO leave_requests (organization_id, member_id, type, start_date, end_date, reason, status)
    VALUES ($1, $2, 'personal', $3, $3, 'integrity test', 'pending') RETURNING id`,
    [org.id, emp.id, today]);
  await q(`UPDATE leave_requests SET status = 'approved', approved_by = $2 WHERE id = $1`,
    [req.id, hr.id]);

  const [afterLeave] = await q(
    `SELECT checked_in_at, worked_minutes, status FROM attendance_records WHERE id = $1`, [before.id]);
  ok(
    afterLeave && String(afterLeave.checked_in_at) === String(clocked.checked_in_at)
      && afterLeave.worked_minutes === clocked.worked_minutes,
    'a backdated leave approval leaves a clocked day intact',
    `${clocked.worked_minutes}m -> ${afterLeave?.worked_minutes}m, status ${afterLeave?.status}`,
  );

  const [freeDay] = await q(`
    SELECT status FROM attendance_records
    WHERE member_id = $1 AND work_date = $2`, [emp.id, today]);
  ok(!!freeDay, 'the register still has the day');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\nTHE ENUM AND THE APPLICATION AGREE');
  // ═════════════════════════════════════════════════════════════════════════

  const dbStatuses = (await q(`
    SELECT e.enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'attendance_status' ORDER BY e.enumsortorder`)).map(r => r.enumlabel);

  const src = readFileSync('src/lib/attendance.ts', 'utf8');
  const listed = [...src.matchAll(/export const ATTENDANCE_STATUSES = \[([\s\S]*?)\]/g)]
    .flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));

  const missing = dbStatuses.filter(s => !listed.includes(s));
  ok(
    missing.length === 0,
    'every status the database can write has a label in the application',
    `missing: ${missing.join(', ')}`,
  );

} finally {
  await q('ROLLBACK');
  await client.end();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
