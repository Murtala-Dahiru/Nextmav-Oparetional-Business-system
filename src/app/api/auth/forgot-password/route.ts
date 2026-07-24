import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error } from '@/lib/api-response';

/**
 * Send a password reset email.
 *
 * Always reports success, even for an address with no account. Distinguishing
 * the two lets anyone enumerate which emails are registered.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = (await request.json()) ?? {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 422, 'VALIDATION_ERROR');
    }

    const supabase = await supabaseServer();
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: origin + '/reset-password',
    });

    return success({
      message: 'If an account exists for that address, a reset link is on its way.',
    });
  } catch (e: any) {
    return error(e.message || 'Could not send the reset email', 500);
  }
}
