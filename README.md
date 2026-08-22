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

**Communication is a layer, not an app.** A channel belongs to a project, a
client or a department, so a conversation opens the work it is about and the
work opens the conversation. A file posted in a channel is a `files` row like
any other — findable, attributable, and no more visible than the channel it was
posted in. A meeting is a conversation with a time attached: it lives in the
channel the team already talks in, writes a `calendar_events` row so it appears
in everybody's week, and connects browsers directly rather than through this
platform's infrastructure. Read receipts are something a sender asks for, never
something a message wears.

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
| `npm run identity:verify` | 82 checks over the identity lifecycle and sessions |
| `npm run security:check` | Static checks over the API surface (no database needed) |
| `npm run test:rate-limit` | Rate limiter behaviour and fail-open (no database needed) |
| `npm run test:observability` | Logger, redaction and correlation ids (no database needed) |
| `npm run verify:all` | Every harness above, in order |

---

## Design

Two surfaces, two records, both worth reading before changing anything visual:

- **The authenticated application** — [`APP-DESIGN-SYSTEM.md`](APP-DESIGN-SYSTEM.md).
  Palette, type, shell anatomy, information architecture, and the phase-by-phase
  redesign log. Start here for anything inside the product.
- **The public and auth surface** — [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) and
  [`DESIGN-PROGRESS.md`](DESIGN-PROGRESS.md).

---

## Layout

```
src/
  app/api/            REST endpoints — thin; RLS does the enforcing
  components/modules/ One directory per business module
  lib/
    permissions.ts    Capability model — the only source of access truth
    navigation.ts     The sidebar's information architecture — groups and marks
    auth-context.ts   Request identity, authorize() guard, error mapping
    account-state.ts  Where an account stands: active, suspended, terminated…
    session-policy.ts Idle and absolute session windows, enforced in proxy.ts
    supabase/crud.ts  Generic list/create/update/delete handlers
    logger.ts         Structured logging, redaction, the external-provider seam
    rate-limit.ts     Per-address and per-account limits on credential endpoints
    request-id.ts     Correlation id, shared with the edge proxy
    case.ts           snake_case ↔ camelCase at the API boundary
  proxy.ts            Route protection, session clocks, correlation id
  instrumentation.ts  Framework-wide capture of unhandled server errors
supabase/migrations/  25 migrations that build the backend from empty
scripts/              Migration and verification tooling
```

---

## Verification

Nothing here is asserted without being run:

- `db:check` — every migration parsed against the real PostgreSQL grammar
- `db:verify` — 45 checks including two-tenant isolation
- `app:verify` — 78 checks through the HTTP API as two users
- `identity:verify` — 82 checks over the whole identity lifecycle
- `security:check` — static checks over every route, policy and header
- `test:rate-limit` — 28 assertions over the limiter, including fail-open
- `test:observability` — 49 assertions over logging, redaction and tracing
- `test:navigation` — 40 assertions that the sidebar shows each role exactly
  what `permissions.ts` allows, and nothing else
- `npm test` — 30 unit tests over the attendance rules

---

## Identity and sessions

A person is one `profile` (1:1 with `auth.users`). Organizations grant that
identity access through `organization_members`; role and department live on the
membership, never on the person, because the same individual can be an owner of
one company and an employee of another.

**Lifecycle.** `pending invitation → active → suspended → employment ended →
permanently deleted`. `account_access_state()` resolves which of those an
account is in, and every entry point — sign-in, the request guards, onboarding,
`create_organization()` — reads that one answer. Withdrawing access revokes the
person's sessions rather than merely filtering their queries.

**Deletion removes the identity, not the record.** Seventeen columns cascade
from a membership row, sixteen of them NOT NULL, so deleting one would erase
that person's messages, comments and meetings along with their login. Instead
live responsibilities are reassigned to a named colleague, rosters are revoked,
history keeps pointing at a retained membership row, and the auth user is
deleted — which ends access and frees the email address for reuse. `GET
/api/admin/users/[id]/account` reports what a deletion would touch before it
happens.

**Sessions** have two clocks, both enforced in `proxy.ts` from httpOnly cookies:
30 minutes idle and 12 hours absolute, configurable through
`NEXT_PUBLIC_SESSION_IDLE_MINUTES` and `NEXT_PUBLIC_SESSION_ABSOLUTE_MINUTES`.
Background polling carries `x-nm-background: 1` and does not hold the idle
window open; the browser warns two minutes before expiry.

---

## Running it in production

How the platform is observed, what happens when a request fails, and what to
look at first when something is wrong: **[OPERATIONS.md](OPERATIONS.md)**.

In short — every request carries an `x-request-id` that appears on the
response, in any error body, and on every log line written while serving it.
Logs are structured JSON on stdout with passwords, tokens, cookies and email
addresses redacted before they are written. `/api` is liveness and checks
nothing; `/api/health` is readiness and probes the database. Unhandled
exceptions in any route are captured framework-wide by `src/instrumentation.ts`
without the route opting in.

Decisions that span files — and the options that were rejected — are recorded
in **[docs/adr](docs/adr)**.

---

## Known gaps

Honest list of what is not built, as distinct from broken:

- **Meetings need a TURN server for the hard networks.** Voice, video and
  screen sharing connect browsers directly in a mesh, signalled over Realtime.
  That works on ordinary networks and for the size of meeting this product is
  for — a team, a client call, a stand-up. Two participants behind symmetric
  NAT cannot connect without a TURN relay, which is infrastructure rather than
  code, and a mesh is the wrong shape above roughly eight people. An SFU is the
  answer to both; neither is pretended away in `hooks/use-meeting.ts`.
- **Performance reviews, budget screens, version-history UI.** Not implemented.
- **Email delivery for invitations.** The database issues the token and the API
  returns the link; sending the email is not wired up.
- **Public signup** is blocked until email confirmation is disabled or custom
  SMTP is configured. See DEPLOYMENT.md.
- **No Content-Security-Policy.** The other security headers are set. A useful
  `script-src` needs per-request nonces threaded through `proxy.ts`, because
  Next's app router inlines hydration and bootstrap scripts; a policy written
  without them either breaks the application or is loosened with
  `unsafe-inline` until it states nothing. That is a piece of work rather than
  a header, and the loosened version would look like protection and not be it.
- **No multi-factor authentication.** Supabase supports TOTP enrolment; nothing
  in this application offers it, and no policy can require it.
