import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error } from '@/lib/api-response';

/**
 * Sign up and create an organization.
 *
 * These are one workflow, not two: a user with no organization has nowhere to
 * land and no rows they are permitted to read, so splitting them leaves a real
 * account in a dead end whenever the second call fails. `create_organization()`
 * is SECURITY DEFINER and writes the organization and the owner membership
 * atomically.
 *
 * Joining an existing company goes through the invitation flow instead, which
 * is why an organization name is required here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, firstName, lastName, organizationName } = body ?? {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 422, 'VALIDATION_ERROR');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return error('Password must be at least 8 characters', 422, 'VALIDATION_ERROR');
    }
    if (!organizationName || !String(organizationName).trim()) {
      return error('Organization name is required', 422, 'VALIDATION_ERROR');
    }

    const supabase = await supabaseServer();

    const { data: signUp, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      // Read by the handle_new_user trigger to populate the profile row.
      options: {
        data: {
          first_name: String(firstName ?? '').trim(),
          last_name: String(lastName ?? '').trim(),
        },
      },
    });

    if (signUpError) return error(signUpError.message, 400, 'AUTH_ERROR');
    if (!signUp.user) return error('Could not create the account.', 500, 'AUTH_ERROR');

    // With email confirmation enabled, signUp returns no session. The account
    // exists but cannot yet create an organization, so say so plainly rather
    // than failing later with something opaque.
    if (!signUp.session) {
      return success(
        {
          user: { id: signUp.user.id, email: signUp.user.email },
          organization: null,
          requiresEmailConfirmation: true,
          message:
            'Check your email to confirm your address, then sign in to finish setting up your organization.',
        },
        undefined,
        201,
      );
    }

    const { data: org, error: orgError } = await supabase.rpc('create_organization', {
      org_name: String(organizationName).trim(),
    });

    if (orgError) {
      // The account is real and usable; only the organization step failed.
      // Reporting that precisely lets the client retry just the organization
      // instead of re-signing-up with an address that is now taken.
      return error(
        `Account created, but the organization could not be set up: ${orgError.message}`,
        500,
        'ORG_CREATE_FAILED',
      );
    }

    const organization = Array.isArray(org) ? org[0] : org;

    return success(
      {
        user: {
          id: signUp.user.id,
          email: signUp.user.email,
          firstName: String(firstName ?? '').trim(),
          lastName: String(lastName ?? '').trim(),
        },
        organization,
        requiresEmailConfirmation: false,
      },
      undefined,
      201,
    );
  } catch (e: any) {
    return error(e.message || 'Signup failed', 500, 'INTERNAL_ERROR');
  }
}
