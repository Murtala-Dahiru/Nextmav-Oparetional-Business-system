import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Feedback requested from colleagues, and the answers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Who can read what ────────────────────────────────────────────────────
 *
 *  Not the subject. That is the whole privacy design of the instrument and it
 *  is argued at length in migration 0048's header; the short version is that
 *  anonymity in a team of six is a promise the data cannot keep, and feedback
 *  people believe is traceable is feedback they stop writing honestly.
 *
 *  The policy enforces it, so this route does not repeat the rule. What it
 *  does do is decline to *filter* by subject for anybody who is not entitled
 *  to the rows anyway — the policy would return nothing, but a screen that
 *  can ask "show me feedback about Ada" and get a clean empty list has still
 *  been told that asking is a thing one might do.
 *
 *  ── Why POST is hand-written rather than a collection handler ────────────
 *
 *  Requesting feedback derives three things the caller must not be trusted
 *  with: the subject (it comes from the review, not the request), the
 *  requester (the session), and the tenant. A caller who could name the
 *  subject could attach feedback about one person to another person's review.
 */

const SELECT = `
  *,
  respondent:organization_members!review_feedback_respondent_id_fkey(
    id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)
  ),
  subject:organization_members!review_feedback_subject_id_fkey(
    id, profiles!organization_members_user_id_fkey(full_name, avatar_url)
  ),
  review:performance_reviews!review_feedback_review_id_fkey(
    id, status, cycle:performance_cycles(id, name, period_start, period_end)
  )
`;

export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('review_feedback')
    .select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  /* Narrowing, not authorising — the policy has already bounded the rows. */
  const reviewId = searchParams.get('reviewId');
  if (isFilterValue(reviewId)) q = q.eq('review_id', reviewId);
  const status = searchParams.get('status');
  if (isFilterValue(status)) q = q.eq('status', status);

  /**
   * `mine` is how somebody asks for their own queue.
   *
   * Written as an explicit flag rather than `respondentId=<me>` so the common
   * case does not require the client to know its own membership id, which is
   * exactly the mistake `/api/projects/tasks` documents having made.
   */
  if (searchParams.get('mine') === 'true' && ctx.org.memberId) {
    q = q.eq('respondent_id', ctx.org.memberId);
  }

  const { data, error: e } = await q.order('created_at', { ascending: false }).limit(500);
  if (e) return pgError(e);
  return success(data ?? []);
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'edit');
  if (ctx instanceof Response) return ctx;
  const orgId = ctx.org.organizationId;

  const b = acceptBody(await req.json());

  const reviewId = String(b.review_id ?? '');
  const respondentId = String(b.respondent_id ?? '');
  if (!reviewId) return error('Say which review this feedback is for.', 422, 'VALIDATION_ERROR');
  if (!respondentId) return error('Say who is being asked.', 422, 'VALIDATION_ERROR');

  /**
   * The subject comes from the review, never from the request.
   *
   * If the review is unreadable to this caller the policy returns nothing, and
   * the answer is 404 rather than 403 — see the competencies route for why
   * confirming a review exists is itself a disclosure.
   */
  const { data: review, error: re } = await ctx.supabase
    .from('performance_reviews').select('id, member_id, status')
    .eq('organization_id', orgId).eq('id', reviewId).maybeSingle();

  if (re) return pgError(re);
  if (!review) return error('No such review.', 404, 'NOT_FOUND');

  if (review.member_id === respondentId) {
    return error(
      'Somebody cannot give 360 feedback on themselves. Their own view of the period is the self-assessment.',
      422, 'FEEDBACK_SELF',
    );
  }

  /**
   * A closed review takes no more feedback.
   *
   * The database does not refuse this and arguably should not — a late
   * response to a request made in time is not misconduct. But *asking*
   * somebody for feedback on a review that is finished produces a task that
   * cannot affect anything, which wastes their time and misrepresents what
   * their answer will be used for.
   */
  if (review.status === 'closed') {
    return error('That review is closed. Feedback on it can no longer change anything.',
      422, 'REVIEW_CLOSED');
  }

  const { data, error: e } = await ctx.supabase
    .from('review_feedback')
    .insert({
      organization_id: orgId,
      review_id: reviewId,
      subject_id: review.member_id,
      respondent_id: respondentId,
      relationship: b.relationship ?? 'peer',
      requested_by: ctx.org.memberId,
      due_on: b.due_on || null,
    })
    .select(SELECT)
    .single();

  if (e) return pgError(e);
  return success(data, undefined, 201);
}
