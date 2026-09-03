import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { HIRE_RECOMMENDATIONS } from '@/lib/hr';

type Params = { params: Promise<{ id: string }> };

const SELECT =
  '*, member:organization_members(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/**
 * Your feedback on an interview you sat.
 *
 * One row per interviewer per interview, and it is a draft until `submitted_at`
 * is stamped. Until then only its author can read it - `interview_feedback_select`
 * enforces that - because a panel that can see each other's notes before writing
 * their own does not produce four opinions, it produces one opinion four times.
 *
 * Submitting is a one-way door, held by a trigger rather than by this handler:
 * an author who could revise after reading the others would make the record of
 * what the panel thought unreconstructable.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('interview_feedback').select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .eq('interview_id', id)
    .order('submitted_at', { ascending: true, nullsFirst: false });

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Write or amend your own.
 *
 * An upsert rather than a create-then-edit pair: the natural key is (interview,
 * member), the form is the same form either way, and a screen that has to know
 * whether it is creating or editing in order to choose a verb is a screen that
 * will get it wrong after a refresh.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    if (b.recommendation && !(HIRE_RECOMMENDATIONS as readonly string[]).includes(String(b.recommendation))) {
      return error(
        `A recommendation is one of: ${HIRE_RECOMMENDATIONS.join(', ')}.`,
        422, 'VALIDATION_ERROR',
      );
    }

    const rating = b.rating === null || b.rating === '' || b.rating === undefined
      ? null : Number(b.rating);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return error('A rating is one to five.', 422, 'VALIDATION_ERROR');
    }

    const submitting = b.submit === true;
    if (submitting && !b.recommendation) {
      return error(
        'Say whether you would hire them before submitting. That is the part the hiring meeting reads.',
        422, 'RECOMMENDATION_REQUIRED',
      );
    }

    const { data: existing } = await ctx.supabase
      .from('interview_feedback').select('id, submitted_at')
      .eq('interview_id', id).eq('member_id', ctx.org.memberId)
      .maybeSingle();

    if (existing?.submitted_at) {
      return error(
        'You have already submitted this feedback and it cannot be changed.',
        409, 'ALREADY_SUBMITTED',
      );
    }

    const row = {
      organization_id: ctx.org.organizationId,
      interview_id: id,
      member_id: ctx.org.memberId,
      recommendation: b.recommendation ?? null,
      rating,
      strengths: b.strengths ?? '',
      concerns: b.concerns ?? '',
      notes: b.notes ?? '',
      ...(submitting ? { submitted_at: new Date().toISOString() } : {}),
    };

    const { data, error: e } = existing
      ? await ctx.supabase.from('interview_feedback')
          .update(row).eq('id', existing.id).select(SELECT).single()
      : await ctx.supabase.from('interview_feedback')
          .insert(row).select(SELECT).single();

    if (e) return pgError(e);
    return success(data, undefined, existing ? 200 : 201);
  } catch (e: any) {
    return serverError(e, 'Could not save your feedback');
  }
}

export { POST as PUT };
