import { NextRequest } from 'next/server';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase/server';
import { success, error } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Change your own password.
 *
 * Distinct from `/api/auth/reset-password`, and the difference is the point:
 * that one trusts a token from an emailed link, this one trusts nothing and
 * demands the current password. Supabase's `updateUser({ password })` will
 * change a password for anyone holding a valid session without asking what the
 * old one was, so a borrowed laptop or a stolen cookie would be enough to take
 * an account over permanently. Re-authenticating first closes that.
 *
 * Deliberately does not go through `authorize()`. An account carrying a
 * temporary password is refused by every module route, and this is the one
 * thing it must still be able to do — routing it through the same guard would
 * make the requirement unsatisfiable.
 */
export async function POST(request: NextRequest) {
  try {
    const { currentPassword, newPassword } = (await request.json()) ?? {};

    if (!currentPassword || typeof currentPassword !== 'string') {
      return error('Your current password is required', 422, 'VALIDATION_ERROR');
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return error('Your new password must be at least 8 characters', 422, 'VALIDATION_ERROR');
    }
    if (currentPassword === newPassword) {
      return error(
        'Your new password must be different from your current one.',
        422, 'PASSWORD_UNCHANGED',
      );
    }

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      return error('Authentication required', 401, 'UNAUTHENTICATED');
    }

    /**
     * Placed after the session is resolved so the account itself is the
     * subject, and before the re-authentication below — which is the thing
     * being protected.
     *
     * Verifying the current password is correct and is also an online
     * password-guessing oracle: anyone holding a stolen session cookie can ask
     * this endpoint "is it hunter2?" as often as they like, and a correct
     * answer lets them take the account over permanently by setting a new one.
     * The session requirement bounds who can try; this bounds how fast.
     */
    const limited = await enforceRateLimit(request, RATE_LIMITS.credentialChange, user.id);
    if (limited) return limited;

    /**
     * Proof that the person at the keyboard knows the current password.
     *
     * This re-issues the session cookies, which is why it must happen through
     * the request-scoped client: the response carries the refreshed session and
     * the user stays signed in rather than being bounced to the login form
     * having just succeeded.
     */
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (reauthError) {
      return error('Your current password is not correct.', 403, 'INVALID_CURRENT_PASSWORD');
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      // Supabase enforces its own strength rules, and its wording is more
      // specific than anything that could be written here.
      return error(updateError.message, 422, 'PASSWORD_REJECTED');
    }

    /**
     * Clearing the flag is what ends the lockout, so it must not depend on the
     * user's own permissions. `profiles_update` does allow someone to edit
     * their own row, but a policy narrowed later would silently leave accounts
     * stuck in the change-password screen with no way forward — the failure
     * would look like the password change itself not working.
     */
    try {
      await supabaseAdmin()
        .from('profiles')
        .update({ force_password_change: false, password_changed_at: new Date().toISOString() })
        .eq('id', user.id);
    } catch {
      // No service-role key configured. Fall back to the user's own client,
      // which the current policy permits.
      await supabase
        .from('profiles')
        .update({ force_password_change: false, password_changed_at: new Date().toISOString() })
        .eq('id', user.id);
    }

    return success({ message: 'Your password has been changed.' });
  } catch (e: any) {
    return error(e.message || 'Could not change the password', 500);
  }
}
