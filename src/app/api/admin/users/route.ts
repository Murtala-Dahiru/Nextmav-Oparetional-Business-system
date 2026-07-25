import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { supabaseAdmin } from '@/lib/supabase/server';
import { acceptBody } from '@/lib/case';
import { ROLES } from '@/lib/constants';

/**
 * Organization members, for the administration screen.
 *
 * Reads v_org_directory so role, department and reporting line arrive
 * resolved.
 */
export async function GET(req: Request) {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

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
  for (const k of ['role','department_id','is_active']) {
    const v = searchParams.get(k);
    if (v) q = q.eq(k, v === 'true' ? true : v === 'false' ? false : v);
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
 * No password is set to anything guessable. The account is created with a
 * random secret nobody records, so the only way in is the password-reset link
 * the administrator is told to trigger — which is also what proves the address
 * belongs to the new member. The previous screen sent `password: 'changeme'`
 * from the browser for every employee it created.
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

    const role = b.role ?? 'employee';
    if (!ROLES.some(r => r.id === role)) {
      return error(`"${role}" is not a role in this system.`, 422, 'VALIDATION_ERROR');
    }

    // Someone already in this organization must be edited, not re-created —
    // a second membership would give them two roles and two directory rows.
    const { data: existingMember } = await ctx.supabase
      .from('v_org_directory').select('member_id')
      .eq('organization_id', ctx.org.organizationId).eq('email', email).maybeSingle();
    if (existingMember) {
      return error('That person is already a member of this organization.', 409, 'DUPLICATE');
    }

    // The address may already have an account from another organization —
    // this platform is multi-tenant, so that is normal and they simply gain a
    // second membership rather than a second account.
    const { data: profile } = await admin
      .from('profiles').select('id').eq('email', email).maybeSingle();

    let userId = profile?.id ?? null;

    if (!userId) {
      const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        // Never returned, never logged, never reused: the reset link is the
        // only route in.
        password: crypto.randomUUID() + crypto.randomUUID(),
        user_metadata: { first_name: b.first_name ?? '', last_name: b.last_name ?? '' },
      });
      if (authErr || !authUser?.user) {
        return error(authErr?.message ?? 'Could not create the account', 400, 'AUTH_CREATE_FAILED');
      }
      userId = authUser.user.id;
      created = { id: userId };
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
        // The screen needs to tell the administrator what happens next, and
        // "we emailed them" would be a lie: nothing is sent from here.
        passwordSet: false,
        nextStep: `${email} has no password yet. Ask them to use "Forgot password" on the sign-in page to set one.`,
      },
      undefined,
      201,
    );
  } catch (e: any) {
    if (created) await admin.auth.admin.deleteUser(created.id).catch(() => {});
    return error(e.message || 'Could not add the member', 500);
  }
}
