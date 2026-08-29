/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CRM, end to end, against the running application
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     APP_URL=http://localhost:3100 node scripts/crm-verify.mjs
 *
 * ── Why a harness of its own ──────────────────────────────────────────────
 *
 * `app:verify` proves the shared route factories work. Phase 4 added things
 * those factories do not cover and that no screen test would catch either: a
 * trigger that stamps a close date, a trigger that records where a deal has
 * been, a conversion that writes four records in one call, and an import whose
 * whole value is what it declines to do. Each of those fails quietly - the
 * request succeeds and the data is subtly wrong - which is exactly the class
 * of defect this repository keeps finding late.
 *
 * It signs in as the seeded demo owner and drives the real HTTP API, so the
 * path under test is cookie session → route → RLS → Postgres → trigger.
 * Everything it creates, it deletes.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:3100';
const EMAIL = process.env.CRM_USER ?? 'dash-demo-owner@example.com';
const PASSWORD = process.env.CRM_PASS ?? 'Passw0rd!dashdemo';

let pass = 0, fail = 0;
const failed = [];

const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; failed.push(label); console.log(`    FAIL  ${label}${detail ? `  - ${detail}` : ''}`); }
  return ok;
};
const section = t => console.log(`\n  ${t}\n  ${'-'.repeat(t.length)}`);

function client() {
  const jar = new Map();
  return async function call(path, init = {}) {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)
          ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === '') jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not every response is JSON */ }
    return { status: res.status, json, text };
  };
}

const call = client();
const created = { deals: [], leads: [], contacts: [], companies: [], activities: [] };

console.log('\n  CRM verification');
console.log('  ════════════════');
console.log(`  ${BASE} as ${EMAIL}\n`);

/* ── Sign in ─────────────────────────────────────────────────────────────── */

section('1. Session');

{
  const res = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!check(res.status === 200, 'signed in', res.json?.error?.message ?? res.status)) {
    console.log('\n  Cannot continue without a session.\n');
    process.exit(1);
  }
}

/* ── Overview ────────────────────────────────────────────────────────────── */

section('2. Revenue intelligence');

let overview = null;
{
  const res = await call('/api/crm/overview');
  check(res.status === 200, 'GET /api/crm/overview', res.json?.error?.message);
  overview = res.json?.data;

  if (overview) {
    const r = overview.revenue;
    check(typeof r?.pipelineValue === 'number', 'pipeline value is a number');
    check(r.weightedPipeline <= r.pipelineValue + 0.01,
      'weighted pipeline never exceeds the pipeline',
      `${r.weightedPipeline} vs ${r.pipelineValue}`);
    check(r.winRate === null || (r.winRate >= 0 && r.winRate <= 100),
      'win rate is a percentage or absent', String(r.winRate));
    check(Array.isArray(r.byMonth) && r.byMonth.length === 12,
      'twelve months of revenue', String(r.byMonth?.length));

    const stageTotal = overview.stages
      .filter(s => !['closed_won', 'closed_lost'].includes(s.stage))
      .reduce((sum, s) => sum + s.value, 0);
    check(Math.abs(stageTotal - r.pipelineValue) < 0.01,
      'the stage bars add up to the headline pipeline figure',
      `${stageTotal} vs ${r.pipelineValue}`);

    const wonFromMonths = r.byMonth.reduce((sum, m) => sum + m.won, 0);
    check(Math.abs(wonFromMonths - r.wonThisYear) < 0.01,
      'the monthly series adds up to the year figure');

    check(overview.scope === 'organization', 'the scope is reported', overview.scope);
    check(Array.isArray(overview.followups), 'a follow-up queue is returned');
    check(Array.isArray(overview.activityByWeek) && overview.activityByWeek.length === 8,
      'eight weeks of activity volume');
  }
}

/* ── Sorting ─────────────────────────────────────────────────────────────── */

section('3. Sorting actually sorts');

{
  const camel = await call('/api/crm/deals?sort=value&sortDir=desc&pageSize=5');
  const values = (camel.json?.data ?? []).map(d => d.value);
  const sorted = [...values].sort((a, b) => b - a);
  check(JSON.stringify(values) === JSON.stringify(sorted),
    'deals sort by value descending', JSON.stringify(values));

  const byCamelColumn = await call('/api/crm/leads?sort=estimatedValue&sortDir=desc&pageSize=5');
  const lv = (byCamelColumn.json?.data ?? []).map(l => l.estimatedValue);
  const ls = [...lv].sort((a, b) => b - a);
  check(JSON.stringify(lv) === JSON.stringify(ls),
    'a camelCase sort key is honoured rather than silently ignored', JSON.stringify(lv));
}

/* ── Deal lifecycle ──────────────────────────────────────────────────────── */

section('4. Deal movement, closure and history');

let dealId = null;
{
  const res = await call('/api/crm/deals', {
    method: 'POST',
    body: JSON.stringify({ name: 'Verification deal', value: 1000, stage: 'prospecting', probability: 30 }),
  });
  check(res.status === 201, 'a deal is created', res.json?.error?.message);
  dealId = res.json?.data?.id;
  if (dealId) created.deals.push(dealId);
  check(res.json?.data?.closedAt == null, 'a new open deal has no close date');
}

if (dealId) {
  const moved = await call(`/api/crm/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stage: 'negotiation' }),
  });
  check(moved.status === 200, 'the deal moves stage', moved.json?.error?.message);
  check(moved.json?.data?.closedAt == null, 'moving between open stages sets no close date');

  const won = await call(`/api/crm/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stage: 'closed_won' }),
  });
  check(won.status === 200, 'the deal is marked won');
  check(Boolean(won.json?.data?.closedAt),
    'closing stamps closed_at without the client sending one', String(won.json?.data?.closedAt));

  const lost = await call(`/api/crm/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stage: 'closed_lost', lostReason: 'Went with a competitor' }),
  });
  check(lost.json?.data?.lostReason === 'Went with a competitor',
    'a lost reason can be recorded', String(lost.json?.data?.lostReason));

  const reopened = await call(`/api/crm/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stage: 'proposal' }),
  });
  check(reopened.json?.data?.closedAt == null, 'reopening clears the close date');
  check(reopened.json?.data?.lostReason == null, 'and clears the lost reason');
}

/* ── Follow-ups ──────────────────────────────────────────────────────────── */

section('5. Follow-ups');

{
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const overdue = await call('/api/crm/activities', {
    method: 'POST',
    body: JSON.stringify({
      activityType: 'call', subject: 'Verification follow-up',
      dealId, dueAt: yesterday, remindAt: yesterday,
    }),
  });
  check(overdue.status === 201, 'a follow-up is created with a due date and a reminder',
    overdue.json?.error?.message);
  const actId = overdue.json?.data?.id;
  if (actId) created.activities.push(actId);
  check(Boolean(overdue.json?.data?.remindAt), 'the reminder time is stored');

  const list = await call('/api/crm/activities?due=overdue&mine=true&pageSize=50');
  check((list.json?.data ?? []).some(a => a.id === actId),
    'it appears in the overdue queue', String(list.status));

  const upcoming = await call('/api/crm/activities?due=upcoming&mine=true&pageSize=50');
  check(!(upcoming.json?.data ?? []).some(a => a.id === actId),
    'and not in the upcoming one');

  const swept = await call('/api/crm/followups/sweep', { method: 'POST' });
  check(swept.status === 200, 'the reminder sweep runs', swept.json?.error?.message);
  check(swept.json?.data?.available === true, 'and the database function is present');

  if (actId) {
    const done = await call(`/api/crm/activities/${actId}`, {
      method: 'PATCH',
      body: JSON.stringify({ completedAt: new Date().toISOString() }),
    });
    check(done.status === 200, 'a follow-up can be completed', done.json?.error?.message);

    const after = await call('/api/crm/activities?due=overdue&mine=true&pageSize=50');
    check(!(after.json?.data ?? []).some(a => a.id === actId),
      'and leaves the overdue queue when it is');
  }
}

/* ── Lead conversion ─────────────────────────────────────────────────────── */

section('6. Lead conversion');

{
  const stamp = Date.now();
  const lead = await call('/api/crm/leads', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Verify', lastName: `Person${stamp}`,
      email: `verify${stamp}@example.test`,
      companyName: `Verify Holdings ${stamp} Ltd`,
      estimatedValue: 250000, score: 70,
    }),
  });
  check(lead.status === 201, 'a lead is created', lead.json?.error?.message);
  const leadId = lead.json?.data?.id;
  if (leadId) created.leads.push(leadId);

  if (leadId) {
    const conv = await call(`/api/crm/leads/${leadId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ createDeal: true }),
    });
    check(conv.status === 200, 'the lead converts', conv.json?.error?.message);

    const d = conv.json?.data;
    check(Boolean(d?.contact?.id), 'a contact is created');
    check(Boolean(d?.company?.id), 'a company is created');
    check(Boolean(d?.deal?.id), 'a deal is opened');
    check(d?.contact?.companyId === d?.company?.id, 'the contact is attached to the company');
    check(d?.deal?.value === 250000, 'the deal takes the estimated value', String(d?.deal?.value));
    check(d?.deal?.probability === 70, 'and the probability comes from the lead score',
      String(d?.deal?.probability));
    check(d?.lead?.convertedContactId === d?.contact?.id, 'the lead records what it became');
    check(d?.lead?.status === 'won', 'and is marked won');

    if (d?.contact?.id) created.contacts.push(d.contact.id);
    if (d?.company?.id) created.companies.push(d.company.id);
    if (d?.deal?.id) created.deals.push(d.deal.id);

    const again = await call(`/api/crm/leads/${leadId}/convert`, { method: 'POST' });
    check(again.json?.meta?.alreadyConverted === true,
      'converting twice returns the first contact rather than a second one');

    const timeline = await call(`/api/crm/activities?companyId=${d?.company?.id}&pageSize=10`);
    check((timeline.json?.data ?? []).some(a => a.subject === 'Lead converted'),
      'the conversion is on the customer timeline');
  }
}

/* ── Import ──────────────────────────────────────────────────────────────── */

section('7. Import Center');

{
  const stamp = Date.now();
  const csv = [
    'Business Name,Contact Person,Email Address,Mobile,Web Address,Sector,Estimated Value',
    `Import Alpha ${stamp} Ltd,Ada Lovelace,ada${stamp}@import.test,+234 801 111 1111,alpha${stamp}.test,Software,"1,500,000"`,
    `Import Alpha ${stamp} Limited,Alan Turing,alan${stamp}@import.test,+234 802 222 2222,,Software,₦2.5m`,
    `,,not-an-email,,,,`,
    `Import Beta ${stamp} Ltd,,,,beta${stamp}.test,Logistics,`,
  ].join('\n');

  const analyze = await call('/api/crm/import/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv', 'x-filename': 'verify.csv' },
    body: Buffer.from(csv),
  });
  check(analyze.status === 200, 'the file is read', analyze.json?.error?.message);

  const cols = analyze.json?.data?.columns ?? [];
  const mapped = Object.fromEntries(cols.filter(c => c.field).map(c => [c.field, c.index]));
  check(mapped.companyName === 0, 'Business Name maps to the company');
  check(mapped.fullName === 1, 'Contact Person maps to the person');
  check(mapped.email === 2, 'Email Address maps to the email');
  check(analyze.json?.data?.rowCount === 4, 'four data rows', String(analyze.json?.data?.rowCount));

  const rows = analyze.json?.data?.rows ?? [];

  const preview = await call('/api/crm/import/preview', {
    method: 'POST',
    body: JSON.stringify({ rows, mapping: mapped, target: 'leads' }),
  });
  check(preview.status === 200, 'the import is previewed', preview.json?.error?.message);

  const plan = preview.json?.data;
  check(plan?.summary?.total === 4, 'every row is accounted for');
  check(plan?.rows?.[2]?.action === 'skip', 'the empty row is skipped');
  check(plan?.rows?.[2]?.candidate?.problems?.some(p => p.severity === 'error'),
    'and says why');
  check(plan?.summary?.companiesCreated === 2,
    'two companies, because Ltd and Limited are one customer',
    String(plan?.summary?.companiesCreated));
  check(plan?.rows?.[0]?.candidate?.person?.estimatedValue === 1500000,
    'a quoted thousands-separated value is read',
    String(plan?.rows?.[0]?.candidate?.person?.estimatedValue));
  check(plan?.rows?.[1]?.candidate?.person?.estimatedValue === 2500000,
    'and so is a currency symbol with a magnitude suffix');

  const commit = await call('/api/crm/import/commit', {
    method: 'POST',
    body: JSON.stringify({ rows, mapping: mapped, target: 'leads' }),
  });
  check(commit.status === 200, 'the import runs', commit.json?.error?.message);

  const r = commit.json?.data;
  check(r?.peopleCreated === 2, 'two leads created', String(r?.peopleCreated));
  check(r?.companiesCreated === 2, 'two companies created', String(r?.companiesCreated));
  check(r?.skipped === 1, 'one row skipped', String(r?.skipped));
  check((r?.failed ?? []).length === 0, 'nothing failed', JSON.stringify(r?.failed));

  /* Re-run: the same file must now find duplicates rather than double up. */
  const second = await call('/api/crm/import/preview', {
    method: 'POST',
    body: JSON.stringify({ rows, mapping: mapped, target: 'leads' }),
  });
  const dupes = second.json?.data?.summary?.duplicates ?? 0;
  check(dupes >= 2, 'importing the same file again finds the duplicates', String(dupes));
  check(second.json?.data?.rows?.[0]?.action === 'update',
    'and proposes an update rather than a second copy',
    second.json?.data?.rows?.[0]?.action);

  /* Clean up what the import made. */
  for (const table of ['leads', 'companies']) {
    const list = await call(`/api/crm/${table}?search=${stamp}&pageSize=50`);
    for (const row of list.json?.data ?? []) created[table].push(row.id);
  }
}

/* ── Tenancy ─────────────────────────────────────────────────────────────── */

section('8. Boundaries');

{
  const anon = client();
  const res = await anon('/api/crm/overview');
  check(res.status === 401 || res.status === 403,
    'the overview refuses an unauthenticated caller', String(res.status));

  const bad = await call('/api/crm/import/preview', {
    method: 'POST',
    body: JSON.stringify({ rows: [['a']], mapping: {} }),
  });
  check(bad.status === 422, 'an import with no mapping is refused', String(bad.status));
}

/* ── Clean up ────────────────────────────────────────────────────────────── */

section('9. Clean up');

{
  let removed = 0;
  for (const [table, ids] of Object.entries(created)) {
    const path = table === 'activities' ? 'activities' : table;
    for (const id of [...new Set(ids)]) {
      const res = await call(`/api/crm/${path}/${id}`, { method: 'DELETE' });
      if (res.status === 200) removed++;
    }
  }
  check(removed > 0, `removed ${removed} verification records`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\n  Failed:');
  for (const f of failed) console.log(`    - ${f}`);
  console.log('');
  process.exit(1);
}
console.log('');
