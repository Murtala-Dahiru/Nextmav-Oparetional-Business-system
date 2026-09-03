import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { APPLICATION_STAGES, APPLICATION_STATUSES } from '@/lib/hr';

const SELECT =
  '*, candidate:candidates(*), ' +
  'opening:job_openings(id, title, reference, status, positions, department:departments(id, name), ' +
  'hiring_manager:organization_members!job_openings_hiring_manager_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)))';

type Params = { params: Promise<{ id: string }> };

/** One application, with everything the hiring conversation needs open. */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('job_applications').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  const application = data as any;

  const [interviews, movement, offers] = await Promise.all([
    ctx.supabase.from('interviews')
      .select(
        '*, participants:interview_participants(id, is_lead, member:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))), ' +
        'feedback:interview_feedback(id, member_id, recommendation, rating, strengths, concerns, notes, submitted_at, ' +
        'member:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)))',
      )
      .eq('application_id', id)
      .order('starts_at', { ascending: false }),

    ctx.supabase.from('application_stage_events')
      .select('*, member:organization_members(id, profiles!organization_members_user_id_fkey(full_name))')
      .eq('application_id', id)
      .order('created_at', { ascending: true }),

    /**
     * Offers, which RLS may well refuse.
     *
     * A hiring manager reading their own pipeline gets an empty array here, and
     * that is the design: the offer carries the money. The screen renders the
     * absence as "offers are managed by HR" rather than as "no offer", because
     * those are different facts and only HR can tell them apart.
     */
    ctx.supabase.from('job_offers')
      .select('*')
      .eq('application_id', id)
      .order('created_at', { ascending: false }),
  ]);

  return success({
    ...application,
    interviews: interviews.data ?? [],
    movement: movement.data ?? [],
    offers: offers.data ?? [],
    /* Whether the caller is allowed offers at all, so the screen can say which
       of the two kinds of empty this is. */
    canSeeOffers: !offers.error,
  });
}

/**
 * Move an application, or end it.
 *
 * `stage` and `status` are separate columns and separate decisions: moving to
 * interview is a stage, turning somebody down is a status, and the database
 * refuses the combination that would let a funnel chart disagree with the list
 * beneath it. Both are recorded in `application_stage_events` by trigger.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('stage' in b) {
      const stage = String(b.stage);
      if (!(APPLICATION_STAGES as readonly string[]).includes(stage)) {
        return error(`Stage must be one of: ${APPLICATION_STAGES.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      if (stage === 'hired') {
        return error(
          'Hiring is completed through the hire endpoint, which creates the account and closes the pipeline.',
          422, 'USE_HIRE_ENDPOINT',
        );
      }
      update.stage = stage;
    }

    if ('status' in b) {
      const status = String(b.status);
      if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) {
        return error(`Status must be one of: ${APPLICATION_STATUSES.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      if (status === 'hired') {
        return error(
          'Hiring is completed through the hire endpoint, which creates the account and closes the pipeline.',
          422, 'USE_HIRE_ENDPOINT',
        );
      }
      update.status = status;

      /* A rejection with no reason is not a record, and it is the field the
         next person reading this pipeline actually needs. */
      if (status === 'rejected' && !String(b.outcome_reason ?? '').trim()) {
        return error('Say why the application was turned down.', 422, 'REASON_REQUIRED');
      }
    }

    for (const k of ['outcome_reason', 'notes']) {
      if (k in b) update[k] = b[k] ?? '';
    }

    if ('rating' in b) {
      const rating = b.rating === null || b.rating === '' ? null : Number(b.rating);
      if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        return error('A rating is one to five.', 422, 'VALIDATION_ERROR');
      }
      update.rating = rating;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('job_applications').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { error: e } = await ctx.supabase
    .from('job_applications').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
