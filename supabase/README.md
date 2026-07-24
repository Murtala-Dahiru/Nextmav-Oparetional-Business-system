# Database

Eight migrations that build the entire backend from an empty Supabase project.
Apply them **in order** — each depends on the ones before it.

| # | File | What it creates |
|---|---|---|
| 0001 | `foundation.sql` | Extensions, 18 enums, organizations, profiles, departments, teams, memberships, invitations, signup trigger |
| 0002 | `rls_helpers.sql` | `SECURITY DEFINER` tenant resolution, last-owner guard, `create_organization` / `invite_to_organization` / `accept_invitation` |
| 0003 | `business_tables.sql` | 40 business tables — HR, CRM, projects, workspace, chat, support, finance, inventory, calendar, files |
| 0004 | `business_logic.sql` | Audit triggers, document numbering, **server-authoritative attendance clock**, leave→attendance sync, stock ledger, invoice totals, notifications |
| 0005 | `rls_policies.sql` | 148 statements: RLS enabled and forced on every table, plus policies |
| 0006 | `storage_realtime.sql` | 6 buckets with tenant-scoped policies, Realtime publication, presence |
| 0007 | `views_reports.sql` | 13 reporting views |
| 0008 | `seed.sql` | Per-organization defaults, opt-in demo data |

**51 tables · 13 views · 40 functions · 18 enums · 405 statements.**

---

## Applying

### Credentials

Three values in `.env`. Supabase dashboard →

| Value | Where | Why |
|---|---|---|
| `DIRECT_URL` | Settings → Database → Connection string → **Direct** (5432) | Migrations are DDL, which cannot run through the pooler |
| `DATABASE_URL` | Settings → Database → Connection string → **Transaction pooler** (6543) | Runtime; serverless opens a connection per invocation |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API | Admin operations and the verification harness |

`.env` is gitignored. The service-role key bypasses RLS entirely — server-side
only, never in a browser bundle.

### One command

```bash
npm run db:setup
```

Checks the migrations, applies them in order, then verifies the result.
Equivalent to `db:check && db:apply && db:verify`.

Each file applies inside its own transaction, so a failure stops at the last
complete migration rather than leaving a half-built schema. Everything is
idempotent — a re-run is safe.

Files under `_archive/` are superseded and must **not** be applied.

### Alternatives

```bash
supabase link --project-ref yecikzliedigggzqzxan -p '<db-password>'
supabase db push
```

Or paste each file into the SQL editor in order.

---

## Verifying it worked

```bash
npm run db:verify
```

Checks schema completeness, that RLS is enabled **and forced** on every table,
that every view sets `security_invoker`, that the helpers are
`SECURITY DEFINER`, storage buckets and their visibility, the realtime
publication, and then the business rules — server-authoritative attendance,
self-approval blocking, per-organization document numbering, the stock ledger
refusing to go negative, the audit trail, and the last-owner guard.

**The section that matters is tenant isolation.** The harness creates two real
users in two real organizations and then tries to read across the boundary:
by list query, by direct id, by cross-tenant insert, and by enumerating the
other organization's members. Everything it creates is namespaced and torn
down afterwards, including on failure.

Schema correctness can be established by inspection. Isolation cannot — and
its failure mode is a data breach rather than an error. If anything under
that heading fails, stop and fix it before migrating any application module.

---

## How it is built

**Tenancy.** An `organization` is the boundary. A person is one `profile`
(1:1 with `auth.users`) who may belong to several organizations through
`organization_members`. Role and department live on the *membership*, not the
profile — the same person can be an owner of one company and an employee of
another, and a model that puts role on the user cannot express that.

Ownership columns reference `organization_members` rather than `profiles`,
which makes it structurally impossible to assign a record to somebody outside
the organization.

**The one RLS rule.** No policy queries `organization_members` directly.
Tenancy is resolved through the `SECURITY DEFINER` helpers in 0002:

```
auth_org_ids()               is_org_member(org)        auth_member_id(org)
auth_role_in(org)            has_org_role(org, roles)  is_org_admin(org)
auth_department_id(org)      auth_visible_member_ids(org)
can_approve(org, domain)     can_access_module(org, module)
```

A policy on `organization_members` that reads `organization_members`
re-enters itself and Postgres aborts with `42P17: infinite recursion`. Since
every table resolves its tenant through that one table, the whole platform
fails the moment RLS is on. A previous version of this schema had exactly that
bug in four policies. `SECURITY DEFINER` breaks the cycle; `STABLE` means the
lookup runs once per statement rather than once per row.

**Two things that must never be relaxed:**

- `FORCE ROW LEVEL SECURITY` on every table. Plain `ENABLE` does not apply to
  the table owner, so any connection authenticating as the owner reads across
  all tenants.
- `security_invoker = true` on every view. A view runs as its *owner* by
  default, so a view over a tenant table hands every organization's rows to
  whoever queries it. It is the most common way a careful multi-tenant schema
  leaks. `npm run db:check` fails the build if a view is missing it.

**Attendance is server-authoritative.** `clock_in()` / `clock_out()` take the
timestamp from `now()`, and a trigger overwrites any client-supplied time even
on a direct PostgREST insert. A device clock is under the user's control, so
accepting it would make attendance self-reported. Lateness is measured against
each organization's own `work_start` and `grace_minutes`.

**Approvals are separated from edits.** `can_approve(org, domain)` is distinct
from write access, and database triggers block approving your own leave or
expense — a separation-of-duties rule that holds regardless of which client
performs the write.

**Storage paths carry the tenant:** `{organization_id}/{rest}`. Every storage
policy checks the first segment against `auth_org_ids()`, so one rule covers
every bucket and writing outside your own organization is impossible.

---

## Checking changes

```bash
npm run db:check
```

Parses every migration against the real PostgreSQL grammar, then verifies
cross-file consistency: undefined tables and functions, invalid enum members,
broken foreign keys, views missing `security_invoker`, recursive policies, and
business tables missing `organization_id NOT NULL`.

Run it before every commit that touches `supabase/migrations/`.

---

## Not yet done

- **Nothing here has been executed against a live database.** It parses and is
  internally consistent; that is not the same as working. Applying it is the
  first real test.
- The application still reads through Prisma on 54 route files. Those must move
  to `supabase-js` before RLS does anything for the app — see
  `BACKEND_ARCHITECTURE.md`.
- Email delivery for invitations is the application's job; the database issues
  the token.
