import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { success } from '@/lib/api-response';

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
export async function POST() {
  try {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
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
  } catch {
    // Cookie store unavailable — `signOut()` above is then the only clearing,
    // and the client still drops its local state.
  }

  return success({ message: 'Signed out' });
}
