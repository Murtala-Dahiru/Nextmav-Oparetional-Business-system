import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid deal',422);
 const page=Math.max(1,Math.min(10000,Number(new URL(req.url).searchParams.get('page'))||1));
 const result=await ctx.supabase.from('crm_pipeline_events').select('*, from_stage:crm_pipeline_stages!crm_pipeline_events_from_stage_id_fkey(name), to_stage:crm_pipeline_stages!crm_pipeline_events_to_stage_id_fkey(name), member:organization_members!crm_pipeline_events_member_id_fkey(profiles!organization_members_user_id_fkey(full_name))').eq('organization_id',ctx.org.organizationId).eq('deal_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*25,page*25);
 if(result.error)return pgError(result.error);
 const duration=await ctx.supabase.rpc('crm_deal_stage_durations',{p_org:ctx.org.organizationId,p_deal:id});
 if(duration.error)return pgError(duration.error);
 return success({events:result.data.slice(0,25),hasMore:result.data.length>25,durations:duration.data});
}
