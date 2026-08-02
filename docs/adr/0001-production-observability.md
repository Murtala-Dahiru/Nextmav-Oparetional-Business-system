# 0001. Production observability: logging, tracing, error handling and health

**Status:** Accepted
**Date:** 2 August 2026
**Supersedes:** nothing
**Related:** `ARCHITECTURE_REVIEW.md` §8 (A2, B14), `OPERATIONS.md`

---

## Context

The architecture review concluded that the platform is *correct* and not yet
*operable*. Reading the source rather than the review confirmed that and found
the problem to be larger than reported:

| Measured | Value |
|---|---|
| API routes with no `try`/`catch` at all | **52 of 115** |
| Sites returning an exception message to the client with a 5xx | **47**, across 43 files |
| Of those, sites that also wrote a server-side record | **0** |
| `console.*` calls in the entire application | 12 |
| Loggers | 0 |
| Correlation ids | none |
| Health endpoint | `{"message": "Hello, world!"}` |

Two consequences followed, and they are worth separating because they have
different victims.

**The operator learned nothing.** A 500 in production existed only as a
screenshot from a customer. "Is it everyone or one tenant", "when did it
start", "did the deploy cause it" were all unanswerable.

**The caller learned too much.** `error(e.message || 'Could not publish the
announcement', 500)` looks like it shows a friendly sentence. It does not:
`e.message` is almost always present, so the sentence beside it was dead code
and what reached the browser was the exception. When that exception came from
PostgreSQL it named columns and constraints — the codebase had already met this
once, which is why `pgError` handles `PGRST204` specially after
`Could not find the 'clientCompanyId' column of 'projects'` reached a user.

## Options

### Logging transport

| Option | Assessment |
|---|---|
| Sentry / Datadog SDK | **Rejected for now.** Solves it in an afternoon and adds a vendor, a bill, a PII egress path and an SDK in the hot path. The value is in the *seam*, not the vendor — and with the seam built, adopting one later is one file. |
| A logging library (pino, winston) | **Rejected.** A dependency to produce a JSON line and filter by level, which is thirty lines of code with no transitive supply-chain surface. |
| Structured logger over `console`, with a pluggable sink | **Chosen.** Every host worth deploying to already collects stdout. A logger that ships its own logs owns a queue that can fill, a retry loop that can spin, and a failure mode where observability takes down the process it was installed to watch. |

### Catching unhandled exceptions in 115 routes

| Option | Assessment |
|---|---|
| Add `try`/`catch` to all 52 unguarded routes | **Rejected.** Large refactor, high regression surface, and route 116 can still omit it. |
| Wrap every export in `withRoute()` | **Rejected.** Same objection, and it repeats the mistake the codebase already learned from with `updateSchema` — a safety property that is a convention rather than a guarantee. |
| **Next's `instrumentation.ts` / `onRequestError`** | **Chosen.** The framework's own hook, fires for every server-side error in the application, and **touches zero route files**. It cannot be forgotten by a new route because no route opts in. |

### Making the correlation id reachable from a handler

| Option | Assessment |
|---|---|
| `AsyncLocalStorage` | **Rejected.** Tidier, but nothing in a Next request lifecycle offers a place to seed it short of wrapping all 115 handlers. |
| Thread the request through every helper | **Rejected.** `pgError` has 178 call sites; adding a parameter means editing all of them. |
| **Header set in `proxy.ts`, read via `headers()`** | **Chosen.** The framework already carries request headers everywhere. Because every `pgError` call site is exactly `return pgError(e)`, making it `async` and reading `headers()` inside cost **zero** call-site edits — an `async` function awaits a returned promise. |

### Health endpoint shape

| Option | Assessment |
|---|---|
| One endpoint that probes the database | **Rejected.** A balancer polls liveness every few seconds per instance. A database blip would then fail every instance's check at once and empty the fleet — monitoring converting a partial outage into a total one. |
| **Split liveness (`/api`) from readiness (`/api/health`)** | **Chosen.** They call for opposite actions: restart the instance, versus stop sending it traffic. |

### Health detail exposure

The brief lists version, uptime and environment as safe. They are — inside a
perimeter. This endpoint must be pre-authentication so a monitor can reach it,
which puts it outside one, and a public version string is free reconnaissance
for anyone scanning for a known-vulnerable release.

**Chosen:** honest *status code* for everybody, so any uptime check works
unauthenticated; *detail* only for a caller holding `HEALTH_TOKEN`. An absent
token grants nothing.

## Decision

Four layers, each covering the gaps in the others.

```
1  proxy.ts            mints x-request-id, forwards it inbound, echoes it out
2  serverError()       handled exceptions: full detail logged, sentence + id returned
   pgError()           database failures: logged; unknown codes no longer described
   crud.ts guard       throws inside the five shared factories
3  instrumentation.ts  everything that reaches no catch block at all
4  logger.ts           redaction, levels, JSON, and the setLogSink() seam
```

Supporting decisions:

- **Redaction is by key name, not value sniffing** — a value-based guess fails
  in both directions. `email` is redacted; **user ids are logged instead**,
  which answers "which account" without putting personal data into a log store.
- **Records are redacted before reaching the sink**, so attaching a provider
  cannot become the thing that starts shipping customer data to a third party.
- **The inbound `x-request-id` is validated, not trusted.** It is
  attacker-controlled and about to be written into logs; a newline forges
  entries, and a megabyte fills a disk. Constrained to
  `[A-Za-z0-9_-]{8,64}` and replaced when it does not fit.
- **Observability never fails a request.** A throwing sink is swallowed; a
  failing probe reports degraded; `onRequestError` cannot throw. Same rule the
  rate limiter follows.

## Consequences

**Gained.** Every unhandled error in all 115 routes is now recorded. Every
request is traceable end to end. No route describes an exception to its caller.
A monitor can tell "alive" from "ready". Nine static checks fail the build if
any of this is undone.

**Costs.** `pgError` and `serverError` are now `async` — invisible at the call
sites, but a future non-async caller must `await`. One `headers()` read per
error path, which is process-local. Logging volume is a real cost at scale and
is why the default production level is `info`.

**Deferred, deliberately.** No metrics (`p95`, error rate, realtime-degraded
rate); no distributed tracing spans; no client-side error transport — the
browser boundary logs to console and will reach a provider through the same
sink. No vendor.

**When to revisit.** Adopt an external provider when *either* the team can no
longer read stdout during an incident, *or* somebody asks a question the logs
cannot answer twice in one quarter. Adopt OpenTelemetry when a second service
exists — `x-request-id` is already the seam, and a `traceparent` header can
populate it without anything downstream changing.
