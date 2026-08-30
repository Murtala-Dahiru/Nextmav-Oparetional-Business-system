import { recordHandlers } from '@/lib/supabase/crud';
import { updateCycleSchema } from '@/lib/validations';

/**
 * A single review cycle.
 *
 * `manage`, like the create route: a manager runs reviews inside a cycle,
 * they do not decide when the company holds one.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'performance_cycles',
  module: 'hr',
  updateAction: 'manage',
  updateSchema: updateCycleSchema,
});
