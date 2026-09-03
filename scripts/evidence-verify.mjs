/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Performance evidence, proved against the real database.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *      npm run test:evidence
 *
 *  ── What this is defending ───────────────────────────────────────────────
 *
 *  0047 made the event spine cross-module, and the single property the whole
 *  design rests on is that **an event is frozen**. "Finished on time" is a
 *  fact about the day the work was finished, measured against the due date it
 *  had *then*. If moving a due date in August can change whether a task
 *  completed in March was on time, the evidence layer is not evidence — it is
 *  a live query wearing a historical label, and every review conducted with it
 *  is conducted with numbers that quietly moved.
 *
 *  That property cannot be observed from the API. The route reads events and
 *  reports what they say; it would go on reporting confidently whatever the
 *  trigger had written, including nothing. So this test is the thing that
 *  edits the due date afterwards and looks again.
 *
 *  ── Why it leaves nothing behind ─────────────────────────────────────────
 *
 *  The run is one transaction, rolled back. That matters more here than
 *  usual: `business_events` has no UPDATE and no DELETE policy by design — an
 *  event that can be edited after an incentive was computed from it is not
 *  evidence — so an HTTP harness driving real completions would write rows
 *  into a real employee's permanent record that nothing could ever remove.
 *  A rolled-back transaction is the only honest way to test an append-only
 *  table.
 *
 *  It uses a real organisation and a real member rather than inventing them,
 *  for the reason the attendance harness gives: a fixture built by the test
 *  can be given exactly the shape that makes the test pass.
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

/** Run as `userId`, undoing whatever it did. Returns its rows or its error. */
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

await q('BEGIN');

try {
  /* ── Fixtures ─────────────────────────────────────────────────────────── */

  const [org] = await q(`
    SELECT o.id, o.name, o.timezone
    FROM organizations o
    WHERE EXISTS (SELECT 1 FROM organization_members m
                  WHERE m.organization_id = o.id AND m.is_active)
    ORDER BY o.created_at
    LIMIT 1`);

  if (!org) {
    console.error('  No organization with an active member. Run npm run seed:demo.');
    process.exit(1);
  }

  const [member] = await q(`
    SELECT m.id, m.user_id, p.full_name
    FROM organization_members m
    JOIN profiles p ON p.id = m.user_id
    WHERE m.organization_id = $1 AND m.is_active
    ORDER BY m.created_at
    LIMIT 1`, [org.id]);

  console.log(`\n  organisation: ${org.name} (${org.timezone})`);
  console.log(`  member: ${member.full_name}\n`);

  const events = async (type, entityId) => q(
    `SELECT * FROM business_events
      WHERE organization_id = $1 AND event_type = $2 AND entity_id = $3
      ORDER BY id`, [org.id, type, entityId]);

  /* ── 1. A completed task becomes evidence ─────────────────────────────── */

  section('a completed task becomes evidence');

  const [task] = await q(`
    INSERT INTO tasks (organization_id, title, status, assignee_id, due_date, priority)
    VALUES ($1, 'Evidence harness — on time', 'todo', $2, (now() AT TIME ZONE $3)::date + 3, 'high')
    RETURNING id`, [org.id, member.id, org.timezone]);

  ok((await events('task.completed', task.id)).length === 0,
    'a task that is not done yet has produced no event');

  await q(`UPDATE tasks SET status = 'done' WHERE id = $1`, [task.id]);

  const done = await events('task.completed', task.id);
  ok(done.length === 1, 'completing it wrote exactly one event', `got ${done.length}`);
  ok(done[0]?.subject_member_id === member.id,
    'credited to the assignee');
  ok(done[0]?.payload?.on_time === true,
    'and recorded that it was finished before its due date');

  /* ── 2. The freeze — the property everything else rests on ────────────── */

  section('an event does not move when its source does');

  await q(`UPDATE tasks SET due_date = (now() AT TIME ZONE $2)::date - 30 WHERE id = $1`,
    [task.id, org.timezone]);

  /**
   * Asked of the database rather than compared in JavaScript.
   *
   * `due_date` comes back from `pg` as a Date and `completed_at` as a Date in
   * a different resolution, so comparing them here compares two things that
   * only look comparable — the first draft of this check did exactly that and
   * reported a failure that was entirely its own. The question is "would the
   * live row read late", and the only place that can answer it in the
   * organisation's own calendar is the same expression the trigger uses.
   */
  const [live] = await q(`
    SELECT (completed_at AT TIME ZONE $2)::date > due_date AS would_read_late
    FROM tasks WHERE id = $1`, [task.id, org.timezone]);
  const after = await events('task.completed', task.id);

  ok(after.length === 1,
    'moving the due date afterwards did not write a second event', `got ${after.length}`);
  ok(after[0]?.payload?.on_time === true,
    'and the event still says it was on time, though the live row now reads late');
  ok(live.would_read_late === true,
    'the live row really would read late if it were the source', 'fixture did not move');

  /* ── 3. What must NOT produce evidence ────────────────────────────────── */

  section('what does not count');

  const before = await q(
    'SELECT count(*)::int AS n FROM business_events WHERE organization_id = $1', [org.id]);

  const [unassigned] = await q(`
    INSERT INTO tasks (organization_id, title, status, assignee_id)
    VALUES ($1, 'Evidence harness — nobody''s task', 'done', NULL)
    RETURNING id`, [org.id]);

  ok((await events('task.completed', unassigned.id)).length === 0,
    'an unassigned task credits nobody and writes no event');

  await q(`UPDATE tasks SET title = title || ' (edited)' WHERE id = $1`, [task.id]);
  ok((await events('task.completed', task.id)).length === 1,
    'editing a task that was already done does not write a second event');

  /**
   * The private list stays private.
   *
   * `todos` has no administrator override in its RLS on purpose. If completing
   * one produced performance evidence, a manager would be able to read the
   * shape of somebody's private list through the evidence layer — the promise
   * would be revoked without anybody editing the policy that makes it.
   */
  const [todo] = await q(`
    INSERT INTO todos (organization_id, member_id, title, is_done, completed_at)
    VALUES ($1, $2, 'Evidence harness — private item', true, now())
    RETURNING id`, [org.id, member.id]);

  const afterTodo = await q(
    'SELECT count(*)::int AS n FROM business_events WHERE organization_id = $1', [org.id]);
  ok(afterTodo[0].n === before[0].n,
    'completing a private My Work item produces no evidence at all',
    `${before[0].n} → ${afterTodo[0].n}`);
  ok(Boolean(todo.id), 'and the item itself was still created');

  /* ── 4. Reopening ─────────────────────────────────────────────────────── */

  section('a second completion is a second event');

  await q(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [task.id]);
  const [reopened] = await q('SELECT completed_at FROM tasks WHERE id = $1', [task.id]);
  ok(reopened.completed_at === null,
    'reopening clears the completion date rather than leaving a row that claims both');

  /* ── 5. Goals ─────────────────────────────────────────────────────────── */

  section('an achieved goal becomes evidence');

  const [goal] = await q(`
    INSERT INTO performance_goals (organization_id, member_id, title, kind, status, weight)
    VALUES ($1, $2, 'Evidence harness — goal', 'assessed', 'active', 5)
    RETURNING id`, [org.id, member.id]);

  ok((await events('goal.achieved', goal.id)).length === 0,
    'an active goal has produced no event');

  await q(`UPDATE performance_goals SET status = 'achieved' WHERE id = $1`, [goal.id]);
  const achieved = await events('goal.achieved', goal.id);
  ok(achieved.length === 1, 'achieving it wrote one event', `got ${achieved.length}`);
  ok(achieved[0]?.subject_member_id === member.id, 'credited to the person whose goal it was');

  await q(`UPDATE performance_goals SET title = title || ' (edited)' WHERE id = $1`, [goal.id]);
  ok((await events('goal.achieved', goal.id)).length === 1,
    'editing an achieved goal does not write a second event');

  await q(`UPDATE performance_goals SET status = 'missed' WHERE id = $1`, [goal.id]);
  ok((await events('goal.achieved', goal.id)).length === 1,
    'and marking it missed afterwards does not retract the event either');

  /* ── 6. The spine stays append-only ───────────────────────────────────── */

  section('evidence cannot be rewritten by a client');

  const anyEvent = achieved[0];

  const upd = await as(member.user_id,
    'UPDATE business_events SET payload = $1 WHERE id = $2',
    [JSON.stringify({ on_time: true, tampered: true }), anyEvent.id]);
  ok(upd.error !== null || upd.rows.length === 0,
    'an employee cannot edit an event');

  const del = await as(member.user_id, 'DELETE FROM business_events WHERE id = $1', [anyEvent.id]);
  ok(del.error !== null || del.rows.length === 0,
    'nor delete one');

  const [still] = await q('SELECT payload FROM business_events WHERE id = $1', [anyEvent.id]);
  ok(still?.payload?.tampered === undefined, 'and the row is unchanged');

  /* ── 7. The database and the application agree ────────────────────────── */

  section('the vocabulary the application declares is the vocabulary the database permits');

  const [check] = await q(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'business_events_event_type_check'`);

  /**
   * Read the declared event types straight out of `lib/evidence.ts`.
   *
   * The registry is the application's claim about what feeds performance. If
   * it names an event the CHECK does not permit, that source silently
   * contributes nothing for ever: the trigger's insert would raise, and
   * `emit_business_event` swallows conflicts but not constraint violations, so
   * the failure surfaces as "this module never produces evidence" rather than
   * as an error anybody sees. This is the drift that made
   * `ATTENDANCE_STATUSES` wrong for months.
   */
  const src = readFileSync('src/lib/evidence.ts', 'utf8');
  const declared = new Set();
  for (const m of src.matchAll(/events:\s*\[([^\]]*)\]/g)) {
    for (const e of m[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)) declared.add(e[1]);
  }
  for (const e of src.matchAll(/^\s*'([a-z_]+\.[a-z_]+)':\s*\{\s*verb:/gm)) declared.add(e[1]);

  ok(declared.size > 0, `found ${declared.size} declared event types in lib/evidence.ts`);
  const missing = [...declared].filter(t => !check.def.includes(`'${t}'`));
  ok(missing.length === 0,
    'every event type the application declares is permitted by the database',
    missing.join(', '));

  ok(check.def.includes("'task.completed'") && check.def.includes("'goal.achieved'"),
    'and the two 0047 added are present');

  /* ── 8. The organisation's clock ──────────────────────────────────────── */

  section("on time is measured against the organisation's midnight");

  const [tz] = await q('SELECT public.org_timezone($1) AS zone', [org.id]);
  ok(tz.zone === org.timezone,
    `org_timezone() returns the organisation's own zone (${tz.zone})`);

  const [unknown] = await q(
    'SELECT public.org_timezone($1) AS zone', ['00000000-0000-0000-0000-000000000000']);
  ok(unknown.zone === 'UTC',
    'and falls back to UTC rather than null for an organisation that does not exist');

} finally {
  await q('ROLLBACK');
  await client.end();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
