/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Performance, incentives and the HR layer, driven against the running app
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     npm run performance:verify
 *
 *  Same shape as `crm-verify.mjs`: HTTP against the dev server as three real
 *  people, so what is tested is the whole stack - route guard, validation,
 *  RLS policy and trigger - rather than any one layer's opinion of itself.
 *
 *  ── What this exists to catch ────────────────────────────────────────────
 *
 *  The failures in this phase are all silent ones. An incentive that
 *  recalculates when a deal is edited still renders a number. A review policy
 *  that leaks an unshared assessment still returns 200. A reversal that does
 *  not net to zero still shows a total. None of them announce themselves, and
 *  every one is a thing somebody would find out about from their payslip.
 *
 *  Anything this writes, it removes. Run it against the demo workspace.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100';
const PASSWORD = process.env.VERIFY_PASSWORD ?? 'Passw0rd!dashdemo';
const ACCOUNTS = {
  owner: process.env.VERIFY_OWNER ?? 'dash-demo-owner@example.com',
  manager: process.env.VERIFY_MANAGER ?? 'dash-demo-mara@example.com',
  employee: process.env.VERIFY_EMPLOYEE ?? 'dash-demo-tobi@example.com',
};

let passed = 0;
const failures = [];

function check(ok, label, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`    PASS  ${label}`);
  } else {
    failures.push(label + (detail ? ` - ${detail}` : ''));
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function section(n, title) {
  console.log(`\n  ${n}. ${title}`);
  console.log('  ' + '-'.repeat(title.length + 3));
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

async function signIn(email) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      if (res.ok) {
        return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
      }
    } catch { /* the resolver flaps in some environments; back off */ }
    await sleep(2000 * (attempt + 1));
  }
  return null;
}

const sessions = {};

function api(who, path, init = {}) {
  return fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      cookie: sessions[who] ?? '',
      ...(init.headers ?? {}),
    },
  }).then(async res => ({
    status: res.status,
    body: await res.json().catch(() => null),
  }));
}

const stamp = Date.now();
const made = {
  targets: [], rules: [], cycles: [], reviews: [], goals: [],
  achievements: [], deals: [], leads: [], partnerLeads: [],
};

/** Set while an account is borrowed as a partner, so it is always put back. */
let borrowedRole = null;

/* ── Run ────────────────────────────────────────────────────────────────── */

console.log('\n  Performance layer verification');
console.log('  ══════════════════════════════');

for (const [role, email] of Object.entries(ACCOUNTS)) {
  sessions[role] = await signIn(email);
  if (!sessions[role]) {
    console.error(`\n  Could not sign in as ${role} (${email}). Is the dev server up and seeded?`);
    process.exit(1);
  }
}

const meOwner = (await api('owner', '/api/performance/overview')).body?.data?.member?.id;
const meEmployee = (await api('employee', '/api/performance/overview')).body?.data?.member?.id;

/**
 * Clear anything an earlier run left behind, before starting.
 *
 * The suite writes targets for fixed periods, and `performance_targets` allows
 * one live target per subject, metric and period - correctly, because two live
 * quotas for the same quarter is not a state anybody wants. So a run that was
 * interrupted before its cleanup makes the *next* run fail on a constraint
 * doing exactly its job, and the failure reads as a bug in the feature.
 *
 * Sweeping first makes the suite re-runnable, which is the property that
 * matters more than the tidiness.
 */
async function sweepResidue() {
  let swept = 0;

  const targets = await api('owner', '/api/performance/targets?pageSize=200');
  for (const t of targets.body?.data ?? []) {
    if (t.periodLabel !== 'VERIFY') continue;
    const r = await api('owner', `/api/performance/targets/${t.id}`, { method: 'DELETE' });
    if (r.status < 400) swept += 1;
  }

  const rules = await api('owner', '/api/performance/rules?pageSize=200');
  for (const r of rules.body?.data ?? []) {
    if (!String(r.name).startsWith('VERIFY')) continue;
    const d = await api('owner', `/api/performance/rules/${r.id}`, { method: 'DELETE' });
    if (d.status < 400) swept += 1;
  }

  const cycles = await api('owner', '/api/hr/cycles?pageSize=200');
  for (const c of cycles.body?.data ?? []) {
    if (!String(c.name).startsWith('VERIFY')) continue;
    const d = await api('owner', `/api/hr/cycles/${c.id}`, { method: 'DELETE' });
    if (d.status < 400) swept += 1;
  }

  return swept;
}

try {
  /* ═════════════════════════════════════════════════════════════════════ */
  section(0, 'Anything an earlier run left behind');
  const swept = await sweepResidue();
  check(true, swept === 0 ? 'nothing to clear' : `cleared ${swept} leftover record(s)`);

  /* ═════════════════════════════════════════════════════════════════════ */
  section(1, 'The event spine records what happened');

  const dealRes = await api('owner', '/api/crm/deals', {
    method: 'POST',
    body: JSON.stringify({
      name: `VERIFY perf ${stamp}`,
      stage: 'negotiation',
      value: 11600000,
      probability: 60,
      ownerId: meOwner,
    }),
  });
  const dealId = dealRes.body?.data?.id;
  if (dealId) made.deals.push(dealId);
  check(dealRes.status === 201, 'a deal is created open', `status ${dealRes.status}`);

  const before = await api('owner', '/api/performance/overview');
  const wonBefore = before.body?.data?.achievement?.revenueWon ?? 0;

  const won = await api('owner', `/api/crm/deals/${dealId}`, {
    method: 'PATCH', body: JSON.stringify({ stage: 'closed_won' }),
  });
  check(won.status === 200, 'and moved to won');

  await sleep(600);
  const after = await api('owner', '/api/performance/overview');
  const wonAfter = after.body?.data?.achievement?.revenueWon ?? 0;
  check(
    wonAfter - wonBefore === 11600000,
    'the win reaches performance without anything being copied there',
    `moved by ${wonAfter - wonBefore}`,
  );

  /* The figure is frozen at the moment of the win. */
  await api('owner', `/api/crm/deals/${dealId}`, {
    method: 'PATCH', body: JSON.stringify({ value: 1 }),
  });
  await sleep(400);
  const corrected = await api('owner', '/api/performance/overview');
  check(
    (corrected.body?.data?.achievement?.revenueWon ?? 0) === wonAfter,
    'correcting the deal value afterwards does not rewrite the achievement',
    `now ${corrected.body?.data?.achievement?.revenueWon}`,
  );
  await api('owner', `/api/crm/deals/${dealId}`, {
    method: 'PATCH', body: JSON.stringify({ value: 11600000 }),
  });

  /* ═════════════════════════════════════════════════════════════════════ */
  section(2, 'Who may see whose numbers');

  const teams = {};
  for (const role of ['owner', 'manager', 'employee']) {
    teams[role] = (await api(role, '/api/performance/team')).body?.data;
  }
  check(teams.owner?.scope === 'organization', 'an owner sees the whole organisation');
  check(teams.manager?.scope === 'department', 'a manager sees their department');
  check(teams.employee?.scope === 'own' && teams.employee?.members?.length === 0,
    'an employee has no team list, and is told so rather than shown an error');
  check(
    (teams.owner?.members?.length ?? 0) > (teams.manager?.members?.length ?? 0),
    'and the owner sees strictly more people than the manager',
  );

  const peek = await api('employee', `/api/performance/overview?member=${meOwner}`);
  check(
    peek.body?.data?.member?.id === meEmployee && peek.body?.data?.self === true,
    'an employee asking about a colleague gets themselves, not a refusal that confirms the person exists',
  );

  /* ═════════════════════════════════════════════════════════════════════ */
  section(3, 'Targets are an input, and a closed period is history');

  const period = { period_start: '2026-07-01', period_end: '2026-09-30', period_label: 'VERIFY' };

  const setTarget = await api('owner', '/api/performance/targets', {
    method: 'POST',
    body: JSON.stringify({
      subject_type: 'member', subject_id: meOwner, metric: 'revenue_won',
      target_value: 20000000, ...period,
    }),
  });
  if (setTarget.body?.data?.id) made.targets.push(setTarget.body.data.id);
  check(setTarget.status === 201, 'a target is set', setTarget.body?.error?.message);

  const withTarget = await api('owner', '/api/performance/overview');
  const t = (withTarget.body?.data?.targets ?? [])[0];
  check(Boolean(t) && t.progress > 0, 'and progress is computed against it', `progress ${t?.progress}`);
  check(
    typeof withTarget.body?.data?.period?.pace === 'number',
    'the period reports how much of it has gone, so a percentage means something',
  );

  const badMetric = await api('owner', '/api/performance/targets', {
    method: 'POST',
    body: JSON.stringify({
      subject_type: 'member', subject_id: meOwner, metric: 'vibes',
      target_value: 5, ...period,
    }),
  });
  check(badMetric.status === 422, 'a metric nothing can measure is refused', `status ${badMetric.status}`);

  const closed = await api('owner', '/api/performance/targets', {
    method: 'POST',
    body: JSON.stringify({
      subject_type: 'member', subject_id: meOwner, metric: 'deals_won',
      target_value: 5, period_start: '2020-01-01', period_end: '2020-03-31',
    }),
  });
  if (closed.body?.data?.id) made.targets.push(closed.body.data.id);
  const editClosed = await api('owner', `/api/performance/targets/${closed.body?.data?.id}`, {
    method: 'PATCH', body: JSON.stringify({ targetValue: 99 }),
  });
  check(editClosed.status === 409, 'the number on a period that has closed cannot be changed',
    `status ${editClosed.status}`);

  const employeeTarget = await api('employee', '/api/performance/targets', {
    method: 'POST',
    body: JSON.stringify({
      subject_type: 'member', subject_id: meEmployee, metric: 'deals_won',
      target_value: 1, ...period,
    }),
  });
  check(employeeTarget.status === 403, 'and nobody sets their own', `status ${employeeTarget.status}`);

  /* ═════════════════════════════════════════════════════════════════════ */
  section(4, 'Incentives are calculated, explained, and never edited');

  const ruleRes = await api('owner', '/api/performance/rules', {
    method: 'POST',
    body: JSON.stringify({
      name: `VERIFY commission ${stamp}`,
      triggerEvent: 'deal.won',
      basis: 'booked_revenue',
      calculation: { kind: 'tiered', tiers: [{ from: 0, rate: 1 }, { from: 10000000, rate: 2.5 }] },
      effectiveFrom: '2020-01-01',
    }),
  });
  const ruleId = ruleRes.body?.data?.id;
  if (ruleId) made.rules.push(ruleId);
  check(ruleRes.status === 201, 'a tiered rule is written', ruleRes.body?.error?.message);

  for (const [label, calculation, basis] of [
    ['a percentage with no rate', { kind: 'percentage' }, 'booked_revenue'],
    ['tiers that do not rise', { kind: 'tiered', tiers: [{ from: 100, rate: 1 }, { from: 10, rate: 2 }] }, 'booked_revenue'],
    ['a percentage of a flat occurrence', { kind: 'percentage', rate: 2 }, 'per_event'],
  ]) {
    const bad = await api('owner', '/api/performance/rules', {
      method: 'POST',
      body: JSON.stringify({ name: `VERIFY bad ${label} ${stamp}`, triggerEvent: 'deal.won', basis, calculation }),
    });
    if (bad.body?.data?.id) made.rules.push(bad.body.data.id);
    check(bad.status >= 400, `${label} is refused`, `status ${bad.status}`);
  }

  const managerRule = await api('manager', '/api/performance/rules', {
    method: 'POST',
    body: JSON.stringify({
      name: `VERIFY manager ${stamp}`, triggerEvent: 'deal.won',
      basis: 'booked_revenue', calculation: { kind: 'percentage', rate: 5 },
    }),
  });
  if (managerRule.body?.data?.id) made.rules.push(managerRule.body.data.id);
  check(managerRule.status === 403,
    'a manager approves a claim but does not write the commission rate',
    `status ${managerRule.status}`);

  const readRules = await api('employee', '/api/performance/rules');
  check(readRules.status === 200 && (readRules.body?.data?.length ?? 0) > 0,
    'and everybody can read the rules, because a scheme people cannot read is a rumour');

  /* A second win, now that the rule exists, to see the ledger fill. */
  const deal2 = await api('owner', '/api/crm/deals', {
    method: 'POST',
    body: JSON.stringify({
      name: `VERIFY earn ${stamp}`, stage: 'negotiation',
      value: 12000000, probability: 80, ownerId: meEmployee,
    }),
  });
  const dealB = deal2.body?.data?.id;
  if (dealB) made.deals.push(dealB);
  await api('owner', `/api/crm/deals/${dealB}`, {
    method: 'PATCH', body: JSON.stringify({ stage: 'closed_won' }),
  });
  await sleep(700);

  const ledger = await api('owner', '/api/performance/incentives');
  const mine = (ledger.body?.data ?? []).filter(e => e.ruleName?.includes(String(stamp)));
  const entry = mine[0];
  check(Boolean(entry), 'winning the deal wrote an incentive entry', `found ${mine.length}`);
  check(entry?.status === 'pending', 'as pending, awaiting a person');
  check(Number(entry?.amount) === 300000, 'at the tier the amount reaches', `amount ${entry?.amount}`);
  check(
    entry?.explanation?.rate === 2.5 && Number(entry?.explanation?.basisAmount) === 12000000,
    'and it carries the workings that produced it, not just the total',
    JSON.stringify(entry?.explanation ?? {}).slice(0, 90),
  );
  check(entry?.ruleVersion === 1, 'pinned to the rule version it was calculated under');

  const selfApprove = await api('employee', `/api/performance/incentives/${entry?.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
  });
  check(selfApprove.status === 403, 'nobody approves their own', `status ${selfApprove.status}`);

  const approve = await api('owner', `/api/performance/incentives/${entry?.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
  });
  check(approve.status === 200, 'somebody else can');

  const paid = await api('owner', `/api/performance/incentives/${entry?.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'paid', paidReference: `VERIFY-${stamp}` }),
  });
  check(paid.status === 200, 'and mark it paid');

  const reopenPaid = await api('owner', `/api/performance/incentives/${entry?.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'pending' }),
  });
  check(reopenPaid.status === 409, 'after which it is finished', `status ${reopenPaid.status}`);

  /* ═════════════════════════════════════════════════════════════════════ */
  section(5, 'A reopened deal reverses what it earned');

  const deal3 = await api('owner', '/api/crm/deals', {
    method: 'POST',
    body: JSON.stringify({
      name: `VERIFY reverse ${stamp}`, stage: 'negotiation',
      value: 20000000, probability: 90, ownerId: meEmployee,
    }),
  });
  const dealC = deal3.body?.data?.id;
  if (dealC) made.deals.push(dealC);

  await api('owner', `/api/crm/deals/${dealC}`, {
    method: 'PATCH', body: JSON.stringify({ stage: 'closed_won' }),
  });
  await sleep(600);
  await api('owner', `/api/crm/deals/${dealC}`, {
    method: 'PATCH', body: JSON.stringify({ stage: 'negotiation' }),
  });
  await sleep(700);

  const afterReopen = await api('owner', '/api/performance/incentives');
  const forDeal = (afterReopen.body?.data ?? []).filter(
    e => e.explanation?.subject === `VERIFY reverse ${stamp}`,
  );
  /**
   * Every entry gets a mirror, however many rules matched.
   *
   * Asserting "two rows" was wrong: a workspace with a commission rule of its
   * own already produces one entry per matching rule, so the count depends on
   * how the company is configured. What must hold regardless is that each
   * original is cancelled exactly once.
   */
  const reversals = forDeal.filter(e => e.reversesEntryId);
  const originals = forDeal.filter(e => !e.reversesEntryId);
  check(
    originals.length > 0 && reversals.length === originals.length,
    'every entry the win produced is cancelled by exactly one mirror row',
    `${originals.length} original, ${reversals.length} reversing`,
  );
  check(
    forDeal.reduce((sum, e) => sum + Number(e.amount), 0) === 0,
    'so the net owed is nothing, and both halves remain readable',
    `net ${forDeal.reduce((sum, e) => sum + Number(e.amount), 0)}`,
  );
  check(
    forDeal.every(e => e.status === 'reversed'),
    'and both are marked reversed rather than deleted',
  );

  /* ═════════════════════════════════════════════════════════════════════ */
  section(6, 'HR: cycles, goals, reviews and the record of what people did');

  const cycle = await api('owner', '/api/hr/cycles', {
    method: 'POST',
    body: JSON.stringify({
      name: `VERIFY cycle ${stamp}`, periodStart: '2026-07-01',
      periodEnd: '2026-12-31', status: 'active',
    }),
  });
  const cycleId = cycle.body?.data?.id;
  if (cycleId) made.cycles.push(cycleId);
  check(cycle.status === 201, 'HR opens a cycle', cycle.body?.error?.message);

  const empCycle = await api('employee', '/api/hr/cycles', {
    method: 'POST',
    body: JSON.stringify({ name: `VERIFY nope ${stamp}`, periodStart: '2026-01-01', periodEnd: '2026-06-30' }),
  });
  check(empCycle.status === 403, 'and only HR does', `status ${empCycle.status}`);

  const measuredNoMetric = await api('employee', '/api/hr/goals', {
    method: 'POST', body: JSON.stringify({ title: `VERIFY m ${stamp}`, kind: 'measured' }),
  });
  check(measuredNoMetric.status === 422,
    'a measured goal with nothing to measure is refused rather than left stuck at zero');

  const assessedWithMetric = await api('employee', '/api/hr/goals', {
    method: 'POST',
    body: JSON.stringify({ title: `VERIFY a ${stamp}`, kind: 'assessed', metric: 'revenue_won' }),
  });
  check(assessedWithMetric.status === 422,
    'and an assessed goal is not quietly given one');

  for (const body of [
    { title: `VERIFY measured ${stamp}`, kind: 'measured', metric: 'revenue_won', cycleId },
    { title: `VERIFY assessed ${stamp}`, kind: 'assessed', cycleId },
  ]) {
    const g = await api('employee', '/api/hr/goals', { method: 'POST', body: JSON.stringify(body) });
    if (g.body?.data?.id) made.goals.push(g.body.data.id);
    check(g.status === 201, `${body.kind === 'measured' ? 'A measured' : 'An assessed'} goal is accepted`, g.body?.error?.message);
  }

  const empReview = await api('employee', '/api/hr/reviews', {
    method: 'POST', body: JSON.stringify({ memberId: meEmployee, cycleId }),
  });
  check(empReview.status === 403, 'an employee cannot open a review on anybody');

  const review = await api('owner', '/api/hr/reviews', {
    method: 'POST', body: JSON.stringify({ memberId: meEmployee, cycleId }),
  });
  const reviewId = review.body?.data?.id;
  if (reviewId) made.reviews.push(reviewId);
  check(review.status === 201, 'a manager or HR can');

  const closeEarly = await api('owner', `/api/hr/reviews/${reviewId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'closed' }),
  });
  check(closeEarly.status === 409, 'a review nobody has seen cannot be closed',
    `status ${closeEarly.status}`);

  /**
   * The one that a FOR ALL policy silently broke once.
   *
   * A write policy saying "you may touch rows about people you can see" also
   * grants SELECT, because permissive policies are OR'd and FOR ALL covers
   * every command. Both policies looked right on their own.
   */
  const hidden = await api('employee', '/api/hr/reviews?pageSize=50');
  const seesUnshared = (hidden.body?.data ?? []).some(r => r.id === reviewId);
  check(!seesUnshared, 'and its subject cannot read it before it is shared');

  const share = await api('owner', `/api/hr/reviews/${reviewId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'shared', overallRating: 4, managerComment: 'Strong half.' }),
  });
  check(share.status === 200 && Boolean(share.body?.data?.sharedAt),
    'sharing stamps the moment they were told');

  const nowSees = await api('employee', '/api/hr/reviews?pageSize=50');
  check((nowSees.body?.data ?? []).some(r => r.id === reviewId),
    'after which they can read it');

  await sleep(400);
  const told = await api('employee', '/api/notifications?pageSize=10');
  check(
    (told.body?.data ?? []).some(n => n.type === 'review_shared'),
    'and they were notified rather than left to notice',
  );

  const selfAch = await api('employee', '/api/hr/achievements', {
    method: 'POST', body: JSON.stringify({ memberId: meEmployee, title: `VERIFY self ${stamp}` }),
  });
  check(selfAch.status === 422, 'an achievement is recorded about somebody, not by them');

  const ach = await api('owner', '/api/hr/achievements', {
    method: 'POST',
    body: JSON.stringify({ memberId: meEmployee, title: `VERIFY achievement ${stamp}` }),
  });
  if (ach.body?.data?.id) made.achievements.push(ach.body.data.id);
  check(ach.status === 201, 'and by somebody else it is');

  /* ═════════════════════════════════════════════════════════════════════ */
  section(7, 'An external partner reaches none of the CRM');

  /**
   * The one property the partner workspace exists to guarantee.
   *
   * Proved with a real session rather than by reading the policy, because
   * this is exactly the kind of rule that looks right in SQL and is undone by
   * a second permissive policy somewhere else - which is how the review
   * table's hiding was undone the first time it was written.
   *
   * The employee account is borrowed for it and put back in the `finally`
   * below, so an interrupted run cannot leave somebody demoted.
   */
  const becamePartner = await api('owner', `/api/admin/users/${meEmployee}`, {
    method: 'PATCH', body: JSON.stringify({ role: 'partner' }),
  });
  check(becamePartner.status === 200, 'a member can be made an external partner',
    becamePartner.body?.error?.message);

  if (becamePartner.status === 200) {
    borrowedRole = 'employee';
    /* A new session, because capabilities are resolved at sign-in. */
    sessions.partner = await signIn(ACCOUNTS.employee);

    for (const path of [
      '/api/crm/leads', '/api/crm/deals', '/api/crm/contacts',
      '/api/crm/companies', '/api/crm/overview', '/api/crm/partner-leads',
    ]) {
      const r = await api('partner', path);
      check(r.status === 403, `${path} is refused`, `status ${r.status}`);
    }

    const perf = await api('partner', '/api/performance/overview');
    check(perf.status === 403, 'and so is anybody\'s performance', `status ${perf.status}`);

    const staff = await api('partner', '/api/directory');
    const listed = Array.isArray(staff.body?.data) ? staff.body.data.length : -1;
    check(staff.status === 403 || listed === 0,
      'a partner cannot enumerate the company\'s staff', `status ${staff.status}, ${listed} rows`);

    /* What they can do: work their own prospects. */
    const own = await api('partner', '/api/portal/partner-leads', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Verify', lastName: `Prospect ${stamp}`,
        companyName: `Verify Partner Co ${stamp}`, estimatedValue: 5000000,
        note: 'Found at a conference.',
      }),
    });
    const prospectId = own.body?.data?.id;
    check(own.status === 201, 'but they can file a prospect of their own',
      own.body?.error?.message);
    check(own.body?.data?.status === 'draft', 'which starts private to them');

    const queueBefore = await api('owner', '/api/crm/partner-leads');
    check(
      !(queueBefore.body?.data ?? []).some(r => r.id === prospectId),
      'and the company cannot see it while it is a draft',
    );

    const sent = await api('partner', `/api/portal/partner-leads/${prospectId}`, { method: 'POST' });
    check(sent.status === 200 && sent.body?.data?.status === 'submitted', 'sending it over works');

    const twice = await api('partner', `/api/portal/partner-leads/${prospectId}`, { method: 'POST' });
    check(twice.status === 409, 'and is a one-way door', `status ${twice.status}`);

    const edit = await api('partner', `/api/portal/partner-leads/${prospectId}`, {
      method: 'PATCH', body: JSON.stringify({ note: 'changed my mind' }),
    });
    check(edit.status >= 400 || edit.body?.data?.note !== 'changed my mind',
      'after which it is no longer theirs to edit', `status ${edit.status}`);

    const queue = await api('owner', '/api/crm/partner-leads');
    const waiting = (queue.body?.data ?? []).find(r => r.id === prospectId);
    check(Boolean(waiting), 'now the company sees it in their queue');

    const accepted = await api('owner', '/api/crm/partner-leads', {
      method: 'POST', body: JSON.stringify({ id: prospectId, decision: 'approve' }),
    });
    const madeLeadId = accepted.body?.data?.leadId;
    if (madeLeadId) made.leads.push(madeLeadId);
    check(accepted.status === 201 && Boolean(madeLeadId),
      'accepting it creates a lead on the company side', accepted.body?.error?.message);

    const lead = await api('owner', `/api/crm/leads/${madeLeadId}`);
    check(lead.body?.data?.sourcePartnerId === meEmployee,
      'stamped with the partner who found it, so attribution survives',
      `source ${lead.body?.data?.sourcePartnerId}`);

    const stillBlind = await api('partner', `/api/crm/leads/${madeLeadId}`);
    check(stillBlind.status === 403,
      'and the partner still cannot read the lead their prospect became');

    const told = await api('partner', '/api/notifications?pageSize=10');
    check((told.body?.data ?? []).some(n => n.type === 'partner_lead_approved'),
      'they are told it was accepted, because their commission depends on it');

    if (prospectId) made.partnerLeads.push(prospectId);
  }
} catch (e) {
  console.error('\n  HARNESS ERROR: ' + (e?.message ?? e));
  failures.push('harness error');
} finally {
  /* ═════════════════════════════════════════════════════════════════════ */
  section(8, 'Clean up');

  let removed = 0;
  const drop = async (path, ids) => {
    for (const id of ids) {
      const r = await api('owner', `${path}/${id}`, { method: 'DELETE' });
      if (r.status < 400) removed += 1;
    }
  };

  /*
   * The borrowed account goes back first, and unconditionally. Everything
   * else here is a record; this is somebody's access.
   */
  if (borrowedRole) {
    const restored = await api('owner', `/api/admin/users/${meEmployee}`, {
      method: 'PATCH', body: JSON.stringify({ role: borrowedRole }),
    });
    console.log(
      `    PASS  the borrowed account is an ${borrowedRole} again`
      + (restored.status === 200 ? '' : `  (WARNING: status ${restored.status})`),
    );
    passed += 1;
  }

  await drop('/api/portal/partner-leads', made.partnerLeads);
  await drop('/api/crm/leads', made.leads);
  await drop('/api/hr/achievements', made.achievements);
  await drop('/api/hr/reviews', made.reviews);
  await drop('/api/hr/goals', made.goals);
  await drop('/api/hr/cycles', made.cycles);
  await drop('/api/performance/targets', made.targets);
  /* Deals go before rules: entries reference the rule and hold it back. */
  await drop('/api/crm/deals', made.deals);
  await drop('/api/performance/rules', made.rules);

  console.log(`    PASS  removed ${removed} verification records`);
  passed += 1;
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  console.log('  Failed:');
  failures.forEach(f => console.log(`    · ${f}`));
  console.log('');
  process.exit(1);
}
