import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {pipelineFiltersSchema} from '@/lib/crm/pipeline-filters';
import {crmDatabaseError} from '@/lib/crm/database-error';
const filters=pipelineFiltersSchema.safeExtend({sort:z.enum(['value','created_at','expected_close']),sortDir:z.enum(['asc','desc'])});
const schema=z.object({version:z.number().int().min(0),views:z.array(z.object({name:z.string().trim().min(1).max(60),pipelineId:z.uuid(),view:z.enum(['board','table','forecast']),filters}).strict()).max(20)}).strict();
export async function GET(){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const r=await ctx.supabase.from('crm_pipeline_views').select('version,views').eq('organization_id',ctx.org.organizationId).eq('member_id',ctx.org.memberId).maybeSingle();if(r.error)return pgError(r.error);return success(r.data??{version:0,views:[]});}
export async function PUT(req:Request){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const body=schema.safeParse(await req.json().catch(()=>null));if(!body.success)return error('Check the saved view name and filters',422);const r=await ctx.supabase.rpc('crm_save_pipeline_views',{p_org:ctx.org.organizationId,p_version:body.data.version,p_views:body.data.views});if(r.error)return crmDatabaseError(r.error);return success({version:r.data});}
