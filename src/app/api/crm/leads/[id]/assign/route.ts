import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {crmDatabaseError as pgError} from '@/lib/crm/database-error';
import {success,error} from '@/lib/api-response';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid lead',422);
 let raw:unknown;try{raw=await req.json();}catch{return error('Invalid JSON',422);}const p=z.object({requestKey:z.uuid(),reassign:z.boolean().default(false)}).strict().safeParse(raw);if(!p.success)return error('Invalid assignment request',422);
 const r=await ctx.supabase.rpc('crm_assign_lead',{p_org:ctx.org.organizationId,p_lead:id,p_key:p.data.requestKey,p_reassign:p.data.reassign});if(r.error)return pgError(r.error);return success(r.data);
}
