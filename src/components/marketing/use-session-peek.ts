'use client';

import { useEffect, useState } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Is anybody signed in?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The problem this solves ──────────────────────────────────────────────
 *
 *  The marketing header offered "Sign in" and "Start free" to everybody,
 *  always. Middleware redirects `/` to the dashboard for a signed-in visitor,
 *  so the landing page hid the problem — but `/features`, `/pricing`,
 *  `/solutions`, `/about`, `/contact`, `/docs`, `/help` and `/status` are all
 *  reachable while signed in, and on every one of them the product invited an
 *  existing customer to create a second account.
 *
 *  That is the sort of thing nobody files a bug for and everybody notices. It
 *  says the marketing site and the product are not the same company.
 *
 *  ── Why a fetch, and why it is cheap ─────────────────────────────────────
 *
 *  The session cookie is httpOnly, by design, so the browser genuinely cannot
 *  read it — there is no synchronous answer available on the client. The one
 *  endpoint that reports this is `/api/auth/session`, which is already public,
 *  already returns "no session" as an ordinary answer rather than a 401, and
 *  is deliberately exempt from advancing the idle clock. So asking does not
 *  extend anybody's session, which is exactly why it is safe to ask on a
 *  marketing page.
 *
 *  The result is cached in a module-level promise, so moving between marketing
 *  pages costs one request per page load and not one per navigation. Nothing
 *  about auth changes here: this reads a state the server already publishes.
 *
 *  ── Three states, not two ────────────────────────────────────────────────
 *
 *  `unknown` matters as much as the other two. Rendering "Sign in" while the
 *  answer is in flight and then swapping it for "Go to dashboard" is a visible
 *  flicker on every page load, and it is worse than useless — it briefly tells
 *  a signed-in customer they are signed out. The header reserves the space and
 *  shows nothing until it knows.
 */

type Peek = 'unknown' | 'authenticated' | 'anonymous';

/**
 * Shared across every mount, and never re-fetched within a page load.
 *
 * Not a context provider: the only consumer is the header, and a provider
 * would put a client boundary around the whole marketing layout — which is
 * what this phase just finished removing.
 */
let cached: Promise<Peek> | null = null;

function readSession(): Promise<Peek> {
  cached ??= fetch('/api/auth/session', {
    // The answer is per-session and must never be served from bfcache or a
    // shared proxy: a cached "authenticated" shown to the next visitor on a
    // shared machine is a small but real information leak.
    cache: 'no-store',
    credentials: 'same-origin',
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => (body?.data?.user ? 'authenticated' : 'anonymous'))
    // Fail to `anonymous`, never to `unknown`. If this endpoint is unreachable
    // the header must still offer a way in — a nav with no actions at all is a
    // worse failure than one showing "Sign in" to somebody already signed in.
    .catch((): Peek => 'anonymous');

  return cached;
}

export function useSessionPeek(): Peek {
  const [state, setState] = useState<Peek>('unknown');

  useEffect(() => {
    let alive = true;
    readSession().then((result) => {
      if (alive) setState(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
