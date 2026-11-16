import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
import {z} from 'zod';
export async function GET(req:Request){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const u=new URL(req.url).searchParams;const type=u.get('type')??'company';const search=(u.get('search')??'').replace(/[%_]/g,'').slice(0,100);const company=u.get('companyId');
 if(type==='quoteVersion') {const r=await ctx.supabase.from('crm_commercial_versions').select('id,revision,purpose,snapshot').eq('organization_id',ctx.org.organizationId).in('purpose',['approved','issued']).eq('snapshot->>kind','quote').eq('snapshot->>company_id',company??'').order('created_at',{ascending:false}).limit(40);return r.error?crmDatabaseError(r.error):success((r.data??[]).map(v=>({id:v.id,name:`${v.snapshot.number} · ${v.purpose} v${v.revision} · ${v.snapshot.currency} ${v.snapshot.total}`})));}
 if(type==='member'){const r=await ctx.supabase.from('organization_members').select('id,profiles!organization_members_user_id_fkey(full_name)').eq('organization_id',ctx.org.organizationId).eq('is_active',true).is('deleted_at',null).in('role',['owner','administrator','manager','sales_staff']).limit(100);return r.error?crmDatabaseError(r.error):success((r.data??[]).map(x=>({id:x.id,name:(x.profiles as unknown as {full_name:string})?.full_name??'Member'})));}
 const config=({company:['companies','name'],contact:['contacts','first_name'],deal:['deals','name'],product:['products','name']} as const)[type as 'company'];if(!config)return error('Invalid lookup',422);
 const [table,column]=config;let q=ctx.supabase.from(table).select(type==='product'?'id,name,description,unit,price':type==='contact'?'id,first_name,last_name':`id,${column}`).eq('organization_id',ctx.org.organizationId).is('deleted_at',null).ilike(column,`%${search}%`);
 if(company&&z.uuid().safeParse(company).success&&['contact','deal'].includes(type))q=q.eq('company_id',company);
 const r=await q.order(column).limit(30);return r.error?crmDatabaseError(r.error):success((r.data??[]).map(x=>{const row=x as unknown as Record<string,unknown>;return {...row,name:type==='contact'?`${row.first_name} ${row.last_name??''}`:row.name};}));
}
