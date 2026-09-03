import { recordHandlers } from '@/lib/supabase/crud';
import { updateFeedbackSchema } from '@/lib/validations';

/**
 * One feedback request, answered or withdrawn.
 *
 * ── `edit`, and why that is not too generous ─────────────────────────────
 *
 * Answering is an ordinary employee's act — they hold `view` and `create`, not
 * `approve` — so the module grant has to admit them. What stops one person
 * answering on another's behalf is `review_feedback_update` (0048), which
 * restricts UPDATE to `respondent_id = auth_member_id(...)` and admits nobody
 * else. **HR is deliberately excluded from that policy**: HR administers the
 * process and must not be able to edit what a colleague wrote about somebody,
 * because feedback its author cannot vouch for is not feedback.
 *
 * `updateFeedbackSchema` is the second half of the same guarantee. It accepts
 * four fields and strips everything else, so even the respondent cannot move
 * their answer onto another review or restamp when it was submitted.
 *
 * DELETE withdraws a request that should not have been made; the policy gives
 * that to HR and the named reviewer, not to the respondent — declining is how
 * a respondent says no, and it leaves a record that they were asked.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'review_feedback',
  module: 'hr',
  updateAction: 'edit',
  updateSchema: updateFeedbackSchema,
});
