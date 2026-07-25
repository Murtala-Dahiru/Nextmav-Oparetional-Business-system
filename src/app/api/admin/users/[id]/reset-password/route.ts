import { authorize } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { supabaseAdmin } from '@/lib/supabase/server';
import { generateTemporaryPassword } from '@/lib/temp-password';

type Params = { params: Promise<{ id: string }> };

/**
 * Issue a new temporary password for a member.
 *
 * For when someone is locked out and email cannot help — no inbox access, no
 * mail provider configured, or simply standing at the desk. The administrator
 * reads out the new password and the employee replaces it on their next sign
 * in, because this sets `force_password_change` exactly as provisioning does.
 *
 * The password is returned once and never stored. An administrator can issue
 * a new one whenever they like, but can never see the current one — which is
 * the property that makes "the admin cannot see passwords" true rather than
 * merely claimed.
 */
export async function POST(_req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch {
    return error(
      'Resetting a password needs SUPABASE_SERVICE_ROLE_KEY on the server. ' +
        'The member can use "Forgot password" on the sign-in page instead.',
      501, 'ADMIN_KEY_MISSING',
    );
  }

  /**
   * Resolved through the directory, which is scoped to this organization by
   * RLS. Taking the user id straight from the URL would let an administrator
   * of one tenant reset the password of anyone on the platform whose member id
   * they could guess.
   */
  const { data: member } = await ctx.supabase
    .from('v_org_directory')
    .select('member_id, user_id, email')
    .eq('organization_id', ctx.org.organizationId)
    .eq('member_id', id)
    .maybeSingle();

  if (!member) return error('That member is not part of this organization.', 404, 'NOT_FOUND');

  if (member.user_id === ctx.user.id) {
    return error(
      'Use the password change in your own profile settings rather than resetting your own account here.',
      409, 'SELF_RESET',
    );
  }

  const temporaryPassword = generateTemporaryPassword();

  const { error: authErr } = await admin.auth.admin.updateUserById(member.user_id, {
    password: temporaryPassword,
  });
  if (authErr) return error(authErr.message, 400, 'RESET_FAILED');

  const { error: flagErr } = await admin
    .from('profiles')
    .update({ force_password_change: true })
    .eq('id', member.user_id);

  if (flagErr) {
    // The password did change, so saying otherwise would be wrong — but
    // without the flag they would never be asked to replace it.
    return error(
      'The password was reset, but the member could not be flagged to change it. Reset again before handing it over.',
      500, 'FLAG_FAILED',
    );
  }

  return success({
    email: member.email,
    temporaryPassword,
    mustChangePassword: true,
    nextStep: `Give ${member.email} this temporary password. They will be asked to choose their own the next time they sign in.`,
  });
}
