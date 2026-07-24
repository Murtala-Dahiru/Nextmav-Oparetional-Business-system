import { NextRequest } from 'next/server';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

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

  try {
    const b = (await request.json()) ?? {};
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
