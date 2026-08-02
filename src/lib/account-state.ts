import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Where an account stands with the platform, and what to say about it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Before this existed there were two answers — "has a session" and "resolves
 *  an organization" — and every state that was neither collapsed into the
 *  second one's `false`. That is how a terminated employee and a brand-new
 *  signup came to be the same case: both resolve no organization, so both were
 *  offered the create-a-workspace screen, and one of them took it.
 *
 *  The states are resolved in the database by `account_access_state()` so that
 *  the login endpoint, the request guards, the onboarding gate and the RPC
 *  itself cannot disagree. This module is the TypeScript side of that: the
 *  names, and the sentence each one shows a person.
 */

export const ACCOUNT_STATES = [
  'anonymous',
  'no_profile',
  'active',
  'suspended',
  'terminated',
  'removed',
  'disabled',
  'invited',
  'no_organization',
] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

export interface AccessState {
  state: AccountState;
  accountOrigin?: 'self_signup' | 'invited' | 'provisioned';
  activeMemberships: number;
  endedMemberships: number;
  pendingInvitations: number;
  mayCreateOrganization: boolean;
}

const EMPTY: AccessState = {
  state: 'anonymous',
  activeMemberships: 0,
  endedMemberships: 0,
  pendingInvitations: 0,
  mayCreateOrganization: false,
};

/**
 * States in which a valid session must not be allowed to do anything.
 *
 * `no_profile` is deliberately absent. It means provisioning failed, not that
 * access was withdrawn, and treating it as a revocation would tell someone
 * their account had been suspended when in fact a trigger did not fire.
 */
const BLOCKED = new Set<AccountState>(['suspended', 'terminated', 'removed', 'disabled']);

export function isBlocked(state: AccountState): boolean {
  return BLOCKED.has(state);
}

/**
 * What to tell the person, and what the client should do about it.
 *
 * The wording matters more here than almost anywhere else in the product: this
 * is the message someone reads when the thing they use for work stops letting
 * them in, and "Authentication required" on a password that plainly worked is
 * how a support ticket becomes an argument. Each one names who can fix it.
 */
export function describeState(state: AccountState): { code: string; message: string; status: 401 | 403 } {
  switch (state) {
    case 'suspended':
      return {
        code: 'ACCOUNT_SUSPENDED',
        status: 403,
        message:
          'Your access has been suspended. Your organization’s administrator can restore it.',
      };
    case 'terminated':
      return {
        code: 'ACCOUNT_TERMINATED',
        status: 403,
        message:
          'Your access to this workspace has ended. If you believe this is a mistake, contact your organization’s administrator.',
      };
    case 'removed':
      return {
        code: 'ACCOUNT_REMOVED',
        status: 403,
        message: 'This account has been permanently removed.',
      };
    case 'disabled':
      return {
        code: 'ACCOUNT_DISABLED',
        status: 403,
        message: 'This account has been disabled.',
      };
    case 'no_profile':
      return {
        code: 'PROFILE_MISSING',
        status: 403,
        message:
          'This account is signed in but has no profile. Sign out and in again; if it persists, contact support.',
      };
    default:
      return { code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required' };
  }
}

/**
 * Ask the database where this caller stands.
 *
 * Runs through the caller's own client — the function is SECURITY DEFINER but
 * reads `auth.uid()`, so it can only ever describe the person asking.
 */
export async function accessStateFor(supabase: SupabaseClient): Promise<AccessState> {
  const { data, error } = await supabase.rpc('account_access_state');
  if (error || !data) return EMPTY;

  const d = data as Record<string, unknown>;
  return {
    state: (d.state as AccountState) ?? 'anonymous',
    accountOrigin: d.accountOrigin as AccessState['accountOrigin'],
    activeMemberships: Number(d.activeMemberships ?? 0),
    endedMemberships: Number(d.endedMemberships ?? 0),
    pendingInvitations: Number(d.pendingInvitations ?? 0),
    mayCreateOrganization: d.mayCreateOrganization === true,
  };
}

/**
 * End every session this person holds, everywhere.
 *
 * ── Why this is not optional ──────────────────────────────────────────────
 *
 * Suspending a membership stops the *next* request resolving an organization.
 * It does nothing to the refresh token already in their browser, which
 * Supabase will keep renewing indefinitely — so the account remains
 * authenticated, and the only thing standing between it and the platform is
 * that every query happens to come back empty. That is a filter, not a
 * revocation, and it is the difference between "cannot see anything" and
 * "cannot sign in".
 *
 * Returns false when it could not be done, which the caller should say out
 * loud rather than swallow: an administrator who clicks Suspend and is told it
 * worked has a right to assume the person is out.
 */
export interface RevocationResult {
  revoked: boolean;
  warning?: string;
}

/**
 * End every session held by the person behind a membership.
 *
 * Takes a membership id rather than a user id because that is what the
 * administration and HR screens work in, and resolving it through the caller's
 * own client keeps the lookup inside their organization — an id from another
 * tenant finds nothing rather than signing a stranger out.
 */
export async function endMemberSessions(
  supabase: SupabaseClient,
  organizationId: string,
  memberId: string,
): Promise<RevocationResult> {
  const { data } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('id', memberId)
    .maybeSingle();

  if (!data?.user_id) return { revoked: false };

  return (await revokeAllSessions(data.user_id))
    ? { revoked: true }
    : {
        revoked: false,
        /**
         * Deliberately does not name a cause.
         *
         * This can be a missing service-role key or a failed call, and an
         * earlier draft asserted the first — so an administrator debugging the
         * second went looking for an environment variable that was set all
         * along. What they need to know is what is and is not true now.
         */
        warning:
          'Access has been withdrawn and every request from this account is refused. Any browser they are already signed in to could not be signed out, so a stale session may linger until it expires on its own. Check that SUPABASE_SERVICE_ROLE_KEY is set on the server.',
      };
}

export async function revokeAllSessions(userId: string): Promise<boolean> {
  try {
    const admin = supabaseAdmin();
    /**
     * `revoke_user_sessions()`, not `auth.admin.signOut()`.
     *
     * The latter reads as exactly the right call and is not: GoTrue's signOut
     * takes the *user's own JWT*, which a server suspending somebody else does
     * not have and should never need, and there is no admin
     * "log this user out" endpoint. Passing a user id fails — quietly, because
     * the membership change has already succeeded, so the administrator is
     * told the person is out while their browser carries on refreshing a
     * perfectly valid token.
     *
     * The RPC deletes the rows GoTrue itself would, and is granted to the
     * service role alone.
     */
    const { error } = await admin.rpc('revoke_user_sessions', { target_user: userId });
    return !error;
  } catch {
    // No service-role key configured. The membership change still holds and
    // every request is refused; the stale token simply stops being useful
    // rather than being torn up.
    return false;
  }
}
