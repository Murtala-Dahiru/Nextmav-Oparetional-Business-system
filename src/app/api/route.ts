import { NextResponse } from 'next/server';

/**
 * Liveness.
 *
 * ── What was here before ──────────────────────────────────────────────────
 *
 * `{"message": "Hello, world!"}`. `proxy.ts` listed it as "health check;
 * returns a version string", `security-check.mjs` described it the same way,
 * and it did neither — but it *was* what a load balancer or an uptime monitor
 * would poll, and it answered 200 whatever else was true, including while the
 * database was unreachable.
 *
 * ── Why this one deliberately checks nothing ──────────────────────────────
 *
 * Liveness answers exactly one question: can this process still serve a
 * request? When the answer is no, the correct response is to restart or
 * replace the instance.
 *
 * Reaching for the database here would be a mistake, and an expensive one. A
 * balancer polls this every few seconds per instance, so a query here becomes
 * permanent synthetic load. Worse, during a brief database wobble *every*
 * instance would fail simultaneously and be pulled from rotation at once —
 * turning a recoverable dependency blip into a total outage caused entirely by
 * the monitoring.
 *
 * Whether the dependencies are healthy is a different question with a
 * different correct response — stop sending traffic, do not restart — and it
 * is answered by `/api/health`.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
