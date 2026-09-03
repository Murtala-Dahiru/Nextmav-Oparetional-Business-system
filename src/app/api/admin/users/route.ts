import { isFilterValue } from '@/lib/filters';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { hasScopeAtLeast } from '@/lib/permissions';
import { provisionMember } from '@/lib/provisioning';

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

  try {
    const b = acceptBody(await req.json());

    /**
     * The work itself lives in `lib/provisioning`.
     *
     * It moved there when completing a hire needed exactly the same hundred
     * and fifty lines - the account, the profile written as service role, the
     * membership, and the rollback if the last of those fails. Two copies of
     * that would have differed within a month, and the difference would have
     * been a stranded login nobody could sign in as.
     */
    const result = await provisionMember(ctx.supabase, ctx.org.organizationId, {
      email: String(b.email ?? ''),
      firstName: String(b.first_name ?? ''),
      lastName: String(b.last_name ?? ''),
      role: b.role ?? 'employee',
      phone: b.phone ?? null,
      jobTitle: b.job_title ?? null,
      departmentId: b.department_id ?? null,
      managerId: b.manager_id ?? null,
      employeeNumber: b.employee_number ?? null,
      employmentType: b.employment_type ?? null,
      hiredOn: b.hired_on ?? null,
      probationEndsOn: b.probation_ends_on ?? null,
      workLocation: b.work_location ?? null,
    });

    if (!result.ok) return error(result.message, result.status, result.code);

    const { ok: _ok, ...payload } = result;
    return success(payload, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the member');
  }
}
