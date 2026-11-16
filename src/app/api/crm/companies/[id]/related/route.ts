import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {can} from '@/lib/permissions';
import {success,error,serverError} from '@/lib/api-response';
import {ownedScope} from '@/lib/supabase/crm-scope';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
 try {const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const{id}=await params;const q=new URL(req.url).searchParams;
 const parsed=z.object({id:z.uuid(),kind:z.enum(['contacts','deals','projects','invoices','tickets','milestones','payments']),page:z.coerce.number().int().min(1).max(10000)}).safeParse({id,kind:q.get('kind'),page:q.get('page')??1});if(!parsed.success)return error('Invalid related-record request',422);
 const {kind,page}=parsed.data,org=ctx.org.organizationId;
 const sourceModule=kind==='projects'||kind==='milestones'?'projects':kind==='invoices'||kind==='payments'?'finance':kind==='tickets'?'support':'crm';
 if(!can(ctx.org.role,sourceModule,'view'))return error('You do not have access to this customer context.',403);
 const company=await ctx.supabase.from('companies').select('id').eq('organization_id',org).eq('id',id).is('deleted_at',null).maybeSingle();if(company.error)return pgError(company.error);if(!company.data)return error('Company not found',404);
 let query;
 if(kind==='contacts')query=ctx.supabase.from('contacts').select('id,first_name,last_name,job_title,email,is_active,crm_profile',{count:'exact'}).eq('company_id',id).is('deleted_at',null);
 else if(kind==='deals')query=ownedScope(ctx.supabase.from('deals').select('id,name,stage,value,currency,expected_close',{count:'exact'}).eq('company_id',id).is('deleted_at',null),ctx);
 else if(kind==='projects')query=ctx.supabase.from('crm_visible_projects').select('id,name,status,end_date,owner:organization_members!projects_owner_id_fkey(profiles!organization_members_user_id_fkey(full_name))',{count:'exact'}).eq('client_company_id',id).is('deleted_at',null);
 else if(kind==='invoices')query=ctx.supabase.from('invoices').select('id,invoice_number,status,total,amount_paid,currency,due_date',{count:'exact'}).eq('company_id',id).is('deleted_at',null);
 else if(kind==='tickets')query=ctx.supabase.from('support_tickets').select('id,subject,status,priority,ticket_number,contact:contacts!inner(company_id,organization_id,deleted_at)',{count:'exact'}).eq('contact.company_id',id).eq('contact.organization_id',org).is('contact.deleted_at',null).is('deleted_at',null);
 else if(kind==='milestones')query=ctx.supabase.from('milestones').select('id,name,stage,due_date,progress_pct,completed_at,project_id,project:crm_visible_projects!inner(name,client_company_id,organization_id,deleted_at)',{count:'exact'}).eq('project.client_company_id',id).eq('project.organization_id',org).is('project.deleted_at',null);
 else query=ctx.supabase.from('payments').select('id,amount,paid_at,invoice_id,invoice:invoices!inner(invoice_number,currency,company_id,organization_id,deleted_at)',{count:'exact'}).eq('invoice.company_id',id).eq('invoice.organization_id',org).is('invoice.deleted_at',null);
 const result=await query.eq('organization_id',org).order(kind==='payments'?'paid_at':'created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*20,page*20-1);
 if(result.error)return pgError(result.error);
 if(kind==='projects'&&result.data?.length){
  const health=await ctx.supabase.from('v_project_health').select('project_id,progress_pct').eq('organization_id',org).in('project_id',result.data.map((row:{id:string})=>row.id));
  if(health.error)return pgError(health.error);
  const progress=new Map((health.data??[]).map(h=>[h.project_id,h.progress_pct]));
  return success(result.data.map((row:{id:string})=>({...row,...(progress.has(row.id)?{progress_pct:progress.get(row.id)}:{})})),{total:result.count??0,page,pageSize:20});
 }
 return success(result.data,{total:result.count??0,page,pageSize:20});
 }catch(cause){return serverError(cause,'Could not load related customer records.')}
}
