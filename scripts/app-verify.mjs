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

let userA, userB, userC, userD;
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
  check(direct.body?.data?.passwordSet === false,
    'no password is set for them — reset is the only way in');
  check(direct.body?.data?.member?.employmentType === 'full_time',
    'the employment_type default applies rather than a null');

  const dupDirect = await A.json('/api/admin/users', {
    method: 'POST', body: JSON.stringify({ email: directEmail, role: 'employee' }),
  });
  check(dupDirect.status === 409, `adding the same person twice is refused (${dupDirect.status})`);

  const badRole = await A.json('/api/admin/users', {
    method: 'POST', body: JSON.stringify({ email: `x-${Date.now()}@example.com`, role: 'superuser' }),
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
} catch (e) {
  fail++; failed.push('harness error');
  console.error(`\n  HARNESS ERROR: ${e.message}`);
} finally {
  if (userA?.id) await adminDeleteUser(userA.id);
  if (userB?.id) await adminDeleteUser(userB.id);
  if (userC?.id) await adminDeleteUser(userC.id);
  if (userD?.id) await adminDeleteUser(userD.id);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n  Failed:'); failed.forEach(f => console.log(`    · ${f}`)); }
process.exit(fail ? 1 : 0);
