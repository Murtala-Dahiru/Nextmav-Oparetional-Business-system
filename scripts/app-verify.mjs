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
    /**
     * This session's cookies, for a request that must not be parsed as JSON.
     *
     * The CSV export returns a file, so `json()` would swallow it — but the
     * headers are half of what is being asserted (content type, disposition,
     * filename), and those only exist on the raw response.
     */
    cookieHeader() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

/**
 * Accounts created by the later sections, cleaned up in `finally`.
 *
 * A list rather than another `userG`, `userH`: the earlier sections each named
 * their own variable and the cleanup block had grown to ten lines of
 * `if (x?.id)`. A new section should not have to edit two places to avoid
 * leaving accounts behind in the project.
 */
const scratchUsers = [];

/**
 * Create a confirmed account.
 *
 * `user_metadata` carries a name because `handle_new_user()` reads
 * `raw_user_meta_data ->> 'first_name'` to populate the profile, and
 * `profiles.full_name` is generated from those two columns. Creating accounts
 * without it left every test user with `full_name = ''`, so assertions about
 * a *named* assignee or author were testing an account shape that the
 * application itself never produces — `/api/auth/signup` and the invitation
 * and provisioning routes all require a first and last name.
 *
 * The name is derived from the address so failures still identify the account.
 */
async function adminCreateUser(email, password, opts = {}) {
  const local = String(email).split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim() || 'Test';
  const r = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: { first_name: local.split(' ')[0] || 'Test', last_name: 'Account' },
      ...opts,
    }),
  });
  if (!r.ok) throw new Error(`admin create: ${r.status} ${await r.text()}`);
  return r.json();
}

/**
 * The token an authentication email would carry.
 *
 * Lets the emailed half of the flow be tested without depending on delivery —
 * which on the built-in SMTP is a few messages an hour and cannot be relied on
 * in a test at all.
 */
async function adminGenerateLink(type, email, redirectTo) {
  const r = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, email, redirect_to: redirectTo }),
  });
  if (!r.ok) throw new Error(`generate_link: ${r.status} ${await r.text()}`);
  return r.json();
}
const REST = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = (q, init) => fetch(`${SUPABASE}/rest/v1/${q}`, { headers: REST, ...init });

/**
 * Remove a test account and everything it owns.
 *
 * The organization has to go first. Deleting the user cascades to their
 * membership, and the last-owner rule refuses that while the organization is
 * still there — so a bare user delete fails, and this used to swallow the
 * error and move on. Every run left its two accounts and their organizations
 * behind; twenty of them had accumulated before anyone noticed.
 *
 * Purchase orders come first in turn: purchase_order_items.product_id and
 * purchase_orders.supplier_id are ON DELETE RESTRICT, so the cascade from the
 * organization hits them and aborts. Same order as delete_organization()
 * in migration 0009.
 *
 * Failures are reported rather than ignored. Cleanup that fails quietly is
 * how the leak went unnoticed in the first place.
 */
async function adminDeleteUser(id) {
  try {
    const members = await (await rest(`organization_members?user_id=eq.${id}&select=organization_id`)).json();

    for (const { organization_id: org } of members ?? []) {
      const orders = await (await rest(`purchase_orders?organization_id=eq.${org}&select=id`)).json();
      if (orders?.length) {
        await rest(`purchase_order_items?order_id=in.(${orders.map(o => o.id).join(',')})`, { method: 'DELETE' });
      }
      await rest(`purchase_orders?organization_id=eq.${org}`, { method: 'DELETE' });

      const dropped = await rest(`organizations?id=eq.${org}`, { method: 'DELETE' });
      if (!dropped.ok) {
        console.warn(`  cleanup: organization ${org} not removed (${dropped.status}) — ${(await dropped.text()).slice(0, 160)}`);
      }
    }

    const res = await fetch(`${SUPABASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: REST });
    if (!res.ok) {
      console.warn(`  cleanup: user ${id} not removed (${res.status}) — ${(await res.text()).slice(0, 160)}`);
    }
  } catch (e) {
    console.warn(`  cleanup: ${id} failed — ${e.message}`);
  }
}

// ── run ────────────────────────────────────────────────────────────────────

const run = Date.now().toString(36);
const emailA = `appverify-${run}-a@example.com`;
const emailB = `appverify-${run}-b@example.com`;
const PW = 'Passw0rd!verify';

let chainClientUser;
let userA, userB, userC, userD, userE, userF, provisionedUserId, teammateUserId, outsiderUser;
const A = makeClient(), B = makeClient(), C = makeClient();

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
  if (ci.body?.data?.checkedInAt) {
    const drift = Math.abs(Date.now() - new Date(ci.body.data.checkedInAt).getTime());
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

  section('8. Inventory — ledger and purchase orders');

  const wh = await A.json('/api/inventory/warehouses', {
    method: 'POST', body: JSON.stringify({ name: `WH-${run}`, location: 'Test' }),
  });
  check(wh.status === 201, `create a warehouse (${wh.status})`, wh.body?.error?.message);

  const sup = await A.json('/api/inventory/suppliers', {
    method: 'POST', body: JSON.stringify({ name: `Supplier-${run}`, lead_time_days: 14 }),
  });
  check(sup.status === 201, `create a supplier (${sup.status})`, sup.body?.error?.message);

  const prod = await A.json('/api/inventory/products', {
    method: 'POST',
    body: JSON.stringify({
      sku: `SKU-${run}`, name: 'Widget', cost: 10, price: 25, reorder_level: 20,
      warehouse_id: wh.body?.data?.id, supplier_id: sup.body?.data?.id,
    }),
  });
  check(prod.status === 201, `create a product (${prod.status})`, prod.body?.error?.message);
  const productId = prod.body?.data?.id;
  check(prod.body?.data?.stock === 0, 'new product starts at zero stock, not a client value');

  if (productId) {
    const receipt = await A.json('/api/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, quantity: 50, type: 'receipt', reason: 'verify' }),
    });
    check(receipt.status === 201, `record a receipt (${receipt.status})`, receipt.body?.error?.message);
    check(receipt.body?.data?.balanceAfter === 50, 'ledger reports the new balance');

    // Sign is derived from the movement type, so a positive number issues out.
    const issue = await A.json('/api/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, quantity: 10, type: 'issue', reason: 'verify' }),
    });
    check(issue.body?.data?.balanceAfter === 40, 'issue subtracts without the client sending a negative');

    const over = await A.json('/api/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, quantity: 9999, type: 'issue' }),
    });
    check(!over.ok, `stock cannot go negative (${over.status})`);

    const alerts = await A.json('/api/inventory/alerts');
    check(alerts.ok, `reorder report loads (${alerts.status})`);
  }

  const po = await A.json('/api/inventory/purchase-orders', {
    method: 'POST',
    body: JSON.stringify({
      supplier_id: sup.body?.data?.id, warehouse_id: wh.body?.data?.id, tax_rate: 10,
      items: [{ product_id: productId, quantity: 25, unit_cost: 10 }],
    }),
  });
  check(po.status === 201, `create a purchase order (${po.status})`, po.body?.error?.message);
  check(po.body?.data?.total === 275, `totals computed server-side (got ${po.body?.data?.total}, expected 275)`);
  const poId = po.body?.data?.id;

  if (poId) {
    const jump = await A.json(`/api/inventory/purchase-orders/${poId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'received' }),
    });
    check(jump.status === 409, `draft cannot jump straight to received (${jump.status})`);

    await A.json(`/api/inventory/purchase-orders/${poId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'submitted' }),
    });
    await A.json(`/api/inventory/purchase-orders/${poId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
    });
    const recv = await A.json(`/api/inventory/purchase-orders/${poId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'received' }),
    });
    check(recv.ok, `approved order can be received (${recv.status})`, recv.body?.error?.message);

    const after = await A.json(`/api/inventory/products/${productId}`);
    check(after.body?.data?.stock === 65, `receiving moved real stock (40 + 25 = ${after.body?.data?.stock})`);

    const del = await A.json(`/api/inventory/purchase-orders/${poId}`, { method: 'DELETE' });
    check(del.status === 409, `a received order cannot be deleted (${del.status})`);
  }

  section('9. Finance');

  const inv = await A.json('/api/finance/invoices', {
    method: 'POST',
    body: JSON.stringify({
      tax_rate: 10,
      line_items: [
        { description: 'Consulting', quantity: 10, unit_price: 100 },
        { description: 'Licence', quantity: 1, unit_price: 500 },
      ],
    }),
  });
  check(inv.status === 201, `create an invoice (${inv.status})`, inv.body?.error?.message);
  check(inv.body?.data?.subtotal === 1500, `subtotal derived from line items (${inv.body?.data?.subtotal})`);
  check(inv.body?.data?.total === 1650, `total includes tax (${inv.body?.data?.total})`);
  check(!!inv.body?.data?.invoiceNumber, `invoice number assigned (${inv.body?.data?.invoiceNumber})`);

  const emptyInv = await A.json('/api/finance/invoices', {
    method: 'POST', body: JSON.stringify({ line_items: [] }),
  });
  check(emptyInv.status === 422, `an invoice with no lines is rejected (${emptyInv.status})`);

  const exp = await A.json('/api/finance/expenses', {
    method: 'POST',
    body: JSON.stringify({ title: 'Travel', amount: 250, category: 'travel', status: 'approved' }),
  });
  check(exp.status === 201, `submit an expense (${exp.status})`, exp.body?.error?.message);
  check(exp.body?.data?.status === 'pending', 'expense forced to pending despite the request body');

  section('10. Support, workspace, communication');

  const ticket = await A.json('/api/support/tickets', {
    method: 'POST',
    body: JSON.stringify({ subject: `Broken widget ${run}`, priority: 'high', description: 'verify' }),
  });
  check(ticket.status === 201, `raise a ticket (${ticket.status})`, ticket.body?.error?.message);
  check(!!ticket.body?.data?.ticketNumber, `ticket number assigned (${ticket.body?.data?.ticketNumber})`);
  check(!!ticket.body?.data?.dueAt, 'SLA due date set from priority');

  const page = await A.json('/api/workspace/pages', {
    method: 'POST', body: JSON.stringify({ title: `Runbook ${run}`, content: 'Steps.' }),
  });
  check(page.status === 201, `create a document (${page.status})`, page.body?.error?.message);

  const chan = await A.json('/api/communication/channels', {
    method: 'POST', body: JSON.stringify({ name: `Team ${run}`, type: 'public' }),
  });
  check(chan.status === 201, `create a channel (${chan.status})`, chan.body?.error?.message);
  check(/^team-/.test(chan.body?.data?.name ?? ''), `channel name slugified (${chan.body?.data?.name})`);

  if (chan.body?.data?.id) {
    const msg = await A.json('/api/communication/messages', {
      method: 'POST', body: JSON.stringify({ channel_id: chan.body.data.id, body: 'Hello team' }),
    });
    check(msg.status === 201, `post a message (${msg.status})`, msg.body?.error?.message);

    const emptyMsg = await A.json('/api/communication/messages', {
      method: 'POST', body: JSON.stringify({ channel_id: chan.body.data.id, body: '   ' }),
    });
    check(emptyMsg.status === 422, `an empty message is rejected (${emptyMsg.status})`);
  }

  section('11. Search, export, admin, audit');

  const search = await A.json(`/api/search?q=${run}`);
  check(search.ok, `search runs (${search.status})`);
  check((search.body?.data?.results ?? []).length > 0,
    `search finds the records just created (${(search.body?.data?.results ?? []).length})`);

  const csv = await A.fetch('/api/export?dataset=leads');
  check(csv.status === 200, `CSV export downloads (${csv.status})`);
  check((csv.headers.get('content-type') ?? '').includes('text/csv'), 'export is served as CSV');

  const badExport = await A.json('/api/export?dataset=nonsense');
  check(badExport.status === 422, `unknown dataset rejected (${badExport.status})`);

  const users = await A.json('/api/admin/users');
  check(users.ok, `admin user list loads (${users.status})`);

  const roles = await A.json('/api/admin/roles');
  check(roles.ok && (roles.body?.data ?? []).length === 9,
    `all 9 roles described (${(roles.body?.data ?? []).length})`);

  const roleEdit = await A.json('/api/admin/roles/employee', {
    method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }),
  });
  check(roleEdit.status === 405, `roles are immutable at runtime (${roleEdit.status})`);

  const settings = await A.json('/api/admin/settings');
  check(settings.ok && !!settings.body?.data?.organization, `settings load (${settings.status})`);

  const audit = await A.json('/api/admin/audit-log');
  check(audit.ok, `audit log loads (${audit.status})`);
  check((audit.body?.data ?? []).length > 0,
    `audit trail captured this run (${(audit.body?.data ?? []).length} entries)`);

  const notifs = await A.json('/api/admin/notifications');
  check(notifs.ok, `notifications load (${notifs.status})`);

  section('12. Cross-tenant on the new modules');

  const bProducts = await B.json('/api/inventory/products');
  check(!(bProducts.body?.data ?? []).some((p) => p.id === productId),
    "B CANNOT see A's product");

  if (productId) {
    const bMove = await B.json('/api/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, quantity: 5, type: 'receipt' }),
    });
    check(bMove.status === 404, `B CANNOT move A's stock — 404, not a 500 (${bMove.status})`);
  }

  const bAudit = await B.json('/api/admin/audit-log');
  check(!(bAudit.body?.data ?? []).some((r) => r.organizationId === orgA.body?.data?.id),
    "B CANNOT read A's audit trail");

  // ─────────────────────────────────────────────────────────────────────────
  section('13. Joining an organization');
  // Invitation was unusable in three separate ways at once: the RPC could not
  // resolve gen_random_bytes, /accept-invite had no page behind it, and the
  // admin screen never called either endpoint. Each is checked here so none
  // can regress quietly.

  const emailC = `verify-c-${Date.now()}@example.com`;
  userC = await adminCreateUser(emailC, PW);

  const invite = await A.json('/api/auth/invite', {
    method: 'POST',
    body: JSON.stringify({ email: emailC, role: 'hr_staff' }),
  });
  check(invite.status === 201, `an invitation is issued (${invite.status})`,
    invite.body?.error?.message);

  const inviteToken = invite.body?.data?.invitation?.token;
  check(typeof inviteToken === 'string' && inviteToken.length === 64,
    'the invitation carries a 64-character token');

  const invitePage = await fetch(`${BASE}/accept-invite?token=${inviteToken ?? 'x'}`);
  check(invitePage.status === 200, `/accept-invite renders (${invitePage.status})`);

  const anonAccept = await C.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: inviteToken }),
  });
  check(anonAccept.status === 401, `accepting while signed out is refused (${anonAccept.status})`);

  await C.json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: emailC, password: PW }) });
  const beforeJoin = await C.json('/api/auth/session');
  check(beforeJoin.body?.data?.needsOrganization === true, 'invitee starts with no organization');

  const accepted = await C.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: inviteToken }),
  });
  check(accepted.ok, `the invitation is accepted (${accepted.status})`, accepted.body?.error?.message);

  const afterJoin = await C.json('/api/auth/session');
  check(afterJoin.body?.data?.user?.capabilities?.role === 'hr_staff',
    'the invited role is the one granted');

  const reuse = await C.json('/api/auth/accept-invite', {
    method: 'POST', body: JSON.stringify({ token: inviteToken }),
  });
  check(reuse.status === 400, `a spent token cannot be reused (${reuse.status})`);

  // The role must bind on the server, not just in the navigation.
  const cFinance = await C.json('/api/finance/invoices');
  check(cFinance.status === 403, `hr_staff is refused Finance by the server (${cFinance.status})`);
  const cHr = await C.json('/api/hr/employees');
  check(cHr.ok, `hr_staff is admitted to HR (${cHr.status})`);

  section('14. Adding a member directly');

  const directEmail = `verify-d-${Date.now()}@example.com`;
  const direct = await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: directEmail, firstName: 'Direct', lastName: 'Hire', role: 'sales_staff' }),
  });
  check(direct.status === 201, `a member can be provisioned directly (${direct.status})`,
    direct.body?.error?.message);
  // This endpoint creates a real auth account, so the harness owns it and has
  // to remove it — otherwise every run leaves another one behind.
  userD = { id: direct.body?.data?.member?.userId };
  // Provisioning now issues a temporary password instead of leaving the
  // account with none. Sections 20-22 cover that contract in full; this only
  // checks the shape has not silently reverted.
  check(typeof direct.body?.data?.temporaryPassword === 'string',
    'a temporary password comes back with the new member');
  check(direct.body?.data?.member?.employmentType === 'full_time',
    'the employment_type default applies rather than a null');

  // Names are supplied so this reaches the duplicate check rather than
  // stopping at validation — the point of the case is the second membership.
  const dupDirect = await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: directEmail, firstName: 'Direct', lastName: 'Hire', role: 'employee' }),
  });
  check(dupDirect.status === 409, `adding the same person twice is refused (${dupDirect.status})`);

  const badRole = await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: `x-${Date.now()}@example.com`, firstName: 'X', lastName: 'Y', role: 'superuser' }),
  });
  check(badRole.status === 422, `an unknown role is refused (${badRole.status})`);

  const directory = await A.json('/api/admin/users?pageSize=100');
  const directRow = (directory.body?.data ?? []).find(u => u.email === directEmail);
  check(!!directRow?.memberId && !!directRow?.fullName !== undefined,
    'the directory row carries memberId, the key the screens act on');

  section('15. Verbs the screens actually send');
  // Each of these answered 405 until the routes gained a PUT alias, which the
  // UI reported to users as an unexplained failure.

  if (directRow?.memberId) {
    const put = await A.json(`/api/admin/users/${directRow.memberId}`, {
      method: 'PUT', body: JSON.stringify({ role: 'support_staff', employmentType: '', departmentId: '' }),
    });
    check(put.ok, `PUT edits a member (${put.status})`, put.body?.error?.message);
    check(put.body?.data?.role === 'support_staff', 'the role change is applied');
    check(put.body?.data?.employmentType === 'full_time',
      'a blank NOT NULL column is left alone rather than nulled');

    const deact = await A.json(`/api/admin/users/${directRow.memberId}`, { method: 'DELETE' });
    check(deact.ok, `a member can be deactivated (${deact.status})`);
  }

  /**
   * PUT is aliased to PATCH, and it has to save something.
   *
   * This used to send `{ settings: [] }` — an empty list, which writes nothing.
   * It proved the verb was routed and nothing else, and it now returns 422
   * because a request that changes nothing is no longer reported as saved.
   * Sending a real value asserts both halves.
   */
  const putSettings = await A.json('/api/admin/settings', {
    method: 'PUT', body: JSON.stringify({ industry: 'Verification' }),
  });
  check(putSettings.ok, `PUT saves settings (${putSettings.status})`,
    putSettings.body?.error?.message);
  check(putSettings.body?.data?.organization?.industry === 'Verification',
    `and the value is stored (${putSettings.body?.data?.organization?.industry})`);

  const emptySettings = await A.json('/api/admin/settings', {
    method: 'PUT', body: JSON.stringify({ settings: {} }),
  });
  check(emptySettings.status === 422,
    `a settings request that writes nothing is refused (${emptySettings.status})`);

  section('16. Contracts the forms depend on');

  // Finance sent `items` as a JSON string; the route reads `line_items` as an
  // array, so every invoice was rejected as having no lines.
  const invCompany = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `Billed ${Date.now()}` }),
  });
  const invoice = await A.json('/api/finance/invoices', {
    method: 'POST',
    body: JSON.stringify({
      companyId: invCompany.body?.data?.id,
      status: 'draft',
      lineItems: [{ description: 'Consulting', quantity: 3, unitPrice: 100 }],
      taxRate: 10,
      dueDate: '2030-01-01',
    }),
  });
  check(invoice.status === 201, `an invoice is created from the form's payload (${invoice.status})`,
    invoice.body?.error?.message);
  check(invoice.body?.data?.taxAmount === 30 && invoice.body?.data?.total === 330,
    `tax and total are derived server-side (${invoice.body?.data?.taxAmount}, ${invoice.body?.data?.total})`);
  check((invoice.body?.data?.lineItems ?? []).length === 1, 'the line item is stored');

  // Calendar sent startDate/endDate/color; the column names are
  // starts_at/ends_at/colour, so every event was rejected.
  const event = await A.json('/api/calendar/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Standup',
      startsAt: '2030-01-01T09:00:00Z',
      endsAt: '2030-01-01T09:30:00Z',
      colour: '#8b5cf6',
    }),
  });
  check(event.status === 201, `an event is created from the form's payload (${event.status})`,
    event.body?.error?.message);
  check(!!event.body?.data?.startsAt && event.body?.data?.colour === '#8b5cf6',
    'the event reads back under the names the calendar renders');

  // A trigger set NEW.updated_at on a table whose column is edited_at, so
  // every message update aborted.
  const editChan = await A.json('/api/communication/channels', {
    method: 'POST', body: JSON.stringify({ name: `verify-edit-${Date.now()}` }),
  });
  const posted = await A.json('/api/communication/messages', {
    method: 'POST', body: JSON.stringify({ channelId: editChan.body?.data?.id, body: 'first' }),
  });
  const editedMsg = await A.json(`/api/communication/messages/${posted.body?.data?.id}`, {
    method: 'PUT', body: JSON.stringify({ body: 'edited' }),
  });
  check(editedMsg.ok, `a message can be edited (${editedMsg.status})`, editedMsg.body?.error?.message);
  check(editedMsg.body?.data?.body === 'edited', 'the edit is persisted');

  // ─────────────────────────────────────────────────────────────────────────
  section('17. Emailed links can be redeemed');
  // No route consumed the code an authentication email returns with, so
  // confirming an address signed nobody in and every password reset failed.

  const resetEmail = `verify-reset-${Date.now()}@example.com`;
  userE = await adminCreateUser(resetEmail, PW);
  const recovery = await adminGenerateLink(
    'recovery', resetEmail, `${BASE}/auth/callback?next=/reset-password`,
  );

  const R = makeClient();
  const cb = await R.fetch(
    `/auth/callback?token_hash=${recovery.hashed_token}&type=recovery&next=/reset-password`,
  );
  check(cb.status === 307 || cb.status === 302, `the callback redeems a recovery link (${cb.status})`);
  check((cb.headers.get('location') ?? '').endsWith('/reset-password'),
    'and forwards to the page that sets the password');

  // /reset-password used to sit in the proxy's "auth pages" list, so the
  // recovery session it depends on got it redirected to /dashboard instead.
  const resetPage = await R.fetch('/reset-password');
  check(resetPage.status === 200, `/reset-password is reachable with a recovery session (${resetPage.status})`);

  const NEW_PW = 'Passw0rd!verify-2';
  const changed = await R.json('/api/auth/reset-password', {
    method: 'POST', body: JSON.stringify({ password: NEW_PW }),
  });
  check(changed.ok, `the password is actually changed (${changed.status})`, changed.body?.error?.message);

  const withNew = await makeClient().json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: resetEmail, password: NEW_PW }),
  });
  check(withNew.ok, `the new password signs in (${withNew.status})`);
  const withOld = await makeClient().json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: resetEmail, password: PW }),
  });
  check(withOld.status === 401, `the old password no longer works (${withOld.status})`);

  const badLink = await makeClient().fetch('/auth/callback?token_hash=not-a-real-token&type=recovery');
  const badTarget = badLink.headers.get('location') ?? '';
  check(badTarget.includes('/login?error='),
    'a dead link lands on sign-in carrying the reason, not a blank page');

  section('18. Sessions that are no longer valid');
  // The proxy routes on cookie presence, so an expired token used to be a
  // lockout: /dashboard was allowed through, the page bounced to /login, and
  // the proxy bounced it straight back. A blank screen with no way out.

  const stale = makeClient();
  const staleName = `sb-${new URL(SUPABASE).hostname.split('.')[0]}-auth-token`;

  const staleApi = await stale.json('/api/auth/session', {
    headers: { cookie: `${staleName}=not-a-real-token` },
  });
  check(staleApi.body?.data?.user === null,
    'the server reports no user for an unusable token');

  const cleared = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST', headers: { cookie: `${staleName}=not-a-real-token` },
  });
  const clearing = (cleared.headers.getSetCookie?.() ?? []).filter(
    c => c.startsWith(staleName) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
  );
  check(clearing.length > 0,
    'signing out clears an unparseable cookie, which is what breaks the loop');

  section('19. Sign-in tells people what is actually wrong');

  const unconfirmedEmail = `verify-unconfirmed-${Date.now()}@example.com`;
  userF = await adminCreateUser(unconfirmedEmail, PW, { email_confirm: false });

  const unconfirmed = await makeClient().json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: unconfirmedEmail, password: PW }),
  });
  check(unconfirmed.body?.error?.code === 'EMAIL_NOT_CONFIRMED',
    `an unconfirmed account is named as such, not "invalid password" (${unconfirmed.status})`);

  // The disclosure above is bounded: it takes the correct password to see it.
  const unconfirmedWrongPw = await makeClient().json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: unconfirmedEmail, password: 'not-the-password' }),
  });
  check(unconfirmedWrongPw.body?.error?.code === 'AUTH_ERROR',
    'without the password it stays indistinguishable from any other failure');

  // Resend asks for no password, so it must give nothing away at all.
  const resendKnown = await makeClient().json('/api/auth/resend-confirmation', {
    method: 'POST', body: JSON.stringify({ email: unconfirmedEmail }),
  });
  const resendUnknown = await makeClient().json('/api/auth/resend-confirmation', {
    method: 'POST', body: JSON.stringify({ email: `nobody-${Date.now()}@example.com` }),
  });
  check(
    resendKnown.status === resendUnknown.status &&
      JSON.stringify(resendKnown.body) === JSON.stringify(resendUnknown.body),
    'resend answers identically for a registered and an unknown address',
  );

  // ─────────────────────────────────────────────────────────────────────────
  section('20. Provisioning an employee directly');
  // The third way into an organization, alongside owner signup and invitation.
  // All three must end at the same membership model.

  const staffEmail = `verify-staff-${Date.now()}@example.com`;
  const provisioned = await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: staffEmail, firstName: 'Provisioned', lastName: 'Staff',
      phone: '+44 7700 900321', jobTitle: 'Payroll Officer',
      employmentType: 'part_time', role: 'hr_staff', hiredOn: '2030-01-01',
    }),
  });
  check(provisioned.status === 201, `an employee is provisioned (${provisioned.status})`,
    provisioned.body?.error?.message);
  provisionedUserId = provisioned.body?.data?.member?.userId;

  const tempPassword = provisioned.body?.data?.temporaryPassword;
  check(typeof tempPassword === 'string' && tempPassword.length >= 12,
    `a temporary password is issued (${tempPassword?.length} characters)`);
  check(!/^(changeme|password|123456)/i.test(tempPassword ?? ''),
    'and is not one of the hardcoded values this replaced');
  check(provisioned.body?.data?.mustChangePassword === true,
    'the account is flagged to change it');

  const staffRow = (await A.json('/api/admin/users?pageSize=100')).body?.data
    ?.find(u => u.email === staffEmail);
  check(staffRow?.jobTitle === 'Payroll Officer' && staffRow?.phone === '+44 7700 900321',
    'the profile fields reached the profile');
  check(staffRow?.role === 'hr_staff' && staffRow?.employmentType === 'part_time',
    'the membership carries the role and employment type');

  // The password must not be readable back from anywhere.
  check(!('temporaryPassword' in (staffRow ?? {})) && !('password' in (staffRow ?? {})),
    'the directory exposes no password field for an administrator to read');

  section('21. The temporary password is genuinely temporary');

  const S = makeClient();
  const staffLogin = await S.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: staffEmail, password: tempPassword }),
  });
  check(staffLogin.ok, `the employee can sign in with it (${staffLogin.status})`);

  const staffSession = await S.json('/api/auth/session');
  check(staffSession.body?.data?.mustChangePassword === true,
    'the session says the password must be changed');

  // Enforcement has to be the server's, not a redirect the client could skip.
  const blockedHr = await S.json('/api/hr/employees');
  const blockedDash = await S.json('/api/dashboard');
  check(blockedHr.body?.error?.code === 'PASSWORD_CHANGE_REQUIRED' &&
        blockedDash.body?.error?.code === 'PASSWORD_CHANGE_REQUIRED',
    `every module is refused until it is changed (${blockedHr.status})`);

  const wrongCurrent = await S.json('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword: 'not-it', newPassword: 'Chosen!2030aa' }),
  });
  check(wrongCurrent.status === 403,
    `changing it without the current password is refused (${wrongCurrent.status})`);

  const reused = await S.json('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword: tempPassword, newPassword: tempPassword }),
  });
  check(reused.status === 422, `reusing the same password is refused (${reused.status})`);

  const OWN_PW = 'Chosen!2030aa';
  const chosen = await S.json('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword: tempPassword, newPassword: OWN_PW }),
  });
  check(chosen.ok, `the employee sets their own password (${chosen.status})`, chosen.body?.error?.message);

  const afterChange = await S.json('/api/hr/employees');
  check(afterChange.ok, `and the modules open up (${afterChange.status})`);

  const staleTemp = await makeClient().json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: staffEmail, password: tempPassword }),
  });
  check(staleTemp.status === 401, `the temporary password stops working (${staleTemp.status})`);

  section('22. Administrator controls, without seeing the password');

  const reset = await A.json(`/api/admin/users/${staffRow.memberId}/reset-password`, { method: 'POST' });
  check(reset.ok, `an administrator can issue a new temporary password (${reset.status})`);
  check(reset.body?.data?.temporaryPassword !== tempPassword,
    'and it is a different one, not the original re-shown');

  const afterReset = await makeClient().json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: staffEmail, password: OWN_PW }),
  });
  check(afterReset.status === 401, `the employee's own password is revoked by the reset (${afterReset.status})`);

  const suspended = await A.json(`/api/admin/users/${staffRow.memberId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'suspended' }),
  });
  check(suspended.body?.data?.status === 'suspended' && suspended.body?.data?.isActive === false,
    'suspending also closes access, because the trigger keeps is_active in step');

  const reactivated = await A.json(`/api/admin/users/${staffRow.memberId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'active' }),
  });
  check(reactivated.body?.data?.isActive === true, 'reactivating restores it');

  const terminated = await A.json(`/api/admin/users/${staffRow.memberId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'terminated' }),
  });
  check(terminated.body?.data?.status === 'terminated' && !!terminated.body?.data?.terminatedOn,
    'terminating records the date');

  // The legacy endpoint writes is_active alone; the trigger must not read that
  // as a demotion from terminated back to merely suspended.
  await A.json(`/api/admin/users/${staffRow.memberId}`, { method: 'DELETE' });
  const stillTerminated = await A.json(`/api/admin/users/${staffRow.memberId}`);
  check(stillTerminated.body?.data?.status === 'terminated',
    'a plain deactivate does not downgrade a termination');

  section('23. Rejections that say what is wrong');

  const cases = [
    [{ email: `x-${Date.now()}@example.com` }, 'First and last name are required'],
    [{ email: `x-${Date.now()}@example.com`, firstName: 'A', lastName: 'B', role: 'wizard' }, 'is not a role'],
    [{ email: `x-${Date.now()}@example.com`, firstName: 'A', lastName: 'B', employmentType: 'freelance' }, 'is not an employment type'],
    [{ email: `x-${Date.now()}@example.com`, firstName: 'A', lastName: 'B', departmentId: '00000000-0000-0000-0000-000000000000' }, 'department does not exist'],
    [{ email: staffEmail, firstName: 'A', lastName: 'B' }, 'already a member'],
  ];
  for (const [body, expected] of cases) {
    const r = await A.json('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
    check(
      r.status >= 400 && (r.body?.error?.message ?? '').includes(expected),
      `refused with a written reason: "${expected}"`,
      `${r.status} ${r.body?.error?.message}`,
    );
  }

  section('24. The other two routes in still work');
  // Provisioning must not have disturbed owner signup or invitation.

  const ownerStillWorks = await A.json('/api/auth/session');
  check(ownerStillWorks.body?.data?.user?.role === 'owner' &&
        !ownerStillWorks.body?.data?.mustChangePassword,
    'an owner who signed up normally is unaffected');

  const inviteStillWorks = await A.json('/api/auth/invite', {
    method: 'POST', body: JSON.stringify({ email: `verify-inv-${Date.now()}@example.com`, role: 'employee' }),
  });
  check(inviteStillWorks.status === 201, `invitations are still issued (${inviteStillWorks.status})`,
    inviteStillWorks.body?.error?.message);
  check(!!inviteStillWorks.body?.data?.inviteUrl, 'and still carry a redeemable link');

  // ─────────────────────────────────────────────────────────────────────────
  section('25. Company settings actually take effect');
  // organizations.currency has always been stored and never read: every
  // formatCurrency() call used the function's USD default, so a workspace
  // could set naira, see it saved, and watch every module carry on in dollars.

  const settingsSaved = await A.json('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({
      name: `Alpha ${run} Ltd`,
      currency: 'NGN',
      phone: '+234 801 234 5678',
      country: 'NG', state: 'Lagos', city: 'Lagos',
      addressLine: '12 Adeola Odeku Street',
      timezone: 'Africa/Lagos',
      settings: { taxRate: '7.5', invoicePrefix: 'AL-' },
    }),
  });
  check(settingsSaved.ok, `settings save (${settingsSaved.status})`, settingsSaved.body?.error?.message);

  const reread = await A.json('/api/admin/settings');
  const savedOrg = reread.body?.data?.organization ?? {};
  check(savedOrg.currency === 'NGN', `the currency reaches the organization row (${savedOrg.currency})`);
  check(savedOrg.phone === '+234 801 234 5678' && savedOrg.country === 'NG',
    'phone and country persist — they had no columns to persist into before');
  check(savedOrg.state === 'Lagos' && savedOrg.city === 'Lagos' && !!savedOrg.addressLine,
    'the Nigerian address fields persist');
  check(reread.body?.data?.settings?.taxRate === '7.5',
    'extras still go to the key/value store, not into numeric keys');

  // What the client formats money with comes from here.
  const sessionOrg = (await A.json('/api/auth/session')).body?.data?.organization;
  check(sessionOrg?.currency === 'NGN' && sessionOrg?.locale === 'en-NG',
    `the session carries currency and locale to the formatters (${sessionOrg?.currency}/${sessionOrg?.locale})`);

  const badCurrency = await A.json('/api/admin/settings', {
    method: 'PUT', body: JSON.stringify({ currency: 'XYZ' }),
  });
  check(badCurrency.status === 422,
    `an unsupported currency is refused before it can break every screen (${badCurrency.status})`);
  check((badCurrency.body?.error?.message ?? '').includes('NGN'),
    'and the refusal lists what is supported');

  section('26. "All" in a filter means all, not a value to look up');
  // Every dropdown has a show-everything option, and the modules spell it
  // differently — `all`, `_all`, empty. Any of them reaching an enum column
  // produced 22P02, surfaced as "One of the filter values is not valid for
  // this field" with no clue which field or what to do about it.

  const sentinelChecks = [
    ['/api/crm/leads?status=all', 'CRM leads'],
    ['/api/crm/deals?stage=_all', 'CRM deals'],
    ['/api/hr/leave?status=all&type=all', 'HR leave'],
    ['/api/hr/attendance?status=all', 'HR attendance'],
    ['/api/projects/projects?status=all', 'projects'],
    ['/api/projects/tasks?status=all&priority=all', 'tasks'],
    ['/api/finance/invoices?status=all', 'invoices'],
    ['/api/inventory/purchase-orders?status=all', 'purchase orders'],
    ['/api/inventory/movements?type=all', 'stock movements'],
    ['/api/support/tickets?status=all', 'tickets'],
    ['/api/admin/users?role=all', 'the directory'],
  ];
  for (const [url, label] of sentinelChecks) {
    const r = await A.json(url);
    check(r.ok, `${label} accept it as no filter (${r.status})`, r.body?.error?.message);
  }

  // A genuinely wrong value must still be refused — and now say what it was.
  const reallyInvalid = await A.json('/api/crm/leads?status=wibble');
  check(reallyInvalid.status === 422, `a real typo is still refused (${reallyInvalid.status})`);
  check((reallyInvalid.body?.error?.message ?? '').includes('wibble'),
    'and the message names the offending value instead of describing it');

  section('27. The attendance register can render what it is sent');
  // The tab typed rows as `date`/`checkInAt`/`user`; the endpoint returns
  // `workDate`/`checkedInAt`/`member`. Grouping did `r.date.slice(0, 10)`, so
  // the first record to exist threw during render and the error boundary
  // replaced the whole module — which looked like check-in breaking the page.

  await A.json('/api/hr/attendance/clock', { method: 'POST', body: JSON.stringify({ action: 'in' }) });
  const register = await A.json('/api/hr/attendance?pageSize=10');
  const row = (register.body?.data ?? [])[0];

  check(!!row?.workDate, 'a row carries workDate, which the register groups on');
  check('checkedInAt' in (row ?? {}), 'and checkedInAt, which the clock card reads');
  check(row?.member !== undefined, 'the person is under `member`, with the name on the profile');

  const meta = register.body?.meta ?? {};
  check(typeof meta.attendanceRate === 'number' && typeof meta.punctualityRate === 'number',
    'the summary reaches meta — it was computed and then discarded');
  check(typeof meta.expectedDays === 'number' && meta.expectedDays > 0,
    `expected working days are reported (${meta.expectedDays})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('28. No placeholder identifiers reach the database');
  // Ownership fields defaulted to the literal string 'u1', left over from
  // before authentication existed. Every uuid column rejected it, and because
  // the placeholder is truthy it also overrode the server-side default the
  // routes already apply.

  const withPlaceholder = await A.json('/api/crm/leads', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'Placeholder', lastName: 'Probe', ownerId: 'u1' }),
  });
  check(withPlaceholder.status === 422,
    `a non-uuid owner is refused rather than reaching Postgres (${withPlaceholder.status})`);

  const withoutOwner = await A.json('/api/crm/leads', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'Server', lastName: 'Assigned' }),
  });
  check(withoutOwner.status === 201, `an omitted owner is accepted (${withoutOwner.status})`);
  check(!!withoutOwner.body?.data?.ownerId,
    'and the server assigns the caller, which is what the forms now rely on');

  section('29. CRM saves what the form collects');
  // The lead form sent company/title/value; the columns are
  // company_name/job_title/estimated_value. All three were dropped on every
  // save and the API still answered 201, so the loss was invisible.

  const lead29 = await A.json('/api/crm/leads', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Chidi', lastName: 'Okeke',
      companyName: 'Zenith Ltd', jobTitle: 'CTO', estimatedValue: 750000,
      status: 'qualified', score: 80,
    }),
  });
  const L29 = lead29.body?.data ?? {};
  check(L29.companyName === 'Zenith Ltd', `the lead's company is stored (${L29.companyName})`);
  check(L29.jobTitle === 'CTO', `the lead's job title is stored (${L29.jobTitle})`);
  check(L29.estimatedValue === 750000, `the lead's value is stored (${L29.estimatedValue})`);

  const dealCo = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `Dangote ${run}` }),
  });
  const dealCt = await A.json('/api/crm/contacts', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'Ngozi', lastName: 'Eze', companyId: dealCo.body?.data?.id }),
  });
  check(dealCt.body?.data?.companyId === dealCo.body?.data?.id,
    'a contact links to its company by id');

  const deal29 = await A.json('/api/crm/deals', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Supply contract', value: 5000000, stage: 'proposal', probability: 60,
      expectedClose: '2030-12-31',
      companyId: dealCo.body?.data?.id, contactId: dealCt.body?.data?.id,
    }),
  });
  const D29 = deal29.body?.data ?? {};
  check(!!D29.expectedClose, `the deal's close date is stored (${D29.expectedClose})`);
  check(D29.company?.name === `Dangote ${run}`, 'and it reads back with its company');
  check(D29.contact?.firstName === 'Ngozi', 'and with its contact');

  section('30. Money is recorded in the organization currency');
  // Invoices and expenses hardcoded 'USD', so a naira workspace stored every
  // record in dollars while the screen showed naira.

  const ngnInvoice = await A.json('/api/finance/invoices', {
    method: 'POST',
    body: JSON.stringify({
      companyId: dealCo.body?.data?.id,
      lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 100000 }],
      dueDate: '2030-01-01',
    }),
  });
  check(ngnInvoice.body?.data?.currency === 'NGN',
    `an invoice is stored in the organization currency (${ngnInvoice.body?.data?.currency})`);

  const ngnExpense = await A.json('/api/finance/expenses', {
    method: 'POST',
    body: JSON.stringify({ title: 'Fuel', amount: 25000, category: 'travel', expenseDate: '2026-07-01' }),
  });
  check(ngnExpense.body?.data?.currency === 'NGN',
    `an expense is too (${ngnExpense.body?.data?.currency})`);

  section('31. The project board is given real progress');
  // v_project_health has computed these since 0007 and nothing read it; the
  // board derived progress from fields the endpoint never returned, so every
  // project showed 0 tasks and 0%.

  const board = await A.json('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `Rollout ${run}`, budget: 12000000, status: 'active',
      startDate: '2026-07-01', endDate: '2030-12-31',
    }),
  });
  const boardId = board.body?.data?.id;
  for (const [title, status] of [['Design', 'done'], ['Build', 'in_progress'], ['Test', 'todo']]) {
    await A.json('/api/projects/tasks', {
      method: 'POST', body: JSON.stringify({ title, projectId: boardId, status }),
    });
  }
  const boardRow = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === boardId);
  check(boardRow?.totalTasks === 3, `the card is told the task count (${boardRow?.totalTasks})`);
  check(boardRow?.completedTasks === 1, `and how many are done (${boardRow?.completedTasks})`);
  check(typeof boardRow?.progressPct === 'number' && boardRow.progressPct > 0,
    `and the progress percentage (${boardRow?.progressPct}%)`);
  check(boardRow?.owner?.profiles !== undefined,
    'the owner resolves far enough to render a name');

  section('32. Chat sends what the endpoint reads');
  // The composer posted the pre-migration field name, which the endpoint does
  // not read, so every send was refused as an empty message.

  const chatChannel = await A.json('/api/communication/channels', {
    method: 'POST', body: JSON.stringify({ name: `chat-${run}` }),
  });
  const oldShape = await A.json('/api/communication/messages', {
    method: 'POST',
    body: JSON.stringify({ content: 'hello', channelId: chatChannel.body?.data?.id }),
  });
  check(oldShape.status === 422, `the pre-migration field name is still refused (${oldShape.status})`);

  const newShape = await A.json('/api/communication/messages', {
    method: 'POST',
    body: JSON.stringify({ body: 'hello', channelId: chatChannel.body?.data?.id }),
  });
  check(newShape.status === 201, `what the composer now sends is accepted (${newShape.status})`);
  const meMember = (await A.json('/api/auth/session')).body?.data?.user?.memberId;
  check(!!meMember && newShape.body?.data?.senderId === meMember,
    'and the sender is the caller, so ownership styling can be resolved');


  // ─────────────────────────────────────────────────────────────────────────
  section('33. A project has a team');
  // `project_members` and its RLS policy shipped in the first migrations and
  // no endpoint ever touched them, so a project had exactly one person — its
  // owner — and no way to record that several people were working on it.

  const teamProject = await A.json('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({ name: `Team project ${run}`, startDate: '2026-07-01', endDate: '2030-12-31' }),
  });
  const teamProjectId = teamProject.body?.data?.id;

  const teamMate = await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: `teammate-${run}@example.com`, firstName: 'Bola', lastName: 'Dev', role: 'employee',
    }),
  });
  teammateUserId = teamMate.body?.data?.member?.userId;
  const teamMateId = teamMate.body?.data?.member?.id;

  const added = await A.json('/api/projects/members', {
    method: 'POST',
    body: JSON.stringify({ projectId: teamProjectId, memberId: teamMateId, role: 'lead', allocationPct: 60 }),
  });
  check(added.status === 201, `someone can be added to a project (${added.status})`,
    added.body?.error?.message);
  check(added.body?.data?.role === 'lead' && added.body?.data?.allocationPct === 60,
    'with a project role and an allocation');
  check(!!added.body?.data?.member?.profiles,
    'and resolves to a real person rather than an id');

  const addedTwice = await A.json('/api/projects/members', {
    method: 'POST',
    body: JSON.stringify({ projectId: teamProjectId, memberId: teamMateId, role: 'contributor' }),
  });
  check(addedTwice.status === 409, `the same person cannot be added twice (${addedTwice.status})`);

  const badProjectRole = await A.json('/api/projects/members', {
    method: 'POST',
    body: JSON.stringify({ projectId: teamProjectId, memberId: teamMateId, role: 'wizard' }),
  });
  check(badProjectRole.status === 422, `an invented project role is refused (${badProjectRole.status})`);

  section('34. A project has a roadmap');
  // `milestones` was in the same state, with tasks.milestone_id pointing at a
  // table nothing could write to.

  const phases = ['Design complete', 'Build complete', 'Launch'];
  const phaseIds = [];
  for (let i = 0; i < phases.length; i++) {
    const m = await A.json('/api/projects/milestones', {
      method: 'POST',
      body: JSON.stringify({
        projectId: teamProjectId, name: phases[i],
        dueDate: `2030-0${i + 1}-01`, sortOrder: i, ownerId: teamMateId,
      }),
    });
    phaseIds.push(m.body?.data?.id);
    if (i === 0) {
      check(m.status === 201, `a milestone can be created (${m.status})`, m.body?.error?.message);
      check(!!m.body?.data?.owner?.profiles, 'with an owner who is accountable for it');
    }
  }

  const roadmap = await A.json(`/api/projects/milestones?projectId=${teamProjectId}`);
  const order = (roadmap.body?.data ?? []).map(m => m.name);
  check(order[0] === 'Design complete' && order[2] === 'Launch',
    `the roadmap reads first phase first (${order.join(' -> ')})`);

  section('35. Finishing a phase moves the project and tells the team');

  const beforePhase = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === teamProjectId);
  check(beforePhase?.totalMilestones === 3,
    `the board is told how many phases there are (${beforePhase?.totalMilestones})`);
  check(beforePhase?.progressPct === 0, `and that none are done yet (${beforePhase?.progressPct}%)`);

  /**
   * Status gates the ends of the range, so the project has to start before it
   * can report progress.
   *
   * `progress_pct` used to be a bare ratio of completed milestones, which meant
   * a project still being drafted reported delivery. Someone sketching a backlog
   * and ticking two throwaway tasks showed 40% complete on work that had not
   * begun, and the client portal showed the customer the same figure. The
   * specification is explicit — "Planning 0%" — so `planning` now reports zero
   * whatever is in the plan, and this project is in `planning` until moved.
   */
  const stillPlanning = await A.json('/api/projects/projects?pageSize=100');
  check(
    (stillPlanning.body?.data ?? []).find(p => p.id === teamProjectId)?.status === 'planning',
    'the project is still in planning',
  );

  const started = await A.json(`/api/projects/projects/${teamProjectId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'active' }),
  });
  check(started.ok, `work can begin on it (${started.status})`, started.body?.error?.message);

  const justStarted = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === teamProjectId);
  check(justStarted?.progressPct === 10,
    `a started project with nothing done reports the floor, not zero (${justStarted?.progressPct}%)`);

  const completed = await A.json(`/api/projects/milestones/${phaseIds[0]}`, {
    method: 'PATCH', body: JSON.stringify({ completed: true }),
  });
  check(completed.ok, `a phase can be marked complete (${completed.status})`);
  check(!!completed.body?.data?.completedAt, 'and the server stamps when, not the client');

  const afterPhase = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === teamProjectId);
  /**
   * One of three phases, and no tasks on this project yet — so the plan is the
   * only signal and it carries the whole figure. Unchanged from before the
   * weighted model, which is the point: adding signals must not move the answer
   * for a project that only has one.
   */
  check(afterPhase?.progressPct === 33.3,
    `progress follows the plan (${afterPhase?.progressPct}%)`);
  check(afterPhase?.completedMilestones === 1, 'and reports which phases are done');

  /**
   * A phase reporting partial progress now counts, at half credit.
   *
   * `milestones.progress_pct` has had a column, a CHECK constraint and an editor
   * behind it since 0016 and was read by nothing: a phase honestly reported at
   * 80% contributed exactly as much as one not started. It is halved rather than
   * taken at face value because it is self-reported, and a phase that has
   * claimed 90% for a month is the case a status report must not smooth over.
   *
   * 1 complete + 0.8/2 of another, over three phases = 46.7%.
   */
  const reported = await A.json(`/api/projects/milestones/${phaseIds[1]}`, {
    method: 'PATCH', body: JSON.stringify({ progressPct: 80 }),
  });
  check(reported.ok, `a phase can report partial progress (${reported.status})`,
    reported.body?.error?.message);

  const withPartial = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === teamProjectId);
  check(withPartial?.progressPct === 46.7,
    `and it counts at half credit (${withPartial?.progressPct}%)`);

  /**
   * Closing a project is the authoritative statement that it is done.
   *
   * This was the other end of the same defect: a project marked `completed` with
   * one phase left un-ticked stayed at 66.7% for ever, and the portal told the
   * client a finished engagement was two-thirds delivered.
   */
  const closed = await A.json(`/api/projects/projects/${teamProjectId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'completed' }),
  });
  check(closed.ok, `the project can be closed (${closed.status})`);

  const afterClose = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === teamProjectId);
  check(afterClose?.progressPct === 100,
    `a completed project reports 100%, whatever is left un-ticked (${afterClose?.progressPct}%)`);
  check(afterClose?.health === 'on_track',
    `and is never described as at risk (${afterClose?.health})`);

  // Returned to `active` for the sections that follow, which assert on this
  // project's tasks, risks and blockers.
  await A.json(`/api/projects/projects/${teamProjectId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'active' }),
  });

  // Reopening clears the stamp, so a mis-click does not leave a false date.
  const reopened = await A.json(`/api/projects/milestones/${phaseIds[0]}`, {
    method: 'PATCH', body: JSON.stringify({ completed: false }),
  });
  check(reopened.body?.data?.completedAt === null, 'reopening a phase clears its completion date');
  await A.json(`/api/projects/milestones/${phaseIds[0]}`, {
    method: 'PATCH', body: JSON.stringify({ completed: true }),
  });

  section('36. Personal tasks, for people with no project');
  // tasks.project_id has always been nullable so this could exist, but the
  // endpoint demanded `create` on projects — which the `employee` role does
  // not hold. Ordinary staff could not create a task at all.

  const mateTempPassword = teamMate.body?.data?.temporaryPassword;
  const M = makeClient();
  await M.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: `teammate-${run}@example.com`, password: mateTempPassword }),
  });
  await M.json('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: mateTempPassword, newPassword: 'Passw0rd!teammate' }),
  });
  const M2 = makeClient();
  await M2.json('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: `teammate-${run}@example.com`, password: 'Passw0rd!teammate' }),
  });

  const personal = await M2.json('/api/projects/tasks', {
    method: 'POST', body: JSON.stringify({ title: 'Prepare monthly report', priority: 'medium' }),
  });
  check(personal.status === 201,
    `an employee can keep their own task list (${personal.status})`, personal.body?.error?.message);
  check(personal.body?.data?.projectId === null, 'the task belongs to no project');
  check(!!personal.body?.data?.assigneeId, 'and is assigned to them automatically');

  const hijack = await M2.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Your problem now', assigneeId: teamMateId === undefined ? null : '00000000-0000-0000-0000-000000000001' }),
  });
  check(hijack.status === 403 || hijack.status === 422,
    `a personal task cannot be pushed onto someone else (${hijack.status})`);

  // The teammate should have heard about both the project and the phase.
  const mateNotes = await M2.json('/api/admin/notifications');
  const noteTypes = (mateNotes.body?.data ?? []).map(n => n.type);
  check(noteTypes.includes('project_assigned'),
    `being added to a project notifies them (${noteTypes.join(', ') || 'none'})`);
  check(noteTypes.includes('milestone_completed'),
    'and so does a phase completing');

  section('37. The roadmap keeps the work when a phase is dropped');

  const phaseTask = await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Wireframes', projectId: teamProjectId, milestoneId: phaseIds[1] }),
  });
  check(phaseTask.status === 201, `a task can be filed under a phase (${phaseTask.status})`,
    phaseTask.body?.error?.message);

  const crossProject = await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Wrong phase', projectId: madeProject.body?.data?.id, milestoneId: phaseIds[2] }),
  });
  check(crossProject.status === 422,
    `a task cannot be filed under another project's phase (${crossProject.status})`);

  const droppedPhase = await A.json(`/api/projects/milestones/${phaseIds[1]}`, { method: 'DELETE' });
  check(droppedPhase.ok, `a phase can be removed from the plan (${droppedPhase.status})`);

  const orphan = ((await A.json('/api/projects/tasks?pageSize=100')).body?.data ?? [])
    .find(t => t.id === phaseTask.body?.data?.id);
  check(!!orphan, 'its tasks survive — dropping a phase is not deleting the work');
  check(orphan?.milestoneId === null, 'and are detached rather than left pointing at nothing');

  section('38. The new routes are tenant-scoped');

  const outsiderTeam = await B.json(`/api/projects/members?projectId=${teamProjectId}`);
  check(outsiderTeam.status === 404, `B cannot read A's project team (${outsiderTeam.status})`);

  const outsiderPhase = await B.json(`/api/projects/milestones/${phaseIds[2]}`);
  check(outsiderPhase.status === 404, `B cannot read A's roadmap (${outsiderPhase.status})`);

  const outsiderJoin = await B.json('/api/projects/members', {
    method: 'POST',
    body: JSON.stringify({ projectId: teamProjectId, memberId: teamMateId, role: 'manager' }),
  });
  check(outsiderJoin.status === 404, `B cannot put anyone on A's project (${outsiderJoin.status})`);

  section('39. The directory every people picker reads');

  /**
   * The bug this covers: every assignee dropdown called `/api/admin/users`,
   * which needs the admin module. Managers, HR, support and employees all got
   * a 403 and an empty picker — and the rows it returns are shaped for the
   * administration table (`memberId`, `fullName`), not the `{ id, firstName }`
   * the components declared, so even an owner saw "undefined undefined".
   *
   * Asserted on the *field names* rather than just the status, because a 200
   * carrying the wrong shape is exactly how this went unnoticed.
   */
  const peoplePicker = await A.json('/api/directory');
  check(peoplePicker.ok, `the directory is readable without admin rights (${peoplePicker.status})`);

  const colleague = (peoplePicker.body?.data ?? [])[0];
  check(!!colleague, 'and returns real colleagues');
  check(typeof colleague?.memberId === 'string' && colleague.memberId.length > 0,
    'each row carries a memberId, which is what assignee_id references');
  check(typeof colleague?.fullName === 'string' && colleague.fullName.trim() !== '',
    'and a full name — never "undefined undefined"');
  check(!(peoplePicker.body?.data ?? []).some(m => !m.memberId || !m.fullName),
    'no row is missing either, so no picker option can be blank');

  const directoryTask = await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Assigned from the directory',
      projectId: teamProjectId,
      assigneeId: colleague?.memberId,
    }),
  });
  check(directoryTask.status === 201,
    `an id from the directory is accepted as an assignee (${directoryTask.status})`);
  check(!!directoryTask.body?.data?.assignee?.profiles?.fullName,
    'and the task comes back with a named assignee');

  section('40. Personal to-dos are private and separate from tasks');

  /**
   * The guarantee that makes this feature usable: nothing here is visible to
   * anybody else, including administrators, and nothing here touches project
   * reporting.
   */
  const list = await A.json('/api/todos/lists', {
    method: 'POST', body: JSON.stringify({ name: `Today ${Date.now()}`, color: 'emerald' }),
  });
  check(list.status === 201, `a personal list can be created (${list.status})`);

  const todo = await A.json('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title: 'Call the client back', listId: list.body?.data?.id }),
  });
  check(todo.status === 201, `a to-do can be added (${todo.status})`);
  check(todo.body?.data?.isDone === false, 'and starts open');

  const todoId = todo.body?.data?.id;
  const ticked = await A.json(`/api/todos/${todoId}`, {
    method: 'PATCH', body: JSON.stringify({ isDone: true }),
  });
  check(ticked.body?.data?.isDone === true, 'ticking it off works');
  check(!!ticked.body?.data?.completedAt,
    'and the server stamps when — a client cannot backdate its own list');

  // The whole point of the separate table: this must not appear on any board.
  const boardAfterTodo = await A.json('/api/projects/tasks?pageSize=100');
  check(!(boardAfterTodo.body?.data ?? []).some(t => t.title === 'Call the client back'),
    'a to-do never appears in the project task list');

  const outsiderTodos = (await B.json('/api/todos?view=all')).body?.data ?? [];
  check(!outsiderTodos.some(t => t.id === todoId),
    "another user cannot see anyone else's to-dos");

  const stealTodo = await B.json(`/api/todos/${todoId}`, {
    method: 'PATCH', body: JSON.stringify({ title: 'hijacked' }),
  });
  check(stealTodo.status === 404, `nor edit them (${stealTodo.status})`);

  section('41. The notification tray');

  const tray = await A.json('/api/notifications');
  check(tray.ok, `notifications are readable by any signed-in user (${tray.status})`);
  check(typeof tray.body?.meta?.unread === 'number',
    'the unread total is counted across the tray, not just the page');
  check((tray.body?.data ?? []).every(n => 'title' in n && 'body' in n),
    'each carries a title and a body — the store previously read "message", which is not a column');

  const marked = await A.json('/api/notifications', {
    method: 'PATCH', body: JSON.stringify({ ids: [] }),
  });
  check(marked.ok, `everything can be marked read (${marked.status})`);
  check(((await A.json('/api/notifications')).body?.meta?.unread ?? -1) === 0,
    'and the unread count really goes to zero');

  section('42. Holidays change what leave costs');

  /**
   * The point of the holiday calendar: it is not a display setting. A date
   * added here stops consuming entitlement, because `is_working_day()` is what
   * the leave trigger reads.
   */
  const holiday = await A.json('/api/admin/holidays', {
    method: 'POST',
    body: JSON.stringify({ name: 'Verification Day', holidayDate: '2031-06-04' }),
  });
  check(holiday.status === 201, `an admin can add a company holiday (${holiday.status})`);

  const holidayList = await A.json('/api/admin/holidays?year=2031');
  check((holidayList.body?.data ?? []).some(h => h.name === 'Verification Day'),
    'and it appears on the calendar for that year');

  const dupHoliday = await A.json('/api/admin/holidays', {
    method: 'POST',
    body: JSON.stringify({ name: 'Duplicate', holidayDate: '2031-06-04' }),
  });
  check(dupHoliday.status === 409, `two holidays cannot share a date (${dupHoliday.status})`);

  section('43. The client portal shows only what a client should see');

  const portalPreview = await A.json('/api/portal');
  check(portalPreview.status === 422,
    `staff must name a client to preview (${portalPreview.status})`);

  const portalCompany = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `Portal Co ${Date.now()}` }),
  });
  const portalCompanyId = portalCompany.body?.data?.id;

  const portal = await A.json(`/api/portal?companyId=${portalCompanyId}`);
  check(portal.ok, `and can then preview it (${portal.status})`);
  check(portal.body?.data?.readOnly === true,
    'the portal declares itself read-only rather than leaving the UI to infer it');
  check(Array.isArray(portal.body?.data?.projects),
    'it carries the client’s projects');
  check(!JSON.stringify(portal.body?.data?.projects ?? []).includes('"budget"'),
    'and never the budget — a status report, not a window into margins');

  const outsiderPortal = await B.json(`/api/portal?companyId=${portalCompanyId}`);
  check(outsiderPortal.status === 404,
    `another tenant cannot preview it (${outsiderPortal.status})`);

  section('44. Project discussion and deliverables');

  const comment = await A.json('/api/projects/comments', {
    method: 'POST',
    body: JSON.stringify({ projectId: teamProjectId, body: 'Kicking this off.' }),
  });
  check(comment.status === 201, `a comment can be posted (${comment.status})`);
  check(comment.body?.data?.isClientVisible === false,
    'and is internal unless somebody says otherwise');
  check(!!comment.body?.data?.author?.profiles?.fullName,
    'with a named author, not a bare id');

  const badMention = await A.json('/api/projects/comments', {
    method: 'POST',
    body: JSON.stringify({
      projectId: teamProjectId, body: 'Hello',
      mentions: ['00000000-0000-0000-0000-000000000000'],
    }),
  });
  check(badMention.status === 422,
    `mentioning someone who is not a member is refused (${badMention.status})`);

  const outsiderComment = await B.json('/api/projects/comments', {
    method: 'POST',
    body: JSON.stringify({ projectId: teamProjectId, body: 'let me in' }),
  });
  check(outsiderComment.status === 404,
    `another tenant cannot post on the project (${outsiderComment.status})`);

  const overview = await A.json(`/api/projects/projects/${teamProjectId}/overview`);
  check(overview.ok, `the workspace loads in one request (${overview.status})`);
  for (const key of ['project', 'members', 'milestones', 'tasks', 'files', 'comments', 'timeline', 'risks', 'blockers']) {
    check(key in (overview.body?.data ?? {}), `the overview carries "${key}"`);
  }
  check(Array.isArray(overview.body?.data?.risks),
    'risks are derived from the work, not a register somebody maintains by hand');

  section('45. Client → CRM → Project → Portal, end to end');

  /**
   * The chain the product is built around, asserted as one path rather than as
   * four separate features.
   *
   * Two links had to exist for any of it to work, and neither did:
   * `createProjectSchema` omitted `clientCompanyId`, so the field was stripped
   * before the request left the browser; and no endpoint accepted
   * `client_company_id` on a membership, so a client login could never be
   * attached to a customer. A client could sign in perfectly and see nothing.
   *
   * The last two assertions are the point of the whole design: the portal
   * reads the same `v_project_health` row the internal board does, so progress
   * and health cannot disagree between what the team sees and what the
   * customer is told.
   */
  const chainCo = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `Chain Client ${run}` }),
  });
  const chainCompanyId = chainCo.body?.data?.id;
  check(!!chainCompanyId, 'a customer exists in the CRM');

  const chainProject = await A.json('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({ name: `Chain Project ${run}`, clientCompanyId: chainCompanyId, status: 'active' }),
  });
  check(chainProject.status === 201, `a project can be created against that client (${chainProject.status})`);
  check(chainProject.body?.data?.clientCompanyId === chainCompanyId,
    'and the link is persisted rather than silently dropped by the schema');
  const chainProjectId = chainProject.body?.data?.id;

  // Two phases, one complete, so progress is a real number rather than 0.
  await A.json('/api/projects/milestones', {
    method: 'POST', body: JSON.stringify({ projectId: chainProjectId, name: 'Phase one', stage: 'planning' }),
  });
  const chainPhase2 = await A.json('/api/projects/milestones', {
    method: 'POST', body: JSON.stringify({ projectId: chainProjectId, name: 'Phase two', stage: 'development' }),
  });
  await A.json(`/api/projects/milestones/${chainPhase2.body?.data?.id}`, {
    method: 'PATCH', body: JSON.stringify({ completed: true }),
  });

  const clientEmail = `chain-client-${run}@nexustest.dev`;
  chainClientUser = await adminCreateUser(clientEmail, PW);
  await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: clientEmail, firstName: 'Cleo', lastName: 'Client', role: 'client' }),
  });
  const chainDir = await A.json('/api/admin/users?pageSize=100');
  const chainMember = (chainDir.body?.data ?? []).find(u => u.email === clientEmail);
  check(!!chainMember, 'the client account appears in the directory');

  const chainLink = await A.json(`/api/admin/users/${chainMember?.memberId}`, {
    method: 'PUT', body: JSON.stringify({ role: 'client', clientCompanyId: chainCompanyId }),
  });
  check(chainLink.ok, `the client login can be linked to the customer (${chainLink.status})`);

  // The guard: this column means "the customer this login *is*", not "the
  // customer this employee handles".
  const chainBadLink = await A.json(`/api/admin/users/${teamMateId}`, {
    method: 'PUT', body: JSON.stringify({ clientCompanyId: chainCompanyId }),
  });
  check(chainBadLink.status === 422,
    `an employee cannot be linked to a customer (${chainBadLink.status})`);

  const P = makeClient();
  await P.json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: clientEmail, password: PW }) });

  const chainPortal = await P.json('/api/portal');
  check(chainPortal.ok, `the client's portal resolves with no parameters (${chainPortal.status})`);
  check(chainPortal.body?.data?.company?.id === chainCompanyId,
    'and resolves to their own company — a client may read the one company row that is them');

  const portalProject = (chainPortal.body?.data?.projects ?? [])
    .find(p => p.projectId === chainProjectId);
  check(!!portalProject, 'the linked project appears in their portal automatically');

  const boardRows = await A.json('/api/projects/projects?pageSize=100');
  const boardProject = (boardRows.body?.data ?? []).find(p => p.id === chainProjectId);
  check(Number(boardProject?.progressPct) === Number(portalProject?.progressPct),
    `internal and portal progress are the same number (${boardProject?.progressPct} vs ${portalProject?.progressPct})`);
  check(boardProject?.health === portalProject?.health,
    `and so is the health verdict (${boardProject?.health} vs ${portalProject?.health})`);

  const portalDetail = await P.json(`/api/portal/projects/${chainProjectId}`);
  check(portalDetail.ok, `the portal project detail loads (${portalDetail.status})`);
  check((portalDetail.body?.data?.milestones ?? []).length === 2,
    'the whole roadmap is shown, including the phase that is not done');

  // Externals stay external.
  const clientDirPeek = await P.json('/api/directory');
  check(clientDirPeek.status === 403, `a client cannot enumerate staff (${clientDirPeek.status})`);
  const clientTodoPeek = await P.json('/api/todos');
  check(clientTodoPeek.status === 403, `nor reach the personal to-do module (${clientTodoPeek.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  // Identities the sections below share. `C` joined organization A by
  // invitation earlier in this run, so they are a genuine colleague rather
  // than a second tenant — which is what the sharing and channel checks need.
  const sessionA = await A.json('/api/auth/session');
  const memberIdA = sessionA.body?.data?.user?.memberId;
  const orgIdA = sessionA.body?.data?.user?.organizationId;
  const sessionC = await C.json('/api/auth/session');
  const memberIdC = sessionC.body?.data?.user?.memberId;

  section('46. The workspace holds folders, documents and spreadsheets');
  /**
   * The module offered "Document / Spreadsheet / File Vault" and only the
   * first had anywhere to write to. The spreadsheet rendered four fixed sample
   * rows behind a badge reading "Auto-saved"; the vault made an object URL in
   * the browser and reported success. Nothing survived a reload.
   */

  const wsFolder = await A.json('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: `HR Documents ${run}`, isFolder: true }),
  });
  check(wsFolder.status === 201, `a folder can be created (${wsFolder.status})`, wsFolder.body?.error?.message);
  const folderId = wsFolder.body?.data?.id;

  const wsNested = await A.json('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: 'Contracts', isFolder: true, parentId: folderId }),
  });
  check(wsNested.status === 201, `folders nest (${wsNested.status})`, wsNested.body?.error?.message);
  const nestedId = wsNested.body?.data?.id;

  // The cycle guard: a folder inside its own subfolder detaches the subtree
  // from the root and makes every recursive read spin.
  const wsCycle = await A.json(`/api/workspace/pages/${folderId}`, {
    method: 'PATCH', body: JSON.stringify({ parentId: nestedId }),
  });
  check(!wsCycle.ok, `a folder cannot be moved inside its own subfolder (${wsCycle.status})`);

  const wsSelfParent = await A.json(`/api/workspace/pages/${folderId}`, {
    method: 'PATCH', body: JSON.stringify({ parentId: folderId }),
  });
  check(wsSelfParent.status === 422, `nor inside itself (${wsSelfParent.status})`);

  const wsSheet = await A.json('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: 'Expense tracker', kind: 'sheet', parentId: folderId }),
  });
  check(wsSheet.status === 201, `a spreadsheet can be created (${wsSheet.status})`, wsSheet.body?.error?.message);
  const sheetId = wsSheet.body?.data?.id;

  const sheetOpen = await A.json(`/api/workspace/pages/${sheetId}`);
  check((sheetOpen.body?.data?.columns ?? []).length === 3,
    `a new sheet starts with usable columns (${(sheetOpen.body?.data?.columns ?? []).length})`);

  const newCol = await A.json(`/api/workspace/pages/${sheetId}/sheet`, {
    method: 'POST', body: JSON.stringify({ target: 'column', name: 'Amount', type: 'currency' }),
  });
  check(newCol.status === 201, `a column can be added (${newCol.status})`, newCol.body?.error?.message);
  const amountColId = newCol.body?.data?.id;

  const newRow = await A.json(`/api/workspace/pages/${sheetId}/sheet`, {
    method: 'POST', body: JSON.stringify({ target: 'row' }),
  });
  check(newRow.status === 201, `a row can be added (${newRow.status})`);
  const rowId = newRow.body?.data?.id;

  await A.json(`/api/workspace/pages/${sheetId}/sheet`, {
    method: 'PATCH',
    body: JSON.stringify({ target: 'row', rowId, cells: { [amountColId]: 4200 } }),
  });

  const sheetReread = await A.json(`/api/workspace/pages/${sheetId}/sheet`);
  const storedCell = (sheetReread.body?.data?.rows ?? [])[0]?.cells?.[amountColId];
  check(Number(storedCell) === 4200, `a cell survives the round trip (${storedCell})`);

  // Renaming a column must not rewrite a single row: cells are keyed by column
  // id precisely so that this is free and cannot orphan a value.
  await A.json(`/api/workspace/pages/${sheetId}/sheet`, {
    method: 'PATCH', body: JSON.stringify({ target: 'column', columnId: amountColId, name: 'Claim value' }),
  });
  const afterRename = await A.json(`/api/workspace/pages/${sheetId}/sheet`);
  check(Number((afterRename.body?.data?.rows ?? [])[0]?.cells?.[amountColId]) === 4200,
    'renaming a column keeps every value beneath it');

  // Dropping a column drops its cells, rather than leaving invisible values
  // that reappear if the id is ever reused.
  await A.json(`/api/workspace/pages/${sheetId}/sheet?columnId=${amountColId}`, { method: 'DELETE' });
  const afterDrop = await A.json(`/api/workspace/pages/${sheetId}/sheet`);
  check((afterDrop.body?.data?.rows ?? [])[0]?.cells?.[amountColId] === undefined,
    'dropping a column removes its cells');

  // ─────────────────────────────────────────────────────────────────────────
  section('47. Document history exists, and a restore can be undone');

  const doc = await A.json('/api/workspace/pages', {
    method: 'POST', body: JSON.stringify({ title: 'Handbook', content: '# One' }),
  });
  const docId = doc.body?.data?.id;

  await A.json(`/api/workspace/pages/${docId}`, { method: 'PATCH', body: JSON.stringify({ content: '# Two' }) });
  await A.json(`/api/workspace/pages/${docId}`, { method: 'PATCH', body: JSON.stringify({ content: '# Three' }) });

  const history = await A.json(`/api/workspace/pages/${docId}/versions`);
  check((history.body?.data ?? []).length >= 2,
    `every save is snapshotted (${(history.body?.data ?? []).length} versions)`);

  const restored = await A.json(`/api/workspace/pages/${docId}/versions`, {
    method: 'POST', body: JSON.stringify({ version: 1 }),
  });
  check(restored.ok && restored.body?.data?.content === '# One',
    'an earlier version can be restored');

  const historyAfter = await A.json(`/api/workspace/pages/${docId}/versions`);
  check((historyAfter.body?.data ?? []).length > (history.body?.data ?? []).length,
    'and the version that was current is kept, so the restore itself can be undone');

  // ─────────────────────────────────────────────────────────────────────────
  section('48. A workspace folder can be made private');
  /**
   * Every page in the organisation used to be readable and writable by every
   * employee, with no way to say otherwise — which is not a workspace anyone
   * can put an HR folder in.
   */

  const privateFolder = await A.json('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: `Board papers ${run}`, isFolder: true, visibility: 'private' }),
  });
  const privateId = privateFolder.body?.data?.id;
  check(privateFolder.status === 201, `a private folder can be created (${privateFolder.status})`);

  const insidePrivate = await A.json('/api/workspace/pages', {
    method: 'POST', body: JSON.stringify({ title: 'Minutes', parentId: privateId }),
  });
  check(insidePrivate.status === 201, `a page can be created inside it (${insidePrivate.status})`);
  const insideId = insidePrivate.body?.data?.id;

  // C is a colleague in the same organisation, added earlier in this run.
  const colleagueTree = await C.json('/api/workspace/pages?pageSize=500');
  const colleagueSees = (colleagueTree.body?.data ?? []).some(p => p.id === privateId);
  check(!colleagueSees, 'a colleague does not see it in the tree');

  const colleagueOpen = await C.json(`/api/workspace/pages/${insideId}`);
  check(colleagueOpen.status === 404,
    `nor the page inside it, which inherits the rule (${colleagueOpen.status})`);

  const share = await A.json(`/api/workspace/pages/${privateId}/shares`, {
    method: 'POST', body: JSON.stringify({ memberId: memberIdC, permission: 'view' }),
  });
  check(share.status === 201, `it can be shared with a named colleague (${share.status})`, share.body?.error?.message);

  const afterShare = await C.json(`/api/workspace/pages/${insideId}`);
  check(afterShare.ok, `who can then open what is inside it (${afterShare.status})`);
  check(afterShare.body?.data?.permission === 'view',
    `and holds exactly the permission granted (${afterShare.body?.data?.permission})`);

  const colleagueEdit = await C.json(`/api/workspace/pages/${insideId}`, {
    method: 'PATCH', body: JSON.stringify({ content: 'edited by someone with view rights' }),
  });
  check(!colleagueEdit.ok, `view access is not edit access (${colleagueEdit.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('49. Channels, groups and direct messages');
  /**
   * The module could list channels and post to them and nothing else: no way
   * to create one, add anybody, or start a conversation with a colleague.
   */

  const group = await A.json('/api/communication/channels', {
    method: 'POST',
    body: JSON.stringify({
      displayName: `Q3 Launch Team ${run}`,
      description: 'Coordination for the launch',
      type: 'private',
      memberIds: [memberIdC],
    }),
  });
  check(group.status === 201, `a private group can be created (${group.status})`, group.body?.error?.message);
  const groupId = group.body?.data?.id;

  // The name people typed, kept alongside the slug. Slugging alone turned
  // "Q3 Launch Team" into "q3-launch-team" and title-cased it on the way out.
  check(group.body?.data?.displayName === `Q3 Launch Team ${run}`,
    'the name people typed is preserved, not just its slug');

  const groupMembers = await A.json(`/api/communication/channels/${groupId}/members`);
  check((groupMembers.body?.data ?? []).length === 2,
    `the creator and the invitee are both in it (${(groupMembers.body?.data ?? []).length})`);
  check((groupMembers.body?.data ?? []).some(m => m.role === 'owner'),
    'and somebody owns it, so it can still be administered');

  const channelOverview = await A.json('/api/communication/channels');
  const groupRow = (channelOverview.body?.data ?? []).find(c => c.channelId === groupId);
  check(!!groupRow, 'the sidebar overview returns it');
  check(typeof groupRow?.unreadCount === 'number',
    'with a real unread count rather than a hard-coded zero');

  const dm = await A.json('/api/communication/direct', {
    method: 'POST', body: JSON.stringify({ memberId: memberIdC }),
  });
  check(dm.status === 201, `a direct conversation can be opened (${dm.status})`, dm.body?.error?.message);
  const dmId = dm.body?.data?.id;

  const dmAgain = await A.json('/api/communication/direct', {
    method: 'POST', body: JSON.stringify({ memberId: memberIdC }),
  });
  check(dmAgain.body?.data?.id === dmId,
    'and opening it again returns the same thread rather than a second empty one');

  // The pair has to be unique in both directions, or each person ends up in a
  // different half of the same conversation.
  const dmFromOther = await C.json('/api/communication/direct', {
    method: 'POST', body: JSON.stringify({ memberId: memberIdA }),
  });
  check(dmFromOther.body?.data?.id === dmId,
    'including when the other person starts it');

  const dmSelf = await A.json('/api/communication/direct', {
    method: 'POST', body: JSON.stringify({ memberId: memberIdA }),
  });
  check(!dmSelf.ok, `nobody can message themselves (${dmSelf.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('50. A private conversation is private');
  /**
   * `channels_select` was generated by the same loop as `companies` and
   * `products`, so it granted SELECT on every channel row in the organisation.
   * Messages were protected; the channel's existence, name and topic were not,
   * and a direct message between two colleagues was listed in everybody's
   * sidebar.
   */

  const D = makeClient();
  const outsiderEmail = `outsider-${run}@nexustest.dev`;
  outsiderUser = await adminCreateUser(outsiderEmail, PW);
  await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: outsiderEmail, firstName: 'Olu', lastName: 'Outsider', role: 'employee' }),
  });
  await D.json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: outsiderEmail, password: PW }) });

  const outsiderList = await D.json('/api/communication/channels');
  const outsiderRows = outsiderList.body?.data ?? [];
  check(!outsiderRows.some(c => c.channelId === groupId),
    'somebody outside a private group does not see it listed');
  check(!outsiderRows.some(c => c.channelId === dmId),
    'and does not see other people’s direct messages');

  const outsiderOpen = await D.json(`/api/communication/channels/${groupId}`);
  check(outsiderOpen.status === 404,
    `nor can they fetch it by id (${outsiderOpen.status})`);

  const outsiderPost = await D.json('/api/communication/messages', {
    method: 'POST', body: JSON.stringify({ channelId: groupId, body: 'let me in' }),
  });
  check(!outsiderPost.ok,
    `nor post into it, which the old policy allowed (${outsiderPost.status})`);

  const outsiderSelfJoin = await D.json(`/api/communication/channels/${groupId}/members`, {
    method: 'POST', body: JSON.stringify({}),
  });
  check(!outsiderSelfJoin.ok,
    `nor add themselves to it (${outsiderSelfJoin.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('51. Channel administration');

  const generalList = await A.json('/api/communication/channels');
  const general = (generalList.body?.data ?? []).find(c => c.name === 'general');
  check(!!general, 'the seeded company channel is there');

  const announce = await A.json(`/api/communication/channels/${general?.channelId}`, {
    method: 'PATCH', body: JSON.stringify({ postPolicy: 'admins' }),
  });
  check(announce.ok, `an administrator can restrict who may post (${announce.status})`);

  const memberPost = await D.json('/api/communication/messages', {
    method: 'POST', body: JSON.stringify({ channelId: general?.channelId, body: 'hello everyone' }),
  });
  check(!memberPost.ok,
    `an employee then cannot post there (${memberPost.status})`);

  const adminPost = await A.json('/api/communication/messages', {
    method: 'POST', body: JSON.stringify({ channelId: general?.channelId, body: 'company notice' }),
  });
  check(adminPost.status === 201, `while an administrator still can (${adminPost.status})`);

  // Restricting a channel is an organisation-level act, not something any
  // member may do to a room the whole company is in.
  const memberRestrict = await D.json(`/api/communication/channels/${general?.channelId}`, {
    method: 'PATCH', body: JSON.stringify({ postPolicy: 'admins' }),
  });
  check(!memberRestrict.ok,
    `an employee cannot impose that rule themselves (${memberRestrict.status})`);

  await A.json(`/api/communication/channels/${general?.channelId}`, {
    method: 'PATCH', body: JSON.stringify({ postPolicy: 'everyone' }),
  });

  const removeMate = await A.json(`/api/communication/channels/${groupId}/members?memberId=${memberIdC}`, {
    method: 'DELETE',
  });
  check(removeMate.ok, `an administrator can remove somebody (${removeMate.status})`);

  const removedRead = await C.json(`/api/communication/messages?channelId=${groupId}`);
  check(!removedRead.ok || (removedRead.body?.data ?? []).length === 0,
    'and they stop being able to read it');

  const lastAdminLeaves = await A.json(`/api/communication/channels/${groupId}/members`, {
    method: 'DELETE',
  });
  check(lastAdminLeaves.ok || lastAdminLeaves.status === 409,
    `the last administrator cannot strand a channel (${lastAdminLeaves.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('51b. Mentions and threads');
  /**
   * ── Two features wired end to end in the database and unreachable ─────────
   *
   * `messages.mentions` is a uuid array, the endpoint has always accepted it,
   * and `notify_message_mentions` has notified everyone in it since 0016. The
   * composer never sent the field, so the column was empty on every message ever
   * posted and that trigger had never once fired.
   *
   * `messages.parent_id` is the same story: accepted by the endpoint, and the
   * message list already separates roots from replies with `parent_id IS NULL`.
   * Nothing ever sent a parent, so every thread was empty and the filter was
   * dividing a set in two where one half was always the whole thing.
   */

  /**
   * A channel of its own: section 51 removes C from the group and then has A
   * leave it, so by this point nobody is in it and every post is a 403.
   */
  const threadRoom = await A.json('/api/communication/channels', {
    method: 'POST',
    body: JSON.stringify({
      displayName: `Threads ${run}`, type: 'private', memberIds: [memberIdC],
    }),
  });
  const threadRoomId = threadRoom.body?.data?.id;
  check(threadRoom.status === 201, `a channel for this (${threadRoom.status})`,
    threadRoom.body?.error?.message);

  const mentioning = await A.json('/api/communication/messages', {
    method: 'POST',
    body: JSON.stringify({
      channelId: threadRoomId,
      body: 'Morning — could you look at this today?',
      mentions: [memberIdC],
    }),
  });
  check(mentioning.status === 201, `a message can name someone (${mentioning.status})`,
    mentioning.body?.error?.message);
  check(Array.isArray(mentioning.body?.data?.mentions)
    && mentioning.body.data.mentions.includes(memberIdC),
    'and the mention is stored against the message');

  const rootId = mentioning.body?.data?.id;
  check(!!rootId, 'the message has an id to reply to');

  // The trigger that had never fired.
  const mentionedTray = await C.json('/api/notifications');
  const mentionNote = (mentionedTray.body?.data ?? []).find(
    n => /mention/i.test(n.type ?? '') || /mentioned/i.test(n.title ?? ''),
  );
  check(!!mentionNote,
    'the person named is notified about it',
    `tray held: ${(mentionedTray.body?.data ?? []).map(n => n.type).join(', ') || 'nothing'}`);

  const reply = await C.json('/api/communication/messages', {
    method: 'POST',
    body: JSON.stringify({ channelId: threadRoomId, body: 'On it.', parentId: rootId }),
  });
  check(reply.status === 201, `a reply can be posted to it (${reply.status})`,
    reply.body?.error?.message);
  check(!!rootId && reply.body?.data?.parentId === rootId, 'and it records what it answers');

  /**
   * The main timeline must not show the reply — that is what makes it a thread
   * rather than another line in the channel.
   */
  const timeline = await A.json(`/api/communication/messages?channelId=${threadRoomId}&pageSize=100`);
  const timelineIds = (timeline.body?.data ?? []).map(m => m.id);
  check(timelineIds.includes(rootId), 'the root message is in the channel timeline');
  check(!!reply.body?.data?.id && !timelineIds.includes(reply.body.data.id),
    'and the reply is not, because it belongs to the thread');

  /**
   * Both spellings of the parameter. The route read only `parent_id`, so a
   * component asking for `?parentId=` was handed the channel's root messages
   * instead of the thread — no error, just the wrong list.
   */
  const threadSnake = await A.json(
    `/api/communication/messages?channelId=${threadRoomId}&parent_id=${rootId}`,
  );
  check((threadSnake.body?.data ?? []).length === 1,
    `the thread can be fetched with parent_id (${(threadSnake.body?.data ?? []).length})`);

  const threadCamel = await A.json(
    `/api/communication/messages?channelId=${threadRoomId}&parentId=${rootId}`,
  );
  check((threadCamel.body?.data ?? []).length === 1,
    `and with parentId, which the component sends (${(threadCamel.body?.data ?? []).length})`);
  check(threadCamel.body?.data?.[0]?.sender?.profiles?.fullName,
    `a reply carries its author's name (${threadCamel.body?.data?.[0]?.sender?.profiles?.fullName})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('52. A client never reaches internal conversation');

  const clientChannels = await P.json('/api/communication/channels');
  check(clientChannels.status === 403,
    `the communication module is closed to clients (${clientChannels.status})`);

  const clientWorkspace = await P.json('/api/workspace/pages');
  check(clientWorkspace.status === 403,
    `so is the workspace (${clientWorkspace.status})`);

  const clientDm = await P.json('/api/communication/direct', {
    method: 'POST', body: JSON.stringify({ memberId: memberIdA }),
  });
  check(!clientDm.ok, `and they cannot open a thread with staff (${clientDm.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('53. Settings that change how the system behaves');
  /**
   * The columns `work_start`, `work_end`, `work_days`, `grace_minutes` and
   * `break_minutes` have driven attendance classification since 0004 and had
   * no control anywhere in the product. This asserts the round trip *and* the
   * effect, because a setting that saves and changes nothing is the failure
   * mode worth testing for.
   */

  const hoursSaved = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      workStart: '08:00', workEnd: '16:00', graceMinutes: 5, breakMinutes: 45,
      workDays: [1, 2, 3],
    }),
  });
  check(hoursSaved.ok, `working hours save (${hoursSaved.status})`, hoursSaved.body?.error?.message);

  const hoursRead = await A.json('/api/admin/settings');
  const savedOrgRow = hoursRead.body?.data?.organization ?? {};
  check(String(savedOrgRow.workStart).startsWith('08:00'),
    `the start of the day persists (${savedOrgRow.workStart})`);
  check(Array.isArray(savedOrgRow.workDays) && savedOrgRow.workDays.length === 3,
    `and a three-day working week (${JSON.stringify(savedOrgRow.workDays)})`);

  /**
   * The effect. `working_days_between()` reads `work_days`, and the register's
   * expected-days figure is what the attendance rate is computed against — it
   * was being derived from a hard-coded Monday-to-Friday constant in
   * TypeScript, so this setting genuinely did nothing before.
   */
  const threeDayMonth = await A.json('/api/hr/attendance?from=2026-03-01&to=2026-03-31');
  const threeDayExpected = threeDayMonth.body?.meta?.expectedDays;

  await A.json('/api/admin/settings', {
    method: 'PATCH', body: JSON.stringify({ workDays: [1, 2, 3, 4, 5] }),
  });
  const fiveDayMonth = await A.json('/api/hr/attendance?from=2026-03-01&to=2026-03-31');
  const fiveDayExpected = fiveDayMonth.body?.meta?.expectedDays;

  check(fiveDayExpected > threeDayExpected,
    `changing the working week changes the expected days (${threeDayExpected} → ${fiveDayExpected})`);

  const badHours = await A.json('/api/admin/settings', {
    method: 'PATCH', body: JSON.stringify({ workStart: '17:00', workEnd: '09:00' }),
  });
  check(badHours.status === 422, `a day that ends before it starts is refused (${badHours.status})`);

  const noDays = await A.json('/api/admin/settings', {
    method: 'PATCH', body: JSON.stringify({ workDays: [] }),
  });
  check(noDays.status === 422, `and a week with no working days (${noDays.status})`);

  const badZone = await A.json('/api/admin/settings', {
    method: 'PATCH', body: JSON.stringify({ timezone: 'Mars/Olympus' }),
  });
  check(badZone.status === 422,
    `an unrecognised time zone is refused before every date query silently falls back to UTC (${badZone.status})`);

  /**
   * Project defaults, which were stored and read by nothing.
   *
   * `project_defaults` holds statuses, priorities, a default status, a default
   * priority and templates. The administration screen rendered and saved all of
   * it, `org-settings.ts` validated it — and the project form read none of it:
   * the status list came from a TypeScript constant, the priority list from an
   * array literal, and a new project always opened as planning/medium.
   *
   * Asserted through the session, because that is how the form receives them.
   * The form is a client component and cannot be exercised over HTTP, so what
   * is checkable here is that the values it reads are the values that were
   * saved — the same shape of check as the working-week one above.
   */
  const defaultsSaved = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      settings: { projectDefaults: {
        statuses: ['planning', 'active', 'completed'],
        priorities: ['low', 'high', 'critical'],
        defaultStatus: 'active',
        defaultPriority: 'high',
        taskCategories: ['feature', 'bug'],
        milestoneStages: ['planning', 'development', 'review', 'completed'],
        templates: [
          {
            name: `Onboarding ${run}`,
            description: 'Standard client onboarding',
            milestones: ['Kick-off', 'Discovery', 'Handover'],
          },
        ],
      } },
    }),
  });
  check(defaultsSaved.ok, `project defaults save (${defaultsSaved.status})`,
    defaultsSaved.body?.error?.message);

  /**
   * A settings request that changes nothing is refused rather than reported
   * as saved.
   *
   * Policy documents have to arrive wrapped in `settings`. A body naming one at
   * the top level — which is the obvious shape to reach for, and what this
   * harness sent on its first attempt — matched no organization column and no
   * policy key, so nothing was written and the endpoint answered 200 with the
   * organization row attached. The administrator saw a success toast and the
   * setting was discarded. Settings are the worst place for that: they are
   * changed once and then trusted for months.
   */
  const misdirected = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ projectDefaults: { defaultStatus: 'active' } }),
  });
  check(misdirected.status === 422,
    `a setting sent at the wrong level is refused, not silently dropped (${misdirected.status})`);
  check(/inside "settings"/.test(misdirected.body?.error?.message ?? ''),
    `and the message says where it belongs (${misdirected.body?.error?.message})`);

  const sessionDefaults = await A.json('/api/auth/session');
  const pd = sessionDefaults.body?.data?.organization?.policies?.projectDefaults ?? {};
  check(pd.defaultStatus === 'active' && pd.defaultPriority === 'high',
    `and reach the session the project form reads (${pd.defaultStatus}/${pd.defaultPriority})`);
  check(Array.isArray(pd.statuses) && pd.statuses.length === 3,
    `with the status list an administrator chose (${JSON.stringify(pd.statuses)})`);
  check((pd.templates ?? []).some(t => t.milestones?.length === 3),
    'and a template carrying its phases');

  /**
   * A template creates real milestones. The form posts them one by one after
   * the project, in order, so the assertion is that a roadmap built that way
   * comes back in the order it was written.
   */
  const fromTemplate = await A.json('/api/projects/projects', {
    method: 'POST', body: JSON.stringify({ name: `Templated ${run}`, status: 'active' }),
  });
  const templatedId = fromTemplate.body?.data?.id;
  const templatePhases = (pd.templates ?? [])[0]?.milestones ?? [];
  for (let i = 0; i < templatePhases.length; i++) {
    await A.json('/api/projects/milestones', {
      method: 'POST',
      body: JSON.stringify({ projectId: templatedId, name: templatePhases[i], sortOrder: i }),
    });
  }
  /**
   * ── The filter that was silently ignored ──────────────────────────────────
   *
   * `filterable` lists snake_case column names and the list handler read only
   * those, while every component builds its query string in camelCase. So
   * `?projectId=` matched nothing, the query ran unfiltered, and this endpoint
   * returned every milestone in the organisation — a roadmap panel showing
   * other projects' phases, and a Tasks table whose Project filter did nothing
   * at all. Both spellings are accepted now, and both are asserted.
   */
  const templatedRoadmap = await A.json(`/api/projects/milestones?projectId=${templatedId}`);
  const templatedNames = (templatedRoadmap.body?.data ?? []).map(m => m.name);
  check(templatedNames.join(' → ') === 'Kick-off → Discovery → Handover',
    `a template's phases are created in order (${templatedNames.join(' → ')})`);

  const snakeRoadmap = await A.json(`/api/projects/milestones?project_id=${templatedId}`);
  check((snakeRoadmap.body?.data ?? []).length === templatedNames.length,
    `project_id filters the same way projectId does (${(snakeRoadmap.body?.data ?? []).length})`);

  const unfiltered = await A.json('/api/projects/milestones?pageSize=100');
  check((unfiltered.body?.data ?? []).length > templatedNames.length,
    `and without a filter the endpoint really does return more (${(unfiltered.body?.data ?? []).length})`);

  /**
   * The same fault, on the filter a user actually clicks: the Tasks table's
   * Project dropdown sends `?projectId=`.
   */
  const tasksOfProject = await A.json(`/api/projects/tasks?projectId=${teamProjectId}&pageSize=100`);
  const allTasks = await A.json('/api/projects/tasks?pageSize=100');
  check((tasksOfProject.body?.data ?? []).length < (allTasks.body?.meta?.total ?? 0),
    `the Tasks table's project filter narrows the list (${(tasksOfProject.body?.data ?? []).length} of ${allTasks.body?.meta?.total})`);
  check((tasksOfProject.body?.data ?? []).every(t => t.projectId === teamProjectId),
    'and every row it returns belongs to that project');

  // ─────────────────────────────────────────────────────────────────────────
  section('53b. A client signs off a deliverable');
  /**
   * ── The loop that was missing ─────────────────────────────────────────────
   *
   * The portal could show a client what had been produced and gave them no way
   * to respond to it, so acceptance happened in email and the project record
   * never learned the outcome — the team could not tell an unreviewed
   * deliverable from an approved one. It is also the third input to project
   * progress: `v_project_health` scores acceptance alongside plan and
   * execution, which it can only do because a decision is now recorded.
   */

  // Its own client company: the portal assertions below need the project to
  // belong to one, and section 59's company does not exist yet.
  const signOffCo = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `SignOff Co ${run}` }),
  });

  const signOffCoId = signOffCo.body?.data?.id;

  const signOffProject = await A.json('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `Sign-off ${run}`, status: 'active',
      clientCompanyId: signOffCoId ?? null,
    }),
  });
  const signOffId = signOffProject.body?.data?.id;

  // Two tasks, both done, so execution alone would report 100%.
  for (const t of ['Design', 'Build']) {
    const made = await A.json('/api/projects/tasks', {
      method: 'POST', body: JSON.stringify({ title: `${t} ${run}`, projectId: signOffId }),
    });
    await A.json(`/api/projects/tasks/${made.body?.data?.id}`, {
      method: 'PUT', body: JSON.stringify({ status: 'done' }),
    });
  }

  const beforeDeliverable = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === signOffId);
  check(beforeDeliverable?.progressPct === 100,
    `all work done and nothing to accept reports 100% (${beforeDeliverable?.progressPct}%)`);

  const deliverable = await A.json('/api/projects/files', {
    method: 'POST',
    body: JSON.stringify({
      projectId: signOffId, bucket: 'documents',
      path: `${orgIdA}/projects/${signOffId}/${run}-report.pdf`,
      filename: 'report.pdf', sizeBytes: 4096, isClientVisible: true,
    }),
  });
  const deliverableId = deliverable.body?.data?.id;
  check(deliverable.status === 201, `a file is shared with the client (${deliverable.status})`,
    deliverable.body?.error?.message);

  /**
   * A deliverable has to be visible to the client before it can be one:
   * "awaiting their approval" on a file they cannot open is a project waiting
   * for a decision nobody was asked to make.
   */
  const hiddenFile = await A.json('/api/projects/files', {
    method: 'POST',
    body: JSON.stringify({
      projectId: signOffId, bucket: 'documents',
      path: `${orgIdA}/projects/${signOffId}/${run}-internal.pdf`,
      filename: 'internal.pdf', sizeBytes: 128, isClientVisible: false,
    }),
  });
  const hiddenPromote = await A.json(`/api/projects/files/${hiddenFile.body?.data?.id}`, {
    method: 'PATCH', body: JSON.stringify({ requiresApproval: true }),
  });
  check(hiddenPromote.status === 422,
    `an unshared file cannot be put forward for approval (${hiddenPromote.status})`);

  const promote = await A.json(`/api/projects/files/${deliverableId}`, {
    method: 'PATCH', body: JSON.stringify({ requiresApproval: true }),
  });
  check(promote.body?.data?.requiresApproval === true,
    `a shared file can be (${promote.status})`, promote.body?.error?.message);

  const awaiting = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === signOffId);
  /**
   * Execution is 100 at weight 30; acceptance is 0 at weight 20. Renormalised
   * over the two signals this project has: (100x30 + 0x20) / 50 = 60.
   */
  check(awaiting?.progressPct === 60,
    `a deliverable awaiting a decision holds the project back (${awaiting?.progressPct}%)`);

  // A rejection has to say why, or the team has nothing to act on.
  const bareRejection = await A.json(`/api/portal/deliverables/${deliverableId}`, {
    method: 'PATCH', body: JSON.stringify({ decision: 'rejected' }),
  });
  check(bareRejection.status === 422,
    `sending a deliverable back without a reason is refused (${bareRejection.status})`);

  const nonsense = await A.json(`/api/portal/deliverables/${deliverableId}`, {
    method: 'PATCH', body: JSON.stringify({ decision: 'maybe' }),
  });
  check(nonsense.status === 422, `and so is an invented decision (${nonsense.status})`);

  const rejected = await A.json(`/api/portal/deliverables/${deliverableId}`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'rejected', note: 'The totals on page 3 do not add up.' }),
  });
  check(rejected.body?.data?.approvalDecision === 'rejected',
    `a deliverable can be sent back (${rejected.status})`, rejected.body?.error?.message);
  check(!!rejected.body?.data?.approvedAt,
    'and the server stamps when, not the client');

  const afterReject = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === signOffId);
  check(afterReject?.health === 'at_risk',
    `a rejected deliverable puts the project at risk (${afterReject?.health})`);

  const approved = await A.json(`/api/portal/deliverables/${deliverableId}`, {
    method: 'PATCH', body: JSON.stringify({ decision: 'approved' }),
  });
  check(approved.body?.data?.approvalDecision === 'approved',
    `and then approved (${approved.status})`, approved.body?.error?.message);

  const afterApprove = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === signOffId);
  check(afterApprove?.progressPct === 100,
    `acceptance carries the project back to 100% (${afterApprove?.progressPct}%)`);
  check(afterApprove?.health === 'on_track',
    `and off the risk list (${afterApprove?.health})`);

  // The portal reads the same figure, from the same view.
  const portalAfter = await A.json(`/api/portal/projects/${signOffId}`);
  check(Number(portalAfter.body?.data?.project?.progressPct) === Number(afterApprove?.progressPct),
    `the client sees the same number as the board (${portalAfter.body?.data?.project?.progressPct})`);
  check(portalAfter.body?.data?.approvals?.approved === 1,
    `and a count of what they have signed off (${JSON.stringify(portalAfter.body?.data?.approvals)})`);
  check((portalAfter.body?.data?.timeline ?? []).some(t => t.kind === 'deliverable_approved'),
    'with the approval on their timeline');

  /**
   * Withdrawing a file from the client withdraws it as a deliverable.
   *
   * Otherwise `requires_approval` stays true on a file the portal no longer
   * lists, and the project's denominator counts something that can never be
   * approved — progress capped for ever with nothing on screen to explain it.
   */
  const unshared = await A.json(`/api/projects/files/${deliverableId}`, {
    method: 'PATCH', body: JSON.stringify({ isClientVisible: false }),
  });
  check(unshared.body?.data?.requiresApproval === false,
    `unsharing a file stops it being a deliverable (${unshared.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('54. Today\'s attendance is visible on the day it happens');
  /**
   * The register's default window was built from `toISOString()`, which is
   * UTC, while `work_date` is written as `now() AT TIME ZONE
   * organizations.timezone`. For any workspace east of UTC the two disagreed
   * for part of every day and today's rows simply fell outside the query.
   */

  const clockToday = await A.json('/api/hr/attendance/clock');
  const clockDay = clockToday.body?.data?.date;
  const registerNow = await A.json('/api/hr/attendance?pageSize=50');
  const registerTo = registerNow.body?.meta?.to;

  check(clockDay === registerTo,
    `the clock and the register agree on what day it is (${clockDay} vs ${registerTo})`);

  const todaysRow = (registerNow.body?.data ?? []).find(r => r.workDate === clockDay);
  check(!!todaysRow, `today's own record is inside the default window (${clockDay})`);
  check(!!todaysRow && 'checkedInAt' in todaysRow, 'and carries checkedInAt, which the clock card reads');
  check(!!todaysRow?.member, 'the person is under `member`, with the name on the profile');

  // ─────────────────────────────────────────────────────────────────────────
  section('55. Leave policy is enforced, not merely offered');

  await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      settings: {
        leave_policy: {
          types: ['vacation', 'sick'],
          requires_approval: true,
          allow_half_day: false,
          min_notice_days: 0,
          max_consecutive_days: 3,
          carry_over_days: 5,
        },
      },
    }),
  });

  const notOffered = await A.json('/api/hr/leave', {
    method: 'POST',
    body: JSON.stringify({ type: 'paternity', startDate: '2026-09-01', endDate: '2026-09-02' }),
  });
  check(notOffered.status === 422,
    `a type the company does not offer is refused (${notOffered.status})`);
  check((notOffered.body?.error?.message ?? '').toLowerCase().includes('paternity'),
    'and the refusal names it rather than describing it');

  const tooLong = await A.json('/api/hr/leave', {
    method: 'POST',
    body: JSON.stringify({ type: 'vacation', startDate: '2026-09-01', endDate: '2026-09-30' }),
  });
  check(tooLong.status === 422, `so is a request past the maximum span (${tooLong.status})`);

  const halfDayOff = await A.json('/api/hr/leave', {
    method: 'POST',
    body: JSON.stringify({ type: 'vacation', startDate: '2026-09-01', endDate: '2026-09-01', isHalfDay: true }),
  });
  check(halfDayOff.status === 422, `and a half day when half days are off (${halfDayOff.status})`);

  const withinPolicy = await A.json('/api/hr/leave', {
    method: 'POST',
    body: JSON.stringify({ type: 'vacation', startDate: '2026-09-07', endDate: '2026-09-08' }),
  });
  check(withinPolicy.status === 201, `a request inside the policy is accepted (${withinPolicy.status})`);

  // A leave type that is not a member of the enum must never reach the column,
  // where it surfaces as 22P02 several screens from the setting that caused it.
  const bogusPolicy = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ settings: { leave_policy: { types: ['sabbatical'] } } }),
  });
  check(bogusPolicy.status === 422,
    `a leave type the database cannot store is refused at the setting (${bogusPolicy.status})`);

  // Restore something usable for anything that runs after this.
  await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      settings: {
        leave_policy: {
          types: ['vacation', 'sick', 'personal', 'maternity', 'paternity', 'bereavement', 'unpaid'],
          requires_approval: true, allow_half_day: true,
          min_notice_days: 0, max_consecutive_days: 30, carry_over_days: 5,
        },
      },
    }),
  });

  // ─────────────────────────────────────────────────────────────────────────
  section('56. Notification settings actually suppress notifications');
  /**
   * Enforced inside `notify_members()`, which reads the toggle before it
   * writes anything. Filtering on the way out would still cost a row and an
   * index entry per suppressed event, on every task update, forever.
   */

  const trayBefore = await C.json('/api/notifications?pageSize=100');
  const countBefore = (trayBefore.body?.data ?? []).length;

  await A.json('/api/admin/settings', {
    method: 'PATCH', body: JSON.stringify({ settings: { notification_events: { task: false } } }),
  });

  await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({
      projectId: chainProjectId, title: `Silent task ${run}`,
      assigneeId: memberIdC, status: 'todo',
    }),
  });

  const trayAfter = await C.json('/api/notifications?pageSize=100');
  check((trayAfter.body?.data ?? []).length === countBefore,
    `an assignment with task notifications off delivers nothing (${countBefore} → ${(trayAfter.body?.data ?? []).length})`);

  await A.json('/api/admin/settings', {
    method: 'PATCH', body: JSON.stringify({ settings: { notification_events: { task: true } } }),
  });

  await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({
      projectId: chainProjectId, title: `Audible task ${run}`,
      assigneeId: memberIdC, status: 'todo',
    }),
  });

  const trayRestored = await C.json('/api/notifications?pageSize=100');
  check((trayRestored.body?.data ?? []).length > countBefore,
    `and switching it back on delivers again (${(trayRestored.body?.data ?? []).length})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('57. Departments can be created and managed');
  /**
   * `departments` has been in the schema since 0001 and nothing could create a
   * second one. That pinned `auth_visible_member_ids()`, HR scoping, project
   * scoping and department folder sharing to a single seeded group.
   */

  const dept = await A.json('/api/admin/departments', {
    method: 'POST', body: JSON.stringify({ name: `Marketing ${run}`, description: 'Brand and demand' }),
  });
  check(dept.status === 201, `a department can be created (${dept.status})`, dept.body?.error?.message);
  const deptId = dept.body?.data?.id;

  const dupeDept = await A.json('/api/admin/departments', {
    method: 'POST', body: JSON.stringify({ name: `Marketing ${run}` }),
  });
  check(dupeDept.status === 409, `names stay unique per organization (${dupeDept.status})`);

  const assignHead = await A.json('/api/admin/departments', {
    method: 'PATCH', body: JSON.stringify({ id: deptId, headId: memberIdC }),
  });
  check(assignHead.ok, `a manager can be assigned (${assignHead.status})`, assignHead.body?.error?.message);

  const deptList = await A.json('/api/admin/departments');
  const savedDept = (deptList.body?.data ?? []).find(d => d.id === deptId);
  check(savedDept?.headId === memberIdC, 'and the assignment persists');
  check(!!savedDept?.headName, `with a name the screen can render (${savedDept?.headName})`);

  const clientAsHead = await A.json('/api/admin/departments', {
    method: 'PATCH', body: JSON.stringify({ id: deptId, headId: chainMember?.memberId }),
  });
  check(clientAsHead.status === 422,
    `a client account cannot manage a department (${clientAsHead.status})`);

  const employeeMakesDept = await D.json('/api/admin/departments', {
    method: 'POST', body: JSON.stringify({ name: 'Shadow IT' }),
  });
  check(employeeMakesDept.status === 403,
    `and an employee cannot create one at all (${employeeMakesDept.status})`);

  const removeUsed = await A.json(`/api/admin/departments?id=${deptId}`, { method: 'DELETE' });
  check(removeUsed.ok, `an empty department can be removed (${removeUsed.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('58. Workspace files are recorded, not simulated');
  /**
   * The uploader made an object URL in the browser, animated a progress bar
   * with setInterval and reported success. Nothing left the tab. Bytes now go
   * to storage and this records what was stored — including refusing a path
   * that belongs to another tenant, which is the check that stops a metadata
   * row being pointed at somebody else's object.
   */

  const foreignPath = await A.json('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({
      pageId: folderId, bucket: 'documents',
      path: `${crypto.randomUUID()}/workspace/stolen.pdf`,
      filename: 'stolen.pdf', sizeBytes: 10,
    }),
  });
  check(foreignPath.status === 422,
    `a storage path outside this organization is refused (${foreignPath.status})`);

  const badBucket = await A.json('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({
      pageId: folderId, bucket: 'hr-documents',
      path: `${orgIdA}/workspace/payslip.pdf`, filename: 'payslip.pdf', sizeBytes: 10,
    }),
  });
  check(badBucket.status === 422, `so is a bucket workspace files do not live in (${badBucket.status})`);

  const filed = await A.json('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({
      pageId: folderId, bucket: 'documents',
      path: `${orgIdA}/workspace/${folderId}/${run}-policy.pdf`,
      filename: 'policy.pdf', mimeType: 'application/pdf', sizeBytes: 2048,
    }),
  });
  check(filed.status === 201, `a real upload is recorded (${filed.status})`, filed.body?.error?.message);

  const listed = await A.json(`/api/workspace/files?pageId=${folderId}`);
  const listedFile = (listed.body?.data ?? []).find(f => f.id === filed.body?.data?.id);
  check(!!listedFile, 'and appears in the folder');
  check(!!listedFile?.uploadedByName,
    `attributed to a real person rather than a hard-coded name (${listedFile?.uploadedByName})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('57b. Branding reaches the shell, and messages can be corrected');
  /**
   * ── Branding ──────────────────────────────────────────────────────────────
   *
   * `organizations.logo_url`, `organizations.name` and
   * `branding.primary_colour` all had columns, validators and controls on the
   * settings screen — and the sidebar rendered a generic hexagon and the
   * literal string "NexusCorp". A company could configure all three and see
   * their own name nowhere in the product they had just set up.
   *
   * Asserted through the session, because that is where the shell reads them.
   */
  const branded = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      name: `Rebranded ${run}`,
      settings: {
        branding: {
          primaryColour: '#7c3aed',
          portalWelcome: '',
          showLogoInPortal: true,
        },
      },
    }),
  });
  check(branded.ok, `branding saves (${branded.status})`, branded.body?.error?.message);

  const brandedSession = await A.json('/api/auth/session');
  const org = brandedSession.body?.data?.organization ?? {};
  check(org.name === `Rebranded ${run}`,
    `the workspace's own name is carried (${org.name})`);
  check(org.policies?.branding?.primaryColour === '#7c3aed',
    `and its brand colour (${org.policies?.branding?.primaryColour})`);
  check('logoUrl' in org,
    'and the logo field, even when unset');

  const badColour = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ settings: { branding: { primaryColour: 'not-a-colour' } } }),
  });
  check(badColour.status === 422,
    `an invalid brand colour is refused rather than reaching a style attribute (${badColour.status})`);

  /**
   * ── Tenant branding is the tenant's, not the platform's ──────────────────
   *
   * This product is multi-tenant SaaS, not a white-label shell. A customer
   * uploading a logo brands *their company* — their client portal, their
   * invoices — and never this application's name, mark or favicon.
   *
   * The two settings that used to say otherwise are refused rather than
   * ignored. They named platform surfaces (`show_logo_in_sidebar`,
   * `login_message`), and accepting them silently would let an administrator
   * keep writing a setting that no longer does anything — which is how a
   * control comes to be believed in long after it stopped working.
   */
  const oldSidebarKey = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ settings: { branding: { showLogoInSidebar: true } } }),
  });
  check(oldSidebarKey.status === 422,
    `branding cannot claim this platform's sidebar (${oldSidebarKey.status})`);
  check(/does not change this platform/.test(oldSidebarKey.body?.error?.message ?? ''),
    `and the message says why (${oldSidebarKey.body?.error?.message})`);

  const oldLoginKey = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ settings: { branding: { loginMessage: 'hello' } } }),
  });
  check(oldLoginKey.status === 422,
    `nor its sign-in page, which cannot know the tenant anyway (${oldLoginKey.status})`);

  /**
   * The replacements point at the portal, which is a page that can show them.
   */
  const portalBranding = await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      settings: {
        branding: {
          primaryColour: '#7c3aed',
          portalWelcome: `Welcome from Rebranded ${run}`,
          showLogoInPortal: true,
        },
      },
    }),
  });
  check(portalBranding.ok, `portal branding saves (${portalBranding.status})`,
    portalBranding.body?.error?.message);

  /**
   * And it reaches the client's portal, where the audience is the *customer* —
   * who expects to see the firm they hired, not the software that firm runs on.
   */
  const brandedPortal = await A.json(`/api/portal?companyId=${signOffCoId}`);
  check(brandedPortal.body?.data?.supplier?.name === `Rebranded ${run}`,
    `the supplier's name reaches their client's portal (${brandedPortal.body?.data?.supplier?.name})`);
  check(brandedPortal.body?.data?.supplier?.welcome === `Welcome from Rebranded ${run}`,
    'and the welcome message that used to be pointed at the sign-in page');
  check(brandedPortal.body?.data?.supplier?.primaryColour === '#7c3aed',
    `and their brand colour (${brandedPortal.body?.data?.supplier?.primaryColour})`);

  // Turning it off withholds the logo rather than merely hiding it client-side.
  await A.json('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ settings: { branding: { showLogoInPortal: false } } }),
  });
  const unbrandedPortal = await A.json(`/api/portal?companyId=${signOffCoId}`);
  check(unbrandedPortal.body?.data?.supplier?.logoUrl === null,
    'and switching it off withholds the logo from the response, not just the render');

  /**
   * ── Message editing ───────────────────────────────────────────────────────
   *
   * The endpoint has always accepted a new body and stamped `edited_at`, and
   * the bubble has always rendered an "(edited)" marker from it. Nothing could
   * trigger one, so that marker had never appeared.
   */
  const editable = await A.json('/api/communication/messages', {
    method: 'POST',
    body: JSON.stringify({ channelId: threadRoomId, body: 'Teh quick brown fox' }),
  });
  const editableId = editable.body?.data?.id;

  const corrected = await A.json(`/api/communication/messages/${editableId}`, {
    method: 'PATCH', body: JSON.stringify({ body: 'The quick brown fox' }),
  });
  check(corrected.ok, `an author can correct their own message (${corrected.status})`,
    corrected.body?.error?.message);
  check(corrected.body?.data?.body === 'The quick brown fox', 'the new text is stored');
  check(!!corrected.body?.data?.editedAt,
    'and it is stamped as edited, which is what the marker renders from');

  /**
   * Only the author. Moderation can remove a message but not rewrite it —
   * putting words in somebody's mouth is a different power from taking them
   * away, and the RLS policy admits an UPDATE only to rows the caller sent.
   */
  const rewriteOther = await C.json(`/api/communication/messages/${editableId}`, {
    method: 'PATCH', body: JSON.stringify({ body: 'Something I never said' }),
  });
  const afterRewrite = await A.json(
    `/api/communication/messages?channelId=${threadRoomId}&pageSize=100`,
  );
  const untouched = (afterRewrite.body?.data ?? []).find(m => m.id === editableId);
  check(untouched?.body === 'The quick brown fox',
    `a colleague cannot rewrite it (${rewriteOther.status})`);

  /**
   * ── Read receipts ─────────────────────────────────────────────────────────
   *
   * Derived from `channel_members.last_read_at`, the same marker the unread
   * badge is computed from — so a receipt can never disagree with the count,
   * and no per-message receipt table is needed.
   */
  const roster = await A.json(`/api/communication/channels/${threadRoomId}/members`);
  check((roster.body?.data ?? []).every(m => 'lastReadAt' in m),
    'the roster carries each member\'s read marker');

  // ─────────────────────────────────────────────────────────────────────────
  section('58a. The workspace trash');
  /**
   * Deleting a page has always been soft — `deleted_at` is stamped and the row
   * survives, and deleting a folder marks its descendants in the same statement
   * so they do not reappear scattered at the root.
   *
   * Nothing ever read those rows back. Every delete was quietly recoverable and
   * there was no way to recover anything: the storage cost of keeping it with
   * none of the reassurance.
   */

  const binFolder = await A.json('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: `Bin folder ${run}`, isFolder: true, parentId: '' }),
  });
  const binFolderId = binFolder.body?.data?.id;

  const binDoc = await A.json('/api/workspace/pages', {
    method: 'POST',
    body: JSON.stringify({ title: `Bin doc ${run}`, parentId: binFolderId, kind: 'document' }),
  });
  const binDocId = binDoc.body?.data?.id;
  check(binDoc.status === 201, `a page inside a folder (${binDoc.status})`, binDoc.body?.error?.message);

  await A.json(`/api/workspace/pages/${binFolderId}`, { method: 'DELETE' });

  const binned = await A.json('/api/workspace/trash');
  const binnedIds = (binned.body?.data ?? []).map(p => p.id);
  check(binnedIds.includes(binFolderId), 'a deleted folder is in the trash');
  check(binnedIds.includes(binDocId),
    'and so is what was inside it, rather than being orphaned at the root');

  const tree = await A.json('/api/workspace/pages?pageSize=500');
  const treeIds = (tree.body?.data ?? []).map(p => p.id);
  check(!treeIds.includes(binFolderId) && !treeIds.includes(binDocId),
    'neither appears in the live tree');

  /**
   * Restoring the *document* has to bring its folder back with it, or the page
   * returns to a parent that is not there and renders at the root or nowhere.
   */
  const putBack = await A.json('/api/workspace/trash', {
    method: 'POST', body: JSON.stringify({ id: binDocId }),
  });
  check(putBack.ok, `a page can be restored (${putBack.status})`, putBack.body?.error?.message);
  check((putBack.body?.data?.restored ?? 0) >= 2,
    `and its deleted ancestors come back with it (${putBack.body?.data?.restored})`);

  const treeAfter = await A.json('/api/workspace/pages?pageSize=500');
  const afterIds = (treeAfter.body?.data ?? []).map(p => p.id);
  check(afterIds.includes(binDocId) && afterIds.includes(binFolderId),
    'both are in the tree again');

  const restoreLive = await A.json('/api/workspace/trash', {
    method: 'POST', body: JSON.stringify({ id: binDocId }),
  });
  check(restoreLive.status === 409,
    `restoring something that is not deleted is refused (${restoreLive.status})`);

  /**
   * A hard delete is only reachable for something already in the trash —
   * otherwise this endpoint would be a way around the recovery it exists to
   * provide.
   */
  const destroyLive = await A.json(`/api/workspace/trash?id=${binDocId}`, { method: 'DELETE' });
  check(destroyLive.status === 409,
    `and a live page cannot be destroyed through the trash (${destroyLive.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('58b. Presence reflects activity, not account age');
  /**
   * ── What this replaces ────────────────────────────────────────────────────
   *
   * `profiles.last_seen_at` is `NOT NULL DEFAULT now()`, so it was stamped when
   * the profile row was created and never again: 0006 added `touch_presence()`
   * to maintain it and nothing has ever called that function, from any route,
   * component or script.
   *
   * So the Admin and HR "Last Seen" column showed every employee's signup date
   * for ever, and the chat header's online count — which filtered on
   * `last_seen_at > now() - 5 minutes` — was true only in the five minutes
   * after somebody signed up. Before that it was the literal 4.
   *
   * The three states are asserted through the API rather than the function,
   * because the derivation is only useful if the route, the view and the policy
   * agree — and the interesting one is the last: a stale heartbeat must read
   * offline no matter what the client last claimed, since a browser that
   * crashes never gets to say goodbye.
   */

  const presenceOf = async () => {
    const r = await A.json('/api/presence');
    const mine = (r.body?.data ?? []).find(p => p.userId === userA.id);
    return { row: mine, meta: r.body?.meta };
  };

  const beat = (status, active) => A.json('/api/presence', {
    method: 'POST', body: JSON.stringify({ status, active }),
  });

  const fresh = await presenceOf();
  check(fresh.row?.presence === 'offline',
    `an account that has never beaten is offline, not online (${fresh.row?.presence})`);

  await beat('online', true);
  const nowOnline = await presenceOf();
  check(nowOnline.row?.presence === 'online',
    `a heartbeat puts somebody online (${nowOnline.row?.presence})`);
  check(nowOnline.meta?.online === 1,
    `and the count the chat header reads follows it (${nowOnline.meta?.online})`);
  check(!!nowOnline.row?.lastActiveAt,
    'an active beat records when they last did something');

  await beat('away', false);
  const nowAway = await presenceOf();
  check(nowAway.row?.presence === 'away',
    `an idle tab reports away rather than dropping offline (${nowAway.row?.presence})`);
  check(nowAway.meta?.online === 0,
    `and stops counting as online (${nowAway.meta?.online})`);

  await beat('online', true);
  check((await presenceOf()).row?.presence === 'online', 'coming back is immediate');

  /**
   * The case a stored status cannot handle. The heartbeat is forced into the
   * past while the reported status still says `online`; the verdict must be
   * offline anyway, because that is the only way a closed laptop is ever
   * reflected.
   */
  await rest(`profiles?id=eq.${userA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ presence_beat_at: new Date(Date.now() - 10 * 60_000).toISOString() }),
  });
  const staleBeat = await presenceOf();
  check(staleBeat.row?.presence === 'offline',
    `a stale heartbeat reads offline whatever the client last claimed (${staleBeat.row?.presence})`);

  await beat('online', true);
  const signedOff = await A.json('/api/presence', { method: 'DELETE' });
  check(signedOff.ok, `signing off is explicit (${signedOff.status})`);
  check((await presenceOf()).row?.presence === 'offline',
    'and takes effect at once rather than after the offline window');

  // Every people surface reads the same verdict.
  await beat('online', true);
  const dirWithPresence = await A.json('/api/directory');
  const meInDirectory = (dirWithPresence.body?.data ?? []).find(m => m.userId === userA.id);
  check(meInDirectory?.presence === 'online',
    `the directory every people picker reads carries it (${meInDirectory?.presence})`);
  check(!('lastSeenAt' in (meInDirectory ?? {})),
    'and still withholds the exact last-seen timestamp, which is the sensitive half');

  const adminRows = await A.json('/api/admin/users?pageSize=100');
  const meInAdmin = (adminRows.body?.data ?? []).find(u => u.userId === userA.id);
  check(meInAdmin?.presence === 'online',
    `the administration table shows presence rather than a signup date (${meInAdmin?.presence})`);
  check(!!meInAdmin?.lastSeenAt,
    'with the timestamp behind it, which administrators may see');

  // ─────────────────────────────────────────────────────────────────────────
  section('58c. Per-module notification badges');
  /**
   * "Support (3), Communication (5), Projects (2)" in the sidebar, and they have
   * to clear on viewing.
   *
   * ── Two things worth asserting rather than assuming ───────────────────────
   *
   *   · The counts come from the server across the whole tray. Derived in the
   *     browser from the twenty rows the store holds, a badge caps at the page
   *     size — somebody with thirty unread tickets sees Support (20), and the
   *     number changes when they page.
   *
   *   · Communication is composed differently on purpose. A notification is
   *     written only for a *mention*; posting in a channel notifies nobody, and
   *     should not. A badge driven by the tray alone would read 0 with unread
   *     messages waiting, so the count also carries each channel's own unread
   *     figure — which is the number the chat sidebar already shows per channel.
   */

  const trayFor = async (client) => (await client.json('/api/notifications')).body?.meta;

  // C has been assigned a task and mentioned in a channel by now.
  const badgeC = await trayFor(C);
  check(typeof badgeC?.byModule === 'object' && badgeC.byModule !== null,
    'the tray reports counts per module');
  check((badgeC?.byModule?.projects ?? 0) > 0,
    `a task assignment counts toward Projects (${badgeC?.byModule?.projects})`);
  check((badgeC?.byModule?.communication ?? 0) > 0,
    `a mention counts toward Communication (${badgeC?.byModule?.communication})`);

  /**
   * Unread messages, not just mentions. A is posting into a channel C is in;
   * nobody is mentioned, so no notification is written — and the badge must
   * still move.
   */
  const beforeMessages = (await trayFor(C))?.unreadMessages ?? 0;
  await A.json('/api/communication/messages', {
    method: 'POST',
    body: JSON.stringify({ channelId: threadRoomId, body: `Unread probe ${run}` }),
  });
  const afterMessages = (await trayFor(C))?.unreadMessages ?? 0;
  check(afterMessages > beforeMessages,
    `an unread message counts even though it notifies nobody (${beforeMessages} → ${afterMessages})`);

  // Opening a module clears its badge, and only its badge.
  const beforeClear = await trayFor(C);
  const clearProjects = await C.json('/api/notifications', {
    method: 'PATCH', body: JSON.stringify({ module: 'projects' }),
  });
  check(clearProjects.ok, `a module's notifications can be marked read (${clearProjects.status})`,
    clearProjects.body?.error?.message);

  const afterClear = await trayFor(C);
  check((afterClear?.byModule?.projects ?? 0) === 0,
    `viewing Projects clears its badge (${afterClear?.byModule?.projects})`);
  check((afterClear?.byModule?.communication ?? 0) === (beforeClear?.byModule?.communication ?? 0),
    `and leaves the others alone (${afterClear?.byModule?.communication})`);

  const bogusModule = await C.json('/api/notifications', {
    method: 'PATCH', body: JSON.stringify({ module: 'not_a_module' }),
  });
  check(bogusModule.status === 422,
    `an unknown module is refused rather than marking everything read (${bogusModule.status})`);

  /**
   * The dangerous shape of that last one: a module name that maps to no types
   * must not fall through to "no filter", which would mark the entire tray read.
   */
  const stillUnread = await trayFor(C);
  check((stillUnread?.unread ?? 0) > 0,
    `and the tray still holds its unread notifications (${stillUnread?.unread})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('59. Editing a record, with the payload the form actually sends');
  /**
   * ── Why this section is written in camelCase ──────────────────────────────
   *
   * Every other section of this harness sends snake_case, and that is exactly
   * how it passed 267 checks while editing a project was impossible in the
   * browser. The forms send camelCase; `acceptBody` was emitting *both*
   * spellings of every renamed field, and the extra one is not a column:
   *
   *     PGRST204  Could not find the 'clientCompanyId' column of 'projects'
   *
   * Creating a record was unaffected, because every create route has a
   * `prepare` that names its columns and drops the rest. The thirteen `[id]`
   * routes had none, so the body reached `.update()` intact. The harness never
   * saw it because the harness never sent the shape that triggers it.
   *
   * So these assertions use the field names the components use, deliberately,
   * and each one edits a *multi-word* field — the only kind that can drift.
   * A snake_case body would pass all of them without proving anything.
   */

  const editProbe = async (label, path, payload, expectField, expectValue) => {
    const res = await A.json(path, { method: 'PUT', body: JSON.stringify(payload) });
    const ok = res.status === 200 && res.body?.data?.[expectField] === expectValue;
    check(ok, `${label} (${res.status})`,
      res.body?.error?.message ??
      `${expectField} came back as ${JSON.stringify(res.body?.data?.[expectField])}`);
    return res.body?.data;
  };

  // A client company to attach, so the project edit carries a real relation.
  const editCo = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `EditCo ${run}` }),
  });
  const editCoId = editCo.body?.data?.id;

  const editProject = await A.json('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({ name: `Edit target ${run}`, status: 'planning' }),
  });
  const editProjectId = editProject.body?.data?.id;

  /**
   * The reported defect, asserted directly: attach a client through an edit.
   * `clientCompanyId` is the field whose alias broke the write, and the one
   * the whole client portal resolves through.
   */
  const editedProject = await editProbe(
    'a project edit attaches a client company',
    `/api/projects/projects/${editProjectId}`,
    {
      name: `Edit target ${run} v2`, description: 'edited', status: 'active',
      priority: 'high', startDate: '2026-03-01', endDate: '2026-10-01',
      budget: 42000, clientCompanyId: editCoId,
    },
    'clientCompanyId', editCoId,
  );
  check(editedProject?.startDate === '2026-03-01',
    `and its start date (${editedProject?.startDate})`);
  check(editedProject?.client?.name === `EditCo ${run}`,
    `and the response carries the client relation the card renders (${editedProject?.client?.name})`);
  check(editedProject?.owner?.profiles?.fullName,
    `and the owner relation (${editedProject?.owner?.profiles?.fullName})`);

  // An omitted field must survive. This is what `.partial()` could not do.
  const partial = await A.json(`/api/projects/projects/${editProjectId}`, {
    method: 'PUT', body: JSON.stringify({ priority: 'low' }),
  });
  check(partial.body?.data?.clientCompanyId === editCoId,
    'an edit that omits the client does not unlink it');
  check(partial.body?.data?.budget === 42000,
    `nor reset the budget to its default (${partial.body?.data?.budget})`);
  check(partial.body?.data?.name === `Edit target ${run} v2`,
    'nor the name');

  // Clearing has to remain possible, and distinguishable from omitting.
  const unlinked = await A.json(`/api/projects/projects/${editProjectId}`, {
    method: 'PUT', body: JSON.stringify({ clientCompanyId: null }),
  });
  check(unlinked.body?.data?.clientCompanyId === null,
    'an explicit null does unlink the client');

  // Mass assignment: the columns a caller must never be able to set.
  const massAssign = await A.json(`/api/projects/projects/${editProjectId}`, {
    method: 'PUT',
    body: JSON.stringify({ priority: 'high', deletedAt: '2020-01-01T00:00:00Z' }),
  });
  check(massAssign.status === 200 && massAssign.body?.data?.deletedAt == null,
    'a column outside the update schema is ignored, not written');

  const onlyUnknown = await A.json(`/api/projects/projects/${editProjectId}`, {
    method: 'PUT', body: JSON.stringify({ progressPct: 99, totalTasks: 500 }),
  });
  check(onlyUnknown.status === 422,
    `an edit naming no known column is refused rather than reported as saved (${onlyUnknown.status})`);

  // Validation must apply to an edit, not only to a create.
  const badDates = await A.json(`/api/projects/projects/${editProjectId}`, {
    method: 'PUT', body: JSON.stringify({ startDate: '2026-06-01', endDate: '2026-01-01' }),
  });
  check(badDates.status === 409 || badDates.status === 422,
    `an end date before the start date is refused on edit too (${badDates.status})`);
  check(/cannot end before it starts/i.test(badDates.body?.error?.message ?? ''),
    `and says so in words (${badDates.body?.error?.message})`);

  // The remaining twelve routes, each on a multi-word field.
  const editLead = await A.json('/api/crm/leads', {
    method: 'POST', body: JSON.stringify({ first_name: 'Edit', last_name: 'Probe' }),
  });
  await editProbe('a lead edit stores companyName',
    `/api/crm/leads/${editLead.body?.data?.id}`,
    { firstName: 'Edit', lastName: 'Probe', companyName: `LeadCo ${run}`, estimatedValue: 4200 },
    'companyName', `LeadCo ${run}`);

  const editContact = await A.json('/api/crm/contacts', {
    method: 'POST', body: JSON.stringify({ first_name: 'Con', last_name: 'Tact' }),
  });
  await editProbe('a contact edit stores jobTitle',
    `/api/crm/contacts/${editContact.body?.data?.id}`,
    { jobTitle: 'Head of Detail', companyId: editCoId },
    'jobTitle', 'Head of Detail');

  await editProbe('a company edit stores employeeCount',
    `/api/crm/companies/${editCoId}`,
    { employeeCount: 250, annualRevenue: 9000000 },
    'employeeCount', 250);

  const editDeal = await A.json('/api/crm/deals', {
    method: 'POST', body: JSON.stringify({ name: `Deal ${run}` }),
  });
  await editProbe('a deal edit stores expectedClose',
    `/api/crm/deals/${editDeal.body?.data?.id}`,
    { expectedClose: '2026-12-01', companyId: editCoId },
    'expectedClose', '2026-12-01');

  const editTask = await A.json('/api/projects/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `Task ${run}`, project_id: editProjectId }),
  });
  await editProbe('a task edit stores estimatedHours',
    `/api/projects/tasks/${editTask.body?.data?.id}`,
    { estimatedHours: 12, dueDate: '2026-05-05', sortOrder: 3 },
    'estimatedHours', 12);

  const editTicket = await A.json('/api/support/tickets', {
    method: 'POST', body: JSON.stringify({ subject: `Ticket ${run}` }),
  });
  await editProbe('a ticket edit stores contactEmail',
    `/api/support/tickets/${editTicket.body?.data?.id}`,
    { contactEmail: 'someone@example.com', status: 'in_progress' },
    'contactEmail', 'someone@example.com');

  const editExpense = await A.json('/api/finance/expenses', {
    method: 'POST',
    body: JSON.stringify({ title: `Expense ${run}`, amount: 10, expense_date: '2026-04-01' }),
  });
  /**
   * `expenseDate`, the field the form was sending as `date`.
   *
   * The column is `expense_date`, so `date` was neither stored on create — the
   * route substituted today and nobody noticed, because the form's default is
   * today — nor accepted on edit. A claim for last week's receipt was filed as
   * this week's.
   */
  const editedExpense = await editProbe('an expense edit stores expenseDate',
    `/api/finance/expenses/${editExpense.body?.data?.id}`,
    { title: `Expense ${run}`, amount: 55, category: 'travel', vendor: 'Rail', expenseDate: '2026-04-15' },
    'expenseDate', '2026-04-15');
  check(editedExpense?.amount === 55, `and the amount (${editedExpense?.amount})`);

  const selfApprove = await A.json(`/api/finance/expenses/${editExpense.body?.data?.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'approved' }),
  });
  check(selfApprove.body?.data?.status !== 'approved',
    `an expense cannot be approved through a plain edit (${selfApprove.status})`);

  // A distinct SKU: section 3 already holds `SKU-${run}` in this organization,
  // and (organization_id, sku) is unique — as it should be.
  const editProduct = await A.json('/api/inventory/products', {
    method: 'POST', body: JSON.stringify({ name: `Widget ${run}`, sku: `SKU-EDIT-${run}` }),
  });
  check(editProduct.status === 201,
    `a product to edit (${editProduct.status})`, editProduct.body?.error?.message);
  await editProbe('a product edit stores reorderLevel',
    `/api/inventory/products/${editProduct.body?.data?.id}`,
    { reorderLevel: 25, isActive: true },
    'reorderLevel', 25);

  const editSupplier = await A.json('/api/inventory/suppliers', {
    method: 'POST', body: JSON.stringify({ name: `Supplier ${run}` }),
  });
  /**
   * `contactName` is free text on the supplier, not a CRM reference. The update
   * schema said `contactId`, which is not a column — and because an unknown key
   * is dropped rather than rejected, wiring it would have emptied this field on
   * every edit while still answering 200.
   */
  await editProbe('a supplier edit stores contactName',
    `/api/inventory/suppliers/${editSupplier.body?.data?.id}`,
    { contactName: 'Dele Adeyemi', leadTimeDays: 21, paymentTerms: 'net60' },
    'contactName', 'Dele Adeyemi');

  const editWarehouse = await A.json('/api/inventory/warehouses', {
    method: 'POST', body: JSON.stringify({ name: `Depot ${run}` }),
  });
  await editProbe('a warehouse edit stores isActive',
    `/api/inventory/warehouses/${editWarehouse.body?.data?.id}`,
    { isActive: false, capacity: 500 },
    'isActive', false);

  const editEvent = await A.json('/api/calendar/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Event ${run}`,
      starts_at: '2026-05-01T09:00:00Z', ends_at: '2026-05-01T10:00:00Z',
    }),
  });
  /**
   * `startsAt`/`endsAt`/`colour`, which is what the calendar sends. The update
   * schema said `startDate`/`endDate`/`color` — three names the table does not
   * have, one of them differing only by British spelling.
   */
  const editedEvent = await editProbe('a calendar edit stores startsAt',
    `/api/calendar/events/${editEvent.body?.data?.id}`,
    {
      title: `Event ${run} moved`,
      startsAt: '2026-05-02T11:00:00Z', endsAt: '2026-05-02T12:00:00Z',
      allDay: false, colour: '#ef4444',
    },
    'colour', '#ef4444');
  check(editedEvent?.startsAt?.startsWith('2026-05-02'),
    `and the new start time (${editedEvent?.startsAt})`);

  const editInvoice = await A.json('/api/finance/invoices', {
    method: 'POST',
    body: JSON.stringify({
      companyId: editCoId, dueDate: '2026-09-01', taxRate: 7.5,
      lineItems: [{ description: 'Consulting', quantity: 2, unitPrice: 1000 }],
    }),
  });
  const invoiceId = editInvoice.body?.data?.id;
  const invoiceTotal = editInvoice.body?.data?.total;
  await editProbe('an invoice edit stores dueDate',
    `/api/finance/invoices/${invoiceId}`,
    { status: 'sent', notes: 'Chased once', dueDate: '2026-09-15' },
    'dueDate', '2026-09-15');

  /**
   * An invoice's money is computed by the server from the line items it holds.
   * Leaving `total` writable meant a caller with `finance.edit` could zero a
   * sent invoice without touching a line, and the ledger would agree.
   */
  const rewriteTotal = await A.json(`/api/finance/invoices/${invoiceId}`, {
    method: 'PUT', body: JSON.stringify({ total: 0, subtotal: 0, invoiceNumber: 'INV-HACK' }),
  });
  check(rewriteTotal.status === 422,
    `an edit that only names server-assigned money is refused (${rewriteTotal.status})`);
  const invoiceAfter = await A.json(`/api/finance/invoices/${invoiceId}`);
  check(invoiceAfter.body?.data?.total === invoiceTotal,
    `and the total is unchanged (${invoiceAfter.body?.data?.total} vs ${invoiceTotal})`);
  check(invoiceAfter.body?.data?.invoiceNumber !== 'INV-HACK',
    `and the invoice number is still the server's (${invoiceAfter.body?.data?.invoiceNumber})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('60. Cross-module search finds records, not just menu entries');
  /**
   * `/api/search` existed, complete and permission-aware, and no screen called
   * it. It is now what the command palette queries, so the palette is only as
   * good as this: each type is asserted separately, because one sub-query
   * naming a column that does not exist fails silently and simply returns
   * nothing for that type — which is exactly how deals were unfindable while
   * the endpoint reported perfect health.
   */

  const searchTag = `Zyxwv${run}`;

  const sCompany = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `${searchTag} Holdings`, industry: 'Mining' }),
  });
  const sCompanyId = sCompany.body?.data?.id;

  const sContact = await A.json('/api/crm/contacts', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Grace', lastName: searchTag,
      email: `grace-${run}@example.com`, jobTitle: 'Head of Ops', companyId: sCompanyId,
    }),
  });
  const sDeal = await A.json('/api/crm/deals', {
    method: 'POST',
    body: JSON.stringify({ name: `${searchTag} renewal`, companyId: sCompanyId, stage: 'proposal', value: 12000 }),
  });
  const sProject = await A.json('/api/projects/projects', {
    method: 'POST',
    body: JSON.stringify({ name: `${searchTag} rollout`, status: 'active', clientCompanyId: sCompanyId }),
  });
  const sProjectId = sProject.body?.data?.id;
  const sTask = await A.json('/api/projects/tasks', {
    method: 'POST', body: JSON.stringify({ title: `${searchTag} migration`, projectId: sProjectId }),
  });
  const sTicket = await A.json('/api/support/tickets', {
    method: 'POST',
    body: JSON.stringify({
      subject: `${searchTag} cannot log in`, contactId: sContact.body?.data?.id,
      priority: 'high', ticketNumber: `TKT-${run}-S`,
    }),
  });
  const sProduct = await A.json('/api/inventory/products', {
    method: 'POST',
    body: JSON.stringify({ name: `${searchTag} widget`, sku: `SKU-${run}`, price: 10, cost: 5, stock: 3, unit: 'unit' }),
  });
  const sInvoice = await A.json('/api/finance/invoices', {
    method: 'POST',
    body: JSON.stringify({
      companyId: sCompanyId, dueDate: '2027-01-01',
      lineItems: [{ description: 'Renewal', quantity: 1, unitPrice: 500 }],
    }),
  });

  const searchAll = await A.json(`/api/search?q=${encodeURIComponent(searchTag)}`);
  const hits = searchAll.body?.data?.results ?? [];
  const hitTypes = new Set(hits.map(h => h.type));

  check(!searchAll.body?.data?.partial,
    'every sub-query succeeds — no entity type is silently dropped',
    JSON.stringify(searchAll.body?.data?.partial ?? []));

  for (const [type, created] of [
    ['company', sCompany], ['contact', sContact], ['deal', sDeal],
    ['project', sProject], ['task', sTask], ['ticket', sTicket], ['product', sProduct],
  ]) {
    if (created?.status !== 201) continue;
    check(hitTypes.has(type), `search finds a ${type}`);
  }

  // An invoice is looked up by its number, which is the string a finance
  // conversation actually contains — and which no search covered before.
  const byNumber = await A.json(
    `/api/search?q=${encodeURIComponent(sInvoice.body?.data?.invoiceNumber ?? 'INV-NONE')}`);
  check((byNumber.body?.data?.results ?? []).some(r => r.type === 'invoice'),
    'search finds an invoice by its number');

  // Matching a column the label never shows: the case cmdk's own filter would
  // have hidden, and the reason the palette turns its filter off.
  const byEmail = await A.json(`/api/search?q=${encodeURIComponent(`grace-${run}@example.com`)}`);
  check((byEmail.body?.data?.results ?? []).some(r => r.type === 'contact'),
    'search finds a contact by an email address that is not in the title');

  const tooShort = await A.json('/api/search?q=a');
  check((tooShort.body?.data?.results ?? []).length === 0,
    'a one-character query returns nothing rather than the whole tenant');

  // Every hit must carry what the palette needs to open it.
  check(hits.every(h => h.id && h.module && h.type && h.title),
    'every result carries the module, type and id needed to open it');

  // ─────────────────────────────────────────────────────────────────────────
  section('61. Activity is recorded, and stays inside the modules a role can open');
  /**
   * `activity_log` had a table, an index, RLS, a place in the realtime
   * publication, an endpoint and a dashboard panel reading it — and no writer,
   * so "Team activity" showed "No recent activity" to everyone, for ever.
   */

  const feed = await A.json('/api/activity-log?pageSize=50');
  const feedRows = feed.body?.data ?? [];
  check(feed.status === 200 && feedRows.length > 0,
    `creating records now writes activity (${feedRows.length} entries)`);

  check(feedRows.some(r => r.title === `Created company: ${searchTag} Holdings`),
    'an entry names what was created, not just its id');
  check(feedRows.every(r => r.user && typeof r.user.firstName === 'string'),
    'every entry carries the person who did it');

  const activityEdit = await A.json(`/api/crm/companies/${sCompanyId}`, {
    method: 'PUT', body: JSON.stringify({ industry: 'Quarrying' }),
  });
  check(activityEdit.status === 200, 'a record is edited');

  // `after()` runs the insert once the response is flushed, so the row is not
  // guaranteed to exist the instant the PUT returns.
  await new Promise(r => setTimeout(r, 1500));

  const entityFeed = await A.json(`/api/activity-log?entityType=company&entityId=${sCompanyId}`);
  const entityRows = entityFeed.body?.data ?? [];
  check(entityRows.some(r => r.action === 'update'),
    'editing it appends to that record’s own timeline');
  check(entityRows.every(r => r.entityId === sCompanyId),
    'and that timeline holds only that record’s entries');

  const deletedForFeed = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `Ephemeral ${run}` }),
  });
  await A.json(`/api/crm/companies/${deletedForFeed.body?.data?.id}`, { method: 'DELETE' });
  await new Promise(r => setTimeout(r, 1500));
  const afterDelete = await A.json('/api/activity-log?pageSize=10');
  check((afterDelete.body?.data ?? []).some(r => r.title === `Deleted company: Ephemeral ${run}`),
    'a deletion names the record that went, which cannot be looked up afterwards');

  /**
   * The access boundary.
   *
   * RLS scopes these rows to the tenant and knows nothing about module grants,
   * so without a filter on the reading side the dashboard narrates Finance and
   * HR to everyone. `hr_staff` cannot open Finance, so no Finance entry may
   * reach them — the expense above is in the same tenant and would otherwise
   * be perfectly visible.
   */
  const hrFeedClient = makeClient();
  const hrFeedEmail = `feed-hr-${run}@nexustest.dev`;
  const hrFeedUser = await adminCreateUser(hrFeedEmail, PW);
  scratchUsers.push(hrFeedUser?.id);
  await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: hrFeedEmail, firstName: 'Hana', lastName: 'Records', role: 'hr_staff' }),
  });
  await hrFeedClient.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: hrFeedEmail, password: PW }),
  });

  await A.json('/api/finance/expenses', {
    method: 'POST',
    body: JSON.stringify({ title: `Executive bonus ${run}`, amount: 90000, category: 'general', expenseDate: '2026-06-01' }),
  });
  await new Promise(r => setTimeout(r, 1500));

  const hrFeed = await hrFeedClient.json('/api/activity-log?pageSize=100');
  const hrRows = hrFeed.body?.data ?? [];
  check(hrFeed.status === 200, `a role without Finance can still read the feed (${hrFeed.status})`);
  check(!hrRows.some(r => r.module === 'finance'),
    'but sees no Finance activity in it');

  const hrDash = await hrFeedClient.json('/api/dashboard');
  check(!(hrDash.body?.data?.activity ?? []).some(a => a.module === 'finance'),
    'and the dashboard panel applies the same boundary');

  /**
   * An expense is never written to the feed at all.
   *
   * Asserted against the *owner's* feed, who can read every module — so this
   * proves the row does not exist rather than that it is merely filtered from
   * one reader. It has to be that strong, because the module filter cannot
   * save an entry that was mislabelled on the way in: `/api/finance/expenses`
   * gates on `module: 'hr'` so that any employee may file their own claim, and
   * labelling activity with the route's gate published "Created expense:
   * Executive bonus" to all staff as an HR entry — past the Finance filter,
   * and past the RLS that hides the expense row itself. Which is why the
   * feed's tables are an allow-list carrying their own module.
   */
  const ownerFeed = await A.json('/api/activity-log?pageSize=100');
  const ownerRows = ownerFeed.body?.data ?? [];
  check(!ownerRows.some(r => String(r.title).includes('Executive bonus')),
    'an expense leaves no feed entry for anyone, because its rows are not org-visible');
  check(ownerRows.some(r => r.module === 'crm'),
    'while records that are org-visible still appear');

  // ─────────────────────────────────────────────────────────────────────────
  section('62. Export is real data, and requires the export capability');
  /**
   * The CRM's "Export CSV" button downloaded a hard-coded string — two invented
   * rows, the same for every tenant. `/api/export` was the real thing and no
   * screen called it.
   */

  const csvRes = await fetch(`${BASE}/api/export?dataset=leads`, {
    headers: { cookie: A.cookieHeader() },
  });
  const csvText = await csvRes.text();
  check(csvRes.status === 200, `an export returns a file (${csvRes.status})`);
  check((csvRes.headers.get('content-type') ?? '').includes('text/csv'),
    'served as text/csv');
  check((csvRes.headers.get('content-disposition') ?? '').includes('attachment'),
    'as an attachment with a filename');
  check(csvText.split('\r\n')[0]?.startsWith('First name,Last name'),
    'with a header row of real column labels');
  check(!csvText.includes('Sarah Jenkins'),
    'and none of the invented rows the old button produced');

  const leadList = await A.json('/api/crm/leads?pageSize=100');
  const firstLead = (leadList.body?.data ?? [])[0];
  if (firstLead?.firstName) {
    check(csvText.includes(firstLead.firstName),
      'the export contains this tenant’s own records');
  }

  const badDataset = await A.json('/api/export?dataset=salaries');
  check(badDataset.status === 422,
    `an unknown dataset is refused rather than guessed at (${badDataset.status})`);

  /**
   * `export` is a capability of its own, not implied by `view`. `hr_staff` can
   * read HR but must not be able to walk out with the register unless the role
   * grants it — the check is that the answer is the role's grant, not `view`.
   */
  const hrExport = await fetch(`${BASE}/api/export?dataset=leads`, {
    headers: { cookie: hrFeedClient.cookieHeader() },
  });
  check(hrExport.status === 403,
    `a role that cannot open CRM cannot export it either (${hrExport.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('63. The customer, whole: one read across every module');
  /**
   * Every relationship below already existed in the schema and nothing read
   * across them, so opening a customer in the CRM showed their address and
   * nothing about the relationship.
   */

  const ov = await A.json(`/api/crm/companies/${sCompanyId}/overview`);
  const o = ov.body?.data;
  check(ov.status === 200, `a company overview loads (${ov.status})`);
  check(o?.company?.id === sCompanyId, 'it is the company that was asked for');
  check((o?.contacts ?? []).length >= 1, 'with the people who work there');
  check((o?.deals ?? []).length >= 1, 'the deals in play');
  check((o?.projects ?? []).some(p => p.id === sProjectId), 'the projects being delivered for them');
  check((o?.invoices ?? []).length >= 1, 'what they have been invoiced');
  check((o?.tickets ?? []).length >= 1, 'and what they have reported');

  /**
   * The figures and the panels must be computed from the same rows, or the
   * header and the list disagree the first time anyone checks the arithmetic.
   */
  const openDealValue = (o?.deals ?? [])
    .filter(d => !['closed_won', 'closed_lost'].includes(d.stage))
    .reduce((s, d) => s + Number(d.value ?? 0), 0);
  check(o?.summary?.openDealValue === openDealValue,
    `the headline pipeline equals the deals listed under it (${o?.summary?.openDealValue})`);
  check(o?.summary?.contacts === (o?.contacts ?? []).length,
    'and the contact count equals the contacts listed');

  // Project health comes from the same view the project board reads, so a
  // client's view of a project and the team's cannot drift apart.
  const ovProject = (o?.projects ?? []).find(p => p.id === sProjectId);
  check(typeof ovProject?.progressPct === 'number',
    `each project carries the progress v_project_health computed (${ovProject?.progressPct}%)`);

  const missingOverview = await A.json('/api/crm/companies/00000000-0000-0000-0000-000000000000/overview');
  check(missingOverview.status === 404,
    `a company that does not exist is a 404, not an empty shell (${missingOverview.status})`);

  /**
   * Reaching a customer through the CRM must not become a way to read modules
   * the sidebar does not offer. `sales_staff` has CRM but no Finance, so the
   * key must be absent — not present and empty, which a client could not tell
   * from "this customer has no invoices".
   */
  const salesClient = makeClient();
  const salesEmail = `ov-sales-${run}@nexustest.dev`;
  const salesUser = await adminCreateUser(salesEmail, PW);
  scratchUsers.push(salesUser?.id);
  await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: salesEmail, firstName: 'Sade', lastName: 'Seller', role: 'sales_staff' }),
  });
  await salesClient.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: salesEmail, password: PW }),
  });

  const salesOv = await salesClient.json(`/api/crm/companies/${sCompanyId}/overview`);
  check(salesOv.status === 200, 'a salesperson can open the same customer');
  check(Array.isArray(salesOv.body?.data?.deals), 'and sees the pipeline');
  check(salesOv.body?.data?.invoices === undefined,
    'but the response carries no invoices key at all, rather than an empty one');

  // ─────────────────────────────────────────────────────────────────────────
  section('64. Logging a call actually records it');
  /**
   * The Activities tab was three hard-coded rows and a handler that appended to
   * local state and raised "Activity logged successfully". `crm_activities` had
   * existed since 0003 with no endpoint on it at all.
   */

  const logged = await A.json('/api/crm/activities', {
    method: 'POST',
    body: JSON.stringify({
      activityType: 'call', subject: `Discovery call ${run}`,
      body: 'Qualified — enterprise tier', companyId: sCompanyId,
    }),
  });
  check(logged.status === 201, `an activity is logged (${logged.status})`);
  check(logged.body?.data?.member?.profiles?.fullName,
    'and the created row names who logged it, without a refetch');

  const loggedList = await A.json(`/api/crm/activities?companyId=${sCompanyId}`);
  check((loggedList.body?.data ?? []).some(a => a.subject === `Discovery call ${run}`),
    'it survives being read back — the thing the old tab never did');

  const detached = await A.json('/api/crm/activities', {
    method: 'POST', body: JSON.stringify({ activityType: 'note', subject: 'Attached to nothing' }),
  });
  check(detached.status === 422,
    `an activity attached to nothing is refused (${detached.status})`);
  check(/lead, contact, company or deal/i.test(detached.body?.error?.message ?? ''),
    'and says which link is missing', detached.body?.error?.message);

  const ovAfterLog = await A.json(`/api/crm/companies/${sCompanyId}/overview`);
  check((ovAfterLog.body?.data?.activities ?? []).some(a => a.subject === `Discovery call ${run}`),
    'and it appears on that customer’s own timeline');

  // ─────────────────────────────────────────────────────────────────────────
  section('65. My Work: the three things the API did that no screen asked for');
  /**
   * Reordering, list management and search were all implemented server-side —
   * with ownership pre-verification, with "deleting a list unfiles its to-dos
   * rather than destroying them", with a search across titles and notes — and
   * no screen had ever called any of them. Asserted here so the next screen
   * that stops calling them fails a test rather than going quiet.
   */

  const myList = await A.json('/api/todos/lists', {
    method: 'POST', body: JSON.stringify({ name: `Errands ${run}`, color: 'blue' }),
  });
  const myListId = myList.body?.data?.id;
  check(myList.status === 201, `a personal list is created (${myList.status})`);

  const renamed = await A.json(`/api/todos/lists/${myListId}`, {
    method: 'PATCH', body: JSON.stringify({ name: `Renamed ${run}`, color: 'rose' }),
  });
  check(renamed.status === 200 && renamed.body?.data?.name === `Renamed ${run}`,
    'a list can be renamed');
  check(renamed.body?.data?.color === 'rose', 'and recoloured');

  const badListColour = await A.json(`/api/todos/lists/${myListId}`, {
    method: 'PATCH', body: JSON.stringify({ color: 'chartreuse' }),
  });
  check(badListColour.status === 422, `an unknown colour is refused (${badListColour.status})`);

  await A.json('/api/todos', {
    method: 'POST', body: JSON.stringify({ title: `Filed item ${run}`, listId: myListId }),
  });
  const listGone = await A.json(`/api/todos/lists/${myListId}`, { method: 'DELETE' });
  check(listGone.body?.data?.todosUnfiled === 1,
    'deleting a list reports how many to-dos it unfiled');
  const survivor = await A.json(`/api/todos?view=all&search=Filed item ${run}`);
  check((survivor.body?.data ?? []).length === 1,
    'and the to-dos inside it survive rather than being destroyed with it');
  check(survivor.body?.data?.[0]?.listId === null, 'they are simply unfiled');

  await A.json('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title: `Call the dentist ${run}`, note: 'ask about the crown' }),
  });
  const byTodoTitle = await A.json(`/api/todos?search=dentist ${run}`);
  const byTodoNote = await A.json('/api/todos?search=crown');
  check((byTodoTitle.body?.data ?? []).length >= 1, 'search matches a to-do title');
  check((byTodoNote.body?.data ?? []).length >= 1, 'and matches its note');

  const openTodos = await A.json('/api/todos');
  const todoIds = (openTodos.body?.data ?? []).map(t => t.id);
  const reorder = await A.json('/api/todos', {
    method: 'PATCH', body: JSON.stringify({ order: [...todoIds].reverse() }),
  });
  check(reorder.status === 200 && reorder.body?.data?.reordered === todoIds.length,
    `a hand-ordering is saved (${reorder.body?.data?.reordered} items)`);

  const foreignReorder = await A.json('/api/todos', {
    method: 'PATCH',
    body: JSON.stringify({ order: [...todoIds, '00000000-0000-0000-0000-000000000000'] }),
  });
  check(foreignReorder.status === 403,
    `a reorder naming somebody else's to-do is refused outright (${foreignReorder.status})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('66. A to-do that comes back');
  /**
   * The next occurrence is queued by a trigger rather than by the route, so
   * the repeat holds for every path that sets `is_done` — including a future
   * bulk action nobody has written yet.
   */

  const noDate = await A.json('/api/todos', {
    method: 'POST', body: JSON.stringify({ title: 'Undated repeat', recurrence: 'weekly' }),
  });
  check(noDate.status === 422, `a repeat with no date to repeat from is refused (${noDate.status})`);

  const badRule = await A.json('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title: 'Bad rule', dueOn: '2026-09-01', recurrence: 'fortnightly' }),
  });
  check(badRule.status === 422, `an unknown interval is refused (${badRule.status})`);
  check(/daily, weekdays, weekly, monthly/.test(badRule.body?.error?.message ?? ''),
    'and lists the ones that exist', badRule.body?.error?.message);

  const repeatTitle = `Weekly report ${run}`;
  const repeat = await A.json('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title: repeatTitle, dueOn: '2026-09-04', recurrence: 'weekly' }),
  });
  const repeatId = repeat.body?.data?.id;
  check(repeat.body?.data?.recurrence === 'weekly', 'a repeating to-do stores its interval');

  await A.json(`/api/todos/${repeatId}`, { method: 'PATCH', body: JSON.stringify({ isDone: true }) });
  const afterTick = await A.json(`/api/todos?view=all&search=${encodeURIComponent(repeatTitle)}`);
  const occurrences = (afterTick.body?.data ?? []).filter(t => t.title === repeatTitle);
  check(occurrences.length === 2, `completing it queues the next one (${occurrences.length} rows)`);
  check(occurrences.some(t => t.dueOn === '2026-09-11' && !t.isDone),
    'dated a week on from the one that was due, not a week from today');

  // Un-ticking and re-ticking is an ordinary accident; it must not queue a third.
  await A.json(`/api/todos/${repeatId}`, { method: 'PATCH', body: JSON.stringify({ isDone: false }) });
  await A.json(`/api/todos/${repeatId}`, { method: 'PATCH', body: JSON.stringify({ isDone: true }) });
  const afterRetick = await A.json(`/api/todos?view=all&search=${encodeURIComponent(repeatTitle)}`);
  check((afterRetick.body?.data ?? []).filter(t => t.title === repeatTitle).length === 2,
    'and un-ticking then re-ticking does not queue a duplicate');

  const strip = await A.json(`/api/todos/${repeatId}`, {
    method: 'PATCH', body: JSON.stringify({ dueOn: null }),
  });
  check(strip.status === 422,
    `clearing the date on a repeating to-do is refused rather than left broken (${strip.status})`);
  check(/repeats/i.test(strip.body?.error?.message ?? ''),
    'and explains what to do instead', strip.body?.error?.message);

  // ─────────────────────────────────────────────────────────────────────────
  section('67. Promoting a private note into work the team can see');
  /**
   * The bridge only ran one way — "pin a task" copies assigned work onto the
   * list. Going the other way meant retyping the title into the Projects
   * dialog and, in practice, never deleting the to-do, so the same work
   * existed twice in two different states.
   */

  const promoteProject = await A.json('/api/projects/projects', {
    method: 'POST', body: JSON.stringify({ name: `Promote ${run}`, status: 'active' }),
  });
  const promoteProjectId = promoteProject.body?.data?.id;

  const note = await A.json('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title: `Chase the quote ${run}`, note: 'turned out to be two days' }),
  });
  const noteId = note.body?.data?.id;

  const noProject = await A.json(`/api/todos/${noteId}/convert`, {
    method: 'POST', body: JSON.stringify({}),
  });
  check(noProject.status === 422, `converting with no project is refused (${noProject.status})`);

  const converted = await A.json(`/api/todos/${noteId}/convert`, {
    method: 'POST', body: JSON.stringify({ projectId: promoteProjectId }),
  });
  check(converted.status === 201, `a to-do becomes a project task (${converted.status})`);
  check(converted.body?.data?.task?.title === `Chase the quote ${run}`,
    'carrying its title across');

  const keptTodo = await A.json(`/api/todos/${noteId}`);
  check(!!keptTodo.body?.data?.linkedTaskId,
    'the to-do is kept and linked, not consumed');
  check(keptTodo.body?.data?.linkedTask?.project?.name === `Promote ${run}`,
    'and now shows which project it belongs to');

  const convertTwice = await A.json(`/api/todos/${noteId}/convert`, {
    method: 'POST', body: JSON.stringify({ projectId: promoteProjectId }),
  });
  check(convertTwice.status === 409,
    `converting the same note twice is refused (${convertTwice.status})`);

  /**
   * `mywork.view` is not `projects.create`. A role that keeps a to-do list but
   * cannot write into a project must not reach one through this side door.
   */
  const clerkClient = makeClient();
  const clerkEmail = `mywork-clerk-${run}@nexustest.dev`;
  const clerkUser = await adminCreateUser(clerkEmail, PW);
  scratchUsers.push(clerkUser?.id);
  await A.json('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: clerkEmail, firstName: 'Femi', lastName: 'Clerk', role: 'finance_staff' }),
  });
  await clerkClient.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: clerkEmail, password: PW }),
  });

  const clerkTodo = await clerkClient.json('/api/todos', {
    method: 'POST', body: JSON.stringify({ title: `Clerk note ${run}` }),
  });
  check(clerkTodo.status === 201, 'a finance clerk still has their own list');

  const clerkConvert = await clerkClient.json(`/api/todos/${clerkTodo.body?.data?.id}/convert`, {
    method: 'POST', body: JSON.stringify({ projectId: promoteProjectId }),
  });
  check(clerkConvert.status === 403,
    `but cannot create a project task through it (${clerkConvert.status})`);

  /** And a private list stays private, which is the whole promise. */
  const clerkSeesMine = await clerkClient.json('/api/todos?view=all');
  check(!(clerkSeesMine.body?.data ?? []).some(t => t.title === `Chase the quote ${run}`),
    'and cannot see anybody else’s to-dos');

} catch (e) {
  fail++; failed.push('harness error');
  console.error(`\n  HARNESS ERROR: ${e.message}`);
} finally {
  for (const id of scratchUsers) { if (id) await adminDeleteUser(id); }
  if (userA?.id) await adminDeleteUser(userA.id);
  if (userB?.id) await adminDeleteUser(userB.id);
  if (userC?.id) await adminDeleteUser(userC.id);
  if (userD?.id) await adminDeleteUser(userD.id);
  if (userE?.id) await adminDeleteUser(userE.id);
  if (userF?.id) await adminDeleteUser(userF.id);
  if (teammateUserId) await adminDeleteUser(teammateUserId);
  if (provisionedUserId) await adminDeleteUser(provisionedUserId);
  if (chainClientUser?.id) await adminDeleteUser(chainClientUser.id);
  if (outsiderUser?.id) await adminDeleteUser(outsiderUser.id);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n  Failed:'); failed.forEach(f => console.log(`    · ${f}`)); }
process.exit(fail ? 1 : 0);
