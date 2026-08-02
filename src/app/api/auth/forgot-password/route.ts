import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error, serverError } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Send a password reset email.
 *
 * Always reports success, even for an address with no account. Distinguishing
 * the two lets anyone enumerate which emails are registered.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = (await request.json()) ?? {};

    /**
     * The subject is the address the mail would go *to*, so the limit protects
     * whoever owns that inbox rather than whoever is asking — which is the
     * right way round, because those are different people when this endpoint
     * is being abused.
     *
     * A 429 here does say "this address has been asked about a lot", which the
     * uniform success response above is otherwise careful not to reveal. That
     * is accepted: the alternative is answering 200 while sending nothing,
     * which lies to the real user who is now waiting for an email that will
     * never arrive.
     */
    const limited = await enforceRateLimit(
      request, RATE_LIMITS.emailDispatch,
      typeof email === 'string' ? email.trim().toLowerCase() : null,
    );
    if (limited) return limited;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 422, 'VALIDATION_ERROR');
    }

    const supabase = await supabaseServer();
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

    /**
     * Sent through /auth/callback rather than straight to /reset-password.
     *
     * The emailed link carries a code, not a session. Pointing it at the page
     * meant the page rendered with nothing signed in, so the form posted to
     * /api/auth/reset-password, which found no recovery session and answered
     * "This reset link is invalid or has expired" — for every reset, always.
     * The callback performs the exchange first and then forwards here with the
     * recovery session in place.
     */
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });

    return success({
      message: 'If an account exists for that address, a reset link is on its way.',
    });
  } catch (e: any) {
    return serverError(e, 'Could not send the reset email');
  }
}
