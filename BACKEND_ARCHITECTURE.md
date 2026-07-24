# Backend architecture

Findings from the pre-implementation review, the decisions that follow from
them, and what is blocked.

---

## 1. The schema fork

The repository contains **two schemas that describe the same product and
disagree with each other**.

| | `prisma/schema.prisma` | `supabase/migrations/001` |
|---|---|---|
| Entities | 27 models | 26 tables |
| `organization_id` | **0 references** | **310 references** |
| Multi-tenant | no | yes |
| Enums / triggers / policies | none | 14 / 40 / 90 |
| Used by the app | **54 of 63 route files** | **never applied** |

They are not two views of one design. Each contains what the other lacks:

- Only the Supabase migration has `organizations`, `organization_members`,
  `invitations`, `profiles`, `channel_members` — the multi-tenancy and
  collaboration core.
- Only Prisma has `attendance_record`, `supplier`, `stock_movement`,
  `purchase_order`, `purchase_order_item` — everything built recently.

A previous session wrote a genuinely good multi-tenant Supabase schema, and
then all subsequent work was built on Prisma instead. Resolving this fork is
the precondition for everything else in the backend phase.

---

## 2. Two blocking bugs found in the unapplied migration

Both were invisible because the migration has never been run against a
database. Both are now fixed.

### 2.1 Infinite recursion in RLS

Four policies on `organization_members` resolved tenancy by querying
`organization_members`:

```sql
CREATE POLICY "select_own_org" ON organization_members
  USING (organization_id IN (
    SELECT organization_id FROM organization_members   -- ← re-enters this policy
    WHERE user_id = auth.uid() AND is_active = true));
```

Evaluating the policy requires reading the table, which re-triggers the policy.
Postgres aborts:

```
ERROR 42P17: infinite recursion detected in policy for relation "organization_members"
```

Every other table resolves its tenant through that same table, so **the entire
platform would fail the moment RLS was switched on.**

Fixed in `002_rls_foundation.sql` by moving tenant resolution into
`SECURITY DEFINER` functions, which execute as the function owner and are
therefore not themselves subject to RLS. They are `STABLE`, so Postgres
evaluates them once per statement rather than once per row.

**Rule for all future policies:** never query membership directly in a policy.
Always go through `auth_org_ids()`, `is_org_member()`, `has_org_role()`,
`is_org_admin()`, or `auth_department_in()`.

### 2.2 Syntax error

```sql
date_trunc('week', now')   -- line 1090, dashboard_stats view
```

The stray quote opens a string literal that swallows the following tokens.
The migration **would not have applied at all**. Fixed to `now()`.

Both files now parse cleanly against the real PostgreSQL grammar
(329 and 41 statements — verified with `pgsql-parser`, not by inspection).

---

## 3. The decision: Prisma and RLS are mutually exclusive as currently wired

This is the central architectural choice, and it cannot be deferred.

RLS identifies the caller through `auth.uid()`, which reads
`request.jwt.claims` — a session variable set by PostgREST when a request
arrives with a user's JWT. **Prisma connects over `DATABASE_URL` as the
database owner and never sets it.**

That produces two failure modes depending on configuration:

- **Without `FORCE`** — the owner bypasses RLS entirely. Policies exist but
  enforce nothing for the application. RLS is decorative.
- **With `FORCE`** — Prisma's queries become subject to RLS. `auth.uid()` is
  NULL, `auth_org_ids()` returns `{}`, every policy evaluates false, and all
  54 Prisma route files **silently return zero rows**. No error, no crash —
  the hardest possible failure to diagnose.

`FORCE` is therefore written into `002` but left commented out, with the exact
statement to run once one of the following is done.

### Option A — move data access to `supabase-js` *(recommended)*

Route handlers use the Supabase client with the caller's JWT. PostgREST sets
the claims, RLS enforces tenancy in the database, and `FORCE` can be switched
on safely.

- Tenant isolation is enforced by Postgres, not by application code that must
  be remembered on all 63 routes.
- Realtime and Storage share the same policy set, so one rule governs all three.
- Cost: rewriting 54 route files, and losing Prisma's generated types in
  favour of generated Supabase types.

### Option B — keep Prisma, add a scoped role

Prisma connects as a dedicated non-owner role and each request opens a
transaction that sets `request.jwt.claims` before querying.

- Much smaller diff; the existing `authorize()` layer stays.
- Every query must run inside that transaction wrapper — one forgotten call
  silently disables tenant isolation for that endpoint. The failure mode is
  invisible, which is what makes this the riskier option long-term.

### Recommendation

**Option A.** The whole reason to adopt RLS is to stop relying on every
developer remembering to scope every query. Option B keeps that burden and
adds a second mechanism on top. Option A is more work now and less risk
forever — and the existing `lib/permissions.ts` capability model maps onto
policies cleanly, so the design work is already done.

Either way, the `SECURITY DEFINER` helpers in `002` are required and correct.

---

## 4. Multi-tenancy gap in the Prisma schema

`0 of 27` Prisma models carry an organization. Whichever option above is
chosen, every business table needs:

- an `organization_id` column, `NOT NULL`, foreign-keyed to `organizations`
- a composite index leading with `organization_id` (every tenant query filters
  on it first)
- a policy — or an `authorize()` scope — that constrains it

This is mechanical but must be complete. **One unscoped table is a
cross-tenant data leak**, and it will not surface in testing with a single
organization, which is exactly how these reach production.

---

## 5. What is blocked, and on what

Applying migrations requires credentials that have not been supplied.

| Needed | Where | Used for |
|---|---|---|
| Database password → `DATABASE_URL` / `DIRECT_URL` | Settings → Database → Connection string | Applying migrations, seeding |
| `service_role` key | Settings → API | Admin operations, server-side seeding |

The anon key that was provided is public by design — it is meant to ship in
browser bundles and is safe in `.env`. It cannot create tables, and confirms
only that the project is reachable: `auth/v1/health` → 200, and every table
probe → 404, i.e. **the database is currently empty.**

### Correction applied

The supplied URL was:

```
https://yecikzliedigggzqzxan.supabase.co/rest/v1/
```

`NEXT_PUBLIC_SUPABASE_URL` must be the bare origin. The `/rest/v1/` shown in
the dashboard is the REST endpoint; including it makes every `supabase-js`
call resolve to `/rest/v1/rest/v1/…` and 404. `.env` now holds the corrected
origin. `.env` is gitignored and was not committed.

---

## 6. Sequence

1. Supply `DATABASE_URL`, `DIRECT_URL`, `service_role`.
2. Apply `001` then `002`. Verify: create two organizations, confirm neither
   can see the other's rows.
3. Decide Option A or B. **This gates everything downstream** — module
   integration, Storage policies and Realtime all inherit from it.
4. Add `organization_id` to every business table.
5. Migrate module data access, one module at a time, verifying isolation after
   each.
6. Switch on `FORCE ROW LEVEL SECURITY`.
7. Storage buckets and Realtime, reusing the same helpers.

Steps 1 and 3 need you. Everything after is mechanical once they are settled.

---

## 7. Verification status

| Claim | How verified |
|---|---|
| Project reachable, database empty | Live HTTP against the project |
| Both migrations are valid PostgreSQL | Parsed with `pgsql-parser` |
| Recursion bug exists | Read from the policy source |
| Syntax error existed and is fixed | Parser failed before, passes after |
| Policies behave correctly at runtime | **Not verified — needs a database** |
| Tenant isolation actually holds | **Not verified — needs a database** |

The last two are the ones that matter, and they cannot be established without
credentials. Every serious bug found in this project so far surfaced at
runtime, not at compile time — that pattern should be assumed to continue.
