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
    /**
     * The policy documents every module reads but only an administrator edits.
     *
     * `/api/admin/settings` is guarded on the admin module, which owners and
     * administrators alone hold — so an employee opening the leave form could
     * not discover which leave types their company offers, and the form fell
     * back to a hard-coded list. Riding along with the session rather than
     * getting an endpoint of its own keeps it to one request per session, the
     * same argument that already put currency and timezone here.
     *
     * Only the non-sensitive half is sent: which leave types are offered and
     * what the working week is are things every employee can already see by
     * using the product. Nothing here discloses anything a colleague could not
     * infer from the request form itself.
     */
    const { data: policyRows } = await ctx.supabase
      .from('org_settings')
      .select('key, value')
      .eq('organization_id', ctx.org.organizationId)
      .in('key', ['leave_policy', 'project_defaults', 'attendance_policy', 'branding']);

    const policies = (policyRows ?? []).reduce<Record<string, unknown>>((acc, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const { data: orgRow } = await ctx.supabase
      .from('organizations')
      .select('work_start, work_end, work_days, grace_minutes, break_minutes, logo_url')
      .eq('id', ctx.org.organizationId)
      .maybeSingle();

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
      /**
       * How this workspace renders money and dates.
       *
       * Sent alongside the user rather than fetched by whichever screen needs
       * it, so there is one answer per session. Every module formats figures,
       * and letting each resolve this independently is precisely how a
       * workspace ends up showing two currencies at once.
       */
      organization: {
        id: ctx.org.organizationId,
        name: ctx.org.organizationName,
        currency: ctx.org.currency,
        locale: ctx.org.locale,
        timezone: ctx.org.timezone,
        logoUrl: orgRow?.logo_url ?? null,
        // The working week, which the leave form and the attendance summary
        // both need in order to agree with the database about what a working
        // day is.
        workStart: orgRow?.work_start ?? '09:00',
        workEnd: orgRow?.work_end ?? '17:30',
        workDays: orgRow?.work_days ?? [1, 2, 3, 4, 5],
        graceMinutes: orgRow?.grace_minutes ?? 10,
        breakMinutes: orgRow?.break_minutes ?? 30,
        policies,
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
