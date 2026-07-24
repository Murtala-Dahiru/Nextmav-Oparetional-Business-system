import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error } from '@/lib/api-response';

/**
 * Accept an invitation.
 *
 * Delegates to accept_invitation(), which is SECURITY DEFINER because the
 * invitee is not yet a member and so cannot satisfy the insert policy on
 * organization_members — the chicken-and-egg at the heart of invite-based
 * onboarding. It validates that the token exists, is pending, unexpired, and
 * was issued to the caller's own address, so a leaked link cannot be redeemed
 * by whoever finds it.
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = (await request.json()) ?? {};
    if (!token || typeof token !== 'string') {
      return error('An invitation token is required', 422, 'VALIDATION_ERROR');
    }

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return error(
        'Sign in or create an account first, then open the invitation link again.',
        401, 'UNAUTHENTICATED',
      );
    }

    const { data, error: e } = await supabase.rpc('accept_invitation', {
      invite_token: token,
    });

    if (e) {
      // The function raises written messages for expired, already-used, and
      // wrong-recipient. Pass them through — each needs a different response
      // from the user.
      return error(e.message, 400, 'INVITE_REJECTED');
    }

    return success({ organization: Array.isArray(data) ? data[0] : data });
  } catch (e: any) {
    return error(e.message || 'Could not accept the invitation', 500);
  }
}
