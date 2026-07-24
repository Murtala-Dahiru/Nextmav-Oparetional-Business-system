import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side route protection (Next.js `proxy` convention, formerly `middleware`).
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
 */
const PROTECTED_PAGES = ['/dashboard', '/onboarding'];

/** Auth pages that a signed-in user should never sit on. */
const AUTH_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password'];

/**
 * API namespaces that serve business data. `/api/auth/*` is intentionally
 * excluded — signing in has to work while signed out.
 */
const PROTECTED_API_PREFIXES = [
  '/api/crm', '/api/projects', '/api/hr', '/api/finance', '/api/inventory',
  '/api/support', '/api/workspace', '/api/communication', '/api/calendar',
  '/api/admin', '/api/dashboard', '/api/activity-log', '/api/search', '/api/export',
];

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

export default function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const authed = hasSession(req);

  // ── Protected data APIs ────────────────────────────────────────────────
  if (startsWithAny(pathname, PROTECTED_API_PREFIXES)) {
    if (!authed) {
      return NextResponse.json(
        { error: { message: 'Authentication required', code: 'UNAUTHENTICATED' } },
        { status: 401 },
      );
    }
    return NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static assets; everything else goes through above.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)'],
};
