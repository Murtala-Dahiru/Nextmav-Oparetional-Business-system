import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { toCamel } from '@/lib/case';
import { log, serializeError } from '@/lib/logger';
import { REQUEST_ID_HEADER, sanitizeRequestId } from '@/lib/request-id';

type ApiResponse<T> = {
  data?: T;
  error?: { message: string; code?: string; details?: unknown; requestId?: string };
  meta?: Record<string, unknown>;
};

/**
 * Successful response.
 *
 * Payloads are converted from the database's snake_case to the camelCase the
 * UI components read. Doing it here — rather than in each of the sixty-odd
 * route handlers, or by renaming Postgres columns — means both sides stay
 * idiomatic and neither has to know about the other's convention.
 */
export function success<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { data: toCamel(data), meta: meta ? toCamel(meta) : undefined } satisfies ApiResponse<unknown>,
    { status },
  );
}

/**
 * Error response.
 *
 * Not case-converted: `message` and `code` are already the shape clients
 * expect, and `details` often carries database output that is more useful
 * verbatim when debugging.
 *
 * `requestId` is additive and optional — clients that ignore it are unaffected,
 * and the ones that show it give support something to search the logs for.
 */
export function error(
  message: string,
  status = 400,
  code?: string,
  details?: unknown,
  requestId?: string,
) {
  return NextResponse.json(
    { error: { message, code, details, requestId } } satisfies ApiResponse<never>,
    { status },
  );
}

export function paginated<T>(data: T[], total: number, page: number, pageSize: number, extra?: Record<string, unknown>) {
  return success(data, {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 0,
    ...(extra ?? {}),
  });
}

/**
 * The correlation id for the request being served, if there is one.
 *
 * Read from the request headers, where `proxy.ts` put it, rather than
 * threaded through a hundred and seventy-eight call sites as a parameter.
 * `headers()` is asynchronous in Next 15 and later, which is the only reason
 * anything below it is async.
 *
 * Returns undefined outside a request — during the build, in a script, in a
 * test — rather than throwing. Nothing here is important enough to fail a
 * response over.
 */
export async function currentRequestId(): Promise<string | undefined> {
  try {
    const bag = await headers();
    return sanitizeRequestId(bag.get(REQUEST_ID_HEADER)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  An unexpected failure: recorded in full, reported in outline.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     } catch (e) {
 *       return serverError(e, 'Could not publish the announcement');
 *     }
 *
 *  ── What this replaced, and why it was wrong twice ────────────────────────
 *
 *  Forty-seven catch blocks across forty-three files read:
 *
 *      return error(e.message || 'Could not publish the announcement', 500);
 *
 *  In practice `e.message` is almost always present — it is an Error — so the
 *  carefully written sentence beside it was dead code, and what the user
 *  actually saw was the exception. That is wrong in both directions at once.
 *
 *  For the *operator*, nothing was written down. The one place that knew a
 *  failure had occurred handed the evidence to the browser and kept no copy,
 *  so a 500 in production existed only in a screenshot from a customer.
 *
 *  For the *user*, "Cannot read properties of undefined (reading 'id')" is not
 *  an error message, it is an apology in the wrong language. And when the
 *  exception comes from the database it is worse than unhelpful: PostgreSQL
 *  names its columns and constraints in its own error text, so the reply
 *  described the schema to whoever provoked it. The codebase had already met
 *  this once — `pgError` handles PGRST204 specially precisely because
 *  "Could not find the 'clientCompanyId' column of 'projects'" reached a user.
 *
 *  So: the exception, its stack and its database diagnostics go to the log.
 *  The sentence the route author wrote goes to the user, with a reference that
 *  ties the two together.
 *
 *  ── Why the message is not made generic ───────────────────────────────────
 *
 *  Because "Could not publish the announcement" tells someone what failed and
 *  what to try again, and "An internal error occurred" tells them nothing.
 *  These strings already exist in the routes and were always meant to be shown;
 *  this simply makes them the thing that is.
 */
export async function serverError(
  err: unknown,
  userMessage: string,
  code = 'INTERNAL_ERROR',
  /**
   * Anything that makes the log line diagnosable — the table, the module, the
   * record. Redacted like every other field, so it cannot become the way a
   * customer's data reaches the log store.
   */
  context?: Record<string, unknown>,
): Promise<NextResponse> {
  const requestId = await currentRequestId();

  log.error(userMessage, { requestId, code, ...context, err: serializeError(err) });

  return error(userMessage, 500, code, undefined, requestId);
}
