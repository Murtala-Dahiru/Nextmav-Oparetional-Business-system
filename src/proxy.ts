import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIES, BACKGROUND_HEADER, expiryOf,
  ABSOLUTE_TIMEOUT_MS, type ExpiryReason,
} from '@/lib/session-policy';
import { REQUEST_ID_HEADER, resolveRequestId } from '@/lib/request-id';

/**
 * Server-side route protection and session lifetime (Next.js `proxy`
 * convention, formerly `middleware`).
 *
 * Auth used to be enforced only inside client components, which meant the
 * dashboard HTML was served to anyone and the redirect happened after hydration
 * — a visible flash of protected UI, and no protection at all for the data
 * APIs. This runs before the request is handled and makes the decision before any protected markup or data
 * leaves the server.
 *
 * Flow:  Landing (/)  →  /login or /signup  →  authenticated  →  /dashboard
 */

/**
 * Pages that require a session.
 *
 * `/onboarding` belongs here: it is where an authenticated user with no
 * organization completes setup, so it must be unreachable while signed out.
 *
 * So do `/change-password` and `/settings`. Both act on the signed-in account,
 * and both are reachable while the server is refusing every module because a
 * temporary password is still in place — which is the whole point of them.
 */
const PROTECTED_PAGES = ['/dashboard', '/onboarding', '/change-password', '/settings'];

/**
 * Auth pages that a signed-in user should never sit on.
 *
 * `/reset-password` is deliberately not one of them. Following a reset link
 * establishes a recovery session, so by the time that page loads the visitor
 * *is* signed in — bouncing them to the dashboard from here meant the password
 * could never actually be changed. Someone already signed in who opens it is
 * simply changing their password, which is allowed.
 */
const AUTH_PAGES = ['/login', '/signup', '/forgot-password'];

/**
 * API namespaces that serve business data.
 *
 * ── Why this is now a deny-list turned inside out ─────────────────────────
 *
 * It used to be a hand-maintained list of eighteen prefixes, and six live
 * namespaces were missing from it: /api/todos, /api/notifications,
 * /api/presence, /api/directory, /api/portal and /api/organizations. Each one
 * guards itself properly, so nothing leaked — but the list was the thing that
 * was supposed to make a *forgotten* guard survivable, and a list that has to
 * be remembered cannot do that job. The next route added would have been the
 * nineteenth omission.
 *
 * Everything under /api is protected unless it is named here as
 * pre-authentication. That list is short, closed, and each entry has a reason
 * it cannot require a session.
 */
const PUBLIC_API = new Set([
  '/api',                            // liveness; no dependencies, no detail
  '/api/health',                     // readiness; status code for anyone, detail for HEALTH_TOKEN
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/resend-confirmation',
  '/api/auth/logout',                // must work with a broken or absent session
  '/api/auth/session',               // reports "no session" as a normal answer
  '/api/auth/accept-invite',         // authenticates by invitation token
]);

/**
 * Detect a session from cookies alone.
 *
 * Middleware runs on the edge, so this deliberately does not call Supabase —
 * it only checks whether a session cookie is present. Cookie presence gates
 * *routing*; the API routes still validate the session properly before
 * returning data.
 */
function hasSession(req: NextRequest): boolean {
  // Supabase stores its session as `sb-<project-ref>-auth-token`, optionally
  // split across `.0`, `.1`, ... chunks when the token is large.
  return req.cookies.getAll().some(
    c => c.name.startsWith('sb-') && c.name.includes('auth-token') && !!c.value,
  );
}

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicApi(pathname: string): boolean {
  return [...PUBLIC_API].some(p => pathname === p || pathname === `${p}/`);
}

// ── Session lifetime ────────────────────────────────────────────────────────

/**
 * Read the two clocks.
 *
 * A session cookie with no clocks beside it is one that began before this
 * existed, or one Supabase established through a path that does not run
 * through here — an emailed confirmation link, say. Treated as starting now
 * rather than as already expired: signing everybody out on deploy, and
 * bouncing every freshly confirmed account straight back to the login form, is
 * a worse failure than one session running slightly long.
 */
function readClock(req: NextRequest, now: number) {
  const started = Number(req.cookies.get(SESSION_COOKIES.started)?.value);
  const seen = Number(req.cookies.get(SESSION_COOKIES.seen)?.value);
  return {
    startedAt: Number.isFinite(started) && started > 0 ? started : now,
    lastSeenAt: Number.isFinite(seen) && seen > 0 ? seen : now,
  };
}

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  // localhost is not https, and a Secure cookie there is simply never sent —
  // which would expire every session on the first navigation in development.
  secure: process.env.NODE_ENV === 'production',
};

function writeClock(res: NextResponse, startedAt: number, lastSeenAt: number) {
  // maxAge matches the absolute ceiling: past that the session is over anyway,
  // and a cookie that outlives the thing it describes is just litter.
  const maxAge = Math.ceil(ABSOLUTE_TIMEOUT_MS / 1000);
  res.cookies.set(SESSION_COOKIES.started, String(startedAt), { ...COOKIE_BASE, maxAge });
  res.cookies.set(SESSION_COOKIES.seen, String(lastSeenAt), { ...COOKIE_BASE, maxAge });
}

/**
 * Clear everything that says "signed in".
 *
 * The Supabase cookies go too, not just the clocks. Leaving them would make
 * `hasSession()` keep returning true, and the browser would loop between
 * /login (redirected away because a cookie is present) and /dashboard
 * (redirected away because the session expired) with no way out but clearing
 * site data by hand.
 */
function clearSession(req: NextRequest, res: NextResponse) {
  for (const { name } of req.cookies.getAll()) {
    if (name.startsWith('sb-') && name.includes('auth-token')) res.cookies.delete(name);
  }
  res.cookies.delete(SESSION_COOKIES.started);
  res.cookies.delete(SESSION_COOKIES.seen);
}

function expiredApi(req: NextRequest, reason: ExpiryReason): NextResponse {
  const res = NextResponse.json(
    {
      error: {
        message: reason === 'idle'
          ? 'Your session ended after a period of inactivity. Sign in to continue.'
          : 'Your session reached its maximum length and ended. Sign in to continue.',
        code: 'SESSION_EXPIRED',
        reason,
      },
    },
    { status: 401 },
  );
  clearSession(req, res);
  return res;
}

function expiredPage(req: NextRequest, reason: ExpiryReason): NextResponse {
  const { pathname, search } = req.nextUrl;
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('reason', reason === 'idle' ? 'timeout' : 'session-limit');
  // Where they were, so signing in again returns them to it rather than to a
  // generic dashboard. Losing your place is a small thing that feels like
  // losing your work.
  url.searchParams.set('next', `${pathname}${search}`);
  const res = NextResponse.redirect(url);
  clearSession(req, res);
  return res;
}

/**
 * Mint the correlation id, and make sure it leaves on the response.
 *
 * ── Why the wrapper, rather than setting it in each branch ────────────────
 *
 * The decision logic below returns from eight different places — redirects,
 * refusals, expiries and the ordinary pass-through — and an identifier that is
 * attached in seven of them is worse than useless, because the one request
 * that went wrong is the one with no id on it. Wrapping is the only shape that
 * cannot be got wrong by adding a ninth branch later.
 *
 * The session logic itself is untouched: `handle` is the previous function,
 * renamed, and it neither reads nor writes the identifier.
 */
export default function proxy(req: NextRequest) {
  const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));
  const res = handle(req, requestId);
  // On the response so the browser can quote it, the network panel shows it,
  // and `error.tsx` has something to put in front of the user.
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

function handle(req: NextRequest, requestId: string) {
  const { pathname, search } = req.nextUrl;

  /**
   * Continue to the handler, with the identifier on the *request*.
   *
   * `NextResponse.next()` alone forwards the original headers, so a route
   * handler would have no way to learn the id and every log line it wrote
   * would be uncorrelated. Rebuilding the header bag is the documented way to
   * pass a value from here into the handler.
   */
  const forward = () => {
    const headers = new Headers(req.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return NextResponse.next({ request: { headers } });
  };
  const authed = hasSession(req);
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  const now = Date.now();

  /**
   * Does this request move the idle clock?
   *
   * Background work does not, or the tray's thirty-second poll would keep
   * every abandoned tab signed in for ever and the timeout would be theatre.
   *
   * `/api/auth/session` is exempt for a different reason and by a different
   * mechanism: it is listed as pre-authentication, so it returns early below
   * without ever reaching `advance()`. The countdown calls it to ask how much
   * time is left, and that question must not be its own answer.
   */
  const isBackground = req.headers.get(BACKGROUND_HEADER) === '1';

  // ── Session lifetime, before anything else ─────────────────────────────
  //
  // Checked ahead of the route rules so that an expired session cannot reach a
  // protected page or an API, and so the /login redirect below is not competing
  // with the "already signed in, go to the dashboard" rule.
  if (authed && !isPublicApi(pathname)) {
    const clock = readClock(req, now);
    const expiry = expiryOf(clock, now);
    if (expiry) {
      return isApi ? expiredApi(req, expiry) : expiredPage(req, expiry);
    }
  }

  const advance = (res: NextResponse): NextResponse => {
    if (!authed) return res;
    const clock = readClock(req, now);
    writeClock(res, clock.startedAt, isBackground ? clock.lastSeenAt : now);
    return res;
  };

  // ── APIs ───────────────────────────────────────────────────────────────
  if (isApi) {
    if (isPublicApi(pathname)) return forward();
    if (!authed) {
      return NextResponse.json(
        { error: { message: 'Authentication required', code: 'UNAUTHENTICATED' } },
        { status: 401 },
      );
    }
    return advance(forward());
  }

  // ── Protected pages ────────────────────────────────────────────────────
  if (startsWithAny(pathname, PROTECTED_PAGES) && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Preserve where they were heading so login can return them there.
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  // ── Auth pages while already signed in ─────────────────────────────────
  if (startsWithAny(pathname, AUTH_PAGES) && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // ── Landing page ───────────────────────────────────────────────────────
  // Unauthenticated visitors always get the landing page. Signed-in users are
  // sent straight to their workspace.
  if (pathname === '/' && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return advance(forward());
}

export const config = {
  // Skip Next internals and static assets; everything else goes through above.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)'],
};
