import type { Instrumentation } from 'next';
import { log, serializeError, LOG_CONFIG } from '@/lib/logger';
import { REQUEST_ID_HEADER, sanitizeRequestId } from '@/lib/request-id';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Framework-level error capture
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The problem this solves, measured ─────────────────────────────────────
 *
 *  Fifty-two of the hundred and fifteen API routes have no `try`/`catch` at
 *  all. That is not carelessness — most of them have nothing to catch, because
 *  `supabase-js` reports failures as a returned `error` object rather than by
 *  throwing, and `pgError()` handles those. But *something* still throws: the
 *  socket to PostgREST drops, `await req.json()` meets a truncated body, a
 *  relation comes back null and a property is read off it.
 *
 *  When that happened, the exception left the handler, Next returned a generic
 *  500, and nothing anywhere recorded that it had occurred. The user saw an
 *  apology; the operator saw nothing at all.
 *
 *  ── Why here rather than in the routes ────────────────────────────────────
 *
 *  `onRequestError` is Next's own hook for this, and it fires for every
 *  server-side error in the application — route handlers, server components,
 *  the proxy — without a single route file being touched. The alternative was
 *  wrapping a hundred and fifteen exports in a `withRoute()` helper, which is
 *  both the large refactor this work is meant to avoid and a convention that
 *  the hundred and sixteenth route can quietly omit.
 *
 *  This cannot be forgotten by a route added tomorrow, because no route opts
 *  into it.
 *
 *  ── What it does not do ───────────────────────────────────────────────────
 *
 *  It does not change the response. The user still receives Next's generic
 *  500, which is correct — the fix for *that* is the handled paths in
 *  `serverError()` and `pgError()`, which return a written explanation and a
 *  reference. This hook exists so the failure is not also silent.
 */

/**
 * Runs once when the server starts.
 *
 * The line it writes is worth more than it looks: it is the first entry after
 * every deploy and every crash-restart, so "when did it start" and "did the
 * deploy cause it" — two questions the review named as unanswerable — are
 * answered by looking for it. It also states the observability configuration,
 * which is how an operator finds out that `LOG_LEVEL` was left at `debug` in
 * production before the bill does.
 *
 * ── Why it returns early on the edge ──────────────────────────────────────
 *
 * Next runs this file in *both* runtimes, so without the guard every start
 * writes two "application starting" lines — and the count of that line is
 * exactly what someone greps to ask "how often is this restarting?". Two per
 * boot makes that number a lie.
 *
 * It also keeps this module's dependencies out of the edge bundle, which is
 * not cosmetic: pulling in anything that reaches for a `node:` builtin makes
 * the edge compilation warn, and the warning is easy to stop reading.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;

  log.info('application starting', {
    runtime: process.env.NEXT_RUNTIME ?? 'nodejs',
    logging: LOG_CONFIG,
  });
}

/**
 * Every unhandled server-side error, from anywhere.
 *
 * Deliberately total: it must not throw, must not await anything slow, and
 * must not be the reason a request fails. It is the last thing standing
 * between a production fault and silence, so its own failure mode has to be
 * "does nothing" rather than "makes it worse".
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  try {
    /**
     * Only the correlation id is taken from the headers, and it is validated
     * on the way in.
     *
     * Logging the whole header bag would put the session cookie and the
     * `Authorization` header into the log store on the very code path that
     * runs when something is already going wrong — which is how an incident
     * becomes a credential disclosure.
     */
    const raw = request.headers[REQUEST_ID_HEADER];
    const requestId = sanitizeRequestId(Array.isArray(raw) ? raw[0] : raw) ?? undefined;

    log.error('unhandled server error', {
      requestId,
      method: request.method,
      // `routePath` is the pattern — `/api/crm/leads/[id]` — which groups
      // occurrences; `path` is the instance, which may carry identifiers in
      // the query string and so is deliberately reduced to its pathname.
      route: context.routePath,
      path: pathOnly(request.path),
      routeType: context.routeType,
      renderSource: context.renderSource,
      err: serializeError(err),
    });
  } catch {
    // An error reporter that throws inside the error path is worse than one
    // that is absent, because it replaces the original fault with its own.
  }
};

/**
 * The path without its query string.
 *
 * Query strings in this application carry record identifiers, search terms and
 * filter values — a customer's name typed into a search box is personal data
 * and does not belong in a log line.
 */
function pathOnly(path: string): string {
  const cut = path.indexOf('?');
  return cut === -1 ? path : path.slice(0, cut);
}
