import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {success,error,serverError} from '@/lib/api-response';

type Params={params:Promise<{id:string}>};
async function handle(req:Request,{params}:Params){
 const ctx=await authorize('crm',req.method==='GET'?'view':'edit');if(ctx instanceof Response)return ctx;
 const {id}=await params,org=ctx.org.organizationId,q=new URL(req.url).searchParams;
 if(!z.uuid().safeParse(id).success)return error('Invalid account',422);
 const company=await ctx.supabase.from('companies').select('id').eq('id',id).eq('organization_id',org).is('deleted_at',null).maybeSingle();
 if(company.error)return pgError(company.error);if(!company.data)return error('Company not found',404);
 const pairs=`company_id.eq.${id},related_company_id.eq.${id}`;
 if(req.method==='GET'){
  const page=z.coerce.number().int().min(1).max(10000).safeParse(q.get('page')??1);if(!page.success)return error('Invalid page',422);
  const r=await ctx.supabase.from('crm_company_relationships').select('id,relationship_type,created_at,company:companies!company_id(id,name,deleted_at),related:companies!related_company_id(id,name,deleted_at)',{count:'exact'}).eq('organization_id',org).or(pairs).order('created_at',{ascending:false}).range((page.data-1)*20,page.data*20-1);
  if(r.error)return pgError(r.error);
  return success(r.data,{total:r.count??0,page:page.data,pageSize:20});
 }
 if(req.method==='DELETE'){
  const link=q.get('link');if(!z.uuid().safeParse(link).success)return error('Invalid relationship',422);
  const r=await ctx.supabase.from('crm_company_relationships').delete().eq('id',link!).eq('organization_id',org).or(pairs).select('id').maybeSingle();
  if(r.error)return pgError(r.error);if(!r.data)return error('Relationship not found',404);
  return success({removed:true});
 }
 const body=z.object({companyId:z.uuid(),type:z.string().trim().min(1).max(80)}).strict().safeParse(await req.json());
 if(!body.success||body.data.companyId===id)return error('Choose a different account and a relationship type',422);
 const [first,second]=[id,body.data.companyId].sort();
 const r=await ctx.supabase.from('crm_company_relationships').insert({organization_id:org,company_id:first,related_company_id:second,relationship_type:body.data.type,created_by:ctx.org.memberId}).select('id').single();
 if(r.error)return pgError(r.error);
 return success(r.data,undefined,201);
}
async function route(req:Request,p:Params){try{return await handle(req,p)}catch(e){return serverError(e,'Could not update account relationships.')}}
export {route as GET,route as POST,route as DELETE};
