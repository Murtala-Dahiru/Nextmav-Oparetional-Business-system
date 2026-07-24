# NexusCorp Business OS

A multi-tenant business operating system: CRM, projects, HR, finance,
inventory, support, workspace and internal communication in one platform, with
every organization's data isolated at the database level.

**Stack** — Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui ·
Supabase (PostgreSQL, Auth, Storage, Realtime)

---

## Getting started

```bash
npm install
cp .env.example .env      # fill in five Supabase values
npm run db:setup          # check → apply migrations → verify
npm run dev
```

Full instructions, including the two Supabase gotchas that will otherwise cost
you an hour, are in **[DEPLOYMENT.md](DEPLOYMENT.md)**.

---

## How it is put together

**Tenancy.** An `organization` is the boundary. A person is one `profile` (1:1
with `auth.users`) who may belong to several organizations through
`organization_members`. Role and department live on the *membership*, not the
profile — the same person can own one company and be an employee of another,
and a model that puts role on the user cannot express that.

Ownership columns reference `organization_members` rather than `profiles`,
which makes assigning a record to somebody outside the organization
structurally impossible rather than something application code must re-check.

**Security is in the database, not the routes.** Every request carries the
signed-in user's JWT into PostgREST, so RLS decides what is visible. A route
handler that forgets to filter is a bug; a missing policy is a breach — so the
default is deny and access is granted explicitly.

Two invariants that must never be relaxed:

- `FORCE ROW LEVEL SECURITY` on every table. Plain `ENABLE` does not apply to
  the table owner, so an owner connection would read across all tenants.
- `security_invoker = true` on **every** view. Views execute as their owner by
  default, so a view over a tenant table hands every organization's rows to
  whoever queries it. `npm run db:check` fails the build if one is missing it.

**One rule for policies:** never query `organization_members` inside a policy.
Tenancy resolves through the `SECURITY DEFINER` helpers in migration `0002`
(`auth_org_ids`, `is_org_member`, `has_org_role`, …). A policy on that table
that reads that table re-enters itself, and Postgres aborts with `42P17:
infinite recursion` — which, because every table resolves its tenant through
it, takes the whole platform down the moment RLS is switched on.

**Server-authoritative where it matters.** Attendance timestamps come from
`now()` in the database and a trigger overwrites any client-supplied time — a
device clock is under the user's control. Invoice and purchase-order totals are
derived from their line items. Stock is the running total of an append-only
ledger. Approving your own leave or expense is blocked by trigger, so the rule
holds regardless of which client is writing.

**Capability model.** `src/lib/permissions.ts` is the single source of truth for
who may do what: `role → module → { actions, scope }`, where scope is `own`,
`department` or `organization`. `approve` is deliberately separate from `edit`,
because authorising someone else's request is a different responsibility from
editing a record. Roles are fixed rather than editable rows — RLS policies are
written against specific role names, so a role invented at runtime would have
no policy and silently see nothing.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Unit tests for the attendance rules |
| `npm run lint` | ESLint |
| `npm run db:check` | Parse and cross-check migrations (no database needed) |
| `npm run db:apply` | Apply migrations in order |
| `npm run db:verify` | Prove schema, RLS, storage, realtime and tenant isolation |
| `npm run db:setup` | All three, in order |
| `npm run app:verify` | 78 end-to-end checks against the running app |

---

## Layout

```
src/
  app/api/            REST endpoints — thin; RLS does the enforcing
  components/modules/ One directory per business module
  lib/
    permissions.ts    Capability model — the only source of access truth
    auth-context.ts   Request identity, authorize() guard, error mapping
    supabase/crud.ts  Generic list/create/update/delete handlers
    case.ts           snake_case ↔ camelCase at the API boundary
  proxy.ts            Route protection (Next.js middleware convention)
supabase/migrations/  8 migrations that build the backend from empty
scripts/              Migration and verification tooling
```

---

## Verification

Nothing here is asserted without being run:

- `db:check` — 8 migrations parsed against the real PostgreSQL grammar
- `db:verify` — 43 checks including two-tenant isolation
- `app:verify` — 78 checks through the HTTP API as two users
- `npm test` — 30 unit tests over the attendance rules

---

## Known gaps

Honest list of what is not built, as distinct from broken:

- **Storage upload UI.** Buckets, policies and the `files` table exist and are
  verified; there is no upload component or signed-download route yet.
- **Realtime subscriptions.** Nine tables are published and verified, but the
  client does not subscribe, so chat and notifications do not update live.
- **Performance reviews, budget screens, notification preferences,
  version-history UI.** Not implemented.
- **Email delivery for invitations.** The database issues the token and the API
  returns the link; sending the email is not wired up.
- **Public signup** is blocked until email confirmation is disabled or custom
  SMTP is configured. See DEPLOYMENT.md.
