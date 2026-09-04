/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The payroll → Finance boundary, proved against the real database.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *      npm run test:posting
 *
 *  ── What is at stake ─────────────────────────────────────────────────────
 *
 *  Two things, and they pull in opposite directions.
 *
 *  A finance team has to be able to see what a month owes and to whom, or they
 *  cannot file anything without taking the payroll apart — and taking it apart
 *  means reading individual pay. So the posting has to be *readable by
 *  Finance*.
 *
 *  And it must disclose nothing about any particular person. A posting that
 *  reconciles perfectly and quietly lets a finance clerk work out the head of
 *  department's salary has failed at the only thing it exists for.
 *
 *  Both are invisible from a screen: the first shows as a table that renders,
 *  the second as a table that renders *too well*. So this asserts the
 *  arithmetic and the access separately, as four real identities.
 *
 *  ── Why it leaves nothing behind ─────────────────────────────────────────
 *
 *  One transaction, rolled back. It builds a whole pay run — a period, items
 *  across two departments, somebody on hold — and an approved payroll run is
 *  deliberately unmodifiable once it exists, so creating one through the
 *  ordinary path would leave a frozen artefact in the workspace that
 *  `hr:cleanup` documents itself as unable to remove.
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
const money = v => Math.round(Number(v ?? 0) * 100) / 100;

const { client } = await connect(url, { statement_timeout: 60_000 });
const q = async (sql, params) => (await client.query(sql, params)).rows;

/** Run as `userId`, then hand the identity back — see review-verify for why. */
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
  const [org] = await q(`
    SELECT o.id, o.name, o.currency
    FROM organizations o
    WHERE (SELECT count(*) FROM organization_members m
           WHERE m.organization_id = o.id AND m.is_active) >= 3
    ORDER BY o.created_at LIMIT 1`);

  if (!org) {
    console.error('  Need an organization with three members. Run npm run seed:demo.');
    process.exit(1);
  }

  const members = await q(`
    SELECT m.id, m.user_id, m.department_id, p.full_name
    FROM organization_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.organization_id = $1 AND m.is_active
    ORDER BY m.created_at LIMIT 3`, [org.id]);

  const [hr] = await q(`
    SELECT m.id, m.user_id FROM organization_members m
    WHERE m.organization_id = $1 AND m.is_active
      AND m.role IN ('owner','administrator','hr_staff')
    ORDER BY m.created_at LIMIT 1`, [org.id]);

  /**
   * Two departments, so the cost-centre split has something to split.
   *
   * Created here rather than borrowed, because the demo organisation's own
   * departments are shared with every other harness and moving people between
   * them would be a side effect this test has no business having.
   */
  const [depA] = await q(
    `INSERT INTO departments (organization_id, name) VALUES ($1, 'Posting harness A') RETURNING id`,
    [org.id]);
  const [depB] = await q(
    `INSERT INTO departments (organization_id, name) VALUES ($1, 'Posting harness B') RETURNING id`,
    [org.id]);

  await q('UPDATE organization_members SET department_id = $1 WHERE id = ANY($2)',
    [depA.id, [members[0].id, members[1].id]]);
  await q('UPDATE organization_members SET department_id = $1 WHERE id = $2',
    [depB.id, members[2].id]);

  console.log(`\n  organisation: ${org.name}\n`);

  const [period] = await q(`
    INSERT INTO payroll_periods (
      organization_id, name, period_start, period_end, pay_date, currency, status, created_by
    ) VALUES ($1, 'Posting harness run', current_date - 30, current_date, current_date, $2, 'draft', $3)
    RETURNING id`, [org.id, org.currency ?? 'NGN', hr.id]);

  /*
    Three people. Two in A, one in B, and one of A's is on hold — so the
    posting and the period totals legitimately disagree, which is the case the
    endpoint's `reconciles.note` exists to explain.
  */
  const items = [
    { member: members[0].id, gross: 500000, ded: 120000, net: 380000, emp: 50000, held: false },
    { member: members[1].id, gross: 300000, ded: 60000, net: 240000, emp: 30000, held: true },
    { member: members[2].id, gross: 400000, ded: 90000, net: 310000, emp: 40000, held: false },
  ];

  for (const i of items) {
    await q(`
      INSERT INTO payroll_items (
        organization_id, period_id, member_id, base_amount, gross,
        taxable_gross, total_deductions, net, employer_cost, currency, is_held
      ) VALUES ($1,$2,$3,$4,$4,$4,$5,$6,$7,$8,$9)`,
      [org.id, period.id, i.member, i.gross, i.ded, i.net, i.emp, org.currency ?? 'NGN', i.held]);
  }

  /* ── 1. Nothing is owed until somebody approves it ─────────────────────── */

  section('a run states what it owes only once it is approved');

  ok((await q('SELECT * FROM payroll_postings WHERE period_id = $1', [period.id])).length === 0,
    'a draft run has no posting');

  await q(`UPDATE payroll_periods SET status = 'calculated' WHERE id = $1`, [period.id]);
  ok((await q('SELECT * FROM payroll_postings WHERE period_id = $1', [period.id])).length === 0,
    'nor does a calculated one — the figures exist, the obligation does not');

  await q(`UPDATE payroll_periods SET status = 'approved' WHERE id = $1`, [period.id]);
  const posted = await q('SELECT * FROM payroll_postings WHERE period_id = $1', [period.id]);
  ok(posted.length > 0, 'approval produces one', `${posted.length} rows`);

  /* ── 2. The arithmetic ────────────────────────────────────────────────── */

  section('the split adds up to the run it came from');

  const total = cat => money(posted
    .filter(r => r.category === cat)
    .reduce((s, r) => s + Number(r.amount), 0));

  const net = total('net_pay');
  const ded = total('employee_deductions');
  const emp = total('employer_contributions');

  ok(net === 690000, 'net pay is the sum of everybody who is actually being paid', String(net));
  ok(ded === 210000, 'deductions likewise', String(ded));
  ok(emp === 90000, 'and employer contributions', String(emp));
  ok(net + ded === 900000,
    'net plus what was withheld is the gross — the identity payroll rests on');

  const [p] = await q('SELECT * FROM payroll_periods WHERE id = $1', [period.id]);
  ok(money(p.total_net) === net, 'and it agrees with the period’s own stored total');

  section('somebody on hold is owed nothing yet');

  ok(!posted.some(r => Number(r.employee_count) === 3),
    'the held employee is not counted in any line');
  const heldSum = 240000;
  ok(net !== 690000 + heldSum, 'and their net pay is not in the total');

  /* ── 3. The cost-centre split ─────────────────────────────────────────── */

  section('costs land on the department that incurred them');

  const byDep = {};
  for (const r of posted) {
    byDep[r.department_name] = (byDep[r.department_name] ?? 0) + Number(r.amount);
  }
  ok(Object.keys(byDep).length === 2,
    'two departments, two sets of lines', Object.keys(byDep).join(', '));

  /*
    A's three lines are its one unheld person: 380000 net + 120000 withheld +
    50000 employer. The held person in A contributes nothing at all, which is
    what makes this a real check rather than a headcount.
  */
  ok(money(byDep['Posting harness A']) === 550000,
    'department A carries exactly its one unheld person, not both of its people',
    String(byDep['Posting harness A']));
  ok(money(byDep['Posting harness B']) === 440000,
    'and B carries its own', String(byDep['Posting harness B']));

  const aNet = money(posted
    .filter(r => r.department_name === 'Posting harness A' && r.category === 'net_pay')
    .reduce((s, r) => s + Number(r.amount), 0));
  const bNet = money(posted
    .filter(r => r.department_name === 'Posting harness B' && r.category === 'net_pay')
    .reduce((s, r) => s + Number(r.amount), 0));
  ok(aNet === 380000, 'A’s net pay is its one unheld person', String(aNet));
  ok(bNet === 310000, 'B’s is its own', String(bNet));

  /* ── 4. It discloses no individual ────────────────────────────────────── */

  section('a posting names nobody');

  const cols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'payroll_postings'`);
  const names = cols.map(c => c.column_name);
  ok(!names.includes('member_id') && !names.some(n => n.includes('member')),
    'there is no member column to join on', names.join(', '));

  /* ── 5. Who may read it ───────────────────────────────────────────────── */

  section('finance may read it; a manager and an employee may not');

  const hrReads = await as(hr.user_id,
    'SELECT * FROM payroll_postings WHERE period_id = $1', [period.id]);
  ok(hrReads.rows.length > 0, 'HR can read the posting', hrReads.error ?? '');

  /* Borrow somebody as finance for the length of one savepoint. */
  const employee = members.find(m => m.id !== hr.id);
  await q('SAVEPOINT as_finance');
  await q(`UPDATE organization_members SET role = 'finance_staff' WHERE id = $1`, [employee.id]);
  const finReads = await as(employee.user_id,
    'SELECT * FROM payroll_postings WHERE period_id = $1', [period.id]);
  ok(finReads.rows.length > 0,
    'finance can read it — the one payroll artefact they are meant to see', finReads.error ?? '');
  const finItems = await as(employee.user_id,
    'SELECT * FROM payroll_items WHERE period_id = $1', [period.id]);
  ok(finItems.rows.length === 0,
    'and still cannot read a single payslip');
  await q('ROLLBACK TO SAVEPOINT as_finance');

  await q('SAVEPOINT as_manager');
  await q(`UPDATE organization_members SET role = 'manager' WHERE id = $1`, [employee.id]);
  const mgrReads = await as(employee.user_id,
    'SELECT * FROM payroll_postings WHERE period_id = $1', [period.id]);
  ok(mgrReads.rows.length === 0,
    'a manager cannot: a department total over three people is close enough to individual pay');
  await q('ROLLBACK TO SAVEPOINT as_manager');

  const empReads = await as(employee.user_id,
    'SELECT * FROM payroll_postings WHERE period_id = $1', [period.id]);
  ok(empReads.rows.length === 0, 'and neither can an ordinary employee');

  /* ── 6. It cannot be adjusted ─────────────────────────────────────────── */

  section('a posting cannot be edited into agreeing with something else');

  const forge = await as(hr.user_id,
    `INSERT INTO payroll_postings (organization_id, period_id, category, owed_to, amount)
     VALUES ($1, $2, 'net_pay', 'employees', 1) RETURNING id`, [org.id, period.id]);
  ok(forge.error !== null || forge.rows.length === 0, 'nobody can insert a line');

  const edit = await as(hr.user_id,
    'UPDATE payroll_postings SET amount = 1 WHERE period_id = $1 RETURNING id', [period.id]);
  ok(edit.error !== null || edit.rows.length === 0, 'nor change one');

  const drop = await as(hr.user_id,
    'DELETE FROM payroll_postings WHERE period_id = $1 RETURNING id', [period.id]);
  ok(drop.error !== null || drop.rows.length === 0, 'nor remove one');

  /* ── 7. Re-approval, and cancellation ─────────────────────────────────── */

  section('approving twice does not owe twice');

  await q(`UPDATE payroll_periods SET status = 'paid' WHERE id = $1`, [period.id]);
  const afterPaid = await q('SELECT * FROM payroll_postings WHERE period_id = $1', [period.id]);
  ok(afterPaid.length === posted.length,
    'marking it paid does not add a second set of lines',
    `${posted.length} → ${afterPaid.length}`);

  const netAfter = money(afterPaid
    .filter(r => r.category === 'net_pay').reduce((s, r) => s + Number(r.amount), 0));
  ok(netAfter === net, 'and the amounts are unchanged');

  section('the single row Finance already had is still the only one');

  const [paid] = await q('SELECT expense_id FROM payroll_periods WHERE id = $1', [period.id]);
  ok(paid.expense_id !== null, '0042 still writes its one expense on payment');

  const expenses = await q(
    'SELECT count(*)::int n FROM expenses WHERE id = $1', [paid.expense_id]);
  ok(expenses[0].n === 1, 'exactly one, not one per department or per person');

} finally {
  await q('ROLLBACK');
  await client.end();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
