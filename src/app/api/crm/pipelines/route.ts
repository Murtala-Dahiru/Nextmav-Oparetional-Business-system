import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {pipelineSchema} from '@/lib/crm/pipelines';

export async function GET(){
  const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
  const result=await ctx.supabase.from('crm_pipelines').select('*, stages:crm_pipeline_stages(*)')
    .eq('organization_id',ctx.org.organizationId).eq('archived',false).order('created_at');
  if(result.error) return ['PGRST205','42P01'].includes(result.error.code)
    ? error('Configurable pipelines require the CRM pipeline migration.',503,'CRM_SCHEMA_REQUIRED'):pgError(result.error);
  return success(result.data?.map(p=>({...p,stages:p.stages.filter((s:{archived:boolean})=>!s.archived).sort((a:{position:number},b:{position:number})=>a.position-b.position)}))??[]);
}
export async function POST(req:Request){
  const ctx=await authorize('crm','manage');if(ctx instanceof Response)return ctx;
  let body:unknown;try{body=await req.json();}catch{return error('Invalid JSON',422);}
  const parsed=pipelineSchema.safeParse(body);if(!parsed.success)return error(parsed.error.issues[0]?.message??'Invalid pipeline',422);
  const p=parsed.data;
  const result=await ctx.supabase.rpc('crm_save_pipeline',{p_org:ctx.org.organizationId,p_id:p.id,p_version:p.version,p_name:p.name,p_purpose:p.purpose,p_stages:p.stages});
  if(['40001','PT409'].includes(result.error?.code??''))return error('This pipeline changed. Reload it before saving your changes.',409,'CRM_PIPELINE_CONFLICT');
  if(result.error?.code==='PGRST202')return error('Configurable pipelines require the CRM pipeline migration.',503,'CRM_SCHEMA_REQUIRED');
  if(result.error)return pgError(result.error);
  return success({id:result.data});
}
