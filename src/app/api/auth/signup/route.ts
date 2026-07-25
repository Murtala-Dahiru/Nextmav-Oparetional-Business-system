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
/**
 * Turn a GoTrue message into something a person can act on.
 *
 * These reach the signup form directly, and three of them are routinely
 * misread. "email rate limit exceeded" is not about the user at all — it is
 * the project's outbound mail quota, which on the built-in SMTP is a handful
 * of messages an hour, and it tells the operator to configure a real provider.
 * "Email address … is invalid" is Supabase refusing a domain that cannot
 * receive mail, not a malformed address. And a duplicate registration must not
 * confirm that the address is taken, since that lets anyone test which
 * addresses have accounts.
 *
 * Returned as a tuple so the caller stays a one-liner.
 */
function describeSignUpError(message: string): [string, number, string] {
  const m = message.toLowerCase();

  if (m.includes('rate limit') || m.includes('too many requests')) {
    return [
      'We could not send the confirmation email because this workspace has hit its email sending limit. Please try again shortly, or contact your administrator.',
      429, 'EMAIL_RATE_LIMIT',
    ];
  }
  if (m.includes('is invalid') && m.includes('email')) {
    return [
      'That email address was rejected as undeliverable. Please use an address at a domain that can receive mail.',
      422, 'EMAIL_UNDELIVERABLE',
    ];
  }
  if (m.includes('password')) {
    return [message, 422, 'WEAK_PASSWORD'];
  }
  return [message, 400, 'AUTH_ERROR'];
}

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
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

    const { data: signUp, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        /**
         * Without this, the confirmation link is built from the project's Site
         * URL, which is a dashboard setting the application cannot see and
         * which points somewhere else the moment the app is deployed. Naming
         * the destination here keeps the link pointed at whichever origin the
         * user actually signed up on.
         *
         * It must also be listed under Redirect URLs in the Supabase
         * dashboard, or Supabase falls back to the Site URL and ignores this.
         */
        emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
        // Read by the handle_new_user trigger to populate the profile row.
        data: {
          first_name: String(firstName ?? '').trim(),
          last_name: String(lastName ?? '').trim(),
          // Kept so the organization typed during signup survives the trip
          // through the inbox. Confirmation means this request cannot create
          // the organization itself, and without carrying it the user is asked
          // for it a second time on the onboarding screen.
          pending_organization_name: String(organizationName).trim(),
        },
      },
    });

    if (signUpError) {
      // An address that is already registered is reported exactly like a fresh
      // signup. Saying "that email is taken" would let anyone check which
      // addresses have accounts here, and Supabase obscures it for the same
      // reason when it handles the case itself.
      if (/already registered|already been registered|user already exists/i.test(signUpError.message)) {
        return success(
          {
            user: null,
            organization: null,
            requiresEmailConfirmation: true,
            message:
              'Check your email to confirm your address, then sign in to finish setting up your organization.',
          },
          undefined,
          201,
        );
      }
      return error(...describeSignUpError(signUpError.message));
    }
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
