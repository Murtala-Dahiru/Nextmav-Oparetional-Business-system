import { recordHandlers } from '@/lib/supabase/crud';
import { updateReviewSchema } from '@/lib/validations';

/**
 * A single review.
 *
 * `approve`, because moving a review along is a management act rather than an
 * ordinary edit. The trigger owns `shared_at` and `closed_at`, and refuses to
 * close a review that was never shared with the person it is about.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'performance_reviews',
  module: 'hr',
  updateAction: 'approve',
  updateSchema: updateReviewSchema,
});
