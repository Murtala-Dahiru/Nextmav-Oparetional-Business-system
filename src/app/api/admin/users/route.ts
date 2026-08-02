import { isFilterValue } from '@/lib/filters';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { supabaseAdmin } from '@/lib/supabase/server';
import { acceptBody } from '@/lib/case';
import { ROLES } from '@/lib/constants';
import { hasScopeAtLeast } from '@/lib/permissions';
import { generateTemporaryPassword } from '@/lib/temp-password';

/** Mirrors the `employment_type` enum; checked here to give a written reason. */
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'temporary'];

/**
 * Organization members, for the administration screen.
 *
 * Reads v_org_directory so role, department and reporting line arrive
 * resolved.
 */
export async function GET(req: Request) {
  /**
   * Admins, or HR.
   *
   * The employee directory *is* the HR module's subject matter — profiles,
   * departments, employment type, reporting line. Guarding it on `admin`
   * alone meant `hr_staff`, whose entire job this is, received a 403 from the
   * screen built for them and saw an empty employee list.
   *
   * The fallback asks the capability model rather than testing the role
   * directly, so a future role granted organization-wide HR access inherits
   * this without anyone remembering to come back here. Writes below are
   * unchanged and remain admin-only: reading the directory and provisioning
   * accounts are different responsibilities.
   */
  let ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) {
    const hrCtx = await authorize('hr', 'view');
    if (hrCtx instanceof Response) return ctx;
    if (!hasScopeAtLeast(hrCtx.org.role, 'hr', 'organization')) return ctx;
    ctx = hrCtx;
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let q = ctx.supabase.from('v_org_directory').select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) q = q.or(['full_name','email','job_title'].map(c => c + '.ilike.%' + safe + '%').join(','));
  }
  // `status` joins the list in 0025: `is_active` cannot express the difference
  // between someone suspended and someone whose employment ended, so filtering
  // on it returned both under one heading on the screen that most needs them
  // apart.
  for (const k of ['role','department_id','is_active','status']) {
    const v = searchParams.get(k);
    if (isFilterValue(v)) q = q.eq(k, v === 'true' ? true : v === 'false' ? false : v);
  }

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await q.order('full_name').range(off, off + pageSize - 1);
  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Provision a member directly, without waiting for an invitation.
 *
 * Invitation remains the normal path — `POST /api/auth/invite` — and is what
 * an administrator should reach for: it lets the person set their own
 * password and proves they control the address. This exists for the cases
 * invitation cannot serve: onboarding staff who do not yet read company mail,
 * migrating an existing directory, or any deployment where outbound email is
 * not configured.
 *
 * The account and the membership are created together. A membership row whose
 * `user_id` has no auth user is an account nobody can sign into, and an auth
 * user with no membership is someone stuck on the onboarding screen; either
 * half alone is a support ticket.
 *
 * The temporary password is generated here and returned exactly once, in this
 * response. It is never stored by this application, never written to a log,
 * and cannot be read back afterwards — `GET` returns the directory, which has
 * no password column to expose. An administrator who loses it issues a new one
 * through `POST /api/admin/users/[id]/reset-password`; there is deliberately
 * no way to recover the original.
 *
 * The account is marked `force_password_change`, so it can sign in and do
 * nothing else until the employee has replaced the password themselves. That
 * check lives in `authorize()`, which every module route already calls.
 */
export async function POST(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch {
    return error(
      'Direct provisioning needs SUPABASE_SERVICE_ROLE_KEY on the server. ' +
        'Invite the person by email instead, which does not require it.',
      501, 'ADMIN_KEY_MISSING',
    );
  }

  let created: { id: string } | null = null;
  try {
    const b = acceptBody(await req.json());

    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      return error('A valid email address is required', 422, 'VALIDATION_ERROR');
    }

    const firstName = String(b.first_name ?? '').trim();
    const lastName = String(b.last_name ?? '').trim();
    if (!firstName || !lastName) {
      return error('First and last name are required', 422, 'VALIDATION_ERROR');
    }

    const role = b.role ?? 'employee';
    if (!ROLES.some(r => r.id === role)) {
      return error(`"${role}" is not a role in this system.`, 422, 'VALIDATION_ERROR');
    }

    if (b.employment_type && !EMPLOYMENT_TYPES.includes(b.employment_type)) {
      return error(
        `"${b.employment_type}" is not an employment type. Expected one of: ${EMPLOYMENT_TYPES.join(', ')}.`,
        422, 'VALIDATION_ERROR',
      );
    }

    // Someone already in this organization must be edited, not re-created —
    // a second membership would give them two roles and two directory rows.
    const { data: existingMember } = await ctx.supabase
      .from('v_org_directory').select('member_id')
      .eq('organization_id', ctx.org.organizationId).eq('email', email).maybeSingle();
    if (existingMember) {
      return error('That person is already a member of this organization.', 409, 'DUPLICATE');
    }

    /**
     * Department and manager are checked here rather than left to the foreign
     * key, for two reasons: the key would report 23503 without saying which of
     * the two was wrong, and neither is scoped to the organization by the
     * constraint alone — a department id belonging to another tenant would
     * otherwise be accepted and quietly attach this employee to it.
     */
    if (b.department_id) {
      const { data: dept } = await ctx.supabase
        .from('departments').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', b.department_id).maybeSingle();
      if (!dept) return error('That department does not exist in this organization.', 422, 'DEPARTMENT_NOT_FOUND');
    }
    if (b.manager_id) {
      const { data: mgr } = await ctx.supabase
        .from('organization_members').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', b.manager_id).maybeSingle();
      if (!mgr) return error('That manager is not a member of this organization.', 422, 'MANAGER_NOT_FOUND');
    }

    // The address may already have an account from another organization —
    // this platform is multi-tenant, so that is normal and they simply gain a
    // second membership rather than a second account.
    const { data: profile } = await admin
      .from('profiles').select('id').eq('email', email).maybeSingle();

    let userId = profile?.id ?? null;

    /**
     * Only a brand-new account gets a temporary password.
     *
     * When the address already has one — because they work for another tenant
     * on this platform — resetting it would hand an administrator here the
     * ability to take over an account in an organization they have nothing to
     * do with. They gain a membership; their existing password is untouched
     * and the response says so.
     */
    const isNewAccount = !userId;
    const temporaryPassword = isNewAccount ? generateTemporaryPassword() : null;

    if (!userId) {
      const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
        email,
        // Confirmed on creation: an administrator vouching for a colleague is
        // the proof here, and there is no inbox round trip to complete.
        email_confirm: true,
        password: temporaryPassword!,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          /**
           * Read by `handle_new_user()` into `profiles.account_origin`.
           *
           * A provisioned account exists because an employer created it. It has
           * no independent relationship with the platform, so when that
           * employer ends the relationship it is over — this is the value that
           * stops a terminated employee signing in with credentials that still
           * work and founding a workspace of their own.
           */
          account_origin: 'provisioned',
        },
      });
      if (authErr || !authUser?.user) {
        const msg = /already been registered|already exists/i.test(authErr?.message ?? '')
          ? 'That email address already belongs to an account on this platform.'
          : authErr?.message ?? 'Could not create the account';
        return error(msg, 400, 'AUTH_CREATE_FAILED');
      }
      userId = authUser.user.id;
      created = { id: userId };
    }

    /**
     * The profile is created by the `on_auth_user_created` trigger, so this
     * fills in the fields the trigger has no way to know — and sets the flag
     * that makes the temporary password temporary.
     *
     * Written with the service-role client because the subject of this row is
     * the new employee, not the administrator: the `profiles_update` policy
     * quite correctly only lets someone edit their own.
     */
    const profileFields: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
    };
    if (b.phone) profileFields.phone = String(b.phone).trim();
    if (b.job_title) profileFields.job_title = String(b.job_title).trim();
    if (isNewAccount) profileFields.force_password_change = true;

    const { error: profileErr } = await admin
      .from('profiles').update(profileFields).eq('id', userId);

    if (profileErr) {
      if (created) await admin.auth.admin.deleteUser(created.id).catch(() => {});
      return pgError(profileErr);
    }

    // Optional columns are omitted rather than sent as null. `employment_type`
    // is NOT NULL with a 'full_time' default, so an explicit null from a form
    // that simply did not ask the question fails the insert outright.
    const membership: Record<string, unknown> = {
      organization_id: ctx.org.organizationId,
      user_id: userId,
      role,
      is_active: true,
    };
    for (const k of ['department_id', 'manager_id', 'employee_number', 'employment_type', 'hired_on'] as const) {
      if (b[k]) membership[k] = b[k];
    }

    const { data: member, error: e } = await ctx.supabase
      .from('organization_members')
      .insert(membership)
      .select('*').single();

    if (e) {
      // Roll back the account so a failed membership does not strand an
      // orphaned login that the next attempt would then collide with.
      if (created) await admin.auth.admin.deleteUser(created.id).catch(() => {});
      return pgError(e);
    }

    return success(
      {
        member,
        /**
         * The only time this value exists outside the password hash.
         *
         * It is not persisted, not logged, and not retrievable: there is no
         * endpoint that can return it again, because there is nowhere to
         * return it from. The screen shows it once and the administrator
         * passes it on; if that is missed, the remedy is a new one.
         */
        temporaryPassword,
        mustChangePassword: isNewAccount,
        // Delivery is not wired up, so saying "we emailed them" would be a
        // lie. This tells the screen what actually has to happen.
        emailSent: false,
        nextStep: isNewAccount
          ? `Give ${email} this temporary password. They will be asked to choose their own the first time they sign in.`
          : `${email} already had an account on this platform and keeps their existing password. They now also belong to this organization.`,
      },
      undefined,
      201,
    );
  } catch (e: any) {
    if (created) await admin.auth.admin.deleteUser(created.id).catch(() => {});
    return serverError(e, 'Could not add the member');
  }
}
