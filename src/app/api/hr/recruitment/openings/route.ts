import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { OPENING_STATUSES, WORK_MODES, EMPLOYMENT_TYPES } from '@/lib/hr';

const SELECT =
  '*, department:departments(id, name), ' +
  'hiring_manager:organization_members!job_openings_hiring_manager_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'recruiter:organization_members!job_openings_recruiter_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/**
 * Job openings.
 *
 * Visibility is `job_openings_select`: HR and administrators see every
 * opening, a hiring manager or recruiter sees their own. An ordinary employee
 * sees none, and gets an empty list rather than a 403 - the module is
 * self-service for attendance and leave, and refusing the whole endpoint would
 * mean the People screen could not load beside it.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));

  let q = ctx.supabase
    .from('job_openings')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const status = searchParams.get('status');
  if (isFilterValue(status)) q = q.eq('status', status);
  const department = searchParams.get('departmentId');
  if (isFilterValue(department)) q = q.eq('department_id', department);

  /* The default list is the work in progress. Closed and filled openings are
     history and are asked for by name. */
  if (searchParams.get('include') !== 'all' && !isFilterValue(status)) {
    q = q.in('status', ['draft', 'open', 'on_hold']);
  }

  const search = searchParams.get('search')?.trim().replace(/[,()*]/g, ' ').trim();
  if (search) q = q.or(`title.ilike.%${search}%,reference.ilike.%${search}%`);

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);

  /**
   * Pipeline counts, in one grouped read rather than one per opening.
   *
   * The list draws "12 candidates, 3 at interview" on every row. Fetching that
   * per row is N+1; fetching every application and counting here is one query
   * whose rows RLS has already filtered to the openings above.
   */
  const ids = (data ?? []).map((o: any) => o.id);
  let counts: Record<string, { total: number; active: number; hired: number }> = {};

  if (ids.length) {
    const { data: apps } = await ctx.supabase
      .from('job_applications')
      .select('opening_id, status')
      .in('opening_id', ids);

    for (const a of apps ?? []) {
      const c = (counts[a.opening_id] ??= { total: 0, active: 0, hired: 0 });
      c.total++;
      if (a.status === 'active') c.active++;
      if (a.status === 'hired') c.hired++;
    }
  }

  return paginated(
    (data ?? []).map((o: any) => ({
      ...o,
      pipeline: counts[o.id] ?? { total: 0, active: 0, hired: 0 },
    })),
    count ?? 0, page, pageSize,
  );
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const title = String(b.title ?? '').trim();
    if (!title) return error('A job title is required', 422, 'VALIDATION_ERROR');

    const status = String(b.status ?? 'draft');
    if (!(OPENING_STATUSES as readonly string[]).includes(status)) {
      return error(`Status must be one of: ${OPENING_STATUSES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const workMode = String(b.work_mode ?? 'onsite');
    if (!(WORK_MODES as readonly string[]).includes(workMode)) {
      return error(`Work mode must be one of: ${WORK_MODES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const employmentType = String(b.employment_type ?? 'full_time');
    if (!(EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)) {
      return error(`Employment type must be one of: ${EMPLOYMENT_TYPES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const positions = Number(b.positions ?? 1);
    if (!Number.isInteger(positions) || positions < 1) {
      return error('An opening must advertise at least one position.', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('job_openings')
      .insert({
        organization_id: ctx.org.organizationId,
        title,
        department_id: b.department_id || null,
        /* Defaulting the hiring manager to the creator, because an opening
           nobody owns is one whose applications nobody can see. */
        hiring_manager_id: b.hiring_manager_id || ctx.org.memberId,
        recruiter_id: b.recruiter_id || null,
        employment_type: employmentType,
        work_mode: workMode,
        location: b.location ?? '',
        positions,
        description: b.description ?? '',
        requirements: b.requirements ?? '',
        status,
        target_start_on: b.target_start_on || null,
        created_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not create the opening');
  }
}
