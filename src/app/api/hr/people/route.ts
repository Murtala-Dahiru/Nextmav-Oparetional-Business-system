import { authorize, pgError } from '@/lib/auth-context';
import { paginated } from '@/lib/api-response';
import { isFilterValue } from '@/lib/filters';

/**
 * The People directory.
 *
 * `v_hr_people` rather than `v_org_directory`: same person, but with the
 * membership's own job title, the lifecycle stage, probation, work location
 * and tenure - the facts a People screen is about and the account-oriented
 * directory has never carried. The view is `security_invoker`, so an employee
 * calling this sees themselves, a manager their department, HR everyone,
 * without this handler restating the rule.
 *
 * There is no POST. Employees are not created here - they are invited or
 * provisioned through `/api/admin/users`, which is the only path that can make
 * an auth account, and a membership without one is a row nobody can sign in
 * as. Hiring a candidate goes through
 * `/api/hr/recruitment/applications/[id]/hire`, which uses that same path.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize')) || 25));

  let q = ctx.supabase
    .from('v_hr_people')
    .select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const search = searchParams.get('search')?.trim();
  if (search) {
    /* PostgREST's `or` is comma-separated and parenthesised, so those
       characters in a search term terminate the filter early and the query
       silently matches something else. */
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) {
      q = q.or(
        ['full_name', 'email', 'job_title', 'department_name', 'employee_number']
          .map(c => `${c}.ilike.%${safe}%`)
          .join(','),
      );
    }
  }

  for (const key of ['department_id', 'role', 'employment_type', 'lifecycle_stage', 'manager_id']) {
    const v = searchParams.get(key);
    if (isFilterValue(v)) q = q.eq(key, v);
  }

  /**
   * Active by default.
   *
   * A People screen that opens on every membership the organisation has ever
   * had - including the nineteen terminated ones in the demo workspace - is
   * answering a question nobody asked. `?include=all` is how you ask it.
   */
  const include = searchParams.get('include');
  if (include !== 'all') {
    if (include === 'former') q = q.eq('lifecycle_stage', 'former');
    else q = q.neq('lifecycle_stage', 'former');
  }

  const sort = searchParams.get('sort');
  const SORTABLE = new Set([
    'full_name', 'hired_on', 'department_name', 'job_title',
    'lifecycle_stage', 'tenure_months', 'employee_number',
  ]);
  const column = sort && SORTABLE.has(sort) ? sort : 'full_name';
  const ascending = searchParams.get('sortDir') !== 'desc';

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order(column, { ascending, nullsFirst: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}
