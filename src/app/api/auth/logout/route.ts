import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { success } from '@/lib/api-response';
import { SESSION_COOKIES } from '@/lib/session-policy';

/**
 * Sign out.
 *
 * Always reports success. If revocation fails the local session cookies are
 * still cleared, and leaving someone on a dashboard they believe they have
 * left is worse than a redundant redirect.
 *
 * This is also the escape hatch from a stale session: the store calls it when
 * the server reports no user despite a cookie being present, so the cookie
 * that would otherwise trap the browser between /login and /dashboard is
 * removed. That is why the cookies are cleared directly rather than by
 * `signOut()` alone — given a token it cannot parse, `signOut()` may decline
 * to clear anything, which is precisely the case that most needs clearing.
 */
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer();
    /**
     * `scope: 'global'` ends this person's sessions everywhere, not just in
     * this browser.
     *
     * Sign Out is read as "end my session", and on a shared or borrowed
     * machine that is precisely what someone needs it to mean. The local
     * default left every other browser they had ever signed in from still
     * authenticated, which is a surprise in the one direction that matters.
     *
     * `?scope=local` opts out, for the session-expiry path: that one is
     * clearing up after a timeout in this tab and has no business ending a
     * session the person is actively using on their phone.
     */
    const scope = new URL(request.url).searchParams.get('scope') === 'local'
      ? 'local' : 'global';
    await supabase.auth.signOut({ scope });
  } catch {
    // Fall through — the cookies are removed below regardless.
  }

  try {
    const store = await cookies();
    for (const { name } of store.getAll()) {
      // Large sessions are split across `…auth-token.0`, `.1`, and so on, so
      // match the prefix rather than an exact name; a missed chunk leaves the
      // browser still looking authenticated to the proxy.
      if (name.startsWith('sb-') && name.includes('auth-token')) {
        store.delete(name);
      }
    }
    /**
     * The session clocks go too.
     *
     * Left behind, `nm-session-started` is read as the start of whatever
     * session comes next — so signing out and straight back in yesterday's
     * browser would produce an account that hits the absolute ceiling on its
     * first request and cannot get past the login form.
     */
    store.delete(SESSION_COOKIES.started);
    store.delete(SESSION_COOKIES.seen);
  } catch {
    // Cookie store unavailable — `signOut()` above is then the only clearing,
    // and the client still drops its local state.
  }

  return success({ message: 'Signed out' });
}
