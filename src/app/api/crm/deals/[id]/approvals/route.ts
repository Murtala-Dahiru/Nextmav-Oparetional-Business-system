import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {activeOwnedScope} from '@/lib/supabase/crm-scope';
type Params={params:Promise<{id:string}>};
export async function GET(_req:Request,{params}:Params){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid deal',422);
 const deal=await activeOwnedScope(ctx.supabase.from('deals').select('id').eq('organization_id',ctx.org.organizationId).eq('id',id),ctx).maybeSingle();
 if(deal.error)return pgError(deal.error);if(!deal.data)return error('Deal not found',404);
 const result=await ctx.supabase.from('crm_stage_approvals').select('*').eq('organization_id',ctx.org.organizationId).eq('deal_id',id).order('requested_at',{ascending:false}).limit(100);
 if(result.error)return ['42P01','PGRST205'].includes(result.error.code)?error('Stage approvals require the CRM pipeline migration.',503,'CRM_SCHEMA_REQUIRED'):pgError(result.error);
 return success(result.data);
}
export async function POST(req:Request,{params}:Params){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid deal',422);
 let body:unknown;try{body=await req.json();}catch{return error('Invalid JSON',422);}
 const parsed=z.object({stageId:z.uuid()}).strict().safeParse(body);if(!parsed.success)return error('Select the stage that requires approval.',422);
 const result=await ctx.supabase.rpc('crm_request_stage_approval',{p_org:ctx.org.organizationId,p_deal:id,p_stage:parsed.data.stageId});
 if(result.error?.code==='PGRST202')return error('Stage approvals require the CRM pipeline migration.',503,'CRM_SCHEMA_REQUIRED');
 if(result.error)return pgError(result.error);return success({id:result.data});
}
