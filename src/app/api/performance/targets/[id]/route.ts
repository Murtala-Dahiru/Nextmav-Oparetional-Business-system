import { recordHandlers } from '@/lib/supabase/crud';
import { updateTargetSchema } from '@/lib/validations';

/**
 * A single target.
 *
 * `DELETE` is reachable but is rarely the right act: a target somebody was
 * measured against for a period that has passed is history, and the trigger
 * `check_performance_target()` already refuses to change its number once the
 * period has closed. To correct a closed period, write a new row and point
 * the old one's `superseded_by` at it, which leaves both visible.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'performance_targets',
  module: 'performance',
  select: '*, setter:organization_members!performance_targets_set_by_fkey('
    + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))',
  updateSchema: updateTargetSchema,
});
