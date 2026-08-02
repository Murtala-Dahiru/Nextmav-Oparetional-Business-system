import { cookies } from 'next/headers';
import { success, error } from '@/lib/api-response';
import { supabaseServer } from '@/lib/supabase/server';
import {
  SESSION_COOKIES, SESSION_POLICY_SUMMARY,
  IDLE_TIMEOUT_MS, ABSOLUTE_TIMEOUT_MS,
} from '@/lib/session-policy';

/**
 * Report that the person is still here, and say how long that buys them.
 *
 * ── Why an endpoint exists for this ───────────────────────────────────────
 *
 * The idle clock lives in an httpOnly cookie and only `proxy.ts` moves it, so
 * the only way for the browser to say "somebody is at the keyboard" is to make
 * a request the proxy counts. Without one, the clock advances solely as a side
 * effect of whatever the application happened to fetch — and somebody spending
 * twenty minutes writing a long comment fetches nothing at all. They would be
 * signed out mid-sentence, which is the precise failure "never lose unsaved
 * work" is about.
 *
 * So: real interaction in the browser, throttled to once a minute, calls this.
 * It does nothing but exist. Passing through the proxy without the background
 * header is the entire effect; the body is the countdown's next reading.
 *
 * Not listed as pre-authentication, deliberately — that list is exactly the
 * set of paths the proxy leaves alone, and a touch the proxy leaves alone
 * touches nothing.
 */
export async function POST() {
  /**
   * A real session, not just a cookie.
   *
   * The proxy has already refused anyone without one, so this is belt and
   * braces — but an endpoint whose entire purpose is to extend a session
   * should be the last place in the codebase that takes the session on trust.
   *
   * `getUser()` rather than `authenticate()`: an account still holding an
   * administrator-issued password is refused every module and is sitting on
   * /change-password, which is exactly where its session most needs to stay
   * alive long enough to finish.
   */
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return error('Authentication required', 401, 'UNAUTHENTICATED');

  const now = Date.now();
  const store = await cookies();

  /**
   * The idle clock is `now` by construction, not whatever the cookie says.
   *
   * A middleware that sets a cookie on the *response* does not change the
   * request the handler then reads — `cookies()` here still holds the value
   * from the previous request. Reading it would mean reporting the deadline
   * this call has just replaced: after twenty-five idle minutes the answer
   * would be "five minutes left" at the very moment the proxy had reset it to
   * thirty, so the warning could never be dismissed by using the application.
   *
   * The absolute start does come from the cookie, because nothing about being
   * active moves it — that is what makes it absolute.
   */
  const started = Number(store.get(SESSION_COOKIES.started)?.value);
  const startedAt = Number.isFinite(started) && started > 0 ? started : now;

  const untilIdle = IDLE_TIMEOUT_MS;
  const untilAbsolute = Math.max(0, startedAt + ABSOLUTE_TIMEOUT_MS - now);

  return success({
    ...SESSION_POLICY_SUMMARY,
    expiresInMs: Math.min(untilIdle, untilAbsolute),
    /**
     * Which clock is running out.
     *
     * The absolute ceiling cannot be pushed back by being active, so the
     * warning has to say something different: "save your work, you will be
     * asked to sign in again" rather than "click to stay signed in", which
     * would be a button that visibly does nothing.
     */
    limitedBy: untilAbsolute < untilIdle ? 'absolute' : 'idle',
  });
}
