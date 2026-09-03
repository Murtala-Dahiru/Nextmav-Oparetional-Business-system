import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/server';
import { ROLES } from '@/lib/constants';
import { generateTemporaryPassword } from '@/lib/temp-password';
import { EMPLOYMENT_TYPES } from '@/lib/hr';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Creating an employee: the one implementation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lifted out of `/api/admin/users` unchanged, because a second caller
 * appeared: completing a hire has to produce a colleague, and the alternative
 * was a hundred and fifty lines of account creation copied into the
 * recruitment endpoint.
 *
 * That copy would have been the expensive kind. Every subtlety below is one
 * somebody had to find:
 *
 *   · An address that already has an account on this platform gains a
 *     *membership*, not a second account, and its password is not touched -
 *     otherwise an administrator here could take over an account belonging to
 *     another tenant.
 *   · The profile is written with the service-role client, because
 *     `profiles_update` is `id = auth.uid()` and the subject is the new
 *     employee rather than the person creating them.
 *   · `account_origin: 'provisioned'` is read by `handle_new_user()`, and is
 *     what stops a terminated employee signing in with credentials that still
 *     work and founding a workspace of their own.
 *   · A failed membership insert rolls the auth account back, so a half-made
 *     employee does not strand a login the next attempt collides with.
 *
 * A duplicate would have got three of those four right and nobody would have
 * noticed which one was missing.
 *
 * The caller decides *who may do this*. `/api/admin/users` asks for
 * `admin.manage`; the hire endpoint asks for `hr.manage`, because creating the
 * colleague you just hired is HR's job and granting HR the whole
 * administration module to do it would be far wider.
 */

export interface ProvisionRequest {
  email: string;
  firstName: string;
  lastName: string;
  role?: string;
  phone?: string | null;
  jobTitle?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
  employeeNumber?: string | null;
  employmentType?: string | null;
  hiredOn?: string | null;
  /** Where the new membership starts. Hiring begins at `onboarding`. */
  lifecycleStage?: string | null;
  probationEndsOn?: string | null;
  workLocation?: string | null;
}

export interface ProvisionFailure {
  ok: false;
  message: string;
  status: number;
  code: string;
}

export interface ProvisionSuccess {
  ok: true;
  member: Record<string, any>;
  temporaryPassword: string | null;
  mustChangePassword: boolean;
  emailSent: false;
  nextStep: string;
}

export type ProvisionResult = ProvisionSuccess | ProvisionFailure;

const fail = (message: string, status: number, code: string): ProvisionFailure =>
  ({ ok: false, message, status, code });

/**
 * Create (or attach) an account and give it a membership in this organisation.
 *
 * `db` is the caller's own client, so the membership insert is still subject to
 * RLS and to the last-owner trigger. Only the two operations that genuinely
 * cannot be done as the caller - creating an auth user, and writing somebody
 * else's profile - use the service-role client.
 */
export async function provisionMember(
  db: SupabaseClient,
  organizationId: string,
  input: ProvisionRequest,
): Promise<ProvisionResult> {
  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch {
    return fail(
      'Direct provisioning needs SUPABASE_SERVICE_ROLE_KEY on the server. ' +
        'Invite the person by email instead, which does not require it.',
      501, 'ADMIN_KEY_MISSING',
    );
  }

  const email = (input.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return fail('A valid email address is required', 422, 'VALIDATION_ERROR');
  }

  const firstName = (input.firstName ?? '').trim();
  const lastName = (input.lastName ?? '').trim();
  if (!firstName || !lastName) {
    return fail('First and last name are required', 422, 'VALIDATION_ERROR');
  }

  const role = input.role ?? 'employee';
  if (!ROLES.some(r => r.id === role)) {
    return fail(`"${role}" is not a role in this system.`, 422, 'VALIDATION_ERROR');
  }

  if (input.employmentType && !(EMPLOYMENT_TYPES as readonly string[]).includes(input.employmentType)) {
    return fail(
      `"${input.employmentType}" is not an employment type. Expected one of: ${EMPLOYMENT_TYPES.join(', ')}.`,
      422, 'VALIDATION_ERROR',
    );
  }

  const { data: existingMember } = await db
    .from('v_org_directory').select('member_id')
    .eq('organization_id', organizationId).eq('email', email).maybeSingle();
  if (existingMember) {
    return fail('That person is already a member of this organization.', 409, 'DUPLICATE');
  }

  /**
   * Department and manager are checked here rather than left to the foreign
   * key: the key reports 23503 without saying which of the two was wrong, and
   * neither is scoped to the organisation by the constraint alone - an id
   * belonging to another tenant would otherwise be accepted.
   */
  if (input.departmentId) {
    const { data: dept } = await db
      .from('departments').select('id')
      .eq('organization_id', organizationId).eq('id', input.departmentId).maybeSingle();
    if (!dept) return fail('That department does not exist in this organization.', 422, 'DEPARTMENT_NOT_FOUND');
  }
  if (input.managerId) {
    const { data: mgr } = await db
      .from('organization_members').select('id')
      .eq('organization_id', organizationId).eq('id', input.managerId).maybeSingle();
    if (!mgr) return fail('That manager is not a member of this organization.', 422, 'MANAGER_NOT_FOUND');
  }

  const { data: profile } = await admin
    .from('profiles').select('id').eq('email', email).maybeSingle();

  let userId = profile?.id ?? null;
  const isNewAccount = !userId;
  const temporaryPassword = isNewAccount ? generateTemporaryPassword() : null;
  let created: { id: string } | null = null;

  if (!userId) {
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: temporaryPassword!,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        account_origin: 'provisioned',
      },
    });
    if (authErr || !authUser?.user) {
      const msg = /already been registered|already exists/i.test(authErr?.message ?? '')
        ? 'That email address already belongs to an account on this platform.'
        : authErr?.message ?? 'Could not create the account';
      return fail(msg, 400, 'AUTH_CREATE_FAILED');
    }
    userId = authUser.user.id;
    created = { id: userId };
  }

  const profileFields: Record<string, unknown> = { first_name: firstName, last_name: lastName };
  if (input.phone) profileFields.phone = String(input.phone).trim();
  if (input.jobTitle) profileFields.job_title = String(input.jobTitle).trim();
  if (isNewAccount) profileFields.force_password_change = true;

  const { error: profileErr } = await admin
    .from('profiles').update(profileFields).eq('id', userId);

  if (profileErr) {
    if (created) await admin.auth.admin.deleteUser(created.id).catch(() => {});
    return fail(profileErr.message, 400, 'PROFILE_UPDATE_FAILED');
  }

  /**
   * Optional columns are omitted rather than sent as null. `employment_type`
   * is NOT NULL with a default, so an explicit null from a form that simply
   * did not ask the question fails the insert outright.
   */
  const membership: Record<string, unknown> = {
    organization_id: organizationId,
    user_id: userId,
    role,
    is_active: true,
  };
  const optional: Array<[string, unknown]> = [
    ['department_id', input.departmentId],
    ['manager_id', input.managerId],
    ['employee_number', input.employeeNumber],
    ['employment_type', input.employmentType],
    ['hired_on', input.hiredOn],
    ['job_title', input.jobTitle],
    ['lifecycle_stage', input.lifecycleStage],
    ['probation_ends_on', input.probationEndsOn],
    ['work_location', input.workLocation],
  ];
  for (const [k, v] of optional) if (v) membership[k] = v;

  const { data: member, error: e } = await db
    .from('organization_members')
    .insert(membership)
    .select('*').single();

  if (e) {
    if (created) await admin.auth.admin.deleteUser(created.id).catch(() => {});
    return fail(e.message, 400, e.code ?? 'MEMBERSHIP_FAILED');
  }

  return {
    ok: true,
    member: member as Record<string, any>,
    /**
     * The only time this value exists outside the password hash. It is not
     * persisted, not logged and not retrievable: there is no endpoint that can
     * return it again, because there is nowhere to return it from.
     */
    temporaryPassword,
    mustChangePassword: isNewAccount,
    /* Delivery is not wired up, so saying "we emailed them" would be a lie. */
    emailSent: false,
    nextStep: isNewAccount
      ? `Give ${email} this temporary password. They will be asked to choose their own the first time they sign in.`
      : `${email} already had an account on this platform and keeps their existing password. They now also belong to this organization.`,
  };
}
