import { z } from 'zod';
import { authorize } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { crmDatabaseError } from '@/lib/crm/database-error';
import { commercialSaveSchema, commercialKinds } from '@/lib/crm/commercial';

export async function GET(req: Request) {
 const ctx = await authorize('crm', 'view'); if (ctx instanceof Response) return ctx;
 const u = new URL(req.url).searchParams, page = Math.max(1, Math.min(10000, Number(u.get('page')) || 1));
 if (u.get('view') === 'overview') { const r = await ctx.supabase.rpc('crm_commercial_overview', {p_org:ctx.org.organizationId}); return r.error ? crmDatabaseError(r.error) : success(r.data); }
 let q = ctx.supabase.from('crm_commercial_records').select('id,kind,number,title,company_id,contact_id,deal_id,owner_id,parent_id,currency,total,status,revision,issue_date,expires_on,effective_on,updated_at,created_at,company:companies(name)', {count:'exact'}).eq('organization_id',ctx.org.organizationId);
 const kind = u.get('kind'); if (kind && commercialKinds.includes(kind as typeof commercialKinds[number])) q=q.eq('kind',kind);
 for (const [param,column] of [['companyId','company_id'],['contactId','contact_id'],['dealId','deal_id'],['ownerId','owner_id']] as const) { const v=u.get(param); if(v && z.uuid().safeParse(v).success) q=q.eq(column,v); }
 if(u.get('status')) q=q.eq('status',u.get('status')!.slice(0,40));
 for(const [param,method] of [['from','gte'],['to','lte']] as const) {const v=u.get(param);if(v&&z.iso.date().safeParse(v).success) q=q[method]('issue_date',v);}
 const search=u.get('search')?.replace(/[^\p{L}\p{N} \-]/gu,'').slice(0,100);if(search) q=q.or(`title.ilike.%${search}%,number.ilike.%${search}%`);
 const sort=['title','total','expires_on','updated_at','issue_date'].includes(u.get('sort')??'')?u.get('sort')!:'updated_at';
 const r=await q.order(sort,{ascending:u.get('direction')==='asc',nullsFirst:false}).order('id').range((page-1)*20,page*20-1);
 return r.error?crmDatabaseError(r.error):paginated(r.data??[],r.count??0,page,20);
}
export async function POST(req: Request) {
 const ctx=await authorize('crm','create');if(ctx instanceof Response)return ctx;
 let raw:unknown;try {raw=await req.json();}catch{return error('Invalid JSON',422);}
 const p=commercialSaveSchema.safeParse(raw);if(!p.success)return error(p.error.issues[0]?.message??'Invalid commercial record',422);
 const {id,revision,...data}=p.data;
 const r=await ctx.supabase.rpc('crm_commercial_save',{p_org:ctx.org.organizationId,p_id:id,p_revision:revision,p_data:data});
 return r.error?crmDatabaseError(r.error):success({id:r.data});
}
