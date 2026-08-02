/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Request correlation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  One identifier, minted once per request in `proxy.ts`, carried on the
 *  request into the handler and on the response back to the browser. Every log
 *  line written while serving that request quotes it, and the error screen
 *  shows it to the user.
 *
 *  That is the whole feature, and it is the difference between "a customer
 *  says the invoice screen broke this morning" and one grep.
 *
 *  ── Why this file is separate from the logger ─────────────────────────────
 *
 *  `proxy.ts` runs on the edge runtime, where `node:` builtins do not exist.
 *  The logger reaches for Node APIs; this must not, because the proxy is where
 *  the identifier is created. Keeping the two apart is what lets one constant
 *  be shared by both sides instead of being written twice and drifting.
 *
 *  ── Why the header, and not something cleverer ────────────────────────────
 *
 *  `AsyncLocalStorage` would be the tidier mechanism, but nothing in a
 *  Next.js request lifecycle offers a place to seed it that does not also mean
 *  wrapping all 115 route handlers. A request header is already carried
 *  everywhere by the framework, is visible in the browser's network panel, and
 *  survives being read from a different runtime.
 */

/**
 * The header, on the way in and on the way out.
 *
 * `x-request-id` rather than a bespoke name because load balancers, CDNs and
 * log aggregators already recognise it, and a future move to W3C
 * `traceparent` can populate this from the trace id without anything
 * downstream noticing.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Generated fresh when nothing upstream supplied a usable one. */
export function newRequestId(): string {
  // Web Crypto, not `node:crypto` — this runs on the edge.
  return crypto.randomUUID();
}

/**
 * Accept an inbound identifier, or refuse it.
 *
 * ── Why an inbound value is validated rather than trusted ─────────────────
 *
 * Honouring `x-request-id` from upstream is what makes a trace span the load
 * balancer, this application and anything called after it — the "supports
 * distributed tracing later" requirement, satisfied by doing nothing clever.
 *
 * But the header is attacker-controlled, and it is about to be written into
 * structured logs. Two real problems follow. A value containing a newline can
 * forge whole log entries, which is how an intruder writes "authentication
 * succeeded" into an audit trail. A value a megabyte long is a cheap way to
 * fill a disk.
 *
 * So the shape is constrained rather than escaped: identifiers are opaque
 * tokens, nothing legitimate needs a character outside this set, and anything
 * that does not fit is discarded and replaced rather than repaired.
 */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
}

/** The identifier for this request: the caller's if usable, otherwise a new one. */
export function resolveRequestId(raw: string | null | undefined): string {
  return sanitizeRequestId(raw) ?? newRequestId();
}
