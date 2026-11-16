import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
type Context={params:Promise<{id:string}>};
export async function GET(_req:Request,{params}:Context) {
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid record',422);
 const r=await ctx.supabase.from('crm_commercial_records').select('*,company:companies(name)').eq('organization_id',ctx.org.organizationId).eq('id',id).maybeSingle();
 if(r.error)return crmDatabaseError(r.error);if(!r.data)return error('Record not found',404);
 const results=await Promise.all(['crm_commercial_versions','crm_commercial_history','crm_commercial_files','crm_commercial_obligations'].map(table=>ctx.supabase.from(table).select(table==='crm_commercial_versions'?'id,revision,purpose,created_at,created_by':'*').eq('organization_id',ctx.org.organizationId).eq('record_id',id).order('created_at',{ascending:false}).limit(100)));
 for(const result of results)if(result.error)return crmDatabaseError(result.error);
 return success({...r.data,versions:results[0].data,history:results[1].data,files:results[2].data,obligations:results[3].data});
}
const transition=z.object({revision:z.number().int().positive(),operation:z.enum(['revise','submit','approve','reject','request_changes','issue','record_sent','accept','decline','execute','activate','expire','terminate','cancel','prepare','negotiate','propose_renewal','not_renewed','renewed']),note:z.string().max(4000).default(''),evidenceId:z.uuid().nullable().default(null)}).strict();
export async function POST(req:Request,{params}:Context){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid record',422);
 const p=transition.safeParse(await req.json().catch(()=>null));if(!p.success)return error('Invalid transition',422);
 const r=await ctx.supabase.rpc('crm_commercial_transition',{p_org:ctx.org.organizationId,p_id:id,p_revision:p.data.revision,p_operation:p.data.operation,p_note:p.data.note,p_evidence:p.data.evidenceId});
 return r.error?crmDatabaseError(r.error):success({id:r.data});
}
