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

/**
 * Source with comments removed, line numbering preserved.
 *
 * Needed because this file's checks look for patterns that the codebase also
 * *describes*. Section 9 below searches for `error(e.message, 500)`, which is
 * exactly the string the comment above `serverError()` quotes when explaining
 * why that shape was removed — so an unfiltered scan fails on its own
 * documentation, and the fix somebody reaches for is deleting the check.
 *
 * Comment bodies become blank rather than disappearing, so a finding still
 * reports the line the reader will find in their editor.
 */
function stripComments(src) {
  let out = '';
  let inBlock = false, inLine = false, quote = null;

  for (let i = 0; i < src.length; i++) {
    const c = src[i], next = src[i + 1];

    if (c === '\n') {
      inLine = false;
      quote = null;         // an unterminated string cannot span a line here
      out += c;
      continue;
    }
    if (inLine) { out += ' '; continue; }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; out += '  '; i++; }
      else out += ' ';
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += src[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && next === '*') { inBlock = true; out += '  '; i++; continue; }
    if (c === '/' && next === '/') { inLine = true; out += '  '; i++; continue; }
    out += c;
  }
  return out;
}

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
  'api/route.ts',                          // liveness; checks nothing by design
  /**
   * Readiness. Pre-authentication because a load balancer and an uptime
   * monitor have no session — that is the whole point of them. It returns an
   * honest status code to anyone and operational detail only to a caller
   * holding `HEALTH_TOKEN`, so being reachable anonymously discloses nothing
   * beyond "this instance is or is not serving".
   */
  'api/health/route.ts',
  'api/auth/login/route.ts',
  'api/auth/signup/route.ts',
  'api/auth/forgot-password/route.ts',
  'api/auth/reset-password/route.ts',
  'api/auth/resend-confirmation/route.ts',
  'api/auth/accept-invite/route.ts',       // authenticates by invitation token
]);

/**
 * The same list, as `proxy.ts` writes it.
 *
 * Two hand-maintained lists of "what is reachable without a session" is one
 * list too many, and the failure is silent in the dangerous direction: a route
 * exempted in the proxy but not here passes both checks while being reachable
 * by anybody. They are compared below rather than merged, because the proxy's
 * runs on the edge and importing TypeScript into this script is not worth it.
 */
const PROXY_PUBLIC_PATHS = [
  '/api',
  '/api/health',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/resend-confirmation',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/auth/accept-invite',
];

/**
 * Reachable without a session in the proxy, but guarded in the handler.
 *
 * Both are correct. Sign-out has to work when the session is already broken —
 * that is the whole point of it — and the session endpoint reports "nobody is
 * signed in" as an ordinary answer rather than a 401. Neither returns tenant
 * data, and both establish a context before they return anything at all.
 */
const PROXY_PUBLIC_BUT_GUARDED = new Set([
  '/api/auth/logout',
  '/api/auth/session',
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

/**
 * And the proxy's list says the same thing this one does.
 *
 * The proxy protects everything under /api except a named few; this file
 * requires a guard in everything except a named few. If the first list grows
 * an entry the second does not have, a route becomes reachable without a
 * session *and* passes the guard check, and nothing anywhere says so.
 */
const proxySrc = readFileSync('src/proxy.ts', 'utf8');
const proxyDeclared = [...proxySrc.matchAll(/^\s*'(\/api[^']*)',/gm)].map(m => m[1]);

const proxyDrift = [
  ...PROXY_PUBLIC_PATHS.filter(p => !proxyDeclared.includes(p))
    .map(p => `${p} is expected in proxy.ts and missing`),
  ...proxyDeclared.filter(p => !PROXY_PUBLIC_PATHS.includes(p))
    .map(p => `${p} is exempt in proxy.ts and unknown here`),
];
check(proxyDrift.length === 0,
  'proxy.ts and this file agree on which routes are pre-authentication',
  proxyDrift.join(', '));

/** Every proxy exemption is either handler-guarded or explicitly accounted for. */
const unaccounted = PROXY_PUBLIC_PATHS.filter(p => {
  if (p === '/api') return false;
  if (PROXY_PUBLIC_BUT_GUARDED.has(p)) return false;
  return !PUBLIC_ROUTES.has(`${p.replace(/^\//, '')}/route.ts`);
});
check(unaccounted.length === 0,
  'every route the proxy lets through unauthenticated is one that must be',
  unaccounted.join(', '));

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
  /**
   * Deletes the auth user, which only the service role can do. Everything it
   * reads or writes about the organization goes through the caller's own
   * client and `delete_member_account()`, which checks `is_org_admin()` itself.
   */
  'api/admin/users/[id]/account/route.ts',
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
section('2b. Tenant branding stays out of the platform shell');
/**
 * ── Why this is a security check and not a style one ──────────────────────
 *
 * This is a multi-tenant SaaS product. The platform keeps its own name, mark
 * and favicon for every customer; a tenant's branding describes their company.
 * When that boundary was not written down, a customer uploading a logo in
 * Settings → Branding replaced this product's identity in their workspace —
 * and it looked like a feature while it was being built, because nothing said
 * the two identities were different things.
 *
 * It belongs here because it is an isolation rule with the same shape as the
 * others: state belonging to one party leaking into a surface owned by
 * another. The difference is only that the leak is visual rather than
 * row-level.
 *
 * The shell is the enforced boundary — `components/layout` renders on every
 * screen for every tenant, so it may read `PLATFORM` and never the store's
 * organization. Modules are unrestricted: the client portal *should* carry the
 * supplier's logo, and the settings screen *should* show the company its own
 * branding.
 */
const TENANT_BRANDING = [
  'organization?.logoUrl', 'organization.logoUrl',
  'logoUrl', 'primaryColour', 'primary_colour',
  'organizationName', 'organization?.name',
];

/** The one legitimate tenant fact in the shell: which workspace you are in. */
const SHELL_ALLOWED = new Set([
  // A small outline badge beside the module title. Not the product's identity,
  // and it has no fallback to the platform name.
  'components/layout/header.tsx',
]);

const shellFiles = walk('src/components/layout').filter(f => /\.tsx?$/.test(f));
const leaks = [];

for (const file of shellFiles) {
  const rel = file.replace(/\\/g, '/').replace('src/', '');
  if (SHELL_ALLOWED.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  // Comments explain the rule at length and must not trip it.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const found = TENANT_BRANDING.filter(t => code.includes(t));
  if (found.length) leaks.push(`${rel}: ${found.join(', ')}`);
}

check(leaks.length === 0,
  `the application shell renders no tenant branding (${shellFiles.length} files)`,
  leaks.join(' | '));

/** And the platform's identity is defined once, not scattered as literals. */
const platformSrc = readFileSync('src/lib/platform.ts', 'utf8');
check(/export const PLATFORM/.test(platformSrc),
  'the platform identity has a single definition');

/**
 * The shell *and* the pre-authentication pages read that definition rather
 * than restating it.
 *
 * Seven auth pages each carried their own `"NexusCorp"` literal. Every one was
 * correct, and that is the point: an identity spread across eight files is one
 * nothing owns, and nothing owning it is why replacing it with a tenant's logo
 * did not look like a mistake while it was being written.
 *
 * The marketing pages are excluded deliberately — they are prose *about* the
 * company ("NexusCorp was founded in 2021"), not chrome, and interpolating a
 * constant into a paragraph makes it harder to read for no benefit. The support
 * module's help articles are the same.
 */
const identityFiles = [
  ...shellFiles,
  ...walk('src/app').filter(f =>
    /\.tsx$/.test(f)
    && !f.replace(/\\/g, '/').includes('(marketing)')),
];

const literals = [];
for (const file of identityFiles) {
  const rel = file.replace(/\\/g, '/').replace('src/', '');
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (/['"`>]\s*NexusCorp/.test(code)) literals.push(rel);
}
check(literals.length === 0,
  `and every screen reads it rather than restating it (${identityFiles.length} files)`,
  literals.join(', '));

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
section('6. The identity lifecycle cannot be walked around');
/**
 * These four are the shape of the defect this pass existed to close, and each
 * one is invisible at runtime: the application works perfectly with all of
 * them broken. It simply lets the wrong people in.
 */

/**
 * A membership row is never deleted.
 *
 * Seventeen columns cascade from it, sixteen NOT NULL — messages, comments,
 * meetings, attendance, leave, time entries. `members_delete` used to let an
 * owner do this from a menu item labelled "remove from organization".
 */
const liveDeletePolicy = /CREATE POLICY members_delete ON/.test(
  /**
   * Only migrations after 0025 matter: that is where the policy is dropped, so
   * a re-added one can only appear later in file order.
   *
   * Compared on the basename rather than the joined path — `join()` produces
   * backslashes on Windows, and `'supabase\\migrations\\0026…' > 'supabase/…'`
   * is false, so every file passed the filter and the check failed against
   * 0005's original definition.
   */
  migrations
    .filter(f => (f.split(/[\\/]/).pop() ?? '') > '0025')
    .map(f => readFileSync(f, 'utf8'))
    .join('\n'),
);
check(!liveDeletePolicy,
  'no DELETE policy on organization_members — deletion goes through the RPC');

/**
 * The onboarding entry point checks standing.
 *
 * Without this clause, a suspended or terminated employee resolves no
 * organization — exactly like a new signup — and is handed the
 * create-a-workspace form, which makes them the owner of a tenant of their own.
 */
check(joined.includes("access := public.account_access_state()")
  && /mayCreateOrganization/.test(joined),
  'create_organization() refuses accounts whose access has been withdrawn');

/**
 * Withdrawing access ends the sessions it was granting.
 *
 * Setting `is_active = false` stops the next request resolving an
 * organization; the refresh token in the browser is renewed indefinitely
 * regardless. Every route that can take access away has to revoke.
 */
const LIFECYCLE_ROUTES = [
  'src/app/api/admin/users/[id]/route.ts',
  'src/app/api/hr/employees/[id]/route.ts',
];
const withoutRevocation = LIFECYCLE_ROUTES.filter(
  f => !readFileSync(f, 'utf8').includes('endMemberSessions'),
);
check(withoutRevocation.length === 0,
  'every route that withdraws access also revokes the sessions',
  withoutRevocation.join(', '));

/**
 * The idle clock is not kept alive by the machine.
 *
 * The tray polls every thirty seconds and presence beats every forty-five. If
 * either counted as activity the session timeout would never elapse on an open
 * tab, and the whole policy would be decoration.
 */
const POLLERS = [
  ['src/store/app-store.ts', 'the notification poll'],
  ['src/hooks/use-presence.ts', 'the presence heartbeat'],
];
const countedAsActivity = POLLERS
  .filter(([f]) => !readFileSync(f, 'utf8').includes('BACKGROUND_HEADER'))
  .map(([f, what]) => `${what} (${f})`);
check(countedAsActivity.length === 0,
  'background polling does not hold the idle timeout open',
  countedAsActivity.join(', '));

// ───────────────────────────────────────────────────────────────────────────
section('7. Security headers are set');
/**
 * There were none. Framing in particular matters here: every destructive
 * control in the product — suspend, terminate, delete an account — is one
 * click inside an authenticated page.
 */
const nextConfig = readFileSync('next.config.ts', 'utf8');
const REQUIRED_HEADERS = [
  'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'frame-ancestors',
];
const missingHeaders = REQUIRED_HEADERS.filter(h => !nextConfig.includes(h));
check(missingHeaders.length === 0,
  'the response headers that cost nothing are all present',
  missingHeaders.join(', '));
check(/source:\s*'\/api\/:path\*'[\s\S]{0,200}no-store/.test(nextConfig),
  'authenticated API responses are marked no-store');

// ───────────────────────────────────────────────────────────────────────────
section('8. Endpoints that accept or issue credentials are rate limited');
/**
 * Guarding a route says who may call it. It says nothing about how often, and
 * for the routes below "how often" is the whole control: an unauthenticated
 * sign-in endpoint that answers correctly a thousand times a minute is doing
 * exactly what it was written to do while an attacker walks a password list
 * through it.
 *
 * Checked statically, and by route rather than by pattern, because the failure
 * is an absence — the next auth route added will work perfectly without a
 * limiter, and nothing at runtime will ever say so.
 *
 * `/api` is not here: it is the health check and holds no credential.
 * `/api/auth/logout` and `/api/auth/session` are not here either — neither
 * accepts a secret, and throttling sign-out is a way to keep somebody signed
 * in against their wishes.
 */
const MUST_RATE_LIMIT = [
  'api/auth/login/route.ts',               // password guessing
  'api/auth/signup/route.ts',              // account creation, address enumeration
  'api/auth/forgot-password/route.ts',     // mail to an address the caller chose
  'api/auth/resend-confirmation/route.ts', // likewise
  'api/auth/reset-password/route.ts',      // sets a password
  'api/auth/change-password/route.ts',     // verifies the current password
  'api/auth/accept-invite/route.ts',       // redeems a token
  'api/auth/invite/route.ts',              // issues one, and sends mail
];

const unlimited = [];
const staleLimits = [];

for (const rel of MUST_RATE_LIMIT) {
  const file = join('src/app', rel);
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    // A path listed here that no longer exists means the list was copied
    // rather than maintained — the same rot the exemption list is checked for.
    staleLimits.push(rel);
    continue;
  }
  if (!src.includes('enforceRateLimit(')) unlimited.push(rel);
}

check(unlimited.length === 0,
  `all ${MUST_RATE_LIMIT.length} credential endpoints call enforceRateLimit()`,
  unlimited.join(', '));
check(staleLimits.length === 0,
  'the rate-limit list has no stale entries',
  staleLimits.join(', '));

/**
 * And the limiter still fails open.
 *
 * This is the property that makes the control safe to have at all, and it is
 * one edit away from being lost — a `throw` added to the catch, or the catch
 * removed as dead code, turns a broken counter into a platform-wide outage of
 * the login page. Cheap to assert, expensive to discover.
 */
const limiterSrc = readFileSync('src/lib/rate-limit.ts', 'utf8');
check(/catch\s*{[^}]*return null;/.test(limiterSrc),
  'a failing rate-limit store permits the request rather than refusing it');
check(limiterSrc.includes('RATE_LIMIT_DISABLED'),
  'the limiter can be switched off by configuration, without a deployment');

// ───────────────────────────────────────────────────────────────────────────
section('9. Failures are recorded, and are not described to the caller');
/**
 * Three properties, all of which were false before this pass and all of which
 * fail silently if they become false again.
 *
 * Forty-seven catch blocks read `error(e.message || '…', 500)`. In practice
 * `e.message` is always present, so what the user received was the exception —
 * a JavaScript stack message, or PostgreSQL naming its own columns and
 * constraints — while the server kept no record of it at all. One line, wrong
 * in both directions: the operator learned nothing and the caller learned too
 * much.
 */
const srcFiles = walk('src').filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

// (a) No handler hands an exception message to the client with a 5xx.
const leaking = [];
for (const file of srcFiles) {
  const rel = file.replace(/\\/g, '/');
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const [i, line] of src.split(/\r?\n/).entries()) {
    if (/\berror\(\s*\w+\.message[^)]*,\s*5\d\d/.test(line)) {
      leaking.push(`${rel}:${i + 1}`);
    }
  }
}
check(leaking.length === 0,
  'no route returns an exception message to the caller with a 5xx',
  leaking.join(', '));

// (b) Logging goes through the logger, so it has a level, a shape and a sink.
const adHoc = [];
for (const file of srcFiles) {
  const rel = file.replace(/\\/g, '/');
  // The logger is the one place allowed to call console — it is the thing
  // being centralised on. Marketing pages contain code samples as strings.
  if (rel.endsWith('src/lib/logger.ts') || rel.includes('(marketing)')) continue;
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const [i, line] of src.split(/\r?\n/).entries()) {
    if (/(?:^|[^.\w])console\.(log|warn|error|info|debug)\s*\(/.test(line)) {
      adHoc.push(`${rel}:${i + 1}`);
    }
  }
}
check(adHoc.length === 0,
  'application code logs through the structured logger, not console',
  adHoc.join(', '));

// (c) The pieces that make a failure findable are all still wired up.
const instrumentation = readFileSync('src/instrumentation.ts', 'utf8');
check(instrumentation.includes('onRequestError'),
  'unhandled server errors are captured framework-wide, without per-route opt-in');

const proxySource = readFileSync('src/proxy.ts', 'utf8');
check(proxySource.includes('resolveRequestId') && proxySource.includes('REQUEST_ID_HEADER'),
  'every request is given a correlation id in the proxy');

const errorPage = readFileSync('src/app/error.tsx', 'utf8');
check(/log\.error\(/.test(errorPage),
  'the application error boundary reports the error rather than discarding it');

const liveness = stripComments(readFileSync('src/app/api/route.ts', 'utf8'));
check(!/Hello, world/.test(liveness),
  'the health endpoint is not the placeholder');
check(!/supabase|from\(/i.test(liveness),
  'and liveness checks no dependency, so a database blip cannot empty the fleet');

const readiness = readFileSync('src/app/api/health/route.ts', 'utf8');
check(readiness.includes('HEALTH_TOKEN'),
  'readiness detail is gated, since the endpoint is pre-authentication');

// ───────────────────────────────────────────────────────────────────────────
section('10. The meeting may use the devices a meeting needs');
/**
 * Section 7 asserts the headers are *present*. This asserts one of them is
 * not so strict that it switches a feature off, which is how the Communication
 * module came to be broken by a security change.
 *
 * `Permissions-Policy: camera=(), microphone=()` was added on the stated
 * belief that "nothing here uses the camera, the microphone or geolocation".
 * Two of those three are exactly what `useMeeting` calls `getUserMedia` and
 * `getDisplayMedia` for. An empty allowlist is not "no third party may ask" —
 * it is nobody, the document's own origin included — so every meeting failed
 * with `NotAllowedError` before any prompt could be shown, and the room, which
 * had no way to tell that apart from a user clicking Block, told people to
 * allow it in an address bar that was never going to offer them the choice.
 *
 * Both directions are checked, because both can rot silently and neither
 * announces itself at runtime:
 *
 *   · the grant disappearing again breaks every meeting, and nothing in the
 *     application would say so — the browser refuses before any code runs;
 *   · the grant widening to `*` hands the camera to any embedded document,
 *     which is the thing the original header was right to want to prevent.
 */
const mediaFeatures = ['camera', 'microphone', 'display-capture'];

const grantsSelf = mediaFeatures.filter(f => !nextConfig.includes(`${f}=(self)`));
check(grantsSelf.length === 0,
  'the app shell is permitted the camera, microphone and screen share',
  grantsSelf.length ? `${grantsSelf.join(', ')} — a meeting cannot start without these` : '');

const stillDenied = mediaFeatures.filter(f => !new RegExp(`${f}=\\(\\)`).test(nextConfig));
check(stillDenied.length === 0,
  'and every other route still refuses them by default',
  stillDenied.join(', '));

const wildcarded = mediaFeatures.filter(f => new RegExp(`${f}=\\*|${f}=\\(\\s*\\*`).test(nextConfig));
check(wildcarded.length === 0,
  'no media feature is opened to every origin',
  wildcarded.join(', '));

/**
 * The grant is worth nothing if it is not on the document that holds a
 * meeting. `/dashboard` renders `AppShell`, which is what lazy-loads the
 * Communication module; nothing else in the product does.
 */
check(/source:\s*'\/dashboard'/.test(nextConfig) && /source:\s*'\/dashboard\/:path\*'/.test(nextConfig),
  'and it is scoped to the route that actually renders the meeting');

/**
 * The other half of the same regression, in the client. A peer connection
 * built with no local tracks produces an offer with no media sections, which
 * `bundlePolicy: 'max-bundle'` rejects outright — so the browser that lost its
 * microphone took every tile in the room down with it. The recvonly
 * transceivers are what make a participant with no devices a spectator rather
 * than a spinner.
 */
const meetingHook = stripComments(readFileSync('src/hooks/use-meeting.ts', 'utf8'));
check(/addTransceiver\(\s*kind\s*,\s*\{\s*direction:\s*'recvonly'/.test(meetingHook),
  'a participant with no camera or microphone still negotiates, rather than offering nothing');

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
