import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error } from '@/lib/api-response';

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
    return error(e.message || 'Could not reset the password', 500);
  }
}
