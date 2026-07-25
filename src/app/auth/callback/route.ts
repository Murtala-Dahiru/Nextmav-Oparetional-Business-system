import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Where every emailed authentication link lands.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nothing in the application handled this before, and the gap was invisible
 * because each half looked correct on its own: Supabase really did verify the
 * token, and the app really did have a /reset-password page. What was missing
 * is the step between them — turning the verified token into the session
 * cookies the rest of the app reads.
 *
 * `@supabase/ssr` signs in with PKCE (a `…-auth-token-code-verifier` cookie is
 * written when the flow starts), so after Supabase verifies the emailed token
 * it redirects back with `?code=`. That code is worthless until it is
 * exchanged, and no route was exchanging it. The visible symptoms were:
 *
 *   · confirming an address dropped the user on the marketing page, still
 *     signed out, with no indication anything had happened;
 *   · every password reset failed with "This reset link is invalid or has
 *     expired", because /api/auth/reset-password looks for a recovery session
 *     that was never established.
 *
 * Both are the same missing exchange.
 *
 * Two link shapes are accepted, because which one Supabase sends depends on
 * the email template and on how the link was generated:
 *
 *   ?code=…                  PKCE. What app-initiated signups and resets send.
 *   ?token_hash=…&type=…     The `{{ .TokenHash }}` template form, and what
 *                            admin-generated links use.
 *
 * Handling only the first would leave anyone whose templates were customised
 * with a link that silently does nothing — the exact failure this route
 * exists to end.
 */

/** Only ever redirect within this app: an open redirect here is a phishing hole. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

function failure(origin: string, reason: string): NextResponse {
  const url = new URL('/login', origin);
  // Carried in the query so the sign-in page can say what went wrong. Without
  // it the user is returned to a blank form having been given no idea why the
  // link they just followed did not work.
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeNext(searchParams.get('next'));

  // Supabase reports its own refusals (an expired or already-used link) on the
  // redirect rather than in the body, and they are the common case rather than
  // an edge one, so they are reported in the user's terms.
  const supabaseError = searchParams.get('error_description') ?? searchParams.get('error');
  if (supabaseError && !code && !tokenHash) {
    return failure(origin, supabaseError);
  }

  if (!code && !tokenHash) {
    return failure(
      origin,
      'That link is missing its confirmation token. Open the most recent email and use the link there.',
    );
  }

  const supabase = await supabaseServer();

  // The exchange writes the session cookies through the SSR client's cookie
  // adapter, which is why this must be a route handler and not a page.
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type ?? 'email' });

  if (error) {
    return failure(origin, error.message);
  }

  return NextResponse.redirect(new URL(next, origin));
}
