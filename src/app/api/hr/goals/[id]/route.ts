import { recordHandlers } from '@/lib/supabase/crud';
import { updateGoalSchema } from '@/lib/validations';

/**
 * A single goal.
 *
 * `edit` at the route, bounded by `performance_goals_write` to yourself and
 * the people you manage. Somebody writing their own self-rating is the
 * ordinary case in every review system; what stops it being a way to award
 * yourself a five is that a self rating and a manager rating are separate
 * columns and the screen shows both.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'performance_goals',
  module: 'hr',
  updateAction: 'edit',
  updateSchema: updateGoalSchema,
});
