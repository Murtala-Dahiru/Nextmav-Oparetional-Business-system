import { getContext } from '@/lib/auth-context';
import { supabaseServer } from '@/lib/supabase/server';
import { success } from '@/lib/api-response';
import { capabilitySummary } from '@/lib/permissions';

/**
 * Current session.
 *
 * Returns null for `user` when there is no session at all, and a user with
 * `needsOrganization` when they are authenticated but belong to nowhere yet —
 * the state between signing up and completing onboarding. Collapsing those two
 * into "not logged in" would bounce a real user back to the login form they
 * just came from.
 */
export async function GET() {
  const ctx = await getContext();

  /**
   * Reported at the top level, not buried in `user`, because it changes where
   * the client must send the person before anything else is worth loading.
   * `getContext()` resolves it whether or not they belong to an organization,
   * so a provisioned employee is caught on their very first request.
   */
  if (ctx?.user.mustChangePassword) {
    return success({
      user: { ...ctx.user, organizationId: ctx.org.organizationId, role: ctx.org.role },
      needsOrganization: false,
      mustChangePassword: true,
    });
  }

  if (ctx) {
    return success({
      user: {
        ...ctx.user,
        organizationId: ctx.org.organizationId,
        organizationName: ctx.org.organizationName,
        organizationSlug: ctx.org.organizationSlug,
        memberId: ctx.org.memberId,
        role: ctx.org.role,
        departmentId: ctx.org.departmentId,
        isActive: true,
        capabilities: capabilitySummary(ctx.org.role),
      },
      needsOrganization: false,
    });
  }

  // Authenticated but without a membership.
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return success({ user: null, needsOrganization: false });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, full_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  return success({
    user: {
      id: user.id,
      email: profile?.email ?? user.email ?? '',
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      fullName: profile?.full_name ?? '',
      avatarUrl: profile?.avatar_url ?? null,
      organizationId: null,
      role: 'employee',
      capabilities: capabilitySummary('employee'),
      // Only meaningful in this branch: it is what the user asked to call
      // their workspace at signup, and onboarding is the screen that finally
      // gets to use it.
      pendingOrganizationName: user.user_metadata?.pending_organization_name ?? null,
    },
    needsOrganization: true,
  });
}
