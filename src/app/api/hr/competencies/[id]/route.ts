import { recordHandlers } from '@/lib/supabase/crud';
import { updateCompetencySchema } from '@/lib/validations';

/**
 * One competency.
 *
 * `DELETE` is exposed and will usually fail, which is the intended behaviour
 * rather than an oversight: `review_competencies.competency_id` is
 * `ON DELETE RESTRICT`, so a competency that has ever been rated in a review
 * cannot be removed. That rating is part of what a closed review means, and
 * deleting the row it points at would leave a score with no question attached
 * to it.
 *
 * Retiring is the operation people actually want, and it is `isActive: false`
 * on this same route: the competency stops being offered on new reviews and
 * every existing rating keeps its meaning. The screen offers that and not a
 * delete button, so the RESTRICT is a backstop rather than an error people
 * meet.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'competencies',
  module: 'hr',
  updateAction: 'manage',
  updateSchema: updateCompetencySchema,
});
