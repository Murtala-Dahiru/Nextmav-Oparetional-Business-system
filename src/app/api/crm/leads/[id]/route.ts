import { recordHandlers } from '@/lib/supabase/crud';
import { activeOwnedScope } from '@/lib/supabase/crm-scope';
import { SELECTS } from '@/lib/supabase/selects';
import { leadPatchSchema } from '@/lib/crm/lead-input';

/**
 * A single lead.
 *
 * `updateSchema` is the list of fields a client may set. Without one this route
 * wrote whatever the body contained, so any column was reachable by anyone
 * holding `crm.edit` - including `deleted_at`, `created_at` and the tenant
 * key - and none of the validation the create route applies was applied to an
 * edit. See the note on `RecordOptions.updateSchema` for why `toUpdateSchema`
 * and not `.partial()`.
 *
 * `SELECTS.leads` is the expression the collection route already used, so a
 * record and a list row come back the same shape. This route was falling back
 * to `select: '*'` and returning no embedded relations at all.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'leads',
  scope: activeOwnedScope,
  module: 'crm',
  select: SELECTS.leads,
  softDelete: true,
  updateSchema: leadPatchSchema,
});
