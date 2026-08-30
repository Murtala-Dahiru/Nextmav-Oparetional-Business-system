import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Reviews
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The one policy that hides something from its subject ─────────────────
 *
 *  `performance_reviews_select` lets the person a review is about read it
 *  only once `shared_at` is set. That is the single place in this phase where
 *  somebody cannot see their own record, and it is deliberate: a manager
 *  drafting an assessment needs to be able to think out loud, and reading a
 *  half-written review of yourself is worse for both people than waiting.
 *
 *  The trigger records the moment sharing happens, so "when was I told this"
 *  has an answer, and closing a review that was never shared is refused.
 *
 *  ── Why the reviewer defaults to the person's manager ────────────────────
 *
 *  `organization_members.manager_id` has existed since 0003 and is the
 *  organisation's own answer to who reviews whom. Asking the creator to pick
 *  a reviewer they already implied would be a form field that is wrong more
 *  often than it is right.
 */

const SELECT =
  '*, member:organization_members!performance_reviews_member_id_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)), '
  + 'reviewer:organization_members!performance_reviews_reviewer_id_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), '
  + 'cycle:performance_cycles(id, name, period_start, period_end, status)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'performance_reviews',
    module: 'hr',
    select: SELECT,
    sortable: ['created_at', 'status', 'shared_at', 'overall_rating'],
    filterable: ['member_id', 'cycle_id', 'status', 'reviewer_id'],
    defaultSort: 'created_at',
  },
  {
    table: 'performance_reviews',
    module: 'hr',
    /**
     * `approve`, not `create`.
     *
     * Opening a review on somebody is a management act, and `approve` is the
     * capability the model already uses for "may act on other people's
     * records" - a manager and HR hold it, an employee does not. Without this
     * anybody could open a review on anybody their visibility admits.
     */
    action: 'approve',
    select: SELECT,
    prepare: async (b, ctx) => {
      if (!b.member_id) throw new Error('Choose who the review is for');
      if (!b.cycle_id) throw new Error('Choose which cycle it belongs to');

      /* The organisation already knows who reviews whom. */
      let reviewer = b.reviewer_id ?? null;
      if (!reviewer) {
        const { data } = await ctx.supabase
          .from('organization_members')
          .select('manager_id')
          .eq('organization_id', ctx.org.organizationId)
          .eq('id', b.member_id)
          .maybeSingle();
        reviewer = data?.manager_id ?? ctx.org.memberId;
      }

      return {
        member_id: b.member_id,
        cycle_id: b.cycle_id,
        reviewer_id: reviewer,
        status: 'not_started',
      };
    },
  },
);
