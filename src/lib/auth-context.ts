import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { error } from '@/lib/api-response';
import type { ModuleId, RoleId } from '@/lib/constants';
import { normalizeRole, can, canAccessModule, type Action } from '@/lib/permissions';
import { currencyOf } from '@/lib/locale';

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
  /** True while the account still has the password an administrator issued. */
  mustChangePassword: boolean;
}

export interface OrgContext {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  /** The caller's membership row id — what business tables reference. */
  memberId: string;
  role: RoleId;
  departmentId: string | null;
  /**
   * The organization's presentation settings.
   *
   * Carried on every request context because money and dates are rendered in
   * every module, and each one reading them separately is how a workspace ends
   * up showing naira in Finance and dollars in CRM.
   */
  currency: string;
  locale: string;
  timezone: string;
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
    .select('id, email, first_name, last_name, full_name, avatar_url, job_title, force_password_change')
    .eq('id', user.id)
    .maybeSingle();

  // Memberships this user can see. RLS already restricts this to their own.
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('id, organization_id, role, department_id, organizations(id, name, slug, currency, timezone, settings)')
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
      mustChangePassword: profile?.force_password_change === true,
    },
    org: {
      organizationId: membership.organization_id,
      organizationName: organization?.name ?? '',
      organizationSlug: organization?.slug ?? '',
      memberId: membership.id,
      role: normalizeRole(membership.role),
      departmentId: membership.department_id ?? null,
      // Falls back to the platform default rather than to whatever the column
      // happens to hold, so an organization created before this existed still
      // renders consistently instead of half-formatted.
      currency: currencyOf(organization?.currency).code,
      locale: organization?.settings?.locale ?? currencyOf(organization?.currency).locale,
      timezone: organization?.timezone ?? 'UTC',
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

  /**
   * An account still holding the password an administrator typed for it can
   * sign in and do nothing else.
   *
   * Enforced here rather than by redirecting in the browser, because a
   * redirect is a suggestion: the session is perfectly valid, so every module
   * endpoint would answer normally to anyone who skipped the screen or called
   * the API directly. Putting it in `authorize()` means the rule holds for all
   * of them at once, and cannot be forgotten by a route added later.
   *
   * `/api/auth/change-password` is unaffected — it authenticates directly
   * rather than through `authorize()`, which is what leaves a way out.
   */
  if (ctx.user.mustChangePassword) {
    return error(
      'You must choose a new password before continuing.',
      403, 'PASSWORD_CHANGE_REQUIRED',
    );
  }

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
    case '23505': {
      // A raised business rule ("You have already checked in today") is far
      // more useful than a generic duplicate notice. Postgres' own constraint
      // messages start with "duplicate key value", so anything else came from
      // a RAISE in a function and should reach the user intact.
      const raised = e.message && !/duplicate key value|violates unique constraint/i.test(e.message);
      return error(raised ? e.message! : 'That record already exists.', 409, 'DUPLICATE');
    }
    case '23503':
      return error('A referenced record does not exist.', 400, 'FK_VIOLATION');
    case '23514':
      // Business-rule triggers raise check_violation with a written message,
      // so pass it through — it is the explanation the user needs.
      return error(e.message ?? 'That change is not allowed.', 409, 'RULE_VIOLATION');
    case '22P02': {
      /**
       * invalid_text_representation — a value that is not a member of the
       * target enum. A bad request rather than a server fault, so 422.
       *
       * Postgres says exactly what was wrong: `invalid input value for enum
       * lead_status: "wibble"`. The previous generic wording threw that away
       * and left users with an error naming neither the field nor the value,
       * so there was nothing to act on. The enum's name is close enough to the
       * field's to be useful once the type suffix is dropped.
       */
      const m = /invalid input value for enum (\w+):\s*"([^"]*)"/i.exec(e.message ?? '');
      if (m) {
        const field = m[1].replace(/_(status|type|stage|level|role)$/, ' $1').replace(/_/g, ' ');
        return error(
          `"${m[2]}" is not a valid ${field}.`,
          422, 'INVALID_FILTER_VALUE',
        );
      }
      return error(
        e.message ?? 'One of the values sent is not valid for this field.',
        422,
        'INVALID_FILTER_VALUE',
      );
    }
    case 'P0002':
      // no_data_found, raised by RPCs when the target row is absent — which
      // includes the cross-tenant case, where the row exists but not for this
      // caller. 404 rather than 500: nothing broke, the record is not theirs.
      return error(e.message ?? 'Not found', 404, 'NOT_FOUND');
    case 'P0001':
      // raise_exception without an explicit ERRCODE. Business rules written
      // this way carry their explanation in the message.
      return error(e.message ?? 'That operation is not allowed.', 409, 'RULE_VIOLATION');
    case 'PGRST116':
      return error('Not found', 404, 'NOT_FOUND');
    case 'PGRST202':
      // The function or its argument list does not exist — a deployment
      // mismatch between the app and the database, not a user error.
      return error(
        'This operation is unavailable: the database is missing a required function. Re-run the migrations.',
        500, 'SCHEMA_MISMATCH',
      );
    default:
      return error(e.message ?? 'Database error', 500, e.code);
  }
}
