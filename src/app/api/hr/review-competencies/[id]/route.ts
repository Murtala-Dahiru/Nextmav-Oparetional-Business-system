import { recordHandlers } from '@/lib/supabase/crud';
import { updateReviewCompetencySchema } from '@/lib/validations';

/**
 * One competency rating.
 *
 * `edit` for the reason the collection route gives: the self-rating is the
 * employee's own to write, and the row-level policy is what decides whether
 * this particular person may touch this particular row at this point in the
 * review.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'review_competencies',
  module: 'hr',
  updateAction: 'edit',
  updateSchema: updateReviewCompetencySchema,
});
