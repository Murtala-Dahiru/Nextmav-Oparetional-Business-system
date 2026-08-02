import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { supabaseAdmin } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Permanent account deletion
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What "delete" means here, and why it is not DELETE FROM ───────────────
 *
 *  Seventeen columns reference `organization_members` with ON DELETE CASCADE,
 *  sixteen of them NOT NULL: messages.sender_id, comments.author_id,
 *  meetings.host_id, time_entries, attendance, leave, todos. Removing one
 *  membership row erases that person's entire trace from the organization,
 *  including half of every conversation they were part of. An owner could do
 *  it, from a button labelled "remove from organization", and there was no
 *  warning anywhere that it would.
 *
 *  So this removes the *identity*, not the *record*:
 *
 *    · live responsibilities — projects, deals, tasks, reporting lines — are
 *      handed to a named colleague;
 *    · rosters and pending invitations are revoked;
 *    · history keeps pointing at a retained membership row, so every foreign
 *      key still resolves and nothing is rewritten;
 *    · the auth user is deleted, which ends access and frees the email address
 *      for reuse.
 *
 *  ── Two calls, deliberately ───────────────────────────────────────────────
 *
 *  GET reports what deletion would touch. DELETE performs it. An administrator
 *  has to be able to see the impact before committing to something
 *  irreversible, and one endpoint that both reports and destroys cannot offer
 *  that.
 */

/** What deleting this account would affect, and what stands in the way. */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase.rpc('member_deletion_impact', {
    target_member: id,
  });
  if (e) return pgError(e);
  return success(data);
}

/**
 * Delete the account.
 *
 * `reassignTo` is a membership id in this organization. It is required
 * whenever the review reports live responsibilities — the database refuses
 * without it rather than trusting this handler to have asked.
 *
 * Ordering matters and is chosen for the failure case. The RPC frees the email
 * address and withdraws access *before* the auth user is removed, so if that
 * last step fails the account is left able to authenticate and able to do
 * nothing at all. The reverse order would leave a window in which the login was
 * gone but the membership still live.
 */
export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const reassignTo = new URL(req.url).searchParams.get('reassignTo');

  if (id === ctx.org.memberId) {
    return error(
      'You cannot delete your own account. Ask another administrator.',
      409, 'SELF_DELETION',
    );
  }

  /**
   * The service-role key is what removes the auth user, and there is no other
   * way to do it. Refusing up front is better than deleting the membership and
   * discovering afterwards that the login survives — a half-deleted account is
   * worse than one that was never started.
   */
  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch {
    return error(
      'Permanent deletion needs SUPABASE_SERVICE_ROLE_KEY on the server, because only the service role can remove a login. Terminate the membership instead, which withdraws all access.',
      501, 'ADMIN_KEY_MISSING',
    );
  }

  const { data, error: e } = await ctx.supabase.rpc('delete_member_account', {
    target_member: id,
    reassign_to: reassignTo || null,
  });
  if (e) return pgError(e);

  const result = (data ?? {}) as Record<string, any>;

  /**
   * Only when this was their last membership on the platform.
   *
   * Someone who also works for another tenant here loses access to *this*
   * organization and keeps their account. Deleting the login because one of
   * their employers ended the relationship would reach across a tenant
   * boundary, which is the exact class of mistake tenancy exists to prevent —
   * so the database decides this, not the caller.
   */
  let identityRemoved = false;
  let warning: string | undefined;

  if (result.authUserToDelete) {
    const { error: authErr } = await admin.auth.admin.deleteUser(result.authUserToDelete);
    if (authErr) {
      warning =
        `The account has been removed from this organization and can no longer sign in, but the underlying login could not be deleted (${authErr.message}). The email address will not be reusable until it is.`;
    } else {
      identityRemoved = true;
    }
  }

  return success({
    ...result,
    platformIdentityRemoved: identityRemoved,
    emailReusable: identityRemoved,
    warning,
  });
}
