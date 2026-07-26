/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Contract drift: what a screen reads vs what its endpoint returns.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     npm run contract:check          (dev server must be on :3100)
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The same defect has now been found in seven modules, one at a time, by
 * hand: a component declares `interface Lead { company: string }` while the
 * endpoint returns `companyName`. TypeScript cannot catch it — the interface
 * is an assertion about a `fetch()` result, not a checked fact — and the
 * request succeeds, so nothing fails. The column simply renders blank, or the
 * field is dropped on save and the API still answers 201.
 *
 * Every previous instance cost a manual audit to find. This finds all of them
 * in one pass, and will fail the moment a new one appears.
 *
 * ── How it works ─────────────────────────────────────────────────────────
 *
 * For each mapping below it creates a real record through the real API as a
 * real signed-in user, then compares the keys that come back against the
 * fields the component's interface declares. A field the component reads that
 * the endpoint never sends is drift; anything that renders it shows blank.
 *
 * It reports rather than guesses: extra keys in the response are fine (an
 * endpoint may legitimately return more than one screen needs), so only the
 * component→response direction is an error.
 *
 * `optional?` fields are still checked. Marking a field optional in
 * TypeScript says "this may be absent", not "this name is correct" — and
 * `owner?: { firstName }` against `owner: { profiles: {...} }` was exactly how
 * the project board came to show a blank owner on every card.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:3100';

function env(k) {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}
const SUPABASE = env('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const REST = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

let drift = 0;
const findings = [];

// ── Reading a component's declared shape ──────────────────────────────────

/**
 * Pull the top-level field names out of `interface Name { ... }`.
 *
 * Deliberately shallow: nested relation shapes are checked by naming the
 * relation itself (`owner`), because a relation that is present but shaped
 * differently is reported separately below via `relations`.
 */
function interfaceFields(file, name) {
  const src = readFileSync(file, 'utf8');
  const start = src.search(new RegExp(`interface\\s+${name}\\s*\\{`));
  if (start === -1) return null;

  let i = src.indexOf('{', start);
  let depth = 0;
  let end = i;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') { depth--; if (depth === 0) break; }
  }

  const body = src.slice(i + 1, end);
  // Strip nested object literals so only top-level members remain. Repeated
  // until stable: one pass only removes the innermost braces, which would
  // leave a two-deep relation like `owner?: { profiles?: {...} }` exposing
  // `profiles` as if it were a top-level field.
  let flat = body;
  for (let prev = null; prev !== flat; ) {
    prev = flat;
    flat = flat.replace(/\{[^{}]*\}/g, 'X');
  }
  const fields = [];
  for (const m of flat.matchAll(/(?:^|[;\n])\s*([a-zA-Z_][\w]*)\s*\??\s*:/g)) {
    fields.push(m[1]);
  }
  return [...new Set(fields)];
}

// ── HTTP client that keeps a session ──────────────────────────────────────

function makeClient() {
  const jar = new Map();
  return {
    async json(path, init = {}) {
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(BASE + path, {
        ...init,
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
      });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        const n = pair.slice(0, idx).trim(), v = pair.slice(idx + 1).trim();
        if (v === '') jar.delete(n); else jar.set(n, v);
      }
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, ok: res.ok, body };
    },
  };
}

// ── What to compare ───────────────────────────────────────────────────────

const CRM = 'src/components/modules/crm/index.tsx';
const PROJECTS = 'src/components/modules/projects/index.tsx';
const INVENTORY = 'src/components/modules/inventory/index.tsx';
const SUPPLY = 'src/components/modules/inventory/supply-tabs.tsx';
const SUPPORT = 'src/components/modules/support/index.tsx';
const WORKSPACE = 'src/components/modules/workspace/index.tsx';
const FINANCE = 'src/components/modules/finance/index.tsx';
const HR = 'src/components/modules/hr/index.tsx';
const ATTENDANCE = 'src/components/modules/hr/attendance-tab.tsx';
const COMMS = 'src/components/modules/communication/index.tsx';
const ADMIN = 'src/components/modules/admin/index.tsx';
const CALENDAR = 'src/components/modules/calendar/index.tsx';

/**
 * Fields a screen holds that are legitimately not on the wire.
 *
 * Only two reasons qualify: the endpoint merges it in from elsewhere, or the
 * component computes it. Anything else in here would be hiding a real defect,
 * so each entry says which.
 */
const NOT_ON_THE_WIRE = {
  // Merged by the projects endpoint from v_project_health.
  Project: ['totalTasks', 'completedTasks', 'blockedTasks', 'overdueTasks',
            'progressPct', 'daysRemaining', 'isAtRisk'],
  // Derived in the channel list from the most recent message.
  ChannelWithLastMessage: ['lastMessage', 'lastMessageSender', 'unreadCount'],
};

/** Each entry: create a record, then compare the component's declared shape. */
const CONTRACTS = [
  { label: 'CRM · Lead',       file: CRM, iface: 'Lead',
    path: '/api/crm/leads', body: () => ({ firstName: 'A', lastName: 'B' }) },
  { label: 'CRM · Contact',    file: CRM, iface: 'Contact',
    path: '/api/crm/contacts', body: () => ({ firstName: 'A', lastName: 'B' }) },
  { label: 'CRM · Company',    file: CRM, iface: 'Company',
    path: '/api/crm/companies', body: () => ({ name: `Co ${Date.now()}` }) },
  { label: 'CRM · Deal',       file: CRM, iface: 'Deal',
    path: '/api/crm/deals', body: () => ({ name: 'D', value: 1 }) },
  { label: 'Projects · Project', file: PROJECTS, iface: 'Project',
    path: '/api/projects/projects', body: () => ({ name: `P ${Date.now()}` }) },
  { label: 'Projects · Task',  file: PROJECTS, iface: 'Task',
    path: '/api/projects/tasks', body: () => ({ title: 'T' }) },
  { label: 'Inventory · Product', file: INVENTORY, iface: 'Product',
    path: '/api/inventory/products', body: () => ({ name: 'W', sku: `S${Date.now()}`, price: 1, cost: 1 }) },
  { label: 'Support · Ticket', file: SUPPORT, iface: 'Ticket',
    path: '/api/support/tickets', body: () => ({ subject: 'S', description: 'D' }) },
  { label: 'Workspace · Page', file: WORKSPACE, iface: 'WorkspacePage',
    path: '/api/workspace/pages', body: () => ({ title: 'P' }) },
  { label: 'Finance · Expense', file: FINANCE, iface: 'ExpenseRecord',
    path: '/api/finance/expenses',
    body: () => ({ title: 'E', amount: 1, category: 'travel', expenseDate: '2026-01-01' }) },

  { label: 'Calendar · Event', file: CALENDAR, iface: 'CalendarEvent',
    path: '/api/calendar/events',
    body: () => ({ title: 'E', startsAt: '2030-01-01T09:00:00Z', endsAt: '2030-01-01T10:00:00Z' }) },
];

/** Endpoints compared against a list read rather than a create. */
const LIST_CONTRACTS = [
  { label: 'Admin · Directory', file: ADMIN, iface: 'UserRecord', path: '/api/admin/users' },
  { label: 'HR · Directory',    file: HR,    iface: 'UserRecord', path: '/api/admin/users' },
  { label: 'HR · Attendance',   file: ATTENDANCE, iface: 'AttendanceRecord', path: '/api/hr/attendance' },
  { label: 'HR · Leave',        file: HR,    iface: 'LeaveRequest', path: '/api/hr/leave' },
  { label: 'Finance · Invoice', file: FINANCE, iface: 'InvoiceRecord', path: '/api/finance/invoices' },
  { label: 'Inventory · PO',    file: SUPPLY,  iface: 'PurchaseOrder', path: '/api/inventory/purchase-orders' },
  { label: 'Inventory · Movement', file: SUPPLY, iface: 'StockMovement', path: '/api/inventory/movements' },
  { label: 'Comms · Channel',   file: COMMS, iface: 'Channel', path: '/api/communication/channels' },
];

function compare(label, iface, declared, received) {
  if (!declared) {
    console.log(`  SKIP  ${label} — interface ${iface} not found`);
    return;
  }
  if (!received) {
    console.log(`  SKIP  ${label} — no record to compare`);
    return;
  }
  const allowed = new Set(NOT_ON_THE_WIRE[iface] ?? []);
  const keys = new Set(Object.keys(received));
  const missing = declared.filter(f => !keys.has(f) && !allowed.has(f));

  if (missing.length === 0) {
    console.log(`  OK    ${label}`);
    return;
  }
  drift += missing.length;
  findings.push({ label, iface, missing });
  console.log(`  DRIFT ${label} — the screen reads ${missing.length} field(s) the endpoint never sends:`);
  for (const f of missing) console.log(`          · ${f}`);
}

// ── Run ───────────────────────────────────────────────────────────────────

const run = Date.now().toString(36);
const email = `contract-${run}@example.com`;
let userId = null;

try {
  const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST', headers: REST,
    body: JSON.stringify({ email, password: 'Passw0rd!contract', email_confirm: true }),
  });
  if (!created.ok) throw new Error(`admin create: ${created.status}`);
  userId = (await created.json()).id;

  const A = makeClient();
  await A.json('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!contract' }),
  });
  await A.json('/api/organizations', {
    method: 'POST', body: JSON.stringify({ name: `Contract ${run}` }),
  });

  console.log('\n  Created records\n  ───────────────');
  for (const c of CONTRACTS) {
    const res = await A.json(c.path, { method: 'POST', body: JSON.stringify(c.body()) });
    if (!res.ok) {
      console.log(`  SKIP  ${c.label} — create returned ${res.status}: ${res.body?.error?.message ?? ''}`);
      continue;
    }
    compare(c.label, c.iface, interfaceFields(c.file, c.iface), res.body?.data);
  }

  /**
   * Seed the records the list comparisons need.
   *
   * A list endpoint with no rows tells us nothing, and every one of these
   * screens is exactly where drift has been found before — skipping them
   * because the tenant is new would leave the highest-risk shapes unchecked.
   */
  const seedCo = await A.json('/api/crm/companies', {
    method: 'POST', body: JSON.stringify({ name: `Seed ${run}` }),
  });
  await A.json('/api/finance/invoices', {
    method: 'POST',
    body: JSON.stringify({
      companyId: seedCo.body?.data?.id,
      lineItems: [{ description: 'Seed', quantity: 1, unitPrice: 100 }],
      dueDate: '2030-01-01',
    }),
  });
  await A.json('/api/hr/attendance/clock', { method: 'POST', body: JSON.stringify({ action: 'in' }) });
  await A.json('/api/hr/leave', {
    method: 'POST',
    body: JSON.stringify({ type: 'vacation', startDate: '2030-03-01', endDate: '2030-03-02' }),
  });

  const seedWh = await A.json('/api/inventory/warehouses', {
    method: 'POST', body: JSON.stringify({ name: 'Seed', code: `S${run}`.slice(0, 8) }),
  });
  const seedSup = await A.json('/api/inventory/suppliers', {
    method: 'POST', body: JSON.stringify({ name: `Sup ${run}` }),
  });
  const seedProd = await A.json('/api/inventory/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Seed', sku: `SKU${run}`, price: 10, cost: 5, warehouseId: seedWh.body?.data?.id }),
  });
  await A.json('/api/inventory/movements', {
    method: 'POST',
    body: JSON.stringify({ productId: seedProd.body?.data?.id, quantity: 5, type: 'receipt' }),
  });
  await A.json('/api/inventory/purchase-orders', {
    method: 'POST',
    body: JSON.stringify({
      supplierId: seedSup.body?.data?.id, warehouseId: seedWh.body?.data?.id,
      items: [{ productId: seedProd.body?.data?.id, quantity: 1, unitCost: 10 }],
    }),
  });

  console.log('\n  List reads\n  ──────────');
  for (const c of LIST_CONTRACTS) {
    const res = await A.json(c.path);
    const row = res.body?.data?.[0];
    if (!res.ok) {
      console.log(`  SKIP  ${c.label} — list returned ${res.status}`);
      continue;
    }
    compare(c.label, c.iface, interfaceFields(c.file, c.iface), row);
  }
} catch (e) {
  console.error(`\n  HARNESS ERROR: ${e.message}`);
  drift = drift || 1;
} finally {
  if (userId) {
    const members = await (await fetch(
      `${SUPABASE}/rest/v1/organization_members?user_id=eq.${userId}&select=organization_id`,
      { headers: REST },
    )).json();
    for (const { organization_id: org } of members ?? []) {
      const orders = await (await fetch(
        `${SUPABASE}/rest/v1/purchase_orders?organization_id=eq.${org}&select=id`, { headers: REST },
      )).json();
      if (orders?.length) {
        await fetch(
          `${SUPABASE}/rest/v1/purchase_order_items?order_id=in.(${orders.map(o => o.id).join(',')})`,
          { method: 'DELETE', headers: REST },
        );
      }
      await fetch(`${SUPABASE}/rest/v1/purchase_orders?organization_id=eq.${org}`, { method: 'DELETE', headers: REST });
      await fetch(`${SUPABASE}/rest/v1/organizations?id=eq.${org}`, { method: 'DELETE', headers: REST });
    }
    await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: REST });
  }
}

console.log(`\n  ${drift === 0 ? 'No contract drift.' : `${drift} drifted field(s) across ${findings.length} screen(s).`}`);
if (drift) {
  console.log('\n  Each one renders blank, or is dropped on save while the API still reports success.');
}
process.exit(drift ? 1 : 0);
