import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * Competency ratings inside reviews.
 *
 * ── Why `edit` and not `approve` ─────────────────────────────────────────
 *
 * The employee writes their own self-rating, and an employee holds `view` and
 * `create` on HR, not `approve`. The authorisation that actually matters is
 * in the RLS policy (0048), which admits HR, the named reviewer, and the
 * subject *only while the review is at `self_review`* — a rule the module
 * grant cannot express, because it depends on the state of a particular row.
 *
 * So the route grant is the coarse gate and the policy is the real one. That
 * is the same division every other HR route uses; it is called out here only
 * because the coarse gate looks surprisingly permissive on its own.
 *
 * ── Filtering ────────────────────────────────────────────────────────────
 *
 * `review_id` is filterable, which is how a screen asks for one review's
 * ratings. It narrows; it does not authorise. Asking for a review you cannot
 * see returns nothing rather than an error, because a 403 here would confirm
 * the review exists.
 */
const SELECT =
  '*, competency:competencies!review_competencies_competency_id_fkey('
  + 'id, name, description, category, sort_order, is_active)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'review_competencies',
    module: 'hr',
    select: SELECT,
    sortable: ['created_at'],
    filterable: ['review_id', 'competency_id'],
    defaultSort: 'created_at',
    defaultSortDir: 'asc',
  },
  {
    table: 'review_competencies',
    module: 'hr',
    action: 'edit',
    select: SELECT,
    prepare: (b) => {
      if (!b.review_id) throw new Error('Say which review this rating belongs to');
      if (!b.competency_id) throw new Error('Say which competency is being rated');
      return {
        review_id: b.review_id,
        competency_id: b.competency_id,
        self_rating: b.self_rating ?? null,
        manager_rating: b.manager_rating ?? null,
        self_comment: b.self_comment ?? '',
        manager_comment: b.manager_comment ?? '',
      };
    },
  },
);
