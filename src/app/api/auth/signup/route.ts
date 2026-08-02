import { NextRequest } from 'next/server';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase/server';
import { success, error } from '@/lib/api-response';

/**
 * Sign up.
 *
 * ── Two arrivals, one account ─────────────────────────────────────────────
 *
 * Founding a workspace and joining one are one workflow here, not two: a user
 * with no organization has nowhere to land and no rows they are permitted to
 * read, so splitting them leaves a real account in a dead end whenever the
 * second call fails. `create_organization()` is SECURITY DEFINER and writes
 * the organization and the owner membership atomically.
 *
 * That reasoning is right for a founder and was quietly wrong for everybody
 * else. An invited person with no account was sent here by the acceptance
 * screen, and this endpoint required an organization name — so before they
 * could join the company that invited them they had to found one of their own,
 * which they then owned for ever. Two organizations, one of them meaningless,
 * and a person whose identity on the platform began with a workspace nobody
 * asked for.
 *
 * Passing `inviteToken` resolves the invitation server-side and turns off the
 * organization requirement. The token is not trusted for anything else: it is
 * only checked to establish that an invitation exists for the address being
 * registered, and `accept_invitation()` still validates it properly when the
 * new account redeems it.
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

/**
 * Is there a live invitation for this address?
 *
 * Read with the service role because the caller has no session yet — they are
 * registering — and `invitations` is quite rightly closed to anonymous readers.
 * Nothing about the invitation is returned to them: the answer is used only to
 * decide whether to insist on an organization name, so this cannot become a way
 * to ask which addresses have been invited where.
 */
async function invitationAwaits(email: string, token: string | null): Promise<boolean> {
  try {
    const admin = supabaseAdmin();
    let q = admin
      .from('invitations')
      .select('id')
      .eq('email', email)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());
    if (token) q = q.eq('token', token);
    const { data } = await q.maybeSingle();
    return !!data;
  } catch {
    // No service-role key. Fall back to requiring an organization name, which
    // is the behaviour that existed before and is merely inconvenient.
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, firstName, lastName, organizationName, inviteToken } = body ?? {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 422, 'VALIDATION_ERROR');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return error('Password must be at least 8 characters', 422, 'VALIDATION_ERROR');
    }

    const normalisedEmail = email.trim().toLowerCase();
    const joiningByInvitation = await invitationAwaits(
      normalisedEmail,
      typeof inviteToken === 'string' && inviteToken ? inviteToken : null,
    );

    if (!joiningByInvitation && (!organizationName || !String(organizationName).trim())) {
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
        emailRedirectTo: joiningByInvitation && inviteToken
          // Straight back to the invitation, so confirming the address and
          // joining the workspace are one continuous act rather than a
          // confirmation that lands on an onboarding form they must not use.
          ? `${origin}/auth/callback?next=${encodeURIComponent(`/accept-invite?token=${inviteToken}`)}`
          : `${origin}/auth/callback?next=/onboarding`,
        // Read by the handle_new_user trigger to populate the profile row.
        data: {
          first_name: String(firstName ?? '').trim(),
          last_name: String(lastName ?? '').trim(),
          // Kept so the organization typed during signup survives the trip
          // through the inbox. Confirmation means this request cannot create
          // the organization itself, and without carrying it the user is asked
          // for it a second time on the onboarding screen.
          pending_organization_name: joiningByInvitation ? null : String(organizationName).trim(),
          /**
           * Read by `handle_new_user()` into `profiles.account_origin`, which
           * decides whether this account may ever create an organization once
           * it belongs to none.
           *
           * An invited account may not. That is what stops a terminated
           * employee — invited originally, and now holding a perfectly valid
           * password — from signing in and founding a workspace of their own.
           */
          account_origin: joiningByInvitation ? 'invited' : 'self_signup',
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
          joiningByInvitation,
          message: joiningByInvitation
            ? 'Check your email to confirm your address. The link brings you straight back to your invitation.'
            : 'Check your email to confirm your address, then sign in to finish setting up your organization.',
        },
        undefined,
        201,
      );
    }

    // An invitee founds nothing. They have a session and an account; the
    // organization is the one that invited them, and they join it by redeeming
    // the token on the acceptance screen.
    if (joiningByInvitation) {
      return success(
        {
          user: {
            id: signUp.user.id,
            email: signUp.user.email,
            firstName: String(firstName ?? '').trim(),
            lastName: String(lastName ?? '').trim(),
          },
          organization: null,
          requiresEmailConfirmation: false,
          joiningByInvitation: true,
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
