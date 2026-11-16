import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {crmDatabaseError as pgError} from '@/lib/crm/database-error';
import {success,error} from '@/lib/api-response';
import {qualificationSchema} from '@/lib/crm/qualification';
export async function PUT(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid lead',422);
 let raw:unknown;try{raw=await req.json();}catch{return error('Invalid JSON',422);}const parsed=qualificationSchema.safeParse(raw);if(!parsed.success)return error(parsed.error.issues[0]?.message??'Invalid answers',422);
 const p=parsed.data;const result=await ctx.supabase.rpc('crm_save_lead_qualification',{p_org:ctx.org.organizationId,p_lead:id,p_version:p.version,p_framework_version:p.frameworkVersion,p_answers:p.answers,p_metadata:p.metadata});
 if(result.error?.code==='40001')return error('The lead or framework changed. Reload before saving your draft.',409);if(result.error)return pgError(result.error);return success({saved:true});
}
