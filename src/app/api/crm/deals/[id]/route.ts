import { recordHandlers } from '@/lib/supabase/crud';
import { activeOwnedScope } from '@/lib/supabase/crm-scope';
import { SELECTS } from '@/lib/supabase/selects';
import { updateDealSchema } from '@/lib/validations';
import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {toCamel,toSnake} from '@/lib/case';
import {recordActivity} from '@/lib/activity';

/**
 * A single deal.
 *
 * `updateSchema` is the list of fields a client may set. Without one this route
 * wrote whatever the body contained, so any column was reachable by anyone
 * holding `crm.edit` - including `deleted_at`, `created_at` and the tenant
 * key - and none of the validation the create route applies was applied to an
 * edit. See the note on `RecordOptions.updateSchema` for why `toUpdateSchema`
 * and not `.partial()`.
 *
 * `SELECTS.deals` is the expression the collection route already used, so a
 * record and a list row come back the same shape. This route was falling back
 * to `select: '*'` and returning no embedded relations at all.
 */
export const { GET, DELETE } = recordHandlers({
  table: 'deals',
  scope: activeOwnedScope,
  module: 'crm',
  select: SELECTS.deals,
  softDelete: true,
  updateSchema: updateDealSchema,
});

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid deal',422);
 const raw=await req.json().catch(()=>null);
 if(!raw||!z.number().int().min(0).safeParse(raw.pipelineVersion).success)return error('Reload the deal before saving; its current revision is required.',422);
 const {pipelineVersion,...fields}=raw;
 const parsed=updateDealSchema.safeParse(toCamel(fields));if(!parsed.success)return error(parsed.error.issues[0].message,422);
 if(!Object.keys(parsed.data).length)return error('No recognized fields to update',422);
 const query=ctx.supabase.from('deals').update(toSnake<Record<string,unknown>>(parsed.data)).eq('organization_id',ctx.org.organizationId).eq('id',id).eq('pipeline_version',pipelineVersion);
 const result=await activeOwnedScope(query,ctx).select(SELECTS.deals).maybeSingle();
 if(result.error)return pgError(result.error);
 if(!result.data)return error('This deal changed or is no longer available. Reload before saving.',409,'CRM_DEAL_CONFLICT');
 recordActivity(ctx,{table:'deals',action:'update',row:result.data});return success(result.data);
}
export const PUT=PATCH;
