import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { error } from '@/lib/api-response';
import type { ModuleId, RoleId } from '@/lib/constants';
import { normalizeRole, can, canAccessModule, type Action } from '@/lib/permissions';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Request context: who is calling, and for which organization.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Two layers of enforcement, deliberately:
 *
 *   1. RLS in the database. The client here carries the user's JWT, so every
 *      query is filtered by policy. This is the layer that actually protects
 *      the data — it holds even if a route handler is wrong.
 *
 *   2. `authorize()` below. Checks the capability model before the query runs,
 *      so a forbidden action returns a clear 403 instead of an empty list.
 *      RLS alone cannot distinguish "no rows" from "not allowed", and that
 *      distinction is the difference between a usable error and a mystery.
 *
 *  Layer 2 is for the user experience. Layer 1 is the security boundary.
 *  Never rely on layer 2 alone.
 */

export interface ActingUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
}

export interface OrgContext {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  /** The caller's membership row id — what business tables reference. */
  memberId: string;
  role: RoleId;
  departmentId: string | null;
}

export interface RequestContext {
  supabase: SupabaseClient;
  user: ActingUser;
  org: OrgContext;
}

/**
 * Resolve the signed-in user and their active organization.
 *
 * Returns null when unauthenticated, or when the user has a session but
 * belongs to no organization — which happens between signing up and either
 * creating an organization or accepting an invitation.
 */
export async function getContext(
  preferredOrgId?: string,
): Promise<RequestContext | null> {
  const supabase = await supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // The profile row is created by a trigger on auth.users; its absence means
  // provisioning failed rather than that the user is unauthenticated.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, full_name, avatar_url, job_title')
    .eq('id', user.id)
    .maybeSingle();

  // Memberships this user can see. RLS already restricts this to their own.
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('id, organization_id, role, department_id, organizations(id, name, slug)')
    .eq('user_id', user.id)
    .eq('is_active', true);

  if (!memberships?.length) return null;

  // Honour the requested organization when the caller genuinely belongs to it;
  // otherwise fall back to the first. Never trust the parameter on its own —
  // that would be a tenant-selection bypass.
  const membership =
    (preferredOrgId && memberships.find(m => m.organization_id === preferredOrgId)) ||
    memberships[0];

  const orgRel = membership.organizations as any;
  const organization = Array.isArray(orgRel) ? orgRel[0] : orgRel;

  return {
    supabase,
    user: {
      id: user.id,
      email: profile?.email ?? user.email ?? '',
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      fullName: profile?.full_name ?? '',
      avatarUrl: profile?.avatar_url ?? null,
      jobTitle: profile?.job_title ?? null,
    },
    org: {
      organizationId: membership.organization_id,
      organizationName: organization?.name ?? '',
      organizationSlug: organization?.slug ?? '',
      memberId: membership.id,
      role: normalizeRole(membership.role),
      departmentId: membership.department_id ?? null,
    },
  };
}

/**
 * Guard a route handler.
 *
 *     const ctx = await authorize('finance', 'create');
 *     if (ctx instanceof Response) return ctx;
 *     const { supabase, org } = ctx;
 *
 * 401 means "no session or no organization"; 403 means "signed in, but not
 * permitted". Clients need that distinction to choose between redirecting to
 * login and showing a permission message.
 */
export async function authorize(
  module: ModuleId,
  action: Action = 'view',
  opts: { organizationId?: string } = {},
): Promise<RequestContext | Response> {
  const ctx = await getContext(opts.organizationId);
  if (!ctx) return error('Authentication required', 401, 'UNAUTHENTICATED');

  const { role } = ctx.org;

  if (!canAccessModule(role, module)) {
    return error(
      `Your role (${role}) does not have access to ${module}.`,
      403,
      'FORBIDDEN_MODULE',
    );
  }
  if (!can(role, module, action)) {
    return error(
      `Your role (${role}) cannot ${action} in ${module}.`,
      403,
      'FORBIDDEN_ACTION',
    );
  }

  return ctx;
}

/**
 * Translate a PostgREST error into an HTTP response.
 *
 * RLS rejections surface as 42501 (insufficient privilege) or as an empty
 * result. Mapping them to 403 rather than 500 keeps "you may not do this"
 * distinguishable from "something broke".
 */
export function pgError(e: { code?: string; message?: string; details?: string } | null) {
  if (!e) return error('Unknown database error', 500);

  switch (e.code) {
    case '42501':
      return error('You do not have permission to perform this action.', 403, 'RLS_DENIED');
    case '23505':
      return error('That record already exists.', 409, 'DUPLICATE');
    case '23503':
      return error('A referenced record does not exist.', 400, 'FK_VIOLATION');
    case '23514':
      // Business-rule triggers raise check_violation with a written message,
      // so pass it through — it is the explanation the user needs.
      return error(e.message ?? 'That change is not allowed.', 409, 'RULE_VIOLATION');
    case 'PGRST116':
      return error('Not found', 404, 'NOT_FOUND');
    default:
      return error(e.message ?? 'Database error', 500, e.code);
  }
}
