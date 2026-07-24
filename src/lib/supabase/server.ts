import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Supabase clients for server code.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Which client to use
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `supabaseServer()`  — carries the signed-in user's JWT. Every query is
 *                        subject to RLS, so tenant isolation is enforced by
 *                        the database rather than by remembering to filter.
 *                        This is the default and should be used everywhere.
 *
 *  `supabaseAdmin()`   — service role. Bypasses RLS entirely. Only for work
 *                        that has no user context: webhooks, scheduled jobs,
 *                        admin provisioning. Never in a request handler that
 *                        serves user data — a single misuse silently removes
 *                        every isolation guarantee the schema provides.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Fail with an explanation rather than Supabase's generic
 * "Your project's URL and Key are required to create a Supabase client!".
 *
 * That message sends people to the API settings page, which is rarely the
 * actual problem. `NEXT_PUBLIC_*` values are substituted into the bundle when
 * `next build` runs, not read at request time — so on a host they must be
 * present *before* the build. Adding them afterwards and restarting changes
 * nothing: the compiled output still contains `undefined`, and only a
 * redeploy picks them up.
 *
 * The trailing-slash check is here for the same reason: the dashboard shows
 * the project URL next to the REST endpoint, and pasting
 * `https://<ref>.supabase.co/rest/v1/` makes every call resolve to
 * `/rest/v1/rest/v1/…` and 404 with nothing that points at the cause.
 */
function requireConfig(): { url: string; anon: string } {
  const missing = [
    !URL && 'NEXT_PUBLIC_SUPABASE_URL',
    !ANON && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Supabase is not configured: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing.\n` +
        'These are inlined when `next build` runs, so setting them on your host ' +
        'and restarting is not enough — set them in the project environment ' +
        'settings and then trigger a new deployment. Locally, put them in .env ' +
        'and rebuild.',
    );
  }

  if (/\/rest\/v1\/?$/.test(URL!)) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL must be the bare project origin ' +
        '(https://<project-ref>.supabase.co), not the REST endpoint. ' +
        'The trailing /rest/v1 makes every request resolve to /rest/v1/rest/v1/… and 404.',
    );
  }

  return { url: URL!, anon: ANON! };
}

/**
 * Request-scoped client authenticated as the caller.
 *
 * Reads and writes the auth cookies through Next's cookie store so session
 * refresh works across server components and route handlers.
 */
export async function supabaseServer() {
  const store = await cookies();

  const { url, anon } = requireConfig();

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            // Written unconditionally: @supabase/ssr signals removal with an
            // empty value and maxAge 0, so guarding on a truthy value here
            // would silently break sign-out.
            store.set(name, value, options as CookieOptions);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore — middleware refreshes the session.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS.
 *
 * Throws rather than falling back if the key is absent, so a missing
 * environment variable fails loudly at the call site instead of silently
 * degrading to an anonymous client that returns empty results.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Required for admin operations.',
    );
  }
  const { url } = requireConfig();

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
