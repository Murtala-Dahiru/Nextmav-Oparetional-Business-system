import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { success, error } from '@/lib/api-response';
import { normalizeRole, capabilitySummary } from '@/lib/permissions';

/**
 * Sign in.
 *
 * On success the session cookies are written by the SSR client, so subsequent
 * requests carry the user's JWT and RLS applies to everything they do.
 *
 * The response includes the resolved role and capability set so navigation
 * matches what the database will actually permit. It is a mirror of server
 * truth for rendering — never the basis of an access decision.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password } = (await request.json()) ?? {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 422, 'VALIDATION_ERROR');
    }
    if (!password || typeof password !== 'string') {
      return error('Password is required', 422, 'VALIDATION_ERROR');
    }

    const supabase = await supabaseServer();

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      /**
       * An unconfirmed account is called out by name, unlike every other
       * failure here.
       *
       * Folding it into "Invalid email or password" left anyone who signed up
       * and never confirmed permanently stuck: their password is correct, so
       * they retype it, reset it, and get the same refusal — and nothing on
       * screen ever mentions the email they are supposed to be looking for.
       * Support cannot tell the two apart either.
       *
       * It does reveal that the address is registered. That is a real
       * trade-off and it is made deliberately: the alternative is an account
       * that can never be used, and the resend endpoint below already
       * discloses nothing further.
       */
      if (/email not confirmed|not confirmed/i.test(authError.message)) {
        return error(
          'Your email address has not been confirmed yet. Check your inbox for the confirmation link, or request a new one.',
          403, 'EMAIL_NOT_CONFIRMED',
        );
      }
      if (/rate limit|too many requests/i.test(authError.message)) {
        return error(
          'Too many sign-in attempts. Please wait a moment and try again.',
          429, 'RATE_LIMITED',
        );
      }
      // Everything else stays indistinguishable: "no such user" and "wrong
      // password" must not be separable, or the form becomes a way to test
      // which addresses have accounts.
      return error('Invalid email or password', 401, 'AUTH_ERROR');
    }
    if (!data.user) return error('Invalid email or password', 401, 'AUTH_ERROR');

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, full_name, avatar_url, job_title')
      .eq('id', data.user.id)
      .maybeSingle();

    const { data: memberships } = await supabase
      .from('organization_members')
      .select('id, organization_id, role, department_id, organizations(id, name, slug, currency, timezone, settings)')
      .eq('user_id', data.user.id)
      .eq('is_active', true);

    const membership = memberships?.[0];
    const orgRel = membership?.organizations as any;
    const organization = Array.isArray(orgRel) ? orgRel[0] : orgRel;
    const role = normalizeRole(membership?.role);

    return success({
      user: {
        id: data.user.id,
        email: profile?.email ?? data.user.email,
        firstName: profile?.first_name ?? '',
        lastName: profile?.last_name ?? '',
        fullName: profile?.full_name ?? '',
        avatarUrl: profile?.avatar_url ?? null,
        jobTitle: profile?.job_title ?? null,
        organizationId: membership?.organization_id ?? null,
        organizationName: organization?.name ?? null,
        organizationSlug: organization?.slug ?? null,
        memberId: membership?.id ?? null,
        role,
        isActive: true,
        capabilities: capabilitySummary(role),
      },
      // A confirmed account with no membership has signed up but not yet
      // created or joined an organization. The client needs to route them to
      // onboarding rather than to an empty dashboard.
      needsOrganization: !membership,
    });
  } catch (e: any) {
    return error(e.message || 'Login failed', 500, 'INTERNAL_ERROR');
  }
}
