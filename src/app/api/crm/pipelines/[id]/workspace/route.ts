import {todayIn} from '@/lib/org-time';
import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {pipelineFiltersSchema} from '@/lib/crm/pipeline-filters';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid pipeline',422);
 const parsed=pipelineFiltersSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
 if(!parsed.success)return error(parsed.error.issues[0].message,422);
 const result=await ctx.supabase.rpc('crm_pipeline_workspace',{p_org:ctx.org.organizationId,p_pipeline:id,p_filters:{...parsed.data,today:todayIn(ctx.org.timezone)}});
 if(result.error)return pgError(result.error);return success(result.data);
}
