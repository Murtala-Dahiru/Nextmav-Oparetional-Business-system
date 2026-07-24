/**
 * End-to-end test of the running application against Supabase.
 *
 *     npm run app:verify           (dev server must be on :3100)
 *
 * Exercises the HTTP API the browser actually calls, as two users in two
 * organizations, so it proves the whole path: cookie session → route handler →
 * supabase-js with the user's JWT → RLS → Postgres.
 *
 * Test accounts are created through the admin API rather than public signup,
 * because the project has email confirmation enabled and the built-in SMTP is
 * rate-limited. That is a real constraint on production signup, recorded in
 * the report — it is not something this harness papers over.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:3100';

function env(k) {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}
const SUPABASE = env('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');

let pass = 0, fail = 0;
const failed = [];
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; failed.push(label); console.log(`    FAIL  ${label}${detail ? `  — ${detail}` : ''}`); }
  return ok;
};
const section = t => console.log(`\n  ${t}\n  ${'─'.repeat(t.length)}`);

// ── session-carrying HTTP client ───────────────────────────────────────────

/** Minimal cookie jar: the app authenticates by cookie, so we must keep them. */
function makeClient() {
  const jar = new Map();
  return {
    async fetch(path, init = {}) {
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(BASE + path, {
        ...init,
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === '' ) jar.delete(name); else jar.set(name, value);
      }
      return res;
    },
    async json(path, init) {
      const r = await this.fetch(path, init);
      let body = null;
      try { body = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, ok: r.ok, body };
    },
  };
}

async function adminCreateUser(email, password) {
  const r = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`admin create: ${r.status} ${await r.text()}`);
  return r.json();
}
const adminDeleteUser = id =>
  fetch(`${SUPABASE}/auth/v1/admin/users/${id}`, {
    method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {});

// ── run ────────────────────────────────────────────────────────────────────

const run = Date.now().toString(36);
const emailA = `appverify-${run}-a@example.com`;
const emailB = `appverify-${run}-b@example.com`;
const PW = 'Passw0rd!verify';

let userA, userB;
const A = makeClient(), B = makeClient();

try {
  section('1. Authentication');

  userA = await adminCreateUser(emailA, PW);
  userB = await adminCreateUser(emailB, PW);
  check(!!userA.id && !!userB.id, 'two accounts created');

  const badLogin = await A.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: emailA, password: 'wrong-password' }),
  });
  check(badLogin.status === 401, `wrong password rejected (${badLogin.status})`);
  check(
    !/user|exist|found/i.test(badLogin.body?.error?.message ?? ''),
    'error does not reveal whether the account exists',
    badLogin.body?.error?.message,
  );

  const loginA = await A.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: emailA, password: PW }),
  });
  check(loginA.ok, `sign in succeeds (${loginA.status})`);
  check(loginA.body?.data?.needsOrganization === true,
    'a user with no organization is flagged for onboarding');

  const sess = await A.json('/api/auth/session');
  check(sess.body?.data?.user?.id === userA.id, 'session resolves the signed-in user');

  section('2. Organization onboarding');

  const orgA = await A.json('/api/organizations', {
    method: 'POST', body: JSON.stringify({ name: `Alpha ${run}` }),
  });
  check(!!orgA.body?.data?.id, 'organization created through the app',
    orgA.body?.error?.message);

  await B.json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: emailB, password: PW }) });
  const orgB = await B.json('/api/organizations', {
    method: 'POST', body: JSON.stringify({ name: `Beta ${run}` }),
  });
  check(!!orgB.body?.data?.id, 'second organization created');

  const sessA = await A.json('/api/auth/session');
  check(sessA.body?.data?.user?.role === 'owner', 'creator is owner of their organization');
  check(sessA.body?.data?.needsOrganization === false, 'onboarding flag clears once joined');

  section('3. Module CRUD through the app');

  const madeLead = await A.json('/api/crm/leads', {
    method: 'POST',
    body: JSON.stringify({ first_name: 'Rita', last_name: 'Vale', company_name: `ACME-${run}`, status: 'qualified' }),
  });
  check(madeLead.status === 201, `create a lead (${madeLead.status})`, madeLead.body?.error?.message);
  const leadId = madeLead.body?.data?.id;

  const listA = await A.json('/api/crm/leads');
  check(listA.ok && (listA.body?.data ?? []).some((l) => l.id === leadId), 'the lead appears in A list');

  const madeProject = await A.json('/api/projects/projects', {
    method: 'POST', body: JSON.stringify({ name: `Rollout ${run}`, status: 'active', priority: 'high' }),
  });
  check(madeProject.status === 201, `create a project (${madeProject.status})`, madeProject.body?.error?.message);

  const madeTask = await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Kickoff', project_id: madeProject.body?.data?.id, priority: 'high' }),
  });
  check(madeTask.status === 201, `create a task (${madeTask.status})`, madeTask.body?.error?.message);

  const badLead = await A.json('/api/crm/leads', { method: 'POST', body: JSON.stringify({}) });
  check(badLead.status === 422, `validation rejects an empty lead (${badLead.status})`);

  section('4. Tenant isolation over HTTP');

  const bSeesLeads = await B.json('/api/crm/leads');
  check(bSeesLeads.ok, `B can call the endpoint (${bSeesLeads.status})`);
  check(!(bSeesLeads.body?.data ?? []).some((l) => l.id === leadId),
    "B CANNOT see A's lead in the list");

  if (leadId) {
    const stolen = await B.json(`/api/crm/leads/${leadId}`);
    check(stolen.status === 404, `B CANNOT fetch A's lead by id (${stolen.status})`);

    const tampered = await B.json(`/api/crm/leads/${leadId}`, {
      method: 'PATCH', body: JSON.stringify({ first_name: 'Hacked' }),
    });
    check(tampered.status === 404, `B CANNOT modify A's lead (${tampered.status})`);
  }

  const anon = makeClient();
  check((await anon.json('/api/crm/leads')).status === 401, 'unauthenticated read is refused');
  check((await anon.json('/api/dashboard')).status === 401, 'dashboard requires a session');

  section('5. Attendance — server-authoritative');

  const clockState = await A.json('/api/hr/attendance/clock');
  check(clockState.ok && clockState.body?.data?.canCheckIn === true, 'clock reports ready to check in');

  const ci = await A.json('/api/hr/attendance/clock', {
    method: 'POST', body: JSON.stringify({ action: 'in' }),
  });
  check(ci.status === 201, `check in (${ci.status})`, ci.body?.error?.message);
  if (ci.body?.data?.checked_in_at) {
    const drift = Math.abs(Date.now() - new Date(ci.body.data.checked_in_at).getTime());
    check(drift < 120_000, `check-in used server time (drift ${Math.round(drift / 1000)}s)`);
  }

  const ciAgain = await A.json('/api/hr/attendance/clock', {
    method: 'POST', body: JSON.stringify({ action: 'in' }),
  });
  check(!ciAgain.ok, `double check-in refused (${ciAgain.status})`);

  const co = await A.json('/api/hr/attendance/clock', {
    method: 'POST', body: JSON.stringify({ action: 'out' }),
  });
  check(co.ok, `check out (${co.status})`, co.body?.error?.message);

  section('6. Leave workflow');

  const leave = await A.json('/api/hr/leave', {
    method: 'POST',
    body: JSON.stringify({
      type: 'vacation', start_date: '2026-09-01', end_date: '2026-09-03',
      reason: 'verify', status: 'approved',
    }),
  });
  check(leave.status === 201, `raise a leave request (${leave.status})`, leave.body?.error?.message);
  check(leave.body?.data?.status === 'pending', 'status forced to pending despite the request body');

  if (leave.body?.data?.id) {
    const self = await A.json(`/api/hr/leave/${leave.body.data.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
    });
    check(self.status === 403, `self-approval blocked (${self.status})`, self.body?.error?.code);
  }

  section('7. Role-composed dashboard');

  const dash = await A.json('/api/dashboard');
  check(dash.ok, `dashboard loads (${dash.status})`, dash.body?.error?.message);
  const d = dash.body?.data ?? {};
  check(!!d.viewer && !!d.myWork && !!d.notifications, 'dashboard returns the personal sections');
  check(d.viewer?.role === 'owner', 'dashboard reports the resolved role');
  check('finance' in d, 'an owner receives the finance section');
} catch (e) {
  fail++; failed.push('harness error');
  console.error(`\n  HARNESS ERROR: ${e.message}`);
} finally {
  if (userA?.id) await adminDeleteUser(userA.id);
  if (userB?.id) await adminDeleteUser(userB.id);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n  Failed:'); failed.forEach(f => console.log(`    · ${f}`)); }
process.exit(fail ? 1 : 0);
