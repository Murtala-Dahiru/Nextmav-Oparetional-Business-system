/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The formal review, proved against the real database.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *      npm run test:review
 *
 *  ── What is actually at risk here ────────────────────────────────────────
 *
 *  Every rule 0048 adds is a rule about *who may see or write what*, and every
 *  one of them fails silently when it is wrong. A subject who can read the 360
 *  feedback written about them does not get an error — they get a screen that
 *  works, and the instrument quietly stops being worth running. HR who can
 *  edit a colleague's feedback does not get an error either. Neither shows up
 *  in a UI test, because the UI simply would not offer the button.
 *
 *  So this authenticates as four real people and attacks the tables directly,
 *  the way a client going around the API would.
 *
 *  ── Why it leaves nothing behind ─────────────────────────────────────────
 *
 *  One transaction, rolled back — the same reason the attendance and evidence
 *  harnesses do it: `review_calibrations` is append-only with no DELETE policy,
 *  so anything this wrote through the ordinary path could never be removed.
 *  Each expected failure gets its own savepoint, because a raised exception
 *  aborts the transaction it happened in.
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
const section = t => console.log(`\n${t.toUpperCase()}`);

const { client } = await connect(url, { statement_timeout: 60_000 });
const q = async (sql, params) => (await client.query(sql, params)).rows;

/**
 * Run as `userId`, rolling back whatever it did. Returns rows or the error.
 *
 * ── The identity has to be handed back, not just the role ────────────────
 *
 * `RESET ROLE` restores the *role*, and the first draft of this file stopped
 * there. `request.jwt.claims` is a transaction-local setting and the whole run
 * is one transaction, so it survived: every later statement made as the
 * superuser still looked, to anything calling `auth_member_id()`, like the
 * last person `as()` impersonated.
 *
 * That is not a cosmetic leak. `restrict_self_review_write` reverts the
 * columns a subject may not touch, so the harness's own "move the review on"
 * statement was silently undone — and the failure surfaced three sections
 * later as an unrelated trigger complaining, which is exactly the kind of
 * wrong answer a harness must not give. The attendance harness records the
 * same trap for `app.attendance_system`: a transaction-local flag lasts the
 * transaction, not the call.
 */
async function as(userId, sql, params) {
  await q('SAVEPOINT sp');
  try {
    await q('SET LOCAL ROLE authenticated');
    await q(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    const rows = await q(sql, params);
    await q('RESET ROLE');
    await q(`SELECT set_config('request.jwt.claims', '', true)`);
    await q('RELEASE SAVEPOINT sp');
    return { rows, error: null };
  } catch (e) {
    await q('ROLLBACK TO SAVEPOINT sp');
    await q('RESET ROLE');
    await q(`SELECT set_config('request.jwt.claims', '', true)`);
    return { rows: [], error: e.message };
  }
}

await q('BEGIN');

try {
  /* ── Fixtures: a real org with HR, an employee, and two colleagues ─────── */

  const [org] = await q(`
    SELECT o.id, o.name
    FROM organizations o
    WHERE (SELECT count(*) FROM organization_members m
           WHERE m.organization_id = o.id AND m.is_active) >= 3
      AND EXISTS (SELECT 1 FROM organization_members m
                  WHERE m.organization_id = o.id AND m.is_active
                    AND m.role IN ('owner', 'administrator', 'hr_staff'))
    ORDER BY o.created_at
    LIMIT 1`);

  if (!org) {
    console.error('  Need an organization with HR and at least three members. Run npm run seed:demo.');
    process.exit(1);
  }

  const [hr] = await q(`
    SELECT m.id, m.user_id FROM organization_members m
    WHERE m.organization_id = $1 AND m.is_active
      AND m.role IN ('owner','administrator','hr_staff')
    ORDER BY m.created_at LIMIT 1`, [org.id]);

  const others = await q(`
    SELECT m.id, m.user_id, p.full_name FROM organization_members m
    JOIN profiles p ON p.id = m.user_id
    WHERE m.organization_id = $1 AND m.is_active AND m.id <> $2
    ORDER BY m.created_at LIMIT 2`, [org.id, hr.id]);

  const subject = others[0];
  const peer = others[1];

  console.log(`\n  organisation: ${org.name}`);
  console.log(`  subject: ${subject.full_name}   peer: ${peer.full_name}\n`);

  /* A cycle and a review to hang everything on. */
  const [cycle] = await q(`
    INSERT INTO performance_cycles (organization_id, name, period_start, period_end, status)
    VALUES ($1, 'Review harness cycle', current_date - 90, current_date, 'active')
    RETURNING id`, [org.id]);

  const [review] = await q(`
    INSERT INTO performance_reviews (organization_id, cycle_id, member_id, reviewer_id, status)
    VALUES ($1, $2, $3, $4, 'self_review')
    RETURNING id`, [org.id, cycle.id, subject.id, hr.id]);

  /* ── 1. The framework ─────────────────────────────────────────────────── */

  section('the framework is HR’s to write and everybody’s to read');

  const employeeWrites = await as(subject.user_id,
    `INSERT INTO competencies (organization_id, name) VALUES ($1, 'Forged competency') RETURNING id`,
    [org.id]);
  ok(employeeWrites.error !== null || employeeWrites.rows.length === 0,
    'an employee cannot add a competency');

  /**
   * A different name from the one below, deliberately.
   *
   * `as()` releases its savepoint when the statement succeeds, so a successful
   * write inside it *persists* for the rest of the run — it is only the outer
   * ROLLBACK that removes it. Reusing the name here collided with the row
   * created a few lines down against `competencies_organization_id_name_key`,
   * which is the unique constraint doing its job and the harness doing a poor
   * one.
   */
  const hrWrites = await as(hr.user_id,
    `INSERT INTO competencies (organization_id, name, description, category)
     VALUES ($1, 'Harness competency (HR write check)', '', 'Craft') RETURNING id`,
    [org.id]);
  ok(hrWrites.rows.length === 1, 'HR can', hrWrites.error ?? '');

  /* Created as the owner so later checks can see it regardless of who asks. */
  const [comp] = await q(`
    INSERT INTO competencies (organization_id, name, description, category)
    VALUES ($1, 'Harness competency', 'What good looks like', 'Craft')
    RETURNING id`, [org.id]);

  const employeeReads = await as(subject.user_id,
    'SELECT id FROM competencies WHERE id = $1', [comp.id]);
  ok(employeeReads.rows.length === 1,
    'and an employee can read the standard they are assessed against');

  /* ── 2. Competency ratings ────────────────────────────────────────────── */

  section('a self-rating belongs to the person, while the review is theirs');

  const [rc] = await q(`
    INSERT INTO review_competencies (organization_id, review_id, competency_id)
    VALUES ($1, $2, $3) RETURNING id`, [org.id, review.id, comp.id]);

  const selfRates = await as(subject.user_id,
    'UPDATE review_competencies SET self_rating = 4 WHERE id = $1 RETURNING self_rating',
    [rc.id]);
  ok(selfRates.rows[0]?.self_rating === 4,
    'the subject can set their own rating at self_review', selfRates.error ?? '');

  section('while it is with the employee, the manager’s half stays shut');

  await q('SAVEPOINT early_assess');
  let earlyRefused = false;
  try {
    await q(`UPDATE performance_reviews SET overall_rating = 5 WHERE id = $1`, [review.id]);
  } catch { earlyRefused = true; }
  await q('ROLLBACK TO SAVEPOINT early_assess');
  ok(earlyRefused,
    'a rating cannot be written while the review is still at self_review');

  const subjectWrites = await as(subject.user_id,
    `UPDATE performance_reviews SET self_comment = 'My account of the period'
     WHERE id = $1 RETURNING self_comment`, [review.id]);
  ok(subjectWrites.rows[0]?.self_comment === 'My account of the period',
    'but the subject can write their own account', subjectWrites.error ?? '');

  const subjectMoves = await as(subject.user_id,
    `UPDATE performance_reviews SET status = 'shared' WHERE id = $1 RETURNING status`,
    [review.id]);
  ok(subjectMoves.rows.length === 0 || subjectMoves.rows[0]?.status === 'self_review',
    'and cannot move their own review along, or share it with themselves');

  /* Move the review on; the subject's window closes. */
  await q(`UPDATE performance_reviews SET status = 'manager_review' WHERE id = $1`, [review.id]);

  const selfRatesLate = await as(subject.user_id,
    'UPDATE review_competencies SET self_rating = 1 WHERE id = $1 RETURNING self_rating',
    [rc.id]);
  ok(selfRatesLate.rows.length === 0,
    'and cannot rewrite it once the review has moved to the manager');

  const hrRates = await as(hr.user_id,
    'UPDATE review_competencies SET manager_rating = 3 WHERE id = $1 RETURNING manager_rating',
    [rc.id]);
  ok(hrRates.rows[0]?.manager_rating === 3, 'the reviewer can rate it', hrRates.error ?? '');

  /* ── 3. 360 feedback: the privacy design ──────────────────────────────── */

  section('the subject of a review cannot read the feedback written about them');

  const [fb] = await q(`
    INSERT INTO review_feedback (
      organization_id, review_id, subject_id, respondent_id, relationship, requested_by
    ) VALUES ($1, $2, $3, $4, 'peer', $5) RETURNING id`,
    [org.id, review.id, subject.id, peer.id, hr.id]);

  await q(`UPDATE review_feedback
           SET status = 'submitted', strengths = 'Ships carefully', improvements = 'Could delegate'
           WHERE id = $1`, [fb.id]);

  const subjectReads = await as(subject.user_id,
    'SELECT id, strengths FROM review_feedback WHERE id = $1', [fb.id]);
  ok(subjectReads.rows.length === 0,
    'the person being reviewed sees none of it — the whole design of the instrument');

  const peerReads = await as(peer.user_id,
    'SELECT id FROM review_feedback WHERE id = $1', [fb.id]);
  ok(peerReads.rows.length === 1, 'the author can see their own');

  const hrReads = await as(hr.user_id,
    'SELECT id FROM review_feedback WHERE id = $1', [fb.id]);
  ok(hrReads.rows.length === 1, 'HR, who runs the process, can read it');

  section('nobody puts words in a colleague’s mouth');

  const hrEdits = await as(hr.user_id,
    `UPDATE review_feedback SET strengths = 'Rewritten by HR' WHERE id = $1 RETURNING strengths`,
    [fb.id]);
  ok(hrEdits.rows.length === 0,
    'HR can read feedback but cannot edit what somebody else wrote');

  const [unchanged] = await q('SELECT strengths FROM review_feedback WHERE id = $1', [fb.id]);
  ok(unchanged.strengths === 'Ships carefully', 'and the words are still the author’s');

  const peerEdits = await as(peer.user_id,
    `UPDATE review_feedback SET improvements = 'Revised' WHERE id = $1 RETURNING improvements`,
    [fb.id]);
  ok(peerEdits.rows[0]?.improvements === 'Revised',
    'the author can revise their own', peerEdits.error ?? '');

  section('an empty submission is not a submission');

  const [fb2] = await q(`
    INSERT INTO review_feedback (organization_id, review_id, subject_id, respondent_id, requested_by)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [org.id, review.id, subject.id, hr.id, hr.id]);

  await q('SAVEPOINT empty_sub');
  let emptyRefused = false;
  try {
    await q(`UPDATE review_feedback SET status = 'submitted' WHERE id = $1`, [fb2.id]);
  } catch { emptyRefused = true; }
  await q('ROLLBACK TO SAVEPOINT empty_sub');
  ok(emptyRefused, 'submitting with nothing written is refused — decline instead');

  /* ── 4. Calibration ───────────────────────────────────────────────────── */

  section('a rating that moves has to say why, and the move is kept');

  await q(`UPDATE performance_reviews SET overall_rating = 4 WHERE id = $1`, [review.id]);
  const firstSet = await q(
    'SELECT count(*)::int n FROM review_calibrations WHERE review_id = $1', [review.id]);
  ok(firstSet[0].n === 0,
    'setting a rating for the first time is not a change and logs nothing');

  await q('SAVEPOINT no_reason');
  let refused = false;
  try {
    await q(`UPDATE performance_reviews SET overall_rating = 3 WHERE id = $1`, [review.id]);
  } catch { refused = true; }
  await q('ROLLBACK TO SAVEPOINT no_reason');
  ok(refused, 'moving it afterwards with no reason is refused');

  await q(`UPDATE performance_reviews
           SET overall_rating = 3, calibration_reason = 'Agreed in calibration — department consistency'
           WHERE id = $1`, [review.id]);

  const logged = await q(
    'SELECT * FROM review_calibrations WHERE review_id = $1 ORDER BY created_at DESC', [review.id]);
  ok(logged.length === 1, 'with a reason it goes through and is recorded', `${logged.length} rows`);
  ok(logged[0]?.previous_rating === 4 && logged[0]?.new_rating === 3,
    'the history keeps what it was as well as what it became');
  ok(String(logged[0]?.reason).includes('department consistency'),
    'and the reason that was given');

  section('the person it is about can read why their rating moved');

  await q(`UPDATE performance_reviews SET status = 'shared' WHERE id = $1`, [review.id]);

  const subjectReadsCal = await as(subject.user_id,
    'SELECT id, previous_rating, new_rating, reason FROM review_calibrations WHERE review_id = $1',
    [review.id]);
  ok(subjectReadsCal.rows.length === 1,
    'once the review is shared, the calibration record is theirs to read too');

  section('the calibration record cannot be forged or erased');

  const forge = await as(hr.user_id,
    `INSERT INTO review_calibrations (organization_id, review_id, new_rating, reason)
     VALUES ($1, $2, 5, 'forged') RETURNING id`, [org.id, review.id]);
  ok(forge.error !== null || forge.rows.length === 0, 'nobody can insert one directly');

  const rewrite = await as(hr.user_id,
    `UPDATE review_calibrations SET new_rating = 5 WHERE id = $1 RETURNING id`, [logged[0].id]);
  ok(rewrite.error !== null || rewrite.rows.length === 0, 'nor rewrite one');

  const erase = await as(hr.user_id,
    'DELETE FROM review_calibrations WHERE id = $1 RETURNING id', [logged[0].id]);
  ok(erase.error !== null || erase.rows.length === 0, 'nor delete one');

  /* ── 5. The rule 0032 set, still holding ──────────────────────────────── */

  section('0032’s promise still holds');

  await q(`UPDATE performance_reviews SET status = 'manager_review', shared_at = NULL WHERE id = $1`,
    [review.id]);

  await q('SAVEPOINT close_unshared');
  let closeRefused = false;
  try {
    await q(`UPDATE performance_reviews SET status = 'closed' WHERE id = $1`, [review.id]);
  } catch { closeRefused = true; }
  await q('ROLLBACK TO SAVEPOINT close_unshared');
  ok(closeRefused, 'a review still cannot be closed before the person has seen it');

  /* ── 6. The application and the database agree ────────────────────────── */

  section('the words the screen uses are the words the database permits');

  const src = readFileSync('src/components/modules/hr/review.tsx', 'utf8');

  const readiness = await q(
    `SELECT unnest(enum_range(NULL::promotion_readiness))::text AS v`);
  const declaredReadiness = [...src.matchAll(/^\s{2}(\w+): '/gm)].map(m => m[1]);
  const missingReadiness = readiness
    .map(r => r.v)
    .filter(v => !src.includes(`${v}:`));
  ok(missingReadiness.length === 0,
    'every promotion_readiness value has a label on screen', missingReadiness.join(', '));

  const rels = await q(`SELECT unnest(enum_range(NULL::feedback_relationship))::text AS v`);
  const missingRels = rels.map(r => r.v).filter(v => !src.includes(`${v}:`));
  ok(missingRels.length === 0,
    'and so does every feedback_relationship', missingRels.join(', '));
  ok(declaredReadiness.length > 0, 'the screen declares labels at all');

} finally {
  await q('ROLLBACK');
  await client.end();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
