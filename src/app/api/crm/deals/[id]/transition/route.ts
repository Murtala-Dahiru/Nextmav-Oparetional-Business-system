import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
const schema=z.object({stageId:z.uuid(),version:z.number().int().min(0),outcome:z.object({lostReason:z.string().max(500).optional(),outcomeNotes:z.string().max(12000).optional(),closedAt:z.iso.datetime({offset:true}).optional()}).strict().optional()}).strict();
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid deal',422);
 let body:unknown;try{body=await req.json();}catch{return error('Invalid JSON',422);}
 const parsed=schema.safeParse(body);if(!parsed.success)return error('Select a stage and current deal revision.',422);
 const result=await ctx.supabase.rpc('crm_move_deal',{p_org:ctx.org.organizationId,p_deal:id,p_stage:parsed.data.stageId,p_version:parsed.data.version,p_outcome:parsed.data.outcome??{}});
 if(['40001','PT409'].includes(result.error?.code??''))return error('The deal changed. Refresh before moving it.',409,'CRM_DEAL_CONFLICT');
 if(result.error?.code==='PGRST202')return error('Pipeline transitions require the CRM pipeline migration.',503,'CRM_SCHEMA_REQUIRED');
 if(result.error)return pgError(result.error);
 return success({moved:true});
}
