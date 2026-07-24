/**
 * Verify the deployed backend.
 *
 *     npm run db:verify
 *
 * Goes beyond "did the migrations apply". It creates two real users in two
 * real organizations and then tries to read across the boundary — because
 * tenant isolation is the one property that cannot be established by
 * inspecting the schema, and the one whose failure is a data breach.
 *
 * Everything it creates is namespaced `verify-<runid>@` and torn down at the
 * end, including on failure.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

// ── config ─────────────────────────────────────────────────────────────────

function env(key) {
  const raw = readFileSync('.env', 'utf8');
  const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return (process.env[key] || (m ? m[1].trim().replace(/^["']|["']$/g, '') : ''));
}

const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON_KEY     = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY  = env('SUPABASE_SERVICE_ROLE_KEY');
const DIRECT_URL   = env('DIRECT_URL') || env('DATABASE_URL');

const missing = Object.entries({ SUPABASE_URL, ANON_KEY, SERVICE_KEY, DIRECT_URL })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`\n  Missing from .env: ${missing.join(', ')}\n`);
  process.exit(1);
}

// ── harness ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const failures = [];

function check(ok, label, detail = '') {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else    { fail++; failures.push(label); console.log(`    FAIL  ${label}${detail ? `  — ${detail}` : ''}`); }
  return ok;
}
const section = t => console.log(`\n  ${t}\n  ${'─'.repeat(t.length)}`);

// ── supabase REST helpers ──────────────────────────────────────────────────

const rest = (path, token, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

const rpc = (fn, token, body = {}) =>
  rest(`rpc/${fn}`, token, { method: 'POST', body: JSON.stringify(body) });

/** Create a confirmed user via the admin API and return their access token. */
async function makeUser(email, password) {
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`admin create user: ${created.status} ${await created.text()}`);
  const user = await created.json();

  const signin = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signin.ok) throw new Error(`sign in: ${signin.status} ${await signin.text()}`);
  const { access_token } = await signin.json();
  return { id: user.id, email, token: access_token };
}

async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

// ── run ────────────────────────────────────────────────────────────────────

const runId = Date.now().toString(36);
const db = new pg.Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } });
let userA, userB, orgA, orgB;

try {
  await db.connect();

  // ─────────────────────────────────────────────────────────────────────────
  section('1. Schema');

  const q = async (sql, args = []) => (await db.query(sql, args)).rows;

  const [{ count: tables }]  = await q(`SELECT count(*)::int FROM pg_tables WHERE schemaname='public'`);
  const [{ count: views }]   = await q(`SELECT count(*)::int FROM pg_views  WHERE schemaname='public'`);
  const [{ count: funcs }]   = await q(`SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`);
  const [{ count: pols }]    = await q(`SELECT count(*)::int FROM pg_policies WHERE schemaname='public'`);

  check(tables >= 45, `tables created (${tables})`);
  check(views  >= 13, `views created (${views})`);
  check(funcs  >= 30, `functions created (${funcs})`);
  check(pols   >= 80, `policies created (${pols})`);

  const expectedTables = [
    'organizations','profiles','organization_members','departments','teams','invitations',
    'attendance_records','leave_requests','companies','contacts','leads','deals',
    'projects','tasks','workspace_pages','channels','messages','support_tickets',
    'invoices','expenses','products','stock_movements','purchase_orders','files',
    'audit_log','activity_log','notifications',
  ];
  const present = new Set((await q(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).map(r => r.tablename));
  const absent = expectedTables.filter(t => !present.has(t));
  check(absent.length === 0, 'all expected tables present', absent.join(', '));

  // ─────────────────────────────────────────────────────────────────────────
  section('2. RLS is enabled and forced');

  const unprotected = await q(`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)`);
  check(unprotected.length === 0,
    'every table has RLS enabled AND forced',
    unprotected.map(r => r.relname).join(', '));

  // A view without security_invoker runs as its owner and bypasses RLS —
  // the most common multi-tenant leak.
  const leakyViews = await q(`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v'
      AND NOT COALESCE((
        SELECT option_value::boolean FROM pg_options_to_table(c.reloptions)
        WHERE option_name = 'security_invoker'), false)`);
  check(leakyViews.length === 0,
    'every view sets security_invoker',
    leakyViews.map(r => r.relname).join(', '));

  const helpers = await q(`
    SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND proname IN
      ('auth_org_ids','is_org_member','auth_role_in','is_org_admin','auth_member_id')`);
  check(helpers.length >= 5 && helpers.every(h => h.prosecdef),
    'tenant helpers exist and are SECURITY DEFINER');

  // ─────────────────────────────────────────────────────────────────────────
  section('3. Storage and realtime');

  const buckets = await q(`SELECT id, public FROM storage.buckets`);
  const byId = Object.fromEntries(buckets.map(b => [b.id, b]));
  check(['avatars','logos','documents','attachments','hr-documents','receipts']
    .every(b => byId[b]), `all 6 buckets exist (${buckets.length} found)`);
  check(byId['hr-documents'] && byId['hr-documents'].public === false,
    'hr-documents bucket is private');
  check(byId['avatars'] && byId['avatars'].public === true,
    'avatars bucket is public');

  const storagePolicies = await q(`SELECT policyname FROM pg_policies WHERE schemaname='storage'`);
  check(storagePolicies.length >= 4, `storage policies present (${storagePolicies.length})`);

  const pub = await q(`
    SELECT tablename FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'`);
  const pubset = new Set(pub.map(r => r.tablename));
  check(['messages','notifications','tasks','attendance_records'].every(t => pubset.has(t)),
    `realtime publication covers the live tables (${pub.length})`);

  // ─────────────────────────────────────────────────────────────────────────
  section('4. Onboarding');

  userA = await makeUser(`verify-${runId}-a@example.com`, 'Passw0rd!verify');
  userB = await makeUser(`verify-${runId}-b@example.com`, 'Passw0rd!verify');

  const profA = await q(`SELECT id, email FROM profiles WHERE id=$1`, [userA.id]);
  check(profA.length === 1, 'signup trigger created a profile row');

  const rA = await rpc('create_organization', userA.token, { org_name: `Verify A ${runId}` });
  const bodyA = await rA.json();
  orgA = Array.isArray(bodyA) ? bodyA[0] : bodyA;
  check(rA.ok && orgA?.id, 'create_organization() succeeded', rA.ok ? '' : JSON.stringify(bodyA));

  const rB = await rpc('create_organization', userB.token, { org_name: `Verify B ${runId}` });
  const bodyB = await rB.json();
  orgB = Array.isArray(bodyB) ? bodyB[0] : bodyB;
  check(rB.ok && orgB?.id, 'second organization created');

  if (orgA?.id) {
    const owner = await q(
      `SELECT role::text FROM organization_members WHERE organization_id=$1 AND user_id=$2`,
      [orgA.id, userA.id]);
    check(owner[0]?.role === 'owner', 'creator became owner');

    const seeded = await q(`SELECT count(*)::int AS n FROM departments WHERE organization_id=$1`, [orgA.id]);
    check(seeded[0].n >= 1, 'new organization seeded with a default department');
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('5. Tenant isolation — the one that matters');

  // Give each organization a distinguishable row, using the service role so
  // the fixture itself is not the thing under test.
  const svc = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               'Content-Type': 'application/json', Prefer: 'return=representation', ...(init?.headers || {}) },
  });

  await svc('companies', { method: 'POST', body: JSON.stringify({ organization_id: orgA.id, name: `ACME-${runId}` }) });
  await svc('companies', { method: 'POST', body: JSON.stringify({ organization_id: orgB.id, name: `GLOBEX-${runId}` }) });

  const aSees = await (await rest('companies?select=name', userA.token)).json();
  const bSees = await (await rest('companies?select=name', userB.token)).json();

  const aNames = (Array.isArray(aSees) ? aSees : []).map(r => r.name);
  const bNames = (Array.isArray(bSees) ? bSees : []).map(r => r.name);

  check(aNames.includes(`ACME-${runId}`), 'A sees its own company');
  check(!aNames.includes(`GLOBEX-${runId}`), "A CANNOT see B's company", aNames.join(','));
  check(bNames.includes(`GLOBEX-${runId}`), 'B sees its own company');
  check(!bNames.includes(`ACME-${runId}`), "B CANNOT see A's company", bNames.join(','));

  // Direct-id fetch must fail too: filtering the list is not enough if a
  // known id can still be read.
  const [aCompany] = (await q(`SELECT id FROM companies WHERE name=$1`, [`ACME-${runId}`]));
  if (aCompany) {
    const stolen = await (await rest(`companies?id=eq.${aCompany.id}&select=name`, userB.token)).json();
    check(Array.isArray(stolen) && stolen.length === 0,
      "B cannot fetch A's company by id", JSON.stringify(stolen));
  }

  // Writing into someone else's tenant must be refused.
  const intrusion = await rest('companies', userB.token, {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgA.id, name: `INTRUDER-${runId}` }),
  });
  check(!intrusion.ok, `B cannot insert into A's organization (HTTP ${intrusion.status})`);

  // Cross-tenant membership must be invisible.
  const membersSeenByB = await (await rest(
    `organization_members?organization_id=eq.${orgA.id}&select=id`, userB.token)).json();
  check(Array.isArray(membersSeenByB) && membersSeenByB.length === 0,
    "B cannot enumerate A's members");

  // ─────────────────────────────────────────────────────────────────────────
  section('6. Business rules');

  // Attendance clock — server timestamps.
  const ci = await rpc('clock_in', userA.token, { org: orgA.id });
  const ciBody = await ci.json();
  const rec = Array.isArray(ciBody) ? ciBody[0] : ciBody;
  check(ci.ok && rec?.checked_in_at, 'clock_in() records a check-in', ci.ok ? '' : JSON.stringify(ciBody));

  if (rec?.checked_in_at) {
    const drift = Math.abs(Date.now() - new Date(rec.checked_in_at).getTime());
    check(drift < 120_000, `check-in uses server time (drift ${Math.round(drift / 1000)}s)`);
  }

  const ciAgain = await rpc('clock_in', userA.token, { org: orgA.id });
  check(!ciAgain.ok, 'double check-in is refused');

  const co = await rpc('clock_out', userA.token, { org: orgA.id });
  check(co.ok, 'clock_out() succeeds');
  const coAgain = await rpc('clock_out', userA.token, { org: orgA.id });
  check(!coAgain.ok, 'double check-out is refused');

  // Attendance times cannot be forged even through a direct insert.
  const forged = await rest('attendance_records', userA.token, {
    method: 'POST',
    body: JSON.stringify({
      organization_id: orgA.id,
      member_id: (await q(`SELECT id FROM organization_members WHERE user_id=$1 AND organization_id=$2`,
                          [userA.id, orgA.id]))[0]?.id,
      work_date: '2020-01-02',
      checked_in_at: '2020-01-02T04:00:00Z',
    }),
  });
  if (forged.ok) {
    const [row] = await q(`SELECT checked_in_at FROM attendance_records WHERE work_date='2020-01-02'`);
    const kept = row && new Date(row.checked_in_at).getFullYear() === 2020;
    check(!kept, 'client-supplied check-in time is overwritten by the server');
  } else {
    check(true, 'direct attendance insert with a forged time was rejected');
  }

  // Self-approval must be impossible.
  const memberA = (await q(
    `SELECT id FROM organization_members WHERE user_id=$1 AND organization_id=$2`,
    [userA.id, orgA.id]))[0]?.id;

  await db.query(
    `INSERT INTO leave_requests (organization_id, member_id, type, start_date, end_date, reason)
     VALUES ($1,$2,'vacation', current_date + 10, current_date + 12, 'verify')`,
    [orgA.id, memberA]);

  let selfApprovalBlocked = false;
  try {
    await db.query(
      `UPDATE leave_requests SET status='approved', approved_by=$1
       WHERE organization_id=$2 AND member_id=$1`, [memberA, orgA.id]);
  } catch (e) {
    selfApprovalBlocked = /cannot approve your own/i.test(e.message);
  }
  check(selfApprovalBlocked, 'approving your own leave is blocked by the database');

  // Document numbering is per-organization and sequential.
  const n1 = (await q(`SELECT public.next_document_number($1,'TST') AS n`, [orgA.id]))[0].n;
  const n2 = (await q(`SELECT public.next_document_number($1,'TST') AS n`, [orgA.id]))[0].n;
  const m1 = (await q(`SELECT public.next_document_number($1,'TST') AS n`, [orgB.id]))[0].n;
  check(n1 === 'TST-000001' && n2 === 'TST-000002', `numbering is sequential (${n1}, ${n2})`);
  check(m1 === 'TST-000001', `numbering restarts per organization (${m1})`);

  // Stock ledger must refuse to go negative.
  const wh = (await svc('warehouses', { method: 'POST',
    body: JSON.stringify({ organization_id: orgA.id, name: `WH-${runId}` }) }).then(r => r.json()))[0];
  const prod = (await svc('products', { method: 'POST',
    body: JSON.stringify({ organization_id: orgA.id, sku: `SKU-${runId}`, name: 'Widget',
                           warehouse_id: wh?.id, cost: 10, price: 25 }) }).then(r => r.json()))[0];

  if (prod?.id) {
    // Called over REST as user A, not through the raw pg connection: the
    // function resolves the caller with auth.uid(), which is NULL on a direct
    // connection — it would correctly refuse, and the test would be measuring
    // the harness rather than the rule.
    const mv = await rpc('record_stock_movement', userA.token, {
      org: orgA.id, product: prod.id, qty: 50,
      movement_type: 'receipt', reason: 'verify', reference: '',
    });
    check(mv.ok, 'record_stock_movement() succeeds for a member',
      mv.ok ? '' : JSON.stringify(await mv.json()));

    const [{ stock }] = await q(`SELECT stock FROM products WHERE id=$1`, [prod.id]);
    check(stock === 50, `stock movement updates the balance (${stock})`);

    const neg = await rpc('record_stock_movement', userA.token, {
      org: orgA.id, product: prod.id, qty: -999,
      movement_type: 'issue', reason: 'verify', reference: '',
    });
    check(!neg.ok, 'stock cannot be driven negative');

    // A non-member must not be able to move another organization's stock.
    const cross = await rpc('record_stock_movement', userB.token, {
      org: orgA.id, product: prod.id, qty: 5,
      movement_type: 'receipt', reason: 'intrusion', reference: '',
    });
    check(!cross.ok, "B cannot move stock in A's organization");
  }

  // Audit trail is written automatically.
  const audit = await q(
    `SELECT count(*)::int AS n FROM audit_log WHERE organization_id=$1`, [orgA.id]);
  check(audit[0].n > 0, `audit log is populated by trigger (${audit[0].n} entries)`);

  // The last owner cannot be removed.
  let lastOwnerBlocked = false;
  try {
    await db.query(`UPDATE organization_members SET role='employee' WHERE id=$1`, [memberA]);
  } catch (e) { lastOwnerBlocked = /last owner/i.test(e.message); }
  check(lastOwnerBlocked, 'the last owner cannot be demoted');

  // ─────────────────────────────────────────────────────────────────────────
  section('7. Reporting views');

  const stats = await q(`SELECT * FROM v_dashboard_stats WHERE organization_id=$1`, [orgA.id]);
  check(stats.length === 1, 'v_dashboard_stats returns a row');
  const alerts = await q(`SELECT count(*)::int AS n FROM v_inventory_alerts WHERE organization_id=$1`, [orgA.id]);
  check(typeof alerts[0].n === 'number', 'v_inventory_alerts is queryable');
  const dir = await q(`SELECT count(*)::int AS n FROM v_org_directory WHERE organization_id=$1`, [orgA.id]);
  check(dir[0].n >= 1, `v_org_directory resolves members (${dir[0].n})`);

} catch (e) {
  fail++;
  failures.push('harness error');
  console.error(`\n  HARNESS ERROR: ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n') ?? ''}`);
} finally {
  // ── teardown ──
  console.log('\n  Cleaning up…');
  try {
    if (orgA?.id) await db.query(`DELETE FROM organizations WHERE id=$1`, [orgA.id]);
    if (orgB?.id) await db.query(`DELETE FROM organizations WHERE id=$1`, [orgB.id]);
  } catch (e) { console.log(`    (org cleanup: ${e.message})`); }
  if (userA) await deleteUser(userA.id);
  if (userB) await deleteUser(userB.id);
  await db.end().catch(() => {});
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\n  Failed checks:');
  failures.forEach(f => console.log(`    · ${f}`));
  console.log('\n  Do not migrate application modules until these pass —');
  console.log('  particularly anything under "Tenant isolation".\n');
}
process.exit(fail ? 1 : 0);
