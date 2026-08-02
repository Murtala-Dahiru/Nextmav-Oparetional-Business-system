import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { error } from '@/lib/api-response';
import type { ModuleId, RoleId } from '@/lib/constants';
import { normalizeRole, can, canAccessModule, type Action } from '@/lib/permissions';
import { currencyOf } from '@/lib/locale';
import { accessStateFor, describeState } from '@/lib/account-state';

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
    .select('id, email, first_name, last_name, full_name, avatar_url, job_title, force_password_change, is_active, auth_deleted_at')
    .eq('id', user.id)
    .maybeSingle();

  /**
   * The platform-level gate, checked before any membership is looked at.
   *
   * `profiles.is_active` existed from 0001 and nothing had ever read it, so a
   * disabled person was disabled in the schema and signed in everywhere else.
   * A tombstone reaches here only in the window between the profile being
   * marked and the auth user being deleted, and must resolve nothing.
   */
  if (profile && (profile.is_active === false || profile.auth_deleted_at)) return null;

  // Memberships this user can see. RLS already restricts this to their own.
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('id, organization_id, role, department_id, organizations(id, name, slug, currency, timezone, settings)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    // A permanently deleted membership is retained only so that history
    // resolves. It is never a way in, and `is_active` alone would already
    // exclude it — this is belt and braces on the one query that decides
    // whether somebody is in the building.
    .is('deleted_at', null);

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
 * Turn "no context" into the right refusal.
 *
 * `getContext()` returns null for four unrelated situations — no session, a
 * session whose account has been suspended, one whose employment has ended,
 * and one that has simply not joined anywhere yet — and every guard used to
 * answer all four with 401 UNAUTHENTICATED. That is wrong twice over: it tells
 * a suspended employee their credentials failed when they did not, and it
 * tells the client to bounce them to the login form, where they sign in
 * successfully and arrive back at the same 401.
 *
 * One extra round trip, on a path that has already decided to refuse.
 */
async function refuse(supabase: SupabaseClient): Promise<Response> {
  const access = await accessStateFor(supabase);
  const { code, message, status } = describeState(access.state);
  return error(message, status, code);
}

/**
 * Guard a route handler that needs a signed-in user but no particular module.
 *
 *     const ctx = await authenticate();
 *     if (ctx instanceof Response) return ctx;
 *
 * For endpoints whose subject is the *person* rather than a module: their own
 * notification tray, their own profile, their own to-do list. Those are not
 * module permissions and forcing them through one produces the wrong answer
 * in both directions — either a role is denied its own notifications because
 * it happens to lack `dashboard`, or a module grant is widened to let it read
 * something unrelated.
 *
 * Carries the same password-change gate as `authorize()`, so an account still
 * holding an administrator-issued password cannot use these either.
 */
export async function authenticate(
  opts: { organizationId?: string } = {},
): Promise<RequestContext | Response> {
  const ctx = await getContext(opts.organizationId);
  if (!ctx) return refuse(await supabaseServer());

  if (ctx.user.mustChangePassword) {
    return error(
      'You must choose a new password before continuing.',
      403, 'PASSWORD_CHANGE_REQUIRED',
    );
  }

  return ctx;
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
  if (!ctx) return refuse(await supabaseServer());

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
/**
 * Written explanations for the table constraints a user can actually trip.
 *
 * A check constraint raised by the schema (rather than by a trigger's RAISE)
 * carries only Postgres' own wording:
 *
 *     new row for relation "projects" violates check constraint
 *     "project_dates_valid"
 *
 * which names the rule but not what to do about it, and was being shown to the
 * user verbatim. The create routes each restate these checks in `prepare` to get
 * a readable message; the update routes have no `prepare`, so the constraint is
 * the only thing standing between a bad edit and the database — it should
 * explain itself as well as reject.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  project_dates_valid: 'A project cannot end before it starts.',
  task_hours_valid: 'Logged and estimated hours cannot be negative.',
  invoice_totals_valid: 'An invoice total cannot be negative.',
  leave_dates_valid: 'Leave cannot end before it starts.',
  event_times_valid: 'An event cannot end before it starts.',
  milestone_progress_valid: 'Milestone progress must be between 0 and 100.',
  allocation_pct_check: 'An allocation must be between 0 and 100 percent.',
};

function constraintMessage(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /violates check constraint "([^"]+)"/i.exec(raw);
  return m ? (CONSTRAINT_MESSAGES[m[1]] ?? null) : null;
}

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
      // so pass it through — it is the explanation the user needs. A schema
      // constraint has no written message, only its own name, so translate the
      // ones a user can reach and fall back to the raw text for the rest.
      return error(
        constraintMessage(e.message) ?? e.message ?? 'That change is not allowed.',
        409, 'RULE_VIOLATION',
      );
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
    case 'PGRST204':
      /**
       * A column named in the write does not exist on the table.
       *
       * Always a fault in the application, never in the request — the caller
       * cannot choose which columns a handler writes. It is mapped explicitly
       * because it used to reach the default branch and surface to the user as
       * a 500 reading "Could not find the 'clientCompanyId' column of
       * 'projects' in the schema cache", which is what editing a project did
       * before `acceptBody` stopped emitting camelCase aliases. Naming it as a
       * server fault keeps a recurrence out of the user's face and in the logs
       * where it belongs.
       */
      return error(
        'This operation could not be completed: the server sent a field the database does not have.',
        500, 'SCHEMA_MISMATCH',
      );
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
