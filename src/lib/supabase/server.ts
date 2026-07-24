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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Request-scoped client authenticated as the caller.
 *
 * Reads and writes the auth cookies through Next's cookie store so session
 * refresh works across server components and route handlers.
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(URL, ANON, {
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
  return createClient(URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
