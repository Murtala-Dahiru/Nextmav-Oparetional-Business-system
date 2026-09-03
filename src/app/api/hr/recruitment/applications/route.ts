import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { APPLICATION_STAGES } from '@/lib/hr';

const SELECT =
  '*, candidate:candidates(id, full_name, email, phone, headline, source, location, resume_file_id), ' +
  'opening:job_openings(id, title, reference, status, department:departments(id, name)), ' +
  'interviews(id, kind, starts_at, ends_at, status)';

/**
 * Applications - one candidate against one opening.
 *
 * Filtered by `job_applications_select`, which resolves through
 * `involved_in_opening()`: HR sees every pipeline, a hiring manager sees the
 * ones they own, an interviewer sees the ones they are sitting on. That last
 * case is why the policy is a function rather than a role list - somebody on a
 * panel needs the candidate in front of them and has no other standing.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize')) || 100));

  let q = ctx.supabase
    .from('job_applications')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  for (const [param, column] of [
    ['openingId', 'opening_id'],
    ['candidateId', 'candidate_id'],
    ['stage', 'stage'],
    ['status', 'status'],
  ] as const) {
    const v = searchParams.get(param);
    if (isFilterValue(v)) q = q.eq(column, v);
  }

  if (searchParams.get('include') !== 'all' && !isFilterValue(searchParams.get('status'))) {
    q = q.eq('status', 'active');
  }

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('updated_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Put a candidate into a pipeline.
 *
 * Both halves already exist by the time this is called - the opening and the
 * person - which is what makes the unique constraint on (opening, candidate)
 * the right error to translate rather than to prevent: adding somebody twice
 * is a mistake with an obvious message, not a state to model.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.opening_id || !b.candidate_id) {
      return error('An opening and a candidate are required', 422, 'VALIDATION_ERROR');
    }

    const stage = String(b.stage ?? 'applied');
    if (!(APPLICATION_STAGES as readonly string[]).includes(stage) || stage === 'hired') {
      return error(
        'An application starts at a pipeline stage; `hired` is reached by completing a hire.',
        422, 'VALIDATION_ERROR',
      );
    }

    const { data: existing } = await ctx.supabase
      .from('job_applications').select('id')
      .eq('opening_id', b.opening_id).eq('candidate_id', b.candidate_id)
      .maybeSingle();

    if (existing) {
      return error('That candidate is already in this pipeline.', 409, 'ALREADY_APPLIED');
    }

    const { data, error: e } = await ctx.supabase
      .from('job_applications')
      .insert({
        organization_id: ctx.org.organizationId,
        opening_id: b.opening_id,
        candidate_id: b.candidate_id,
        stage,
        applied_on: b.applied_on || undefined,
        notes: b.notes ?? '',
        created_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the application');
  }
}
