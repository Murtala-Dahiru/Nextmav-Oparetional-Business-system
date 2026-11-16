import { guardedRelationshipUpdate } from '@/lib/crm/guarded-relationship-update';
import { z } from 'zod';
import { recordHandlers } from '@/lib/supabase/crud';
import { SELECTS } from '@/lib/supabase/selects';
import { updateCompanySchema } from '@/lib/validations';

/**
 * A single company.
 *
 * `updateSchema` is the list of fields a client may set. Without one this route
 * wrote whatever the body contained, so any column was reachable by anyone
 * holding `crm.edit` - including `deleted_at`, `created_at` and the tenant
 * key - and none of the validation the create route applies was applied to an
 * edit. See the note on `RecordOptions.updateSchema` for why `toUpdateSchema`
 * and not `.partial()`.
 *
 * `SELECTS.companies` is the expression the collection route already used, so a
 * record and a list row come back the same shape. This route was falling back
 * to `select: '*'` and returning no embedded relations at all.
 */
const companyDetailsSchema=updateCompanySchema.extend({address:z.string().max(4000).optional()});
const handlers = recordHandlers({
  table: 'companies',
  module: 'crm',
  select: SELECTS.companies,
  softDelete: true,
  updateSchema: companyDetailsSchema,
});

export const { GET, DELETE } = handlers;
export const PATCH = guardedRelationshipUpdate('companies',companyDetailsSchema,SELECTS.companies,handlers.PATCH);
export const PUT = guardedRelationshipUpdate('companies',companyDetailsSchema,SELECTS.companies,handlers.PUT);
