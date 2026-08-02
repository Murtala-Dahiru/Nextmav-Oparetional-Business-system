/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The identity lifecycle, driven end to end
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     npm run identity:verify        (dev server must be on :3100)
 *
 *  ── Why this harness exists ───────────────────────────────────────────────
 *
 *  Every defect this file tests for was invisible to the other five harnesses,
 *  and for the same reason: the application worked. `db:verify` proves tenant
 *  isolation, `app:verify` proves the routes behave, `security:check` proves
 *  the guards are present — and a terminated employee could still sign in,
 *  because signing in is *supposed* to work and nothing anywhere asserted that
 *  for this person it should not.
 *
 *  So these are not unit tests of the new functions. They are the workflows,
 *  driven through the same HTTP surface a browser uses, with the assertions
 *  written as the thing a person would actually complain about:
 *
 *      "I fired them last week and they just logged in."
 *
 *  ── How session expiry is tested without waiting thirty minutes ───────────
 *
 *  The two clocks are httpOnly cookies that `proxy.ts` reads. The harness owns
 *  its own cookie jar, so it can write a `nm-session-seen` from forty minutes
 *  ago and see what the real proxy does with it. That exercises the actual
 *  enforcement path rather than a shortened copy of it.
 *
 *  Everything created is namespaced `idv-<runid>@` and torn down at the end,
 *  including on failure.
 */
import { readFileSync } from 'node:fs';
import { connect } from './db-connect.mjs';

const BASE = process.env.APP_URL ?? 'http://localhost:3100';

function env(key) {
  const raw = readFileSync('.env', 'utf8');
  const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return (process.env[key] || (m ? m[1].trim().replace(/^["']|["']$/g, '') : ''));
}

const SUPABASE = env('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const DIRECT_URL = env('DIRECT_URL') || env('DATABASE_URL');

const missing = Object.entries({ SUPABASE, SERVICE, DIRECT_URL })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`\n  Missing from .env: ${missing.join(', ')}\n`);
  process.exit(1);
}

// ── harness ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const failures = [];
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; failures.push(label); console.log(`    FAIL  ${label}${detail ? `  — ${detail}` : ''}`); }
  return ok;
};
const section = t => console.log(`\n  ${t}\n  ${'─'.repeat(t.length)}`);

const PASSWORD = 'Verify!Passw0rd';
const runId = Date.now().toString(36);
const addr = who => `idv-${runId}-${who}@example.com`;

/**
 * A browser, more or less.
 *
 * The application authenticates by cookie, and half of what is being tested
 * lives in cookies the JavaScript never sees, so the jar has to be real.
 * `redirect: 'manual'` matters as much: the proxy expresses most of its
 * decisions as 302s, and following them would turn every assertion about
 * *where* someone was sent into an assertion about what the login page renders.
 */
function makeClient() {
  const jar = new Map();
  return {
    jar,
    set(name, value) { jar.set(name, value); },
    has(name) { return jar.has(name); },
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
        if (value === '') jar.delete(name); else jar.set(name, value);
      }
      return res;
    },
    async json(path, init) {
      const r = await this.fetch(path, init);
      let body = null;
      try { body = await r.json(); } catch { /* not JSON */ }
      return { status: r.status, ok: r.ok, body, headers: r.headers };
    },
    async login(email, password = PASSWORD) {
      return this.json('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },
  };
}

// ── admin-side helpers ─────────────────────────────────────────────────────

const adminHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
};

/**
 * Create a confirmed account with a stated provenance.
 *
 * `account_origin` is read by `handle_new_user()` into the profile, and it is
 * what decides whether an account that belongs nowhere may found a workspace.
 * Setting it here is how the harness distinguishes an employee an employer
 * created from a customer who signed up for the platform.
 */
async function createAccount(email, { origin = 'self_signup', firstName = 'Test', lastName = 'User' } = {}) {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email, password: PASSWORD, email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, account_origin: origin },
    }),
  });
  if (!res.ok) throw new Error(`create ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function deleteAccount(id) {
  if (!id) return;
  await fetch(`${SUPABASE}/auth/v1/admin/users/${id}`, {
    method: 'DELETE', headers: adminHeaders,
  }).catch(() => {});
}

async function authUserExists(id) {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/users/${id}`, { headers: adminHeaders });
  return res.ok;
}

// ── run ────────────────────────────────────────────────────────────────────

console.log(`\n  Identity lifecycle verification  (run ${runId})`);
console.log(`  Application: ${BASE}\n`);

let sql;
const created = [];
let orgId = null;

try {
  const conn = await connect(DIRECT_URL);
  sql = conn.client;
  if (conn.note) console.log(`  note: ${conn.note}\n`);
} catch (e) {
  console.error(`  Could not reach the database: ${e.message}`);
  process.exit(1);
}

try {
  const probe = await fetch(BASE + '/api', { redirect: 'manual' }).catch(() => null);
  if (!probe) {
    console.error(`  No application at ${BASE}. Start the dev server first.\n`);
    process.exit(1);
  }
} catch {
  console.error(`  No application at ${BASE}.\n`);
  process.exit(1);
}

try {
  // ═════════════════════════════════════════════════════════════════════════
  section('1. Registration and the founding of a workspace');

  const ownerEmail = addr('owner');
  const ownerId = await createAccount(ownerEmail, { origin: 'self_signup', firstName: 'Ada', lastName: 'Owner' });
  created.push(ownerId);

  const owner = makeClient();
  const ownerLogin = await owner.login(ownerEmail);
  check(ownerLogin.status === 200, 'a confirmed account can sign in', `${ownerLogin.status}`);
  check(ownerLogin.body?.data?.accessState === 'no_organization',
    'and is reported as belonging to no organization yet',
    ownerLogin.body?.data?.accessState);
  check(ownerLogin.body?.data?.mayCreateOrganization === true,
    'a self-registered account may found a workspace');

  const orgRes = await owner.json('/api/organizations', {
    method: 'POST', body: JSON.stringify({ name: `Identity Verify ${runId}` }),
  });
  check(orgRes.status === 201, 'and does so', `${orgRes.status} ${JSON.stringify(orgRes.body?.error ?? '')}`);
  orgId = orgRes.body?.data?.id;

  const afterOrg = await owner.json('/api/auth/session');
  check(afterOrg.body?.data?.accessState === 'active', 'the session now reports an active account');
  check(afterOrg.body?.data?.user?.role === 'owner', 'with the founder as owner');

  // ═════════════════════════════════════════════════════════════════════════
  section('2. Provisioning an employee');

  const staffCreate = await owner.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: addr('staff'), firstName: 'Ben', lastName: 'Staff', role: 'employee',
    }),
  });
  check(staffCreate.status === 201, 'an administrator provisions an account',
    JSON.stringify(staffCreate.body?.error ?? ''));

  const staffMemberId = staffCreate.body?.data?.member?.id;
  const staffTempPassword = staffCreate.body?.data?.temporaryPassword;
  check(!!staffTempPassword, 'a temporary password is issued exactly once');

  const { rows: [staffProfile] } = await sql.query(
    `SELECT p.id, p.account_origin, p.force_password_change
       FROM profiles p JOIN organization_members om ON om.user_id = p.id
      WHERE om.id = $1`, [staffMemberId]);
  created.push(staffProfile?.id);

  check(staffProfile?.account_origin === 'provisioned',
    'and is recorded as provisioned, not self-registered',
    staffProfile?.account_origin);
  check(staffProfile?.force_password_change === true,
    'and must replace the password before doing anything');

  // The password gate, which predates this work but is part of the lifecycle.
  const staff = makeClient();
  const staffLogin = await staff.login(addr('staff'), staffTempPassword);
  check(staffLogin.status === 200, 'the employee can sign in with it');
  const staffBlocked = await staff.json('/api/crm/leads');
  check(staffBlocked.status === 403 && staffBlocked.body?.error?.code === 'PASSWORD_CHANGE_REQUIRED',
    'but every module refuses until they choose their own',
    `${staffBlocked.status} ${staffBlocked.body?.error?.code}`);

  await staff.json('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: staffTempPassword, newPassword: PASSWORD }),
  });
  const staffSession = await staff.json('/api/auth/session');
  check(staffSession.body?.data?.accessState === 'active',
    'and work normally once they have');

  // ═════════════════════════════════════════════════════════════════════════
  section('3. Invitation, without founding a workspace first');

  const inviteEmail = addr('invitee');
  const inviteRes = await owner.json('/api/auth/invite', {
    method: 'POST', body: JSON.stringify({ email: inviteEmail, role: 'employee' }),
  });
  check(inviteRes.status === 201, 'an administrator issues an invitation',
    JSON.stringify(inviteRes.body?.error ?? ''));
  const inviteToken = inviteRes.body?.data?.invitation?.token;

  /**
   * The signup that used to require an organization name.
   *
   * An invitee with no account was sent to /signup, which demanded one and
   * created it — so they owned a workspace nobody asked for before they could
   * join the one that invited them. Passing the token is what makes the
   * question unnecessary.
   *
   * ── Asserted on the refusal, not on the account ───────────────────────────
   *
   * Public signup cannot be driven repeatedly here: the project has email
   * confirmation on, and the built-in SMTP answers `over_email_send_rate_limit`
   * after a handful of messages an hour. That is a genuine production
   * constraint rather than something to work around, and `app:verify` records
   * it too.
   *
   * The organization-name requirement is checked *before* the account is
   * created, so it is still fully testable: without a token the request is
   * refused for the missing name, and with one it gets past that gate —
   * whatever the mail server then does. Anything other than
   * VALIDATION_ERROR means the question was not asked.
   */
  const noToken = await makeClient().json('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: addr('nameless'), password: PASSWORD, firstName: 'No', lastName: 'Org' }),
  });
  check(noToken.status === 422 && /organization name/i.test(noToken.body?.error?.message ?? ''),
    'signing up without an invitation still requires an organization name',
    `${noToken.status} ${noToken.body?.error?.message}`);

  const withToken = await makeClient().json('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: inviteEmail, password: PASSWORD,
      firstName: 'Cleo', lastName: 'Invitee', inviteToken,
    }),
  });
  check(withToken.body?.error?.code !== 'VALIDATION_ERROR',
    'an invitee is not asked for one at all',
    `${withToken.status} ${withToken.body?.error?.code ?? 'accepted'}`);

  /**
   * The invitee's account, created the way the harness can create accounts.
   *
   * `origin: 'invited'` is what the signup route sets through user metadata
   * when a token is present; setting it directly here tests the consequence —
   * that such an account cannot found a workspace — without needing the mail
   * server to cooperate.
   */
  const inviteeId = withToken.status === 201 && withToken.body?.data?.user?.id
    ? withToken.body.data.user.id
    : await createAccount(inviteEmail, { origin: 'invited', firstName: 'Cleo', lastName: 'Invitee' });
  created.push(inviteeId);

  const { rows: [inviteeProfile] } = await sql.query(
    'SELECT id, account_origin FROM profiles WHERE email = $1', [inviteEmail]);
  check(inviteeProfile?.account_origin === 'invited',
    'their account is recorded as invited, not self-registered',
    inviteeProfile?.account_origin);

  const { rows: strayOrgs } = await sql.query(
    `SELECT count(*)::int AS n FROM organization_members WHERE user_id = $1`,
    [inviteeProfile?.id]);
  check(strayOrgs[0].n === 0, 'and they own no workspace of their own', `${strayOrgs[0].n}`);

  const inviteeSignedIn = makeClient();
  const inviteeLogin = await inviteeSignedIn.login(inviteEmail);
  check(inviteeLogin.body?.data?.mayCreateOrganization === false,
    'an invited account may not found one either — the invitation is the way in');
  const accept = await inviteeSignedIn.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: inviteToken }),
  });
  check(accept.status === 200, 'the invitation is redeemed',
    JSON.stringify(accept.body?.error ?? ''));

  const reAccept = await inviteeSignedIn.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: inviteToken }),
  });
  check(reAccept.status === 400, 'and cannot be redeemed twice');

  const outsider = makeClient();
  const outsiderEmail = addr('outsider');
  created.push(await createAccount(outsiderEmail));
  await outsider.login(outsiderEmail);
  const stolen = await outsider.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: inviteToken }),
  });
  check(stolen.status === 400, 'a leaked invitation link is useless to anyone else');

  // ═════════════════════════════════════════════════════════════════════════
  section('4. Suspension actually suspends');

  /**
   * A session that is already open when the suspension lands.
   *
   * This is the case that matters. Testing only "can they sign in afterwards"
   * would miss the browser that is already on the dashboard, and that browser
   * is exactly where the old behaviour left them: authenticated, refreshing a
   * valid token indefinitely, with nothing but empty query results between
   * them and the platform.
   */
  const openTab = makeClient();
  await openTab.login(addr('staff'));
  const beforeSuspension = await openTab.json('/api/auth/session');
  check(beforeSuspension.body?.data?.accessState === 'active',
    'the employee has a live session before anything happens');

  const suspend = await owner.json(`/api/admin/users/${staffMemberId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'suspended' }),
  });
  check(suspend.status === 200, 'an administrator suspends the employee');
  check(suspend.body?.data?.sessionsRevoked === true,
    'and every session they hold is revoked, not merely filtered',
    JSON.stringify(suspend.body?.data?.warning ?? ''));

  const suspendedLogin = await makeClient().login(addr('staff'));
  check(suspendedLogin.status === 403
    && suspendedLogin.body?.error?.code === 'ACCOUNT_SUSPENDED',
    'they can no longer sign in, and are told why rather than "invalid password"',
    `${suspendedLogin.status} ${suspendedLogin.body?.error?.code}`);

  const afterSuspension = await openTab.json('/api/auth/session');
  check(afterSuspension.body?.data?.accessState === 'suspended'
    || afterSuspension.body?.data?.user === null,
    'the tab that was already open stops resolving an account',
    JSON.stringify(afterSuspension.body?.data?.accessState));

  const stillReading = await openTab.json('/api/crm/leads');
  check(stillReading.status === 401 || stillReading.status === 403,
    'and can read nothing', `${stillReading.status}`);

  /**
   * The defect this whole pass exists for.
   *
   * A suspended member resolves no organization, which used to be reported as
   * `needsOrganization` — the same answer a brand-new signup gets — so the
   * dashboard offered them the create-a-workspace form and they came out of it
   * owning a tenant of their own, with their employer's suspension amounting to
   * nothing but a change of scenery.
   *
   * Driven through the session that was open when the suspension happened,
   * because a suspended person cannot sign in any more to try it fresh.
   */
  const escape = await openTab.json('/api/organizations', {
    method: 'POST', body: JSON.stringify({ name: `Escape Hatch ${runId}` }),
  });
  check(escape.status === 403 || escape.status === 401,
    'and cannot found a workspace of their own instead',
    `${escape.status} ${JSON.stringify(escape.body?.error ?? '')}`);

  const { rows: escaped } = await sql.query(
    `SELECT count(*)::int AS n FROM organizations WHERE name = $1`, [`Escape Hatch ${runId}`]);
  check(escaped[0].n === 0, 'and no organization was created by the attempt');

  /**
   * The same attempt at the database, bypassing the route entirely.
   *
   * `create_organization()` is granted to `authenticated`, so a refusal that
   * lived only in the API would be one REST call away from being no refusal at
   * all.
   */
  const { rows: [rpcGuard] } = await sql.query(
    `SELECT prosecdef, pg_get_functiondef(oid) LIKE '%account_access_state%' AS checks_state
       FROM pg_proc WHERE proname = 'create_organization'`);
  check(rpcGuard?.checks_state === true,
    'the RPC behind it refuses on its own account, not because a route said so');

  const restore = await owner.json(`/api/admin/users/${staffMemberId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'active' }),
  });
  check(restore.status === 200, 'restoring access works');
  const restored = await makeClient().login(addr('staff'));
  check(restored.status === 200, 'and they can sign in again');

  // ═════════════════════════════════════════════════════════════════════════
  section('5. Termination');

  const terminate = await owner.json(`/api/admin/users/${staffMemberId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'terminated' }),
  });
  check(terminate.status === 200, 'employment is recorded as ended');

  const { rows: [terminated] } = await sql.query(
    'SELECT status, is_active, terminated_on FROM organization_members WHERE id = $1',
    [staffMemberId]);
  check(terminated.status === 'terminated' && terminated.is_active === false,
    'the membership records termination rather than a generic deactivation');
  check(!!terminated.terminated_on, 'and the date it happened');

  const terminatedLogin = await makeClient().login(addr('staff'));
  check(terminatedLogin.status === 403
    && terminatedLogin.body?.error?.code === 'ACCOUNT_TERMINATED',
    'a terminated employee cannot sign in',
    `${terminatedLogin.status} ${terminatedLogin.body?.error?.code}`);

  // ═════════════════════════════════════════════════════════════════════════
  section('6. Permanent deletion reviews before it removes');

  // Something for them to own, and something that is history.
  const project = await owner.json('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({ name: `Owned by leaver ${runId}`, status: 'active' }),
  });
  const projectId = project.body?.data?.id;
  if (projectId) {
    await sql.query('UPDATE projects SET owner_id = $1 WHERE id = $2', [staffMemberId, projectId]);
  }
  await sql.query(
    `INSERT INTO comments (organization_id, author_id, body, project_id)
     VALUES ($1, $2, 'A comment that must outlive the account', $3)`,
    [orgId, staffMemberId, projectId]);

  const impact = await owner.json(`/api/admin/users/${staffMemberId}/account`);
  check(impact.status === 200, 'the impact of deleting an account can be reviewed first');

  const items = impact.body?.data?.items ?? [];
  const findItem = (t, c) => items.find(i => i.table === t && i.column === c);
  check(findItem('projects', 'owner_id')?.kind === 'reassign',
    'a project they own is listed as needing a new owner');
  check(findItem('comments', 'author_id')?.kind === 'retain',
    'a comment they wrote is listed as history to keep');
  check(impact.body?.data?.requiresReassignment === true,
    'and the review says reassignment is required');
  check(impact.body?.data?.removesPlatformIdentity === true,
    'this being their only membership, their login goes too');

  const selfDelete = await owner.json(`/api/admin/users/${afterOrg.body.data.user.memberId}/account`, {
    method: 'DELETE',
  });
  check(selfDelete.status === 409, 'an administrator cannot delete themselves',
    `${selfDelete.status}`);

  const ownerImpact = await owner.json(`/api/admin/users/${afterOrg.body.data.user.memberId}/account`);
  check((ownerImpact.body?.data?.blockers ?? []).some(b => /only owner/i.test(b)),
    'and the only owner is refused, so the organization stays administrable');

  const noTarget = await owner.json(`/api/admin/users/${staffMemberId}/account`, { method: 'DELETE' });
  check(noTarget.status === 409,
    'deleting without naming a successor is refused', `${noTarget.status}`);

  const inviteeMemberId = (await sql.query(
    'SELECT id FROM organization_members WHERE user_id = $1 AND organization_id = $2',
    [inviteeProfile.id, orgId])).rows[0]?.id;

  const staffUserId = staffProfile?.id;
  const del = await owner.json(
    `/api/admin/users/${staffMemberId}/account?reassignTo=${inviteeMemberId}`,
    { method: 'DELETE' });
  check(del.status === 200, 'with one, the deletion goes through',
    JSON.stringify(del.body?.error ?? ''));
  check(del.body?.data?.platformIdentityRemoved === true, 'and the login is removed');

  const { rows: [movedProject] } = await sql.query(
    'SELECT owner_id FROM projects WHERE id = $1', [projectId]);
  check(movedProject?.owner_id === inviteeMemberId,
    'the project has a new owner rather than none');

  const { rows: [keptComment] } = await sql.query(
    'SELECT count(*)::int AS n FROM comments WHERE author_id = $1', [staffMemberId]);
  check(keptComment.n === 1,
    'the comment they wrote is still there, still attributed to them');

  const { rows: [tombstone] } = await sql.query(
    'SELECT deleted_at, is_active, status FROM organization_members WHERE id = $1',
    [staffMemberId]);
  check(!!tombstone?.deleted_at && tombstone.is_active === false,
    'their membership survives as a tombstone, so every foreign key resolves');

  const directory = await owner.json('/api/admin/users?pageSize=100');
  check(!(directory.body?.data ?? []).some(u => u.memberId === staffMemberId),
    'but the directory no longer lists them');

  check(!(await authUserExists(staffUserId)), 'the auth identity is gone');

  // ── The address comes back ───────────────────────────────────────────────
  const reusedId = await createAccount(addr('staff'), { origin: 'self_signup' });
  created.push(reusedId);
  check(!!reusedId && reusedId !== staffUserId,
    'the email address can be registered again, as a new identity');

  const { rows: [oldProfile] } = await sql.query(
    'SELECT email, deleted_email, is_active FROM profiles WHERE id = $1', [staffUserId]);
  check(oldProfile?.deleted_email === addr('staff') && oldProfile.email !== addr('staff'),
    'and the old profile keeps the address for the audit trail without holding it');

  const { rows: [audit] } = await sql.query(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE table_name = 'organization_members' AND record_id = $1 AND action = 'delete'`,
    [staffMemberId]);
  check(audit.n >= 1, 'the deletion is in the audit log');

  // ═════════════════════════════════════════════════════════════════════════
  section('7. Sessions expire');

  const idle = makeClient();
  await idle.login(ownerEmail);
  // Establish the clocks: they are written by the proxy on the first request
  // that carries a session, not by the sign-in itself.
  await idle.json('/api/auth/session');
  await idle.json('/api/notifications?pageSize=1');
  check(idle.has('nm-session-seen') && idle.has('nm-session-started'),
    'a session carries an idle clock and an absolute one');

  const fresh = await idle.json('/api/notifications?pageSize=1');
  check(fresh.status === 200, 'an active session is served normally');

  // Forty minutes ago, against a thirty-minute idle window.
  idle.set('nm-session-seen', String(Date.now() - 40 * 60_000));
  const expired = await idle.json('/api/notifications?pageSize=1');
  check(expired.status === 401 && expired.body?.error?.code === 'SESSION_EXPIRED',
    'an idle session is refused by the proxy, before any handler runs',
    `${expired.status} ${expired.body?.error?.code}`);
  check(!idle.has('sb-access-token') && ![...idle.jar.keys()].some(k => k.includes('auth-token')),
    'and the auth cookies are cleared, so there is no redirect loop');

  const page = makeClient();
  await page.login(ownerEmail);
  await page.json('/api/auth/session');
  await page.json('/api/notifications?pageSize=1');
  page.set('nm-session-seen', String(Date.now() - 40 * 60_000));
  const pageRes = await page.fetch('/dashboard');
  check(pageRes.status === 307 || pageRes.status === 302,
    'a page request redirects rather than erroring', `${pageRes.status}`);
  check((pageRes.headers.get('location') ?? '').includes('reason=timeout'),
    'and says why, so the login form can explain itself',
    pageRes.headers.get('location') ?? '');

  const absolute = makeClient();
  await absolute.login(ownerEmail);
  await absolute.json('/api/auth/session');
  await absolute.json('/api/notifications?pageSize=1');
  // Thirteen hours ago, against a twelve-hour ceiling; the idle clock is fresh.
  absolute.set('nm-session-started', String(Date.now() - 13 * 60 * 60_000));
  const overLimit = await absolute.json('/api/notifications?pageSize=1');
  check(overLimit.status === 401 && overLimit.body?.error?.reason === 'absolute',
    'an active session still ends at the absolute ceiling',
    `${overLimit.status} ${overLimit.body?.error?.reason}`);

  // ── The idle clock ignores the machine ───────────────────────────────────
  const polling = makeClient();
  await polling.login(ownerEmail);
  await polling.json('/api/notifications?pageSize=1');
  const stamp = polling.jar.get('nm-session-seen');
  await new Promise(r => setTimeout(r, 1100));
  await polling.json('/api/notifications?pageSize=1', { headers: { 'x-nm-background': '1' } });
  check(polling.jar.get('nm-session-seen') === stamp,
    'a background poll does not hold the idle timeout open');
  await polling.json('/api/notifications?pageSize=1');
  check(polling.jar.get('nm-session-seen') !== stamp,
    'a foreground request does');

  const touched = await polling.json('/api/auth/session/touch', { method: 'POST' });
  check(touched.status === 200 && touched.body?.data?.expiresInMs > 0,
    'and the browser can say "somebody is here" explicitly');

  // ── Refresh, reopen, multiple tabs ───────────────────────────────────────
  const tabA = makeClient();
  await tabA.login(ownerEmail);
  await tabA.json('/api/auth/session');
  const tabB = makeClient();
  for (const [k, v] of tabA.jar) tabB.set(k, v);   // a second tab shares cookies
  const bothA = await tabA.json('/api/notifications?pageSize=1');
  const bothB = await tabB.json('/api/notifications?pageSize=1');
  check(bothA.status === 200 && bothB.status === 200,
    'two tabs on one session both work');
  const reopened = makeClient();
  for (const [k, v] of tabA.jar) reopened.set(k, v);  // browser closed and reopened
  const afterReopen = await reopened.json('/api/auth/session');
  check(afterReopen.body?.data?.user?.id === ownerId,
    'and reopening the browser resumes it rather than demanding a sign-in');

  // ── Signing out ──────────────────────────────────────────────────────────
  /**
   * Driven as somebody other than the owner, on purpose.
   *
   * Sign Out is global — it ends this person's sessions everywhere, which is
   * what it has to mean on a shared or borrowed machine. An earlier draft of
   * this harness signed the *owner* out here and every later section failed,
   * which is the feature working and the test being wrong.
   */
  const sessionsEmail = addr('sessions');
  const sessionsUserId = await createAccount(sessionsEmail, { firstName: 'Dana', lastName: 'Sessions' });
  created.push(sessionsUserId);
  await sql.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'employee')`,
    [orgId, sessionsUserId]);

  const laptop = makeClient();
  const phone = makeClient();
  await laptop.login(sessionsEmail);
  await phone.login(sessionsEmail);
  check((await phone.json('/api/notifications?pageSize=1')).status === 200,
    'one person can be signed in on two devices');

  await laptop.json('/api/auth/logout', { method: 'POST' });
  check(![...laptop.jar.keys()].some(k => k.includes('auth-token') || k.startsWith('nm-session')),
    'signing out clears the auth cookies and both clocks');
  check((await phone.json('/api/notifications?pageSize=1')).status === 401,
    'and ends the session on the other device too — Sign Out means everywhere');

  /**
   * The expiry path opts out of that.
   *
   * A timeout in one tab is housekeeping, not a decision. Ending someone's
   * session on their phone because a laptop was left idle would be a surprise
   * in the one direction that matters.
   */
  const desk = makeClient();
  const mobile = makeClient();
  await desk.login(sessionsEmail);
  await mobile.login(sessionsEmail);
  await desk.json('/api/auth/logout?scope=local', { method: 'POST' });
  check((await mobile.json('/api/notifications?pageSize=1')).status === 200,
    'but a timed-out tab signs out only itself');

  // ═════════════════════════════════════════════════════════════════════════
  section('8. Permission changes reach a live session');

  const live = makeClient();
  await live.login(inviteEmail);
  const beforeChange = await live.json('/api/finance/invoices');
  check(beforeChange.status === 403,
    'an employee cannot read finance', `${beforeChange.status}`);

  await owner.json(`/api/admin/users/${inviteeMemberId}`, {
    method: 'PUT', body: JSON.stringify({ role: 'finance_staff' }),
  });
  const afterChange = await live.json('/api/finance/invoices');
  check(afterChange.status === 200,
    'promoting them takes effect on their next request, without signing out',
    `${afterChange.status}`);
  const afterCaps = await live.json('/api/auth/session');
  check(afterCaps.body?.data?.user?.role === 'finance_staff',
    'and the session reports the new role');

  await owner.json(`/api/admin/users/${inviteeMemberId}`, {
    method: 'PUT', body: JSON.stringify({ role: 'employee' }),
  });
  const afterDemotion = await live.json('/api/finance/invoices');
  check(afterDemotion.status === 403,
    'and demoting them takes effect just as immediately', `${afterDemotion.status}`);

  // ═════════════════════════════════════════════════════════════════════════
  section('9. Two organizations, one person');

  const secondEmail = addr('multi');
  const secondId = await createAccount(secondEmail, { origin: 'self_signup' });
  created.push(secondId);

  const multi = makeClient();
  await multi.login(secondEmail);
  const ownOrg = await multi.json('/api/organizations', {
    method: 'POST', body: JSON.stringify({ name: `Second Workspace ${runId}` }),
  });
  check(ownOrg.status === 201, 'someone can found their own workspace');
  const secondOrgId = ownOrg.body?.data?.id;

  // And also be invited into the first.
  const crossInvite = await owner.json('/api/auth/invite', {
    method: 'POST', body: JSON.stringify({ email: secondEmail, role: 'employee' }),
  });
  await multi.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: crossInvite.body?.data?.invitation?.token }),
  });
  const { rows: [memberships] } = await sql.query(
    'SELECT count(*)::int AS n FROM organization_members WHERE user_id = $1 AND deleted_at IS NULL',
    [secondId]);
  check(memberships.n === 2, 'and hold two memberships on one identity', `${memberships.n}`);

  const crossMemberId = (await sql.query(
    'SELECT id FROM organization_members WHERE user_id = $1 AND organization_id = $2',
    [secondId, orgId])).rows[0]?.id;

  const crossImpact = await owner.json(`/api/admin/users/${crossMemberId}/account`);
  check(crossImpact.body?.data?.removesPlatformIdentity === false,
    'deleting them from one organization does not touch their login');

  const crossDelete = await owner.json(`/api/admin/users/${crossMemberId}/account`, { method: 'DELETE' });
  check(crossDelete.status === 200, 'the deletion goes through');
  check(await authUserExists(secondId),
    'and their account survives, because another organization still has them');

  const stillIn = makeClient();
  const stillLogin = await stillIn.login(secondEmail);
  check(stillLogin.status === 200 && stillLogin.body?.data?.user?.organizationId === secondOrgId,
    'they sign in and land in the organization they still belong to');

  // ═════════════════════════════════════════════════════════════════════════
  section('10. A deleted membership cannot be revived');

  const revive = await owner.json('/api/auth/invite', {
    method: 'POST', body: JSON.stringify({ email: secondEmail, role: 'employee' }),
  });
  const reviveAccept = await stillIn.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: revive.body?.data?.invitation?.token }),
  });
  check(reviveAccept.status === 400,
    'an invitation cannot resurrect a permanently deleted membership',
    `${reviveAccept.status}`);

} catch (e) {
  fail++;
  failures.push('harness error');
  console.error(`\n  HARNESS ERROR: ${e.message}\n${e.stack ?? ''}\n`);
} finally {
  console.log('\n  Cleaning up…');
  try {
    // Organizations first: everything else cascades from them.
    await sql.query(
      `DELETE FROM organizations WHERE name LIKE $1`, [`%${runId}%`]).catch(() => {});
    for (const id of created) await deleteAccount(id);
    // Tombstoned profiles are no longer cascaded by auth deletion — that is the
    // point of 0025 — so they are removed explicitly here.
    await sql.query(
      `DELETE FROM profiles WHERE email LIKE $1 OR deleted_email LIKE $1`,
      [`idv-${runId}-%`]).catch(() => {});
    await sql.query(
      `DELETE FROM profiles WHERE email LIKE $1`, [`deleted+%@account.invalid`]).catch(() => {});
  } catch (e) {
    console.log(`  (cleanup: ${e.message})`);
  }
  await sql.end().catch(() => {});
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\n  Failed checks:');
  for (const f of failures) console.log(`    · ${f}`);
  console.log('');
}
process.exit(fail ? 1 : 0);
