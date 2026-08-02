import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error, serverError } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Set a new password.
 *
 * Requires the recovery session Supabase establishes when the user follows the
 * emailed link, so possession of the link is the proof of identity. There is
 * no token in the body: accepting one would let it be replayed.
 */
export async function POST(request: NextRequest) {
  try {
    const { password } = (await request.json()) ?? {};

    /**
     * Address only. There is no subject to key on — identity here is the
     * recovery session, which has not been read yet, and reading it first
     * would mean an unauthenticated caller could make this endpoint call
     * GoTrue before anything had bounded them.
     *
     * Possession of a valid recovery link is already the hard part, so this is
     * a volume control rather than a guessing control.
     */
    const limited = await enforceRateLimit(request, RATE_LIMITS.credentialChange);
    if (limited) return limited;

    if (!password || typeof password !== 'string' || password.length < 8) {
      return error('Password must be at least 8 characters', 422, 'VALIDATION_ERROR');
    }

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return error(
        'This reset link is invalid or has expired. Request a new one.',
        401, 'NO_RECOVERY_SESSION',
      );
    }

    const { error: e } = await supabase.auth.updateUser({ password });
    if (e) return error(e.message, 400, 'AUTH_ERROR');

    return success({ message: 'Password updated. You can now sign in.' });
  } catch (e: any) {
    return serverError(e, 'Could not reset the password');
  }
}
