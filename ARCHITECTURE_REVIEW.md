# CTO Enterprise Architecture Review — NexusCorp Business OS

**Date:** 2 August 2026
**Scope:** Full platform, read-only audit. No code was modified.
**Codebase reviewed:** 281 TypeScript files / 67,200 LOC application code · 115 API
routes · 25 migrations / 12,262 lines SQL · 61 tables · 19 views · 102 functions ·
138 RLS policies · 8 verification harnesses.

**Method.** Every claim below is drawn from reading the source or from running the
repository's own static harnesses. Where I could not verify something without a
live database or production traffic, I say so rather than assert it.

---

## Executive Summary

This is a **well-architected platform built by someone who understood the
problem**. That is not a courtesy sentence — it is the finding that shapes every
recommendation that follows.

The core architectural decision — that tenant isolation is enforced by PostgreSQL
Row Level Security rather than by application code remembering to filter — is
correct, is implemented completely, and is the difference between a product that
can be sold to enterprises and one that cannot. It is backed by a level of rigour
that is rare: `FORCE ROW LEVEL SECURITY` on all 61 tables (not merely `ENABLE`,
which the owner bypasses), `security_invoker = true` on all 19 views, and
`SET search_path` on **all 100** `SECURITY DEFINER` functions — I checked every
one, and there are no exceptions. The recursion trap that kills RLS multi-tenancy
was identified, understood, and designed around before it shipped.

The code is unusually well documented. Not comment noise — written rationale for
decisions, including the ones that were reversed and why. `0020_realtime_everywhere.sql`
opens by quoting the earlier migration's contrary decision and explaining what
changed. That is institutional memory encoded in the repository, and it is worth
real money to whoever maintains this in three years.

**So the answer to "is this suitable for production SaaS deployment" is yes — the
architecture is. The gaps are not architectural. They are operational.**

This platform is built to be *correct* and is not yet built to be *operated*. There
is no CI pipeline, so the seven excellent verification harnesses run only when
someone remembers. There is no error telemetry, so a 500 in production is invisible
to you — `src/app/error.tsx` renders an apology and discards the error object. There
is no rate limiting on any endpoint, including `/api/auth/login`. There is no
documented backup or restore procedure. These are the things that turn a correct
system into a reliable service, and none of them require touching the application.

**Verdict: approve for public launch after the five Category A items below.**
They total roughly 12–16 engineer-days, none of them require a rewrite, none
require downtime, and none change a line of business logic.

---

## Scorecard

| Dimension | Score | One-line justification |
|---|---|---|
| **Architecture** | **8.0** / 10 | Coherent layering, single source of permission truth, correct central decision. Deducted for no service seam and one stale architecture document. |
| **Security** | **8.5** / 10 | Among the strongest multi-tenant implementations I have reviewed. Deducted for missing rate limiting, MFA, CSP `script-src`, and export auditing. |
| **Scalability** | **6.0** / 10 | Comfortable to ~5,000 users. Four identified bottlenecks bite between 10k and 100k. |
| **Performance** | **6.5** / 10 | Good query design and parallelism, undermined by a per-request auth round trip, exact counts, and one dashboard route that counts in JavaScript. |
| **Maintainability** | **7.0** / 10 | Exceptional commentary and consistent abstractions. Deducted for hand-written database types (341 `any`) and nine unused production dependencies. |
| **Enterprise readiness** | **5.5** / 10 | Tenancy is real and provable. Operations, compliance evidence, SSO and MFA are absent. |
| **Supabase coupling** | **4.0** / 10 <br>*(10 = decoupled)* | Heavily coupled: 349 PostgREST call sites, 26 RPCs, platform-specific auth/storage/realtime. |
| **Migration readiness** | **5.0** / 10 | Better than the coupling score suggests — the value lives in portable PostgreSQL — but no seams exist today. |
| **Technical debt** | **7.0** / 10 <br>*(10 = no debt)* | Low and concentrated. Clean typecheck, zero lint errors, no code sprawl. |

**Overall: 6.5 / 10 — a strong product on weak operational footing.**

---

## 1. Overall Architecture — 8.0/10

### What is there

```
Request → proxy.ts            route protection + session clocks (edge)
        → authorize()         capability check, clear 403s
        → crud.ts handlers    list/create/update/delete, one shape
        → supabase-js         caller's JWT
        → PostgREST → RLS     the actual security boundary
```

Folder structure is conventional Next.js App Router and needs no change.
`src/components/modules/` has one directory per business module, mirrored by
`src/app/api/` namespaces. A developer can find anything.

**The layering is genuinely good.** `lib/permissions.ts` is a real single source of
truth — `role → module → { actions, scope }` — consumed by route enforcement,
navigation, dashboard composition and record filtering alike. The `README` claim
that this replaced three unreconciled role vocabularies is visible in the code
(`LEGACY_ROLE_ALIASES` still maps them), and the fallback for an unknown role is
`employee`, the least-privileged — a typo cannot escalate.

`src/lib/supabase/crud.ts` expresses the shape of a resource once. Forty
near-identical hand-written handlers would have drifted; these provably have not.

### What is missing

**There is no service or repository layer.** Route handlers call PostgREST
directly — 349 `.from()` call sites across the application. For a system of this
size that is a defensible choice (it removes a layer that would mostly forward
calls), but it has two consequences worth naming:

1. Business logic that spans tables lives either in a route handler or in a
   Postgres function, and both patterns are in use. There is no single answer to
   "where does an invoice get created?"
2. It is the single largest contributor to the Supabase coupling score. See §3.

**Module components are large.** `communication/meetings.tsx` is 2,597 lines;
`communication/index.tsx` is 2,065; `crm/index.tsx` is 1,720. These work and I am
**not** recommending you split them on principle. Flagged as Category C only:
split a file the next time you have substantive work inside it, not before.

**`BACKEND_ARCHITECTURE.md` is stale and actively misleading.** It documents a
"schema fork" between Prisma and Supabase, presents Option A vs Option B as an open
decision, and lists tenant isolation as *"Not verified — needs a database."* All of
that has been resolved: there is no `prisma/` directory, Option A was taken, and
`FORCE ROW LEVEL SECURITY` is live on 61 tables. A new engineer reading this
document would begin from a false picture of the system.

---

## 2. Backend Architecture — is business logic separated?

**Partially, and deliberately so.** The split is:

| Lives in PostgreSQL | Lives in route handlers |
|---|---|
| Tenant isolation (138 policies) | Request validation (Zod) |
| Attendance timestamps (`clock_in()` overwrites client time) | Capability checks (`authorize()`) |
| Invoice / PO totals (trigger-derived from line items) | Response shaping and case conversion |
| Stock levels (append-only movement ledger) | Cross-module orchestration |
| Self-approval prevention (trigger) | Error translation |
| Document numbering (row-locked per-org counter) | |
| Audit trail (trigger on 20 tables) | |

**This split is correct**, and the reasoning in the README is sound: a rule enforced
by trigger holds regardless of which client is writing. `next_document_number()`
takes a row lock so two concurrent invoices cannot collide — application-level
`MAX()+1` could not make that guarantee.

**Is data access abstracted?** No. There is no repository interface. `crud.ts` is a
*handler* factory, not a data-access abstraction — it emits PostgREST queries
directly and its options (`select` strings with embedded-resource syntax,
`filterable` column lists) are PostgREST-shaped.

**Can the architecture migrate away from Supabase?** Yes, but not cheaply, and the
reason is not the database. See §11 for the full analysis. In short: the
PostgreSQL schema, functions, triggers and RLS policies are standard and portable.
What is not portable is the *access path* — 349 PostgREST call sites, 26 RPC calls,
and the auth/storage/realtime integrations.

---

## 3. Supabase Dependency Analysis — Coupling 4/10

Measured, not estimated:

| Surface | Count | Portability |
|---|---|---|
| `.from(...)` PostgREST call sites | **349** | ❌ PostgREST-specific query builder |
| `.rpc(...)` calls | 26 distinct functions | ⚠️ Functions port; the call mechanism does not |
| `auth.uid()` in policies | 46 | ❌ GoTrue-specific |
| `auth.users` foreign keys | 19 | ❌ GoTrue-specific |
| `storage.objects` policies | 16 | ❌ Supabase Storage schema |
| `supabase_realtime` publication | 23 tables | ⚠️ Logical replication is standard; the consumer is not |
| Browser-side Supabase clients | 5 files | ❌ Realtime, meetings, file upload, settings, composer |
| Tables / views / functions / policies | 61 / 19 / 102 / 138 | ✅ **Standard PostgreSQL** |

**Where the coupling actually is — and where it is not.**

The valuable, hard-to-rebuild part of this system is the PostgreSQL schema: 61
tables, 138 policies, 102 functions, 40+ triggers, the whole tenancy model. **None
of it is Supabase-proprietary.** It runs on any PostgreSQL 15+, including RDS,
Cloud SQL, Azure Flexible Server or a self-hosted cluster, essentially unchanged.
That is the single most important fact in this section and it is why the migration
readiness score (5.0) is higher than the coupling score (4.0).

The coupling is concentrated in four places:

1. **`auth.uid()` and the `auth.users` table.** Every policy resolves the caller
   through `auth.uid()`, which reads `request.jwt.claims` — a session variable
   PostgREST sets. Any replacement must set the same variable, which is a
   connection-level concern, not a schema change.
2. **PostgREST query syntax.** `.select('*, member:organization_members!fk(profiles(...))')`
   is not SQL. 349 sites use it.
3. **Supabase Storage.** Six buckets with a `{organization_id}/{path}` convention
   enforced by 16 policies on `storage.objects`. The *convention* is portable; the
   enforcement mechanism is not.
4. **Supabase Realtime.** 23 tables in a publication, consumed by a websocket
   protocol specific to Supabase's realtime server.

**How to reduce coupling without rewriting the application** — the actionable
answer, in priority order and none of it requiring a product change:

- **Pin the auth seam now (½ day).** Every `auth.uid()` call in a policy already
  goes through the `SECURITY DEFINER` helpers in `0002` — `auth_org_ids()`,
  `is_org_member()`, `has_org_role()`. That is *already the abstraction*. Ensure no
  new policy calls `auth.uid()` directly (add a check to `security:check`). Then
  migrating auth means rewriting **five helper functions**, not 46 policies. This is
  the highest-leverage decoupling move available and it is nearly free.
- **Do not build a repository layer today.** It would touch 349 sites for no
  present benefit. Instead, adopt a rule: *new* cross-table writes go into
  `SECURITY INVOKER` PostgreSQL functions called via `.rpc()` (which you already do
  for `record_stock_movement`). Every one of those is a transaction boundary
  (§6, B5) **and** a portable seam. You get both benefits from one discipline.
- **Isolate storage path construction (1 day).** Introduce `lib/storage.ts` with
  `objectPath(orgId, …)` and `signedUrl(…)`, and route the handful of upload sites
  through it. Swapping to S3 then means rewriting one file.
- **Keep the browser Supabase client to realtime only.** Three of the five
  browser-side usages (`settings-panels`, `composer`, `file-browser`) do data work
  the API layer could do. Moving them behind the API is small and shrinks the
  client-side coupling surface to the realtime hooks alone.

**Do not migrate now. There is no business case for it, and the recommendations
above cost days, not months.**

---

## 4. Database Review

### Schema quality — strong

Third normal form throughout. Ownership columns reference `organization_members`
rather than `profiles`, which makes assigning a record to somebody outside the
organization *structurally* impossible rather than something application code
re-checks. That is good design and it is unusual.

21 enums, real check constraints (`project_dates_valid`, `milestone_progress_valid`,
`allocation_pct_check`), and foreign keys throughout with deliberate `ON DELETE`
semantics. `npm run db:check` parses all 25 migrations against the real PostgreSQL
grammar and cross-checks undefined tables, invalid enum members and broken foreign
keys — **it passes**, and I ran it.

### Indexes — 99 total, thoughtfully built, with gaps

Genuinely good work: partial indexes (`WHERE deleted_at IS NULL`), trigram GIN
indexes for search (`companies.name`, `products.sku`, `profiles.full_name`), a
full-text index on messages, and composite indexes leading with `organization_id`
on the hot tables.

**But 15 tenant-scoped tables have no index leading with `organization_id`:**

```
notifications        todos            comments          stock_movements
payments             time_entries     milestones        crm_activities
workspace_spaces     kb_articles      budgets           leave_balances
workspace_sheet_rows workspace_sheet_columns            workspace_page_shares
```

This matters because **every list query in the system filters on `organization_id`
first** — `crud.ts:109` applies `.eq('organization_id', …)` unconditionally, and
every RLS policy evaluates `organization_id = ANY(auth_org_ids())`. Several of
these tables have an alternative access path that covers the common query
(`milestones` has `(project_id, stage)`, `comments` has `(task_id, created_at)`),
so this is not urgent — but `notifications`, `todos`, `payments` and
`stock_movements` will sequential-scan under tenant-wide reads as they grow.

Five more (`org_settings`, `document_counters`, `suppliers`, `warehouses`,
`todo_lists`) are covered by a primary key or unique constraint leading with
`organization_id` and need nothing.

### Capacity assessment

| Users | Verdict | What breaks first |
|---|---|---|
| **100** | ✅ Comfortable | Nothing. |
| **1,000** | ✅ Comfortable | Nothing structural. Dashboard latency starts to be noticeable on large tenants. |
| **10,000** | ⚠️ Degrades | `count: 'exact'` on every list; the dashboard route pulling whole `leads`/`deals`/`products` tables; `audit_log` growth. |
| **100,000** | ❌ Requires work | Realtime fan-out with `REPLICA IDENTITY FULL` on 23 tables; WAL volume; per-request `auth.getUser()` round trip becomes the dominant latency term. |
| **1,000,000** | ❌ Requires re-platforming of specific subsystems | Realtime must move to an SFU/broker model; `audit_log` must be partitioned or externalised; read replicas required; connection budget must be planned. |

Note that "users" here means *platform* users across all tenants. Per-tenant
scaling is far more forgiving because RLS bounds every query to one organization
— a 500-person tenant behaves well regardless of how many tenants exist. **The
bottlenecks above are all platform-wide, not per-tenant**, which is the better
failure mode to have.

### Migrations

25 files, applied in order, each in its own transaction so a failure stops at the
last complete one. Idempotent. Verified by parser before application. This is a
better migration story than most companies at Series B.

**Gap:** migrations are forward-only with no `down` scripts. For a schema this
carefully built that is a defensible trade-off, but it means rollback of a bad
migration is restore-from-backup — which makes the untested backup procedure (A4)
a compounding risk.

---

## 5. Security Review — 8.5/10

I ran the repository's own `npm run security:check`. **Every check passes**, and
the checks are real ones — not smoke tests.

### Strong — and verified by me, not taken on trust

- **`FORCE ROW LEVEL SECURITY` on all 61 tables.** Plain `ENABLE` does not apply
  to the table owner; `FORCE` does. A pooler misconfiguration or a stray `psql`
  session cannot read across tenants.
- **All 100 `SECURITY DEFINER` functions pin `SET search_path`.** I parsed every
  function definition across all 25 migrations. Zero exceptions. An unpinned
  `SECURITY DEFINER` function is a privilege-escalation primitive; there are none
  here.
- **All 19 views set `security_invoker = true`**, and `db:check` fails the build
  if one is added without it. A view over a tenant table that executes as its owner
  hands every organization's rows to whoever queries it — this is the single most
  common way RLS is defeated in practice, and it is closed by construction.
- **Defence in depth, correctly reasoned.** `authorize()` returns a clear 403 for
  UX; RLS is the boundary. `auth-context.ts` says so explicitly and says never to
  rely on the former alone.
- **No service-role client in any request handler serving user data** — statically
  enforced.
- **Server-authoritative business rules.** Attendance time comes from `now()` and a
  trigger overwrites forged client timestamps. Self-approval of leave and expenses
  is blocked by trigger.
- **Sort injection closed** by allow-list (`crud.ts:102`); search terms have
  PostgREST filter metacharacters stripped rather than escaped.
- **Mass assignment closed.** All 14 routes using the generic `updateHandler` pass
  an explicit `updateSchema`; the 34 hand-written update routes build their payload
  field-by-field from an allow-list. I checked all 48.
- **No SQL injection surface.** No string-concatenated SQL anywhere; PostgREST
  parameterises.
- **XSS surface is minimal.** One `dangerouslySetInnerHTML`, in `ui/chart.tsx`,
  emitting CSS custom properties from a static config — not user input. No `eval`,
  no `new Function`.
- **Storage tenancy by path prefix**, one rule covering six buckets, with
  `hr-documents` further restricted to HR roles and the subject.
- **Secrets are clean.** `.env` is gitignored. It appears in early git history —
  I checked the contents of every such commit: it held `DATABASE_URL=file:...`
  (the old SQLite path) and empty Supabase values. **No credential was ever
  committed.**

### Gaps

| # | Gap | Severity |
|---|---|---|
| **A1** | **No rate limiting anywhere.** `/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot-password` are unauthenticated and unthrottled. The login route *translates* Supabase's rate-limit error, so the only protection is GoTrue's own — which does not cover credential stuffing against your origin, and does not exist at all for authenticated endpoints. | **A** |
| **A5** | **No MFA.** Supabase supports TOTP enrolment; nothing offers it and no policy can require it. Blocks enterprise procurement. | **A** |
| **B8** | **CSV formula injection.** `export/route.ts:105` implements RFC 4180 quoting correctly but does not neutralise leading `=`, `+`, `-`, `@`, tab or CR. A CRM lead name is attacker-controllable (public web forms, portal users); exported and opened in Excel it executes. | **B** |
| **B9** | **Exports are not audited.** The route's own comment says exporting *"removes the data from the platform's access controls entirely"* — and then writes no record that it happened. The customer list and salary register can leave with no trace. | **B** |
| **B12** | **No CSP `script-src`.** `frame-ancestors 'none'` is set. The README's reasoning for deferring the rest is correct and honest — a nonce-threaded policy is real work, and `unsafe-inline` would be theatre. It remains a gap. | **B** |
| **C6** | `pgError` default branch returns the raw PostgreSQL message to the client, which can disclose column and constraint names. | **C** |
| **C4** | `avatars` and `logos` buckets are world-readable by URL. Documented trade-off, correct for the use case; some enterprise buyers will still object. | **C** |

**Enterprise Security Score: 8.5/10.** The foundation is better than most funded
startups ship. The gaps are perimeter and compliance controls, not design faults.

---

## 6. Performance Review — 6.5/10

### Good

Dashboard fans out 16 queries with `Promise.all` rather than sequentially.
Pagination is capped at 100. Realtime refetches are debounced at 400 ms so a
500-row import costs one refetch, not 500. Aggregates are pushed into
`security_invoker` views. Connection pooling is Supabase's concern because the app
speaks HTTP to PostgREST and holds no PostgreSQL connections — **this is a real
advantage** and it makes the app serverless-safe by construction.

### The four measurable problems

**B3 — `auth.getUser()` on every authenticated request.** `getContext()` makes
three round trips before any business query runs: a network call to the Supabase
Auth server, a `profiles` lookup, and an `organization_members` lookup. The first
is an outbound HTTP request to a separate service on *every single API call*.
That is a ~30–100 ms latency floor on all 115 endpoints, a hard availability
dependency on GoTrue, and a multiplier on every other volume problem in this
document.

**B1 — `count: 'exact'` on every list query.** `crud.ts:108` requests an exact
count unconditionally. PostgreSQL must scan every matching row to produce it. On a
tenant with 200 leads it is free; on one with 200,000 it doubles the cost of every
page of a paginated table, forever, to render "Page 1 of 10,000".

**B2 — the dashboard counts in JavaScript.** `dashboard/route.ts` fetches **every
lead, every deal and every product** in the organization with no `LIMIT`, then
counts and sums them in Node (lines 122–135, 242–268, 347–363). For a tenant with
50,000 products that is a multi-megabyte transfer on every dashboard load to
compute six numbers PostgreSQL could return in one row. `v_dashboard_stats`
already exists and already does this correctly for other figures — the pattern is
established, it just was not applied here.

**B13 — presence heartbeat cost.** `use-presence.ts` beats every 45 s per open
tab, unconditionally, including hidden tabs. Each beat is a full
`authenticate()` → `getContext()` → three round trips → write. At 10,000
concurrent tabs that is ~220 req/s costing ~900 backend operations/s for presence
alone.

### Polling — less alarming than it first appears

The Communication module polls at 8 s (messages), 20 s (channels) and 5 s (meeting
participants). **These are fallbacks that run only when the websocket reports
`unavailable`** — the code gates them explicitly and the UI tells the user updates
are delayed. That is good design.

The residual risk is real but different from what the numbers suggest:
**websockets are blocked by many corporate proxies — which the code itself notes —
and you have no measurement of how many users are in the degraded path.** In an
enterprise deployment that population may not be small. Instrument it (§8) before
you size capacity around it.

The notification poll at 120 s runs unconditionally even when realtime is healthy.
Minor, but it is the one poll with no gate.

### Caching

There is none, and this is correct for now. `Cache-Control: no-store, private` on
all `/api/*` is the right default for authenticated multi-tenant JSON — a shared
proxy handing one tenant's response to another is a breach. Introduce caching only
where you can key it by organization *and* by role, because the dashboard payload
differs by role by design.

---

## 7. Scalability Review

| Users | Behaviour |
|---|---|
| **10** | Perfect. |
| **100** | Perfect. |
| **1,000** | Good. Dashboard latency noticeable on the largest tenants. Fix B2 when a customer complains. |
| **10,000** | Degrades. B1, B2 and B7 all bite. `audit_log` becomes the largest table. Realtime is still fine. |
| **100,000** | Requires the B-list. Realtime fan-out is the wall — see below. Read replicas needed for reporting. B3 becomes the dominant latency term. |
| **1,000,000** | Requires subsystem re-platforming: Realtime → broker/SFU, `audit_log` → partitioned or externalised, sharded or per-region deployment. |

### B4 — Realtime is the hardest ceiling

23 tables are in the `supabase_realtime` publication, every one with
`REPLICA IDENTITY FULL`. Two compounding costs:

1. **WAL amplification.** `REPLICA IDENTITY FULL` writes the *entire old row* to
   the WAL on every UPDATE and DELETE. On 23 tables including `tasks`, `messages`,
   `products` and `notifications`, this materially increases write I/O, WAL volume,
   backup size and replication lag.
2. **Fan-out with per-subscriber RLS.** Supabase's Postgres-changes implementation
   evaluates RLS *per subscriber per change*. Cost scales with
   `writes × concurrent subscribers per tenant`. This degrades well before you
   reach the connection limit.

`0020_realtime_everywhere.sql` documents this trade-off honestly and accepts it
deliberately — the reasoning (a stale row silently overwriting a colleague's work
is a correctness bug, not a likelihood problem) is sound. **I am not recommending
you reverse it.** I am recommending you measure it (§8) so you know when it needs
to change, and that you re-examine `REPLICA IDENTITY FULL` on tables where no
subscription filters on a non-key column — `REPLICA IDENTITY DEFAULT` is
sufficient there and much cheaper.

### B7 — Append-only tables have no retention policy

`audit_log` receives a row for every INSERT, UPDATE and DELETE on 20 of the busiest
tables, storing `old_values` and `new_values` as JSONB. `activity_log` and
`notifications` grow similarly. None is partitioned. None has retention.

At 10,000 users `audit_log` will be the largest object in the database and will
dominate backup duration and restore time — which makes it a *reliability* problem
as much as a storage one. Because the trigger is `FOR EACH ROW`, a 5,000-row import
writes 5,000 audit rows synchronously inside the same transaction.

---

## 8. Reliability Review — the weakest dimension

### A2 — There is no error telemetry. This is the most important finding in this report.

- `src/app/error.tsx` renders "Something went wrong" and **discards the error**.
  It receives `error.digest` and sends it nowhere.
- There are **12** `console.*` calls in 281 files, and no logger.
- No Sentry, no OpenTelemetry, no structured logging, no log aggregation.
- Route handlers return errors as JSON to the client and log nothing server-side.

**A 500 in production is invisible to you.** You learn about failures from
customers. You cannot answer "is it broken for everyone or one tenant", "when did
it start", or "did the deploy cause it". Every other reliability control depends on
this one existing first.

There is a good per-module React error boundary in `module-content.tsx` that
`console.error`s the component stack — so the mechanism exists, it simply has
nowhere to report to.

### A3 — There is no CI pipeline

No `.github/`, no workflow files. The repository contains **eight** verification
harnesses — `db:check`, `db:verify` (45 checks including live two-tenant
isolation), `app:verify` (78 HTTP checks as two users), `identity:verify` (82
checks), `security:check`, `schema:check`, `realtime:verify`, `contract:check`,
plus 30 attendance unit tests.

**This is a genuinely impressive test estate and nothing runs it automatically.**
The harnesses are the safety net that lets you change this system confidently, and
right now they protect you only when someone remembers to type the command. A CI
pipeline here is not process overhead — it is the thing that converts existing work
into ongoing protection. It is the highest return-per-hour item in this entire
document.

### A4 — Backups are undocumented and restore is untested

No backup policy, no RPO/RTO, no documented restore procedure, no evidence a
restore has ever been performed. The platform presumably relies on Supabase's
automated backups, whose retention depends on plan tier. Combined with forward-only
migrations, a bad migration's rollback path is restore-from-backup — a path nobody
has walked.

### B14 — The health endpoint checks nothing

`src/app/api/route.ts` returns `{"message": "Hello, world!"}`. It is listed in
`proxy.ts` as the health check and is what a load balancer or uptime monitor would
poll. It will report healthy while the database is unreachable.

### Present and working

Retry and reconnect logic in the realtime hooks is careful, with an explicit
`unavailable` state and a polling fallback — the failure is *surfaced to the user*
rather than hidden, which is the right instinct. `pgError()` maps PostgreSQL error
codes to correct HTTP status codes thoughtfully. Session expiry clears cookies to
avoid the redirect loop it would otherwise cause.

---

## 9. Maintainability Review — 7.0/10

### Strong

- **`npx tsc --noEmit` passes cleanly. `npx eslint .` reports 0 errors** (3
  warnings, all benign). I ran both.
- `next.config.ts` sets `ignoreBuildErrors: false` — type errors fail the build.
- Documentation quality is exceptional. Decisions carry their reasoning, including
  reversed ones. This is the most valuable maintainability asset in the repository.
- `crud.ts` prevents the drift that forty hand-written handlers would guarantee.
- `schema-contract.mts` checks Zod schemas against actual migration columns —
  a clever, unusual and effective guard.

### B10 — Database types are hand-written, not generated

`src/lib/supabase/types.ts` is a hand-maintained set of interfaces covering a
subset of the 61 tables. The Supabase client is **not** parameterised with a
`Database` generic, so every `.from('anything')` returns `any`. That is the origin
of **341 `: any`** and **82 `as any`** annotations.

The consequence: **renaming a column compiles cleanly and fails at runtime.** The
codebase has felt this — `auth-context.ts` documents a production incident where a
camelCase field reached PostgREST and surfaced to users as a 500 reading
`Could not find the 'clientCompanyId' column`.

Fix is mechanical and non-breaking: `supabase gen types typescript` into
`src/lib/database.types.ts`, then `createServerClient<Database>(…)`. Types can be
adopted file by file; nothing breaks on day one.

### C2 — Nine unused production dependencies

Verified by grep across all of `src/`:

```
@tanstack/react-query   next-auth      next-intl
socket.io               socket.io-client
z-ai-web-dev-sdk        react-syntax-highlighter
@reactuses/core         swr (absent from src entirely)
```

`next-auth` is the notable one: **a second authentication library in the
dependency tree of an application that uses Supabase Auth.** It is dead code, but
it is dead code with a security-sensitive name, and a future engineer may wire it
up. `z-ai-web-dev-sdk` is unrecognised scaffolding. All nine are supply-chain
surface and CVE-alert noise for zero value.

### D1 — Dead scaffolding tracked in git

`db/custom.db` (a SQLite file from the pre-Supabase era), `examples/websocket/`,
`.zscripts/`, `mini-services/`, `test.txt`. Harmless, but `db/custom.db`
contradicts the architecture and will confuse someone.

### C8 — `Caddyfile` in the repository root

It reverse-proxies to `localhost:{query.XTransformPort}` — **the proxy target is
taken from a URL query parameter.** As sandbox tooling that is fine. If it ever
reaches a production edge it is an SSRF and internal-port-scanning primitive. Move
it out of the repository root or document unambiguously that it is dev-only.

---

## 10. Enterprise SaaS Readiness — 5.5/10

| Requirement | Status |
|---|---|
| Multi-tenant isolation | ✅ Enforced in the database, provable, tested by `db:verify` |
| RBAC | ✅ Single source of truth, scoped (own/department/organization) |
| Audit trail | ⚠️ 20 tables covered by trigger; **exports and reads are not audited** |
| **SSO / SAML / SCIM** | ❌ Absent. Blocks most enterprise deals above ~500 seats. |
| **MFA** | ❌ Absent |
| **Uptime monitoring / SLO** | ❌ Absent |
| **Error tracking** | ❌ Absent |
| **Backup / DR** | ❌ Undocumented, untested |
| Rate limiting | ❌ Absent |
| Data residency | ❌ Single Supabase region; no story for EU-only customers |
| Data export (GDPR portability) | ⚠️ CSV per dataset; no per-subject export |
| Data deletion (GDPR erasure) | ✅ `delete_member_account()` with impact preview — genuinely well designed |
| Currency / timezone | ✅ Per-organization, correctly applied (`org-time.ts`, `locale.ts`) |
| **UI internationalisation** | ❌ English only. `next-intl` installed, unused. |

**Suitable today for:** SMEs, internal deployment, design-partner customers, and
mid-market SaaS after the Category A items.

**Not yet suitable for:** regulated industries, enterprises with a security
questionnaire (SSO, MFA and audit-of-exports are standard line items), or EU
customers with residency requirements.

**International expansion:** data internationalisation is done well — money and
dates are per-organization and correctly handled throughout. Interface
internationalisation does not exist. That is the right order to have done them in,
and the remaining work is bounded and mechanical.

---

## 11. Supabase → AWS Migration Analysis (five-year horizon)

**Overall complexity: MEDIUM-HIGH. Estimate 4–6 engineer-months. Downtime: 2–4
hours if planned; near-zero achievable with logical replication.**

| Component | Complexity | Effort | Notes |
|---|---|---|---|
| **Schema, functions, triggers, RLS** | 🟢 **Low** | 1–2 weeks | Standard PostgreSQL. `pg_dump` → RDS. The 138 policies and 102 functions port essentially unchanged. **This is the bulk of the system's value and it is portable.** |
| **Data** | 🟢 Low | 1 week | `pg_dump`/`pg_restore`, or logical replication for near-zero downtime. |
| **Auth** | 🔴 **High** | **6–8 weeks** | The hard part. 19 FKs to `auth.users`; user IDs must be preserved through migration or every FK breaks. Password hashes are bcrypt and *can* be migrated to Cognito or Keycloak, but sessions cannot — every user re-authenticates once. |
| **Data access (349 sites)** | 🔴 **High** | **8–10 weeks** | PostgREST replacement. Either self-host PostgREST on ECS (**recommended — near-zero code change**) or rewrite to an ORM/query builder. The first option collapses this to ~2 weeks. |
| **RLS session context** | 🟡 Medium | 2 weeks | Whatever replaces PostgREST must set `request.jwt.claims`. If the five `SECURITY DEFINER` helpers are the only readers of `auth.uid()`, this is five functions. |
| **Storage** | 🟡 Medium | 3–4 weeks | S3 + the same `{org_id}/{path}` convention, enforced by presigned URLs from the API instead of by database policy. Object copy is straightforward; the 16 `storage.objects` policies must be reimplemented as application logic. |
| **Realtime** | 🔴 High | 4–6 weeks | Rebuild on AWS AppSync, API Gateway WebSockets, or a self-hosted broker fed by logical replication. The 23-table publication carries over; the consumer does not. |
| **Business logic** | 🟢 **Trivial** | 0 | It is in PostgreSQL. It moves with the database. **This is the payoff of the original architectural decision.** |
| **Edge Functions** | 🟢 None | 0 | None are used. |

**Downtime:** 2–4 hours with a maintenance window. Near-zero is achievable using
logical replication for cutover, at the cost of a dual-write period.

**Actions that reduce future migration risk without changing the product today:**

1. **Keep `auth.uid()` out of policies** — it already is; enforce it statically.
   Converts an 8-week auth migration into a 2-week one. *Cost today: 2 hours.*
2. **New cross-table writes go into `SECURITY INVOKER` functions called via
   `.rpc()`.** Fixes B5 (transactions) *and* creates a portable seam. *Cost today:
   nothing — it is a convention, not a change.*
3. **`lib/storage.ts` for path construction and URL signing.** *Cost today: 1 day.*
4. **Document the `{organization_id}/{path}` convention as a contract**, so an S3
   implementation can reproduce it exactly. *Cost today: 1 hour.*
5. **Do not adopt any further Supabase-proprietary feature** (Edge Functions, Vault,
   pg_graphql) without a written note on its migration cost.

**My recommendation: stay on Supabase.** It is the right platform for this
product at this stage, the coupling is not accidental, and the migration cost is
dominated by services (auth, realtime) you would have to build regardless. Spend
the four days above and revisit in three years.

---

## Top 20 Risks

| # | Risk | Cat | Likelihood | Impact |
|---|---|---|---|---|
| 1 | Production failures are invisible — no error telemetry | **A** | Certain | Severe |
| 2 | No CI — eight harnesses run only by hand; a regression ships silently | **A** | High | Severe |
| 3 | No rate limiting — credential stuffing, enumeration, resource exhaustion | **A** | High | Severe |
| 4 | Backups undocumented, restore never tested | **A** | Medium | Catastrophic |
| 5 | No MFA — blocks enterprise procurement; account takeover unmitigated | **A** | Medium | Severe |
| 6 | Realtime fan-out + `REPLICA IDENTITY FULL` on 23 tables | **B** | High at 100k | Severe |
| 7 | Multi-table writes are not atomic — 8 routes, orphan rows possible | **B** | Medium | Moderate |
| 8 | `audit_log` unpartitioned, no retention — dominates storage and restore time | **B** | High | Moderate |
| 9 | `count: 'exact'` on every list query | **B** | High at 10k | Moderate |
| 10 | Dashboard fetches whole tables to count in JavaScript | **B** | High at 10k | Moderate |
| 11 | `auth.getUser()` network hop on every request | **B** | Certain | Moderate |
| 12 | No generated DB types — schema drift compiles cleanly, fails at runtime | **B** | Medium | Moderate |
| 13 | CSV formula injection in export | **B** | Medium | Moderate |
| 14 | Exports not audited — bulk exfiltration leaves no trace | **B** | Medium | Severe |
| 15 | 15 tenant tables lack an `organization_id`-leading index | **B** | Medium | Moderate |
| 16 | No CSP `script-src` | **B** | Low | Severe if XSS found |
| 17 | Health endpoint reports healthy while the database is down | **B** | Medium | Moderate |
| 18 | `updateSchema` optional on `recordHandlers` — mass-assignment guard is convention | **B** | Low | Severe |
| 19 | Stale `BACKEND_ARCHITECTURE.md` misleads new engineers | **C** | High | Low |
| 20 | Nine unused prod dependencies incl. `next-auth` — supply-chain surface | **C** | Low | Moderate |

---

## Top 20 Improvements

Ordered by return per engineer-day.

| # | Improvement | Cat | Effort | Breaking | Downtime | DB migration |
|---|---|---|---|---|---|---|
| 1 | CI pipeline running the existing harnesses | A | 2 d | No | No | No |
| 2 | Sentry (or equivalent) on client + server | A | 2 d | No | No | No |
| 3 | Rate limiting on auth + mutation endpoints | A | 3 d | No | No | No |
| 4 | Document and **rehearse** backup/restore; set RPO/RTO | A | 2 d | No | No | No |
| 5 | Enable Supabase TOTP MFA; require for owner/administrator | A | 4 d | No | No | No |
| 6 | Add the 15 missing `organization_id`-leading indexes | B | 0.5 d | No | No | Yes (`CONCURRENTLY`) |
| 7 | `count: 'estimated'` for large lists, exact under a threshold | B | 1 d | No | No | No |
| 8 | Move dashboard aggregates into `v_dashboard_stats` | B | 2 d | No | No | Yes (view only) |
| 9 | Neutralise CSV formula injection | B | 0.5 d | No | No | No |
| 10 | Write export events to `audit_log` | B | 0.5 d | No | No | No |
| 11 | Real health endpoint (`SELECT 1` + version) | B | 0.5 d | No | No | No |
| 12 | Make `updateSchema` required in `RecordOptions`; add static check | B | 1 d | No | No | No |
| 13 | Multi-table writes → `SECURITY INVOKER` RPC (8 routes) | B | 5 d | No | No | Yes (functions) |
| 14 | Generate `Database` types; parameterise the client | B | 3 d | No | No | No |
| 15 | Partition `audit_log` by month; 12-month retention | B | 3 d | No | No | Yes |
| 16 | Cache auth context per request; JWKS local verification | B | 3 d | No | No | No |
| 17 | Metrics: realtime-degraded rate, p95 latency, error rate | B | 3 d | No | No | No |
| 18 | `REPLICA IDENTITY DEFAULT` where no non-key filter is used | B | 1 d | No | No | Yes |
| 19 | Rewrite `BACKEND_ARCHITECTURE.md`; remove dead deps and scaffolding | C | 1 d | No | No | No |
| 20 | CSP with per-request nonces threaded through `proxy.ts` | B | 5 d | No | No | No |

---

## Category A — Full Recommendations

### A1. Rate limiting

| | |
|---|---|
| **Problem** | No rate limiting on any endpoint. `/api/auth/login`, `/api/auth/signup` and `/api/auth/forgot-password` are unauthenticated and unthrottled. The login route translates GoTrue's rate-limit error but adds none of its own; authenticated endpoints have none at all. |
| **Business impact** | Credential stuffing against customer accounts. Account enumeration. A single script can exhaust the Supabase request quota and take the platform down for every tenant. Appears on every enterprise security questionnaire. |
| **Technical impact** | Unbounded request volume reaching PostgREST and GoTrue. Cost exposure on usage-based pricing. |
| **Risk** | **Critical** |
| **Effort** | 3 engineer-days |
| **Breaking changes** | None — additive middleware |
| **Downtime** | None |
| **DB migration** | None (use Upstash Redis or Vercel KV; do not put a counter in PostgreSQL) |
| **Users affected** | None under normal use |
| **Rollback** | Environment flag disables the limiter; or revert the `proxy.ts` change |
| **Testing** | Add a harness case asserting the 11th login attempt in 60 s returns 429. Verify a normal session never trips it. |

Suggested initial limits: auth endpoints 10/min/IP; mutations 100/min/user;
reads 300/min/user. Start permissive, measure, then tighten.

---

### A2. Error telemetry

| | |
|---|---|
| **Problem** | No error tracking. `src/app/error.tsx` renders an apology and discards the error, including its `digest`. 12 `console.*` calls across 281 files. No structured logging, no aggregation, no APM. |
| **Business impact** | You learn about outages from customers. Mean time to detection is unbounded; mean time to resolution is dominated by reproduction. No way to tell a platform-wide failure from a single tenant's. |
| **Technical impact** | 500s are unattributable. Deploy regressions are invisible. Every other reliability control depends on this existing first. |
| **Risk** | **Critical** |
| **Effort** | 2 engineer-days |
| **Breaking changes** | None |
| **Downtime** | None |
| **DB migration** | None |
| **Users affected** | None |
| **Rollback** | Remove the DSN environment variable |
| **Testing** | Throw a deliberate error in a staging route; confirm it appears with tenant and route context. Confirm no PII in the payload. |

Scrub `organization_id` to a hash, never send email addresses or record contents.
Capture `error.digest` in `error.tsx` — it correlates client and server.

---

### A3. Continuous integration

| | |
|---|---|
| **Problem** | No CI. Eight verification harnesses — 45 database checks with live two-tenant isolation, 78 HTTP checks, 82 identity checks, static security checks, schema contracts, realtime, 30 unit tests — run only when a human remembers. |
| **Business impact** | A tenant-isolation regression could ship. That is a breach, a disclosure obligation, and the end of enterprise credibility. |
| **Technical impact** | The existing test estate provides no ongoing protection. |
| **Risk** | **Critical** |
| **Effort** | 2 engineer-days |
| **Breaking changes** | None |
| **Downtime** | None |
| **DB migration** | None |
| **Users affected** | None |
| **Rollback** | Delete the workflow file |
| **Testing** | Open a PR that deliberately breaks tenant isolation and confirm CI blocks it. |

On every PR: `tsc --noEmit`, `eslint`, `db:check`, `schema:check`,
`security:check`, `npm test`. On merge to main, against an ephemeral Supabase
branch: `db:apply`, `db:verify`, `app:verify`, `identity:verify`,
`realtime:verify`. **This is the highest return-per-hour item in this report** —
it costs two days and converts existing work into permanent protection.

---

### A4. Backup, restore and disaster recovery

| | |
|---|---|
| **Problem** | No documented backup policy, no RPO/RTO, no tested restore. Migrations are forward-only, so a bad migration's rollback path *is* restore-from-backup — a path nobody has walked. |
| **Business impact** | An untested backup is not a backup. Worst case is total data loss; realistic case is a multi-day outage discovering the procedure under pressure. Enterprise contracts require stated RPO/RTO. |
| **Technical impact** | Recovery time unknown and unbounded. |
| **Risk** | **Critical** |
| **Effort** | 2 engineer-days |
| **Breaking changes** | None |
| **Downtime** | None (rehearse against a staging project) |
| **DB migration** | None |
| **Users affected** | None |
| **Rollback** | N/A |
| **Testing** | **The test is the deliverable.** Restore a production-sized backup into a fresh project, run `db:verify` and `app:verify` against it, record the wall-clock time. That number is your RTO. |

Also confirm your Supabase plan's PITR window meets your stated RPO, and take an
independent `pg_dump` to separate storage — a backup inside the platform you are
protecting against is only half a backup.

---

### A5. Multi-factor authentication

| | |
|---|---|
| **Problem** | No MFA. Supabase supports TOTP enrolment; nothing in the application offers it and no organization policy can require it. |
| **Business impact** | Blocks enterprise procurement outright. A compromised owner password grants full control of a tenant — including `delete_member_account()` and every financial record. |
| **Technical impact** | Password is the sole authentication factor for privileged roles. |
| **Risk** | **Critical for enterprise; High otherwise** |
| **Effort** | 4 engineer-days |
| **Breaking changes** | None if opt-in first |
| **Downtime** | None |
| **DB migration** | One column: `organizations.require_mfa` |
| **Users affected** | Only those who enrol, until an organization enables enforcement |
| **Rollback** | Feature flag; enrolled factors remain valid |
| **Testing** | Enrol, sign out, sign in with TOTP. Verify enforcement blocks a non-enrolled owner. Verify recovery codes work. Add to `identity:verify`. |

Ship opt-in first, then per-organization enforcement for `owner` and
`administrator`. Enforce in `authorize()`, not by redirect — the same reasoning
the codebase already applies to `force_password_change`, which is a correct
precedent to follow.

---

## Category B — Recommendations (condensed, complete fields)

Every item: **no breaking changes, no downtime, existing users unaffected**, unless
noted. Rollback for all schema items is `DROP INDEX` / `DROP FUNCTION` / revert
the view; rollback for all code items is a git revert.

| # | Recommendation | Problem → Impact | Effort | DB migration | Testing |
|---|---|---|---|---|---|
| B1 | Estimated counts above a threshold | Exact count scans every matching row on every list page → list latency grows linearly with tenant size | 1 d | No | `app:verify`: confirm pagination still correct; benchmark 100k-row tenant |
| B2 | Dashboard aggregates into `v_dashboard_stats` | Fetches all leads/deals/products to count in Node → multi-MB transfer per load | 2 d | View only | Response shape must be byte-identical; `app:verify` covers dashboard |
| B3 | Cache auth context per request; JWKS local verify | 3 round trips before every query, one of them a network call to GoTrue | 3 d | No | `identity:verify` must pass unchanged; verify suspension still revokes immediately |
| B4 | `REPLICA IDENTITY DEFAULT` where no non-key filter used | WAL amplification on 23 tables → I/O, backup size, replication lag | 1 d | Yes | `realtime:verify` — this harness exists precisely for this |
| B5 | Multi-table writes → `SECURITY INVOKER` RPC | 8 routes; compensating deletes are best-effort → orphan invoice headers with a consumed document number | 5 d | Yes (functions) | Kill the process between statements in staging; assert no orphan. Also a migration seam (§11) |
| B6 | 15 missing `organization_id`-leading indexes | Sequential scans on tenant-wide reads as tables grow | 0.5 d | Yes — use `CREATE INDEX CONCURRENTLY` | `EXPLAIN` before/after on a seeded tenant |
| B7 | Partition `audit_log`; 12-month retention | Becomes largest table; dominates backup and restore time | 3 d | Yes | Verify the admin audit-log screen is unchanged across the partition boundary |
| B8 | Neutralise CSV formula injection | Leading `=`/`+`/`-`/`@` in attacker-controlled fields executes in Excel | 0.5 d | No | Export a lead named `=1+1`; confirm the cell is inert |
| B9 | Audit export events | Bulk extraction of customers or salaries leaves no trace | 0.5 d | No | Export, then assert the `audit_log` row exists |
| B10 | Generate `Database` types | 341 `any`; column renames compile and fail at runtime | 3 d | No | `tsc --noEmit` must stay clean; adopt file by file |
| B11 | Make `updateSchema` required in `RecordOptions` | Mass-assignment guard is convention, not contract; next route may omit it | 1 d | No | Add to `security:check`; confirm it fails on a route with it removed |
| B12 | CSP with per-request nonces | No `script-src`; XSS would be unmitigated | 5 d | No | Every page renders; zero CSP violations in the console |
| B13 | Gate presence heartbeat on visibility | 45 s/tab unconditional, each a full auth context | 1 d | No | Confirm presence still accurate; `app:verify` |
| B14 | Real health endpoint | Reports healthy while the database is down | 0.5 d | No | Point a monitor at it; stop the database in staging; confirm it fails |

---

## Priority Roadmap

### Immediate (this week — 2 days)
1. **CI pipeline** (A3) — everything else is safer once this exists.
2. Rewrite `BACKEND_ARCHITECTURE.md` (C1) — it currently misinforms.
3. Real health endpoint (B14) — half a day.
4. CSV injection + export auditing (B8, B9) — one day, two real vulnerabilities.

### Before public launch (3 weeks — the approval gate)
5. Error telemetry (A2)
6. Rate limiting (A1)
7. Backup/restore rehearsal with recorded RTO (A4)
8. MFA, opt-in (A5)
9. Missing indexes (B6)
10. Remove nine dead dependencies and the tracked scaffolding (C2, D1)

### After 100 customers
11. Generated database types (B10)
12. `updateSchema` required (B11)
13. Estimated counts (B1)
14. Dashboard aggregates (B2)
15. Basic SLO dashboard: p95 latency, error rate, **realtime-degraded rate** (B17)

### After 1,000 customers
16. Multi-table writes → RPC (B5)
17. `audit_log` partitioning and retention (B7)
18. Auth context caching / JWKS (B3)
19. CSP with nonces (B12)
20. SSO (SAML/OIDC) — the next enterprise procurement blocker after MFA

### After 10,000 customers
21. Read replicas for reporting and analytics
22. Re-examine realtime: filtered subscriptions, or a broker in front of the publication
23. Per-organization usage metering and quotas
24. Formal SOC 2 readiness (the audit trail is most of the way there)

### After 100,000 customers
25. Realtime → dedicated broker / SFU (B4 has bought you time, not a solution)
26. `audit_log` → external store (ClickHouse or S3 + Athena)
27. Multi-region deployment for data residency
28. Connection budget and Supavisor tuning under load

### After 1,000,000 users
29. Tenant sharding by organization across database clusters
30. Extract communication and realtime into a separate service — **the first time
    this document recommends splitting anything**, and only at a scale where the
    workload profile genuinely diverges from the rest of the platform

---

## The CTO Question

> *"If I were the CTO of a global SaaS company preparing this platform for
> long-term growth, what are the minimum changes I would make before approving it
> for public launch, while preserving the existing working system and avoiding
> unnecessary rewrites?"*

**Five changes. Twelve to sixteen engineer-days. Not one of them touches business
logic, changes the schema's shape, or alters a single screen.**

1. **CI running the harnesses that already exist** (2 d). You have built a
   remarkable test estate — live two-tenant isolation checks, 78 HTTP checks, 82
   identity checks — and it protects you only when someone remembers to run it.
   Two days converts that into permanent protection. Nothing else on this list has
   a comparable return.

2. **Error telemetry** (2 d). Right now a production failure is invisible to you;
   `error.tsx` catches the error and throws it away. You cannot operate a service
   you cannot see. Every other reliability improvement is downstream of this one.

3. **Rate limiting** (3 d). `/api/auth/login` is unauthenticated and unthrottled.
   This is the one *open* door in an otherwise carefully locked building.

4. **A rehearsed restore** (2 d). Not a backup policy document — an actual restore,
   timed, with `db:verify` run against the result. Until someone has done it, your
   RTO is a guess, and forward-only migrations mean restore is also your rollback
   path.

5. **MFA, opt-in, enforceable for owners and administrators** (4 d). A compromised
   owner password today grants complete control of a tenant. This is also the first
   thing an enterprise security questionnaire asks about.

**What I would explicitly refuse to do before launch:**

- Any rewrite. The architecture is sound and the central decision — RLS as the
  security boundary — is correct.
- Migrating off Supabase. The coupling is real but deliberate, and the migration
  cost is dominated by services you would otherwise have to build yourself.
- Introducing a service or repository layer. It would touch 349 call sites for no
  present benefit. The `.rpc()` convention (B5) gets you the same seam as a
  by-product of fixing a real bug.
- Microservices. Nothing in this workload justifies them until roughly a million
  users, and even then only for communication.
- Splitting large components on principle. Split them when you next have work
  inside them.

**Final position: approve for public launch conditional on the five items above.**

The architecture will support this business to ten thousand customers with the
Category B work, and to a hundred thousand with the realtime and audit-log changes
identified in §7. What stands between this platform and production is not design —
it is the operational layer that lets you run it, and that layer costs weeks, not
quarters.

---

*Prepared as a read-only architecture review. No application code, schema or
configuration was modified. Every quantitative claim was derived from the source
or from the repository's own harnesses, which were run during this review:
`security:check` (all pass), `db:check` (25 migrations, all parse, cross-file
checks pass), `schema:check` (all contracts hold), `tsc --noEmit` (clean),
`eslint` (0 errors). `db:verify`, `app:verify`, `identity:verify` and
`realtime:verify` require a live database and were not run, so no runtime claim in
this document rests on them.*
