import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
const data=z.object({businessNeed:z.string().max(12000),decisionProcess:z.string().max(12000),closePlan:z.string().max(12000),stakeholders:z.array(z.object({contactId:z.uuid(),role:z.enum(['economic_buyer','decision_maker','champion','technical_evaluator','influencer'])}).strict()).max(40)}).strict();
type Params={params:Promise<{id:string}>};
export async function GET(_req:Request,{params}:Params){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const{id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid deal',422);
 const result=await ctx.supabase.from('crm_opportunity_plans').select('*').eq('organization_id',ctx.org.organizationId).eq('deal_id',id).maybeSingle();
 if(result.error)return pgError(result.error);
 if(!result.data)return success({version:0,businessNeed:'',decisionProcess:'',closePlan:'',stakeholders:[]});
 const ids=(result.data.stakeholders??[]).map((s:{contactId:string})=>s.contactId);
 const contacts=ids.length?await ctx.supabase.from('contacts').select('id,first_name,last_name').eq('organization_id',ctx.org.organizationId).in('id',ids).is('deleted_at',null):{data:[],error:null};
 if(contacts.error)return pgError(contacts.error);
 return success({...result.data,contactNames:Object.fromEntries((contacts.data??[]).map(c=>[c.id,`${c.first_name} ${c.last_name}`.trim()]))});
}
export async function PUT(req:Request,{params}:Params){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;const{id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid deal',422);
 const parsed=z.object({version:z.number().int().min(0),data}).strict().safeParse(await req.json().catch(()=>null));if(!parsed.success)return error('Check opportunity plan fields',422);
 const result=await ctx.supabase.rpc('crm_save_opportunity_plan',{p_org:ctx.org.organizationId,p_deal:id,p_version:parsed.data.version,p_data:parsed.data.data});
 if(result.error)return crmDatabaseError(result.error);return success({version:result.data});
}
