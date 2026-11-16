import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
 const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid pipeline',422);
 const q=new URL(req.url).searchParams;
 const report=q.get('report')??'stages';if(!['stages','forecast'].includes(report))return error('Invalid report',422);
 const parsed=z.object({search:z.string().max(500),owner:z.uuid().nullable(),from:z.iso.date().nullable(),to:z.iso.date().nullable()}).safeParse({search:q.get('search')??'',owner:q.get('ownerId'),from:q.get('closeFrom'),to:q.get('closeTo')});
 if(!parsed.success)return error('Check the pipeline filters',422);
 const f=parsed.data;
 if(f.from&&f.to&&f.from>f.to)return error('Close date range is reversed',422);
 const result=await ctx.supabase.rpc(report==='forecast'?'crm_pipeline_forecast':'crm_pipeline_summary',{p_org:ctx.org.organizationId,p_pipeline:id,p_search:f.search,p_owner:f.owner,p_from:f.from,p_to:f.to});
 if(result.error)return pgError(result.error);return success(result.data);
}
