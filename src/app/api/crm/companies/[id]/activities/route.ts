import {z} from 'zod';
import {authorize,pgError} from '@/lib/auth-context';
import {error,paginated,serverError} from '@/lib/api-response';

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
  const {id}=await params,q=new URL(req.url).searchParams;
  const parsed=z.object({id:z.uuid(),page:z.coerce.number().int().min(1).max(10000),pageSize:z.coerce.number().int().min(1).max(100)}).safeParse({id,page:q.get('page')??1,pageSize:q.get('pageSize')??20});
  if(!parsed.success)return error('Invalid account activity request',422);
  const org=ctx.org.organizationId;
  const contact=await ctx.supabase.from('companies').select('id').eq('id',id).eq('organization_id',org).is('deleted_at',null).maybeSingle();
  if(contact.error)return pgError(contact.error);if(!contact.data)return error('Account not found',404);
  const {page,pageSize}=parsed.data;
  let query=ctx.supabase.from('crm_visible_activities').select('*, member:organization_members!crm_activities_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))',{count:'exact'}).eq('organization_id',org).eq('account_company_id',id);
  const open=q.get('due')==='open';
  if(open)query=query.is('completed_at',null).not('due_at','is',null);
  const result=await query.order(open?'due_at':'created_at',{ascending:open}).order('id').range((page-1)*pageSize,page*pageSize-1);
  if(result.error)return pgError(result.error);
  return paginated(result.data??[],result.count??0,page,pageSize);
 }catch(cause){return serverError(cause,'Account activities could not be loaded.')}
}
