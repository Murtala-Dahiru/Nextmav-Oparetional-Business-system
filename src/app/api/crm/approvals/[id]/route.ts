import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {crmDatabaseError} from '@/lib/crm/database-error';
import {success,error} from '@/lib/api-response';
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','approve');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid approval',422);
 let body:unknown;try{body=await req.json();}catch{return error('Invalid JSON',422);}
 const parsed=z.object({approve:z.boolean(),note:z.string().max(4000)}).strict().safeParse(body);if(!parsed.success)return error('Provide an approval decision and a note of up to 4,000 characters.',422);
 const result=await ctx.supabase.rpc('crm_decide_stage_approval',{p_org:ctx.org.organizationId,p_id:id,p_approve:parsed.data.approve,p_note:parsed.data.note});
 if(result.error?.code==='PGRST202')return error('Stage approvals require the CRM pipeline migration.',503,'CRM_SCHEMA_REQUIRED');
 if(result.error)return crmDatabaseError(result.error);return success({decided:true});
}
