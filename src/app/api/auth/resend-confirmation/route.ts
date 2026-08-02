import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error, serverError, currentRequestId } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { log, serializeError } from '@/lib/logger';

/**
 * Send the confirmation email again.
 *
 * Until this existed, an account whose confirmation email never arrived — the
 * common outcome on the built-in SMTP, which allows only a few messages an
 * hour — had no route forward at all. Signing up again is refused because the
 * address is taken, and signing in is refused because it is unconfirmed. The
 * login form now offers this when it sees EMAIL_NOT_CONFIRMED.
 *
 * Like the reset endpoint, it always reports success: answering differently
 * for an unknown address, for one already confirmed, or for one the sending
 * quota refused would turn it into a way to test which addresses have
 * accounts. The login form may say an address is unconfirmed, but only once
 * the correct password has been supplied; this endpoint asks for no password
 * at all, so it must give nothing away.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = (await request.json()) ?? {};

    /**
     * Shares `emailDispatch` with the reset endpoint deliberately: both make
     * this server send mail to an address the caller chose, and counting them
     * separately would hand a script twice the budget for alternating between
     * two forms that do the same thing to the same inbox.
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

    const { error: e } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${origin}/auth/callback?next=/onboarding` },
    });

    if (e) {
      // Logged, never returned. Reporting the sending quota here would undo
      // the whole point of the uniform response: Supabase only tries to send
      // for an address that actually needs confirming, so a 429 for one input
      // and a 200 for another is a way to test which addresses are registered
      // — and unlike the login form, this endpoint asks for no password first.
      log.warn('confirmation email was not sent', {
        requestId: await currentRequestId(),
        err: serializeError(e),
      });
    }

    // Deliberately identical for every input: unknown address, already
    // confirmed, sent, or refused by the quota.
    return success({
      message:
        'If that address needs confirming, a new link is on its way. ' +
        'If nothing arrives in a few minutes, contact your administrator — ' +
        'the workspace may have reached its email sending limit.',
    });
  } catch (e: any) {
    return serverError(e, 'Could not resend the confirmation email');
  }
}
