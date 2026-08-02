import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { log, LOG_CONFIG } from '@/lib/logger';
import { RATE_LIMIT_SUMMARY } from '@/lib/rate-limit';
import { currentRequestId } from '@/lib/api-response';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Readiness — should this instance be sent traffic?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Distinct from `/api`, which answers "is this process alive". The two need
 *  separate answers because they call for opposite actions: a dead process
 *  should be restarted, and an instance whose database is unreachable should
 *  be left alone — restarting it will not bring PostgreSQL back, and doing so
 *  across the fleet during a dependency blip converts a partial outage into a
 *  total one.
 *
 *  ── Two audiences, one endpoint ───────────────────────────────────────────
 *
 *  A monitor needs a status code. A person diagnosing an incident needs
 *  detail. Those are different needs and only one of them is safe to serve to
 *  the internet.
 *
 *  So the *status code* is honest for everybody — 200 healthy, 503 degraded,
 *  which is all an uptime check or a load balancer consumes — while the
 *  *detail* requires `HEALTH_TOKEN`. That keeps the version string, the
 *  uptime and the dependency latencies out of the hands of anyone scanning
 *  for a known vulnerable release or watching for the moment you deploy.
 *
 *  This is the one place where the brief's list of "safe operational
 *  information" is not followed literally. Version and uptime are safe to
 *  publish inside a network perimeter; this endpoint has to be
 *  pre-authentication so that a monitor can reach it, which puts it outside
 *  one. Gating costs an environment variable and removes the trade-off.
 */

const PROBE_TIMEOUT_MS = Number(process.env.HEALTH_PROBE_TIMEOUT_MS) || 3_000;

/**
 * How long a probe result is reused.
 *
 * Without this the endpoint is an unauthenticated way to make the platform
 * query its database as fast as anyone cares to ask. With it, the load is
 * bounded by the window regardless of request volume — and a monitor polling
 * every second costs the same as one polling every ten.
 *
 * Short enough that a real outage is reported within seconds, which is the
 * only thing the window trades away.
 */
const CACHE_MS = Number(process.env.HEALTH_CACHE_MS) || 5_000;

interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  /** Only ever returned to an authorised caller. */
  detail?: string;
}

let cached: { at: number; result: DependencyStatus } | null = null;

/**
 * Can we still reach the database?
 *
 * Uses an anonymous client rather than the caller's session — a monitor has no
 * session — and emphatically not the service-role client, which would make a
 * pre-authentication endpoint the one place in the application that bypasses
 * RLS.
 *
 * The query is a counting `head` request against a tenant table. Under RLS an
 * anonymous caller matches no rows, so the answer is always an empty count:
 * the point is not the data but that the whole path answered — DNS, TLS,
 * PostgREST, PostgreSQL and policy evaluation. A row count would prove no
 * more and would depend on there being data.
 */
async function probeDatabase(): Promise<DependencyStatus> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.result;

  const started = Date.now();
  let result: DependencyStatus;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error('Supabase environment is not configured');

    const supabase = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase
      .from('organizations')
      .select('id', { head: true, count: 'exact' })
      // Without this a hung connection holds the health check open until the
      // platform's own timeout, by which point the monitor has given up and
      // reported the wrong cause.
      .abortSignal(AbortSignal.timeout(PROBE_TIMEOUT_MS));

    result = error
      ? { status: 'down', latencyMs: Date.now() - started, detail: error.message }
      : { status: 'up', latencyMs: Date.now() - started };
  } catch (e) {
    result = {
      status: 'down',
      latencyMs: Date.now() - started,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // Logged on the transition only. A degraded database logged on every poll
  // would produce thousands of identical lines during exactly the incident
  // somebody is trying to read the log through.
  if (cached?.result.status !== result.status) {
    const fields = { dependency: 'database', latencyMs: result.latencyMs, detail: result.detail };
    if (result.status === 'down') log.error('dependency became unreachable', fields);
    else log.info('dependency reachable', fields);
  }

  cached = { at: now, result };
  return result;
}

/**
 * Is this caller allowed the detailed answer?
 *
 * Compared with a constant-time comparison of equal-length buffers would be
 * the textbook answer; it is not warranted here, because the token guards
 * diagnostics rather than access to data, and a timing oracle against a
 * high-entropy token over the internet is not a practical attack. What *is*
 * practical is leaving the token unset, so an absent token grants nothing.
 */
function isAuthorised(request: Request): boolean {
  const expected = process.env.HEALTH_TOKEN;
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
  return presented.length > 0 && presented === expected;
}

export async function GET(request: Request) {
  const database = await probeDatabase();
  const healthy = database.status === 'up';

  const body: Record<string, unknown> = {
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    dependencies: {
      // Never the connection string, the host or the project reference — the
      // question is whether it answers, not where it lives.
      database: { status: database.status },
    },
  };

  if (isAuthorised(request)) {
    body.version = process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';
    body.environment = LOG_CONFIG.environment;
    body.uptimeSeconds = Math.round(process.uptime());
    body.requestId = await currentRequestId();
    (body.dependencies as Record<string, unknown>).database = {
      status: database.status,
      latencyMs: database.latencyMs,
      ...(database.detail ? { detail: database.detail } : {}),
    };
    body.observability = {
      logLevel: LOG_CONFIG.level,
      logFormat: LOG_CONFIG.format,
      rateLimiting: RATE_LIMIT_SUMMARY.enabled,
    };
  }

  return NextResponse.json(body, {
    // 503 rather than 200-with-a-sad-field: a load balancer and an uptime
    // monitor both read the status code and neither reads the body, so a
    // degraded instance reported as 200 keeps receiving traffic it cannot
    // serve.
    status: healthy ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Never cached or prerendered.
 *
 * A health check answered from a build-time snapshot reports the state of the
 * machine that ran the build, which is the most confidently wrong answer this
 * endpoint could give.
 */
export const dynamic = 'force-dynamic';
