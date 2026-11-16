import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
const schema=z.object({version:z.number().int().min(1),description:z.string().max(4000),active:z.boolean(),isDefault:z.boolean(),archive:z.boolean().default(false)}).strict();
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','manage');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid pipeline',422);
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return error('Check pipeline settings',422);
 const p=parsed.data;const result=await ctx.supabase.rpc('crm_pipeline_lifecycle',{p_org:ctx.org.organizationId,p_id:id,p_version:p.version,p_description:p.description,p_active:p.active,p_default:p.isDefault,p_archive:p.archive});
 if(result.error)return crmDatabaseError(result.error);return success({saved:true});
}
