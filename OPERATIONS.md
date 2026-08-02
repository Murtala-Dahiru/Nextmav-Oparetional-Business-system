# Operations

How this platform is observed, what happens when a request fails, and what to
look at first when something is wrong.

For *why* it is shaped this way — including the options rejected — see
[`docs/adr/0001-production-observability.md`](docs/adr/0001-production-observability.md).
For deployment and database setup see [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 1. Request lifecycle

Every request takes the same path, and each stage has one job.

```
   browser / monitor
        │
        ▼
   proxy.ts ──────────────────  mint or accept x-request-id
        │                       route protection, session clocks
        │                       (id goes on the request AND the response)
        ▼
   route handler
        │
        ├── enforceRateLimit()  credential endpoints only
        ├── authorize()         capability check → clear 403
        ▼
   supabase-js (caller's JWT)
        │
        ▼
   PostgREST → RLS → PostgreSQL
```

Failures leave by one of four doors, and every one of them writes a log line
carrying the request id:

| What happened | Handled by | Client gets |
|---|---|---|
| Database returned an error | `pgError()` | Mapped status, safe message, `requestId` |
| Handler caught an exception | `serverError()` | 500, the route's own sentence, `requestId` |
| A shared `crud.ts` handler threw | `guarded()` → `serverError()` | 500, sentence, `requestId` |
| Nothing caught it | `instrumentation.ts` | Next's generic 500 |

The fourth is the safety net, not the goal. Anything landing there regularly is
a route that should be handling the case explicitly.

---

## 2. Logging

`src/lib/logger.ts`. A formatter and a redactor in front of `console` — no
transport, no buffer, no sockets. Your host already collects stdout.

```ts
import { log, serializeError } from '@/lib/logger';

log.warn('project notification failed', { projectId, err: serializeError(err) });
```

**Always pass an exception through `serializeError()`.** `JSON.stringify(new
Error('boom'))` is `{}` — `message` and `stack` are non-enumerable — so an
error handed straight to a JSON logger writes nothing at all.

| Setting | Env | Default |
|---|---|---|
| Threshold | `LOG_LEVEL` | `info` in production, `debug` otherwise |
| Format | `LOG_FORMAT` | `json` in production, `pretty` otherwise |
| Environment label | `NEXT_PUBLIC_APP_ENV` | `NODE_ENV` |

### What never reaches a log line

Redaction is by **key name**, applied recursively before anything is written or
handed to a sink:

```
password  passphrase  secret  token  cookie  authorization  auth  jwt
credential  api_key  session  email  refresh  bearer  signature
```

`email` is on that list. Log the **user id** instead — it answers "which
account" without putting personal data into a log store with its own retention.
Strings are truncated at 2 000 characters and arrays over 50 entries are
summarised, so one runaway field cannot become the log.

Enforced by `npm run test:observability` (49 assertions) and by
`npm run security:check` §9, which fails if any application file calls
`console.*` directly.

### Attaching an external provider

One file, no call sites:

```ts
// src/instrumentation.ts, inside register()
import { setLogSink } from '@/lib/logger';

setLogSink(record => {
  Sentry.captureEvent(record);   // records arrive already redacted
});
```

A sink that throws is swallowed and the record falls back to stdout.
Observability failing must never be why a request fails.

---

## 3. Request tracing

One id per request, in the `x-request-id` header.

- **Accepted from upstream** when it matches `[A-Za-z0-9_-]{8,64}`, so a trace
  spans the load balancer and this application.
- **Rejected and replaced** otherwise. The header is attacker-controlled and
  goes into logs: a newline forges entries, a megabyte fills a disk.
- **On the response**, always — including 401s, redirects and expiries.
- **In the error body** as `requestId`, so support can be given one string.

To follow a report: take the id from the response header or the error body, and
search the logs for it.

Moving to distributed tracing later means populating this from a W3C
`traceparent`. Nothing downstream changes.

---

## 4. Health endpoints

Two, because "restart this instance" and "stop sending it traffic" are
different instructions.

### `GET /api` — liveness

```json
{ "status": "ok", "timestamp": "2026-08-02T19:14:17.663Z" }
```

Checks nothing, deliberately. Point your load balancer here. A database probe
on this path would fail every instance simultaneously during a dependency blip
and empty the fleet — the monitoring causing the outage.

### `GET /api/health` — readiness

Probes the database (anonymous client, RLS applies, result cached for
`HEALTH_CACHE_MS`). **200** healthy, **503** degraded.

Anonymous — enough for any uptime monitor:

```json
{ "status": "ok", "timestamp": "…", "dependencies": { "database": { "status": "up" } } }
```

With `Authorization: Bearer $HEALTH_TOKEN` — adds `version`, `environment`,
`uptimeSeconds`, `requestId`, dependency `latencyMs`, and the live logging and
rate-limiting configuration.

The endpoint is pre-authentication so monitors can reach it, which is exactly
why the detail is gated: a public version string is free reconnaissance. **If
`HEALTH_TOKEN` is unset, detail is never served.**

| Setting | Env | Default |
|---|---|---|
| Detail token | `HEALTH_TOKEN` | unset — detail disabled |
| Probe timeout | `HEALTH_PROBE_TIMEOUT_MS` | `3000` |
| Probe cache | `HEALTH_CACHE_MS` | `5000` |
| Reported version | `APP_VERSION` / `VERCEL_GIT_COMMIT_SHA` | `unknown` |

The cache is not an optimisation: without it the endpoint is an
unauthenticated way to make the platform query its database as fast as anyone
cares to ask.

---

## 5. First moves in an incident

1. **`GET /api/health`** with the token. `database: down` narrows it to the
   dependency immediately.
2. **Search the logs for the request id** the user reported, or for
   `"level":"error"`.
3. **Find the last `application starting` line.** It is written once per boot —
   if there are several, the process is restarting.
4. **`unhandled server error`** means an exception reached no catch block. The
   `route` field is the pattern (`/api/crm/leads/[id]`), so occurrences group.
5. **`dependency became unreachable`** is logged on transition only, not per
   poll, so it marks the start of an outage rather than filling the window.

### Levers that need no deployment

| Symptom | Lever |
|---|---|
| A rate limit is wrong | `RATE_LIMIT_DISABLED=1`, or raise the specific limit |
| Not enough detail | `LOG_LEVEL=debug` |
| Logs unreadable in a terminal | `LOG_FORMAT=pretty` |
| Health detail leaking | unset `HEALTH_TOKEN` |

---

## 6. Verification

| Command | Needs | Covers |
|---|---|---|
| `npm run security:check` | nothing | 9 sections, incl. rate limiting and observability |
| `npm run test:observability` | nothing | logger, redaction, correlation ids |
| `npm run test:rate-limit` | nothing | limiter behaviour and fail-open |
| `npm run db:check` | nothing | 25 migrations parse and cross-check |
| `npm run schema:check` | nothing | Zod schemas against real columns |
| `npm run db:verify` | database | 45 checks, live two-tenant isolation |
| `npm run app:verify` | server + database | 78 HTTP checks as two users |
| `npm run identity:verify` | server + database | 82 identity-lifecycle checks |
| `npm run verify:all` | both | everything above |

---

## 7. Known gaps

Named here rather than left to be discovered.

- **No metrics.** No p95 latency, error rate, or realtime-degraded rate. Logs
  answer "what happened", not "how often".
- **No CI.** These harnesses still run only when somebody types the command.
  The review calls this the highest return-per-hour item outstanding.
- **No rehearsed restore.** Migrations are forward-only, so restore-from-backup
  *is* the rollback path for a bad migration, and nobody has walked it. RPO and
  RTO are currently guesses.
- **Rate-limit counters are per-process.** With N instances the effective limit
  is N× configured. `setRateLimitStore()` is the fix when that matters.
- **Client errors reach the console, not a provider.** The boundary logs
  through the same logger, so a sink captures them — but no sink is attached.
