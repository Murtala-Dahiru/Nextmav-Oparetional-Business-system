import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
const schema=z.object({version:z.number().int().min(0),details:z.object({nextStep:z.string().max(4000),competitor:z.string().max(250),outcomeNotes:z.string().max(12000),forecastCategory:z.enum(['pipeline','best_case','commit','omitted']),teamIds:z.array(z.uuid()).max(100),services:z.array(z.object({name:z.string().trim().min(1).max(250),quantity:z.number().positive().max(1000000),unitPrice:z.number().min(0).max(100000000000)}).strict()).max(100)}).strict()}).strict();
export async function PUT(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;const id=z.uuid().safeParse((await params).id);if(!id.success)return error('Invalid deal',422);
 let raw:unknown;try{raw=await req.json();}catch{return error('Invalid JSON',422);}const body=schema.safeParse(raw);if(!body.success)return error(body.error.issues[0]?.message??'Invalid deal details',422);
 const result=await ctx.supabase.rpc('crm_save_deal_execution',{p_org:ctx.org.organizationId,p_deal:id.data,p_version:body.data.version,p_details:body.data.details});
 if(['40001','PT409'].includes(result.error?.code??''))return error('This deal changed. Reload its latest details before saving.',409);
 if(result.error)return crmDatabaseError(result.error);return success({version:result.data});
}
