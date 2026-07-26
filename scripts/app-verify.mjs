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

let userA, userB, userC, userD, userE, userF, provisionedUserId, teammateUserId;
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

  const putSettings = await A.json('/api/admin/settings', {
    method: 'PUT', body: JSON.stringify({ settings: [] }),
  });
  check(putSettings.ok, `PUT saves settings (${putSettings.status})`);

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

  const completed = await A.json(`/api/projects/milestones/${phaseIds[0]}`, {
    method: 'PATCH', body: JSON.stringify({ completed: true }),
  });
  check(completed.ok, `a phase can be marked complete (${completed.status})`);
  check(!!completed.body?.data?.completedAt, 'and the server stamps when, not the client');

  const afterPhase = ((await A.json('/api/projects/projects?pageSize=100')).body?.data ?? [])
    .find(p => p.id === teamProjectId);
  check(afterPhase?.progressPct === 33.3,
    `progress follows the plan, not the task list (${afterPhase?.progressPct}%)`);
  check(afterPhase?.completedMilestones === 1, 'and reports which phases are done');

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

} catch (e) {
  fail++; failed.push('harness error');
  console.error(`\n  HARNESS ERROR: ${e.message}`);
} finally {
  if (userA?.id) await adminDeleteUser(userA.id);
  if (userB?.id) await adminDeleteUser(userB.id);
  if (userC?.id) await adminDeleteUser(userC.id);
  if (userD?.id) await adminDeleteUser(userD.id);
  if (userE?.id) await adminDeleteUser(userE.id);
  if (userF?.id) await adminDeleteUser(userF.id);
  if (teammateUserId) await adminDeleteUser(teammateUserId);
  if (provisionedUserId) await adminDeleteUser(provisionedUserId);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n  Failed:'); failed.forEach(f => console.log(`    · ${f}`)); }
process.exit(fail ? 1 : 0);
