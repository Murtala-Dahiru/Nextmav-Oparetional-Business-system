# Deploying to Vercel + Supabase

The app runs on PostgreSQL. It previously used a SQLite file, which cannot work
on Vercel: serverless functions get a read-only, ephemeral filesystem, so the
database file could not be opened — the cause of the
"Couldn't load your dashboard" error.

You need to do steps 1 and 3 yourself (they involve your credentials).

---

## 1. Create the database

1. Go to <https://supabase.com> → **New project**. Any region; note the database
   password you set — it appears in the connection strings.
2. Once it finishes provisioning, open
   **Project Settings → Database → Connection string**.
3. Copy **two** strings:

   | Label in Supabase | Port | Use for |
   |---|---|---|
   | **Transaction pooler** | `6543` | `DATABASE_URL` — runtime |
   | **Direct connection**  | `5432` | `DIRECT_URL` — migrations |

Both are needed. Serverless functions open a connection per invocation, so
runtime traffic must go through the pooler or Postgres exhausts its connection
limit. Migrations cannot run through PgBouncer, so they use the direct
connection.

Append `?pgbouncer=true&connection_limit=1` to the pooled URL.

---

## 2. Create the tables and load the data

Run locally, once, with both variables set in your `.env`
(copy `.env.example` to `.env` first):

```bash
npm install
npm run db:deploy
npm run db:seed
```

`db:deploy` creates the tables from `prisma/schema.prisma`.
`db:seed` loads `prisma/seed-data.json` — a snapshot of the original database,
so the demo organisation, users and role assignments carry over. The seed is
idempotent; re-running it will not duplicate anything.

---

## 3. Configure Vercel

**Project Settings → Environment Variables**, for Production *and* Preview:

| Name | Value |
|---|---|
| `DATABASE_URL` | the pooled string (port **6543**, with `?pgbouncer=true&connection_limit=1`) |
| `DIRECT_URL` | the direct string (port **5432**) |

Then **redeploy** — Vercel does not pick up new environment variables on an
existing deployment.

Nothing else needs configuring. `prisma generate` runs on both `postinstall`
and `build`, so the client is always generated.

---

## Verifying it worked

Open the app and sign in. In demo mode any password works, and the email
determines which role you get:

| Sign in as | Role | What you should see |
|---|---|---|
| `alex.johnson@nexuscorp.com` | Owner | Everything, including revenue |
| `michael.lee@nexuscorp.com` | Finance | Finance + revenue, no HR directory |
| `emily.martinez@nexuscorp.com` | HR | HR only — **no revenue**, no CRM |
| `sarah.chen@nexuscorp.com` | Sales | CRM + inventory, **no** finance |
| `john.davis@nexuscorp.com` | Employee | Own tasks/leave only, no finance |

If the dashboard still fails it will now say *why* rather than showing a blank
panel. The messages map directly to causes:

| Message | Cause |
|---|---|
| `DATABASE_URL is not set on this deployment` | Env var missing in Vercel, or not redeployed after adding it |
| `...still points at a SQLite file` | `DATABASE_URL` is a `file:` path |
| `The database server is unreachable` | Wrong host/port, or the Supabase project is paused |
| `The database is reachable but empty` | `npm run db:deploy` was not run |
| `Database credentials were rejected` | Password in the string is wrong |

---

## Notes

- `.env` is gitignored and must stay that way. `.env.example` is the template.
- `db/custom.db` remains in the repository only as the origin of
  `prisma/seed-data.json`. It is no longer used at runtime.
- Supabase free-tier projects pause after a period of inactivity; the first
  request after that will fail until the project resumes.
