import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * The employee directory.
 *
 * Reads `v_org_directory`, which resolves the membership, profile, department
 * and reporting line in one query. The view is `security_invoker`, so it is
 * subject to the caller's RLS exactly as the underlying tables are.
 *
 * There is no POST here: employees are not created, they are *invited*.
 * A row in this table without a corresponding auth user is an account nobody
 * can sign into. Use /api/admin/invitations.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let q = ctx.supabase
    .from('v_org_directory')
    .select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) {
      q = q.or(
        ['full_name', 'email', 'job_title', 'department_name']
          .map(c => `${c}.ilike.%${safe}%`)
          .join(','),
      );
    }
  }

  for (const key of ['department_id', 'role', 'is_active', 'employment_type']) {
    const v = searchParams.get(key);
    if (v !== null && v !== '') {
      q = q.eq(key, v === 'true' ? true : v === 'false' ? false : v);
    }
  }

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('full_name', { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Update employment details on a membership.
 *
 * Changing someone's role or department is an administrative act, so this
 * requires `manage` rather than `edit`. Profile fields (name, avatar, phone)
 * belong to the person and are changed through their own profile, not here.
 */
export async function PATCH(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    if (!b.member_id) return error('member_id is required', 422, 'VALIDATION_ERROR');

    const update: Record<string, any> = {};
    for (const k of [
      'role', 'department_id', 'manager_id', 'employee_number',
      'employment_type', 'hired_on', 'is_active',
    ]) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('organization_members')
      .update(update)
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', b.member_id)
      .select('id, role, department_id, manager_id, employment_type, hired_on, is_active')
      .maybeSingle();

    // The last-owner trigger raises check_violation here when someone tries to
    // demote or deactivate the only owner. pgError passes its message through.
    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}
