# Deployment

Next.js 16 on the front, Supabase (PostgreSQL + Auth + Storage + Realtime) on
the back. There is no ORM — data access goes through `supabase-js` carrying the
signed-in user's JWT, so Row Level Security is what enforces tenant isolation.

---

## 1. Environment

Copy `.env.example` to `.env` and fill in five values from the Supabase
dashboard.

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL | **Bare origin only.** The `/rest/v1/` shown next to it is the REST endpoint; including it makes every call resolve to `/rest/v1/rest/v1/…` and 404. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → anon public | Public by design; ships in the browser bundle. |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role | **Server only.** Bypasses RLS entirely. Never expose it to the browser. |
| `DIRECT_URL` | Settings → Database → **Session pooler** (5432) | Applying migrations. |
| `DATABASE_URL` | Settings → Database → **Transaction pooler** (6543) | Reserved for tooling; the app itself uses `supabase-js`. |

### `NEXT_PUBLIC_*` is baked in at build time

This catches nearly everyone, so it is worth stating plainly.

Next.js **substitutes `NEXT_PUBLIC_*` values into the compiled output when
`next build` runs.** They are not read per request. So on a host:

1. Set them in the project's environment settings **first**.
2. **Then trigger a new deployment.**

Adding the variables and restarting is not enough — the existing build still
contains `undefined`, and Supabase fails with:

```
Your project's URL and Key are required to create a Supabase client!
```

That message points at the API settings page, which is usually not the problem.
The app now replaces it with one that names the actual cause.

On Vercel: Settings → Environment Variables → add all five → Deployments →
**Redeploy**. Make sure they are enabled for the environment you are deploying
(Production and Preview are separate).

Two more things that will otherwise cost you an hour:

- **`db.<ref>.supabase.co` no longer resolves over IPv4.** Supabase deprecated
  direct IPv4 connections, so use the *session pooler* host on port 5432 for
  `DIRECT_URL`. It supports DDL; the transaction pooler on 6543 does not.
- **Percent-encode special characters in the password.** A literal `+` in a URI
  decodes to a space and surfaces as `password authentication failed`, which
  points nowhere near the real cause. `+` → `%2B`.

`.env` is gitignored and must stay that way.

---

## 2. Database

```bash
npm install
npm run db:setup
```

That runs three steps, and you can run them individually:

| Command | Does |
|---|---|
| `npm run db:check` | Parses all 8 migrations against the real PostgreSQL grammar, then checks cross-file consistency — undefined tables and functions, invalid enum members, broken foreign keys, views missing `security_invoker`, recursive policies, business tables missing `organization_id`. |
| `npm run db:apply` | Applies every migration in order, each in its own transaction, so a failure stops at the last complete one rather than leaving a half-built schema. |
| `npm run db:verify` | Verifies the deployed result — see below. |

Everything is idempotent; re-running is safe.

### What `db:verify` actually proves

It creates **two real users in two real organizations** and tries to cross the
boundary: by list query, by direct id, by cross-tenant insert, and by
enumerating the other organization's members.

Schema correctness can be established by reading the SQL. Isolation cannot —
and its failure mode is a data breach rather than an error. It also checks that
RLS is `FORCE`d rather than merely enabled, that every view sets
`security_invoker`, that `clock_in()` writes server time and overwrites a
forged client timestamp, that self-approval is blocked, that stock cannot go
negative, and that the last owner cannot be demoted.

Everything it creates is namespaced and torn down afterwards, including on
failure.

**If anything under "Tenant isolation" fails, stop.**

---

## 3. Application

```bash
npm run dev              # http://localhost:3000
npm run build && npm start
```

`npm run app:verify` exercises the HTTP API the browser actually calls, as two
users in two organizations — 78 checks covering auth, onboarding, module CRUD,
isolation, attendance, leave, inventory, finance, support, admin and export.
The dev server must be running on `:3100`, or set `APP_URL`.

### Seeding demo data

Sign in, then call the seeder once. It fills every module with interlinked
records — deals attached to companies, tasks to projects, invoices to clients —
so cross-module views have something real to show:

```sql
select public.seed_demo_organization('Acme Inc');
```

It is deliberately not a migration: a migration that inserts fake customers
eventually runs against production.

---

## 4. Before you go live

**Email confirmation must be resolved.** `mailer_autoconfirm` is currently
false and the built-in SMTP is rate-limited, so public signup fails with
`email rate limit exceeded` after a few attempts. Either:

- turn off confirmation — Authentication → Providers → Email → *Confirm email*
  off, suitable for an internal tool; or
- configure custom SMTP — Authentication → Emails → SMTP Settings, which is
  what a real deployment wants.

Until one of those is done, accounts can only be created through the admin API.

**Hosting.** Any Node host works. `output: "standalone"` is configured and the
build copies `.next/static` and `public` into it, so
`node .next/standalone/server.js` runs anywhere. On Vercel the standalone
output is ignored and the platform handles it.

**Rotate credentials** that have been shared during development — Settings →
API → *Rotate* for the service-role key, Settings → Database → *Reset database
password* for the connection strings.

---

## Troubleshooting

The dashboard reports the actual cause rather than a blank panel:

| Message | Cause |
|---|---|
| `Your project's URL and Key are required…` | `NEXT_PUBLIC_*` was not set **before** the build. Set it, then redeploy — restarting is not enough |
| `Supabase is not configured: … is missing` | Same cause, reported by this app with the fix spelled out |
| `must be the bare project origin` | The URL has `/rest/v1` on the end; use `https://<ref>.supabase.co` |
| `DATABASE_URL is not set on this deployment` | Environment variable missing, or the host was not redeployed after adding it |
| `…still points at a SQLite file` | `DATABASE_URL` is a `file:` path left over from earlier |
| `The database server is unreachable` | Wrong host or port, or the Supabase project is paused |
| `The database is reachable but empty` | `npm run db:apply` has not been run |
| `Database credentials were rejected` | Password wrong, or a special character is not percent-encoded |
| `the database is missing a required function` | Migrations are behind the application — re-run `db:apply` |

Supabase free-tier projects pause after inactivity; the first request after
that fails until the project wakes.
