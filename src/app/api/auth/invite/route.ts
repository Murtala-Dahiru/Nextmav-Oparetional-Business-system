import { NextRequest } from 'next/server';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Invite someone to the organization.
 *
 * Delegates to invite_to_organization(), which checks the caller is an admin,
 * refuses addresses that already belong to a member, and refreshes an existing
 * pending invitation rather than accumulating duplicates — issuing a new token
 * so any previously sent link stops working.
 *
 * Sending the email is the application's job; the database issues the
 * credential. The token is returned so the caller can build the link.
 */
export async function POST(request: NextRequest) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  /**
   * Authenticated and privileged, and limited anyway.
   *
   * Being an administrator is authority over this organization, not a budget
   * for outbound mail from the platform's shared sending quota. The two cases
   * this bounds are a compromised administrator account used to mail-bomb a
   * list of addresses, and — far more likely — an honest integration looping
   * over a spreadsheet with a bug in it.
   */
  const limited = await enforceRateLimit(request, RATE_LIMITS.invitation, ctx.user.id);
  if (limited) return limited;

  try {
    const b = (acceptBody(await request.json())) ?? {};
    if (!b.email || typeof b.email !== 'string' || !b.email.includes('@')) {
      return error('A valid email address is required', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase.rpc('invite_to_organization', {
      org: ctx.org.organizationId,
      invite_email: b.email.trim().toLowerCase(),
      invite_role: b.role ?? 'employee',
      invite_department: b.department_id || null,
      invite_message: b.message ?? null,
    });

    if (e) return pgError(e);

    const invitation = Array.isArray(data) ? data[0] : data;
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

    return success({
      invitation,
      inviteUrl: origin + '/accept-invite?token=' + invitation.token,
      // Delivery is not wired up yet; surfacing the link means the workflow is
      // usable now rather than silently doing nothing.
      emailSent: false,
    }, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Could not create the invitation', 500);
  }
}
