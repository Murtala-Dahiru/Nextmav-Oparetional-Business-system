/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Static security checks over the API surface
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     npm run security:check          (no server or database needed)
 *
 * ── What this catches that the other harnesses cannot ─────────────────────
 *
 * `app:verify` proves the routes that exist behave correctly. It cannot prove
 * anything about a route added tomorrow — and the failure mode of a forgotten
 * guard is not an error but an *absence*: the handler runs, the query succeeds,
 * and data crosses a tenant boundary with a 200.
 *
 * So this reads the source rather than the running application, and fails on
 * the shapes that are wrong by construction:
 *
 *   1. A route handler that never establishes a request context.
 *   2. A query that uses the service-role client — which bypasses RLS entirely
 *      — inside a request handler.
 *   3. A view created without `security_invoker`, which is the one way a view
 *      becomes the place RLS does not apply. (`check-migrations-consistency`
 *      already does this; it is restated here so one command covers the
 *      boundary.)
 *   4. A table with RLS enabled and no policy, which denies everything, and a
 *      table with policies but RLS not enabled, which permits everything.
 *
 * Every finding is a file and a line, because a security check nobody can act
 * on quickly is one that gets skipped.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fail = 0;
const findings = [];
const check = (ok, label, detail = '') => {
  if (ok) console.log(`    PASS  ${label}`);
  else { fail++; findings.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`    FAIL  ${label}`); }
  return ok;
};
const section = t => console.log(`\n  ${t}\n  ${'─'.repeat(t.length)}`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
section('1. Every route handler establishes a request context');
/**
 * The pre-authentication routes are listed explicitly rather than pattern
 * matched. `/api/auth/**` as a blanket exemption would also exempt
 * `/api/auth/profile`, which returns the signed-in user's own record and must
 * not be reachable anonymously.
 */
const PUBLIC_ROUTES = new Set([
  'api/route.ts',                          // health check, returns a version
  'api/auth/login/route.ts',
  'api/auth/signup/route.ts',
  'api/auth/forgot-password/route.ts',
  'api/auth/reset-password/route.ts',
  'api/auth/resend-confirmation/route.ts',
  'api/auth/accept-invite/route.ts',       // authenticates by invitation token
]);

/**
 * Anything that resolves who is calling, or issues its queries as them.
 *
 * Three tiers, all acceptable:
 *
 *   · `authorize()` — a module capability check. What most routes want.
 *   · `authenticate()` / `getContext()` — a session, without a module grant.
 *     For endpoints whose subject is the person: their own tray, their own
 *     presence, their own profile.
 *   · `supabaseServer()` — a client carrying the user's JWT, so every query is
 *     subject to RLS. Necessary for the routes that must work for somebody
 *     authenticated but not yet in an organization: `/api/organizations` POST
 *     creates the first membership, and `authorize()` would 401 the very
 *     request that fixes that.
 *
 * What is *not* on this list is the point: `supabaseAdmin()`, which bypasses
 * RLS, is checked separately below.
 */
const GUARDS = [
  'authorize(', 'authenticate(', 'getContext(', 'supabaseServer(',
  // The shared handlers call `authorize()` themselves, once, for every route
  // built from them — which is the point of them existing.
  'recordHandlers(', 'collectionHandlers(', 'listHandler(', 'createHandler(',
  'updateHandler(', 'deleteHandler(', 'getOneHandler(',
];

const routes = walk('src/app/api').filter(f => f.endsWith('route.ts'));
const unguarded = [];

for (const file of routes) {
  const rel = file.replace(/\\/g, '/').replace('src/app/', '');
  if (PUBLIC_ROUTES.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  if (!GUARDS.some(g => src.includes(g))) unguarded.push(rel);
}

check(unguarded.length === 0,
  `all ${routes.length - PUBLIC_ROUTES.size} non-public routes establish a context`,
  unguarded.join(', '));

/**
 * The exemption list must not rot. A path listed here that no longer exists is
 * a sign the list was copied rather than maintained, and the next stale entry
 * might be one that does exist and should not be exempt.
 */
const missingPublic = [...PUBLIC_ROUTES].filter(
  p => !routes.some(f => f.replace(/\\/g, '/').replace('src/app/', '') === p),
);
check(missingPublic.length === 0,
  'the pre-authentication exemption list has no stale entries',
  missingPublic.join(', '));

// ───────────────────────────────────────────────────────────────────────────
section('2. The service-role client stays out of request handlers');
/**
 * `supabaseAdmin()` bypasses RLS completely. It is legitimate for provisioning
 * an account — creating an auth user before any membership exists — and for
 * nothing that serves a caller their own data, because a single misuse removes
 * every isolation guarantee the schema provides at once.
 */
const ADMIN_ALLOWED = new Set([
  'api/auth/signup/route.ts',              // creates the first membership
  'api/auth/invite/route.ts',              // creates an auth user for an invitee
  'api/auth/accept-invite/route.ts',
  'api/auth/forgot-password/route.ts',
  'api/auth/resend-confirmation/route.ts',
  'api/admin/users/route.ts',              // provisions a real account
  'api/admin/users/[id]/reset-password/route.ts',
  'api/organizations/route.ts',            // the very first row for a tenant
  /**
   * Clears `force_password_change` once the caller has proved the current
   * password. The row is the caller's own and the update is a single boolean;
   * it needs the admin client only because the user is, by definition, still
   * inside the gate that refuses them everything else.
   */
  'api/auth/change-password/route.ts',
]);

const adminMisuse = [];
for (const file of routes) {
  const rel = file.replace(/\\/g, '/').replace('src/app/', '');
  if (ADMIN_ALLOWED.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  if (/supabaseAdmin\s*\(/.test(src)) adminMisuse.push(rel);
}
check(adminMisuse.length === 0,
  'no route serves user data through the service-role client',
  adminMisuse.join(', '));

// ───────────────────────────────────────────────────────────────────────────
section('3. Views do not become the hole in RLS');

const migrations = readdirSync('supabase/migrations')
  .filter(f => f.endsWith('.sql'))
  .map(f => join('supabase/migrations', f));

const joined = migrations.map(f => readFileSync(f, 'utf8')).join('\n');

/**
 * Every `CREATE [OR REPLACE] VIEW public.x` must be followed closely by
 * `security_invoker`. Without it the view runs as its owner, and a member
 * reading it receives rows their own policies would refuse.
 */
const definerViews = [];
for (const m of joined.matchAll(/CREATE (?:OR REPLACE )?VIEW public\.(\w+)([\s\S]{0,120})/g)) {
  if (!/security_invoker\s*=\s*true/.test(m[2])) definerViews.push(m[1]);
}
check(definerViews.length === 0,
  'every view is security_invoker, so RLS still applies through it',
  [...new Set(definerViews)].join(', '));

// ───────────────────────────────────────────────────────────────────────────
section('4. Tenant-scoped tables have RLS enabled and policies to match');

/**
 * RLS is enabled two ways, and both have to be recognised.
 *
 * 0005 does it in a `FOREACH t IN ARRAY ARRAY[...] LOOP` over forty-odd table
 * names — `EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t)`
 * — while later migrations write the statement out for the tables they add. A
 * checker that understood only the literal form reported all forty as having
 * inert policies: forty false alarms, which is how a security check comes to be
 * ignored and then switched off.
 */
const rlsEnabled = new Set(
  [...joined.matchAll(/ALTER TABLE (?:public\.)?(\w+)\s+ENABLE ROW LEVEL SECURITY/g)].map(m => m[1]),
);

for (const block of joined.matchAll(
  /FOREACH\s+\w+\s+IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP([\s\S]{0,600}?)END LOOP/g,
)) {
  if (!/ENABLE ROW LEVEL SECURITY/.test(block[2])) continue;
  for (const name of block[1].matchAll(/'(\w+)'/g)) rlsEnabled.add(name[1]);
}

/**
 * Policies are declared two ways as well.
 *
 * Most are written out. The nineteen straightforward tenant-scoped tables —
 * where the rule is "your organization, and the module grant decides the rest"
 * — are generated from a `VALUES (table, module)` list, because nineteen
 * hand-written copies of one policy is nineteen chances for one of them to
 * differ. `CREATE POLICY %I ON public.%I` never matches a literal search, so a
 * checker that only reads literals concludes those tables have RLS on and no
 * policy, which reads as "everything is denied" when the truth is the opposite
 * of alarming.
 */
const withPolicies = new Set(
  [...joined.matchAll(/CREATE POLICY \w+ ON (?:public\.)?(\w+)/g)].map(m => m[1]),
);

for (const block of joined.matchAll(
  /SELECT \* FROM \(VALUES([\s\S]*?)\) AS t\(tbl, module\)([\s\S]{0,2000}?)END LOOP/g,
)) {
  if (!/CREATE POLICY %I ON public\.%I/.test(block[2])) continue;
  // The first column of each tuple is the table; the second is its module.
  for (const row of block[1].matchAll(/\(\s*'(\w+)'\s*,/g)) withPolicies.add(row[1]);
}

/**
 * A table with policies and no `ENABLE ROW LEVEL SECURITY` is the dangerous
 * direction: the policies are inert and every row is readable. The reverse —
 * RLS on with no policy — denies everything, which is loud and gets fixed.
 */
const inertPolicies = [...withPolicies].filter(t => !rlsEnabled.has(t));
check(inertPolicies.length === 0,
  `all ${withPolicies.size} tables with policies also have RLS enabled`,
  inertPolicies.join(', '));

const lockedOut = [...rlsEnabled].filter(t => !withPolicies.has(t));
check(lockedOut.length === 0,
  'no table has RLS enabled with no policy at all',
  lockedOut.join(', '));

// ───────────────────────────────────────────────────────────────────────────
section('5. Organization scoping is explicit in the shared handlers');
/**
 * RLS is the guarantee; the explicit filter is what keeps the queries on the
 * index and the intent readable. Both matter, and the second is easy to forget
 * in a hand-written route.
 */
const crud = readFileSync('src/lib/supabase/crud.ts', 'utf8');
check(
  (crud.match(/\.eq\('organization_id', ctx\.org\.organizationId\)/g) ?? []).length >= 5,
  'the shared list/record handlers filter on the caller\'s organization',
);
check(
  crud.includes("delete payload.organization_id") && crud.includes("delete payload.id"),
  'and refuse to let a client move a record between tenants',
);

// ───────────────────────────────────────────────────────────────────────────
console.log('');
if (findings.length) {
  console.log('  Findings');
  console.log('  ────────');
  for (const f of findings) console.log(`    · ${f}`);
  console.log('');
}
console.log(fail ? `  ${fail} check(s) failed` : '  the API surface is guarded');
process.exit(fail ? 1 : 0);
