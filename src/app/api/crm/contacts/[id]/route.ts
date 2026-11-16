import { guardedRelationshipUpdate } from '@/lib/crm/guarded-relationship-update';
import { recordHandlers } from '@/lib/supabase/crud';
import { SELECTS } from '@/lib/supabase/selects';
import { updateContactSchema } from '@/lib/validations';

/**
 * A single contact.
 *
 * `updateSchema` is the list of fields a client may set. Without one this route
 * wrote whatever the body contained, so any column was reachable by anyone
 * holding `crm.edit` - including `deleted_at`, `created_at` and the tenant
 * key - and none of the validation the create route applies was applied to an
 * edit. See the note on `RecordOptions.updateSchema` for why `toUpdateSchema`
 * and not `.partial()`.
 *
 * `SELECTS.contacts` is the expression the collection route already used, so a
 * record and a list row come back the same shape. This route was falling back
 * to `select: '*'` and returning no embedded relations at all.
 */
const handlers = recordHandlers({
  table: 'contacts',
  module: 'crm',
  select: SELECTS.contacts,
  softDelete: true,
  updateSchema: updateContactSchema,
});

export const { GET, DELETE } = handlers;
export const PATCH = guardedRelationshipUpdate('contacts',updateContactSchema,SELECTS.contacts,handlers.PATCH);
export const PUT = guardedRelationshipUpdate('contacts',updateContactSchema,SELECTS.contacts,handlers.PUT);
