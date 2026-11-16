import { z } from 'zod';
import { authorize } from '@/lib/auth-context';
import { crmDatabaseError as pgError } from '@/lib/crm/database-error';
import { success, error, serverError } from '@/lib/api-response';
const filters = z.object({page:z.coerce.number().int().min(1).max(3334),type:z.enum(['','activity','contact','lead','deal-created','deal-closed','stage','project','invoice','payment','ticket','ticket-resolved','milestone','meeting']),from:z.union([z.iso.date(),z.literal('')]),to:z.union([z.iso.date(),z.literal('')])});
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
  const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid company',422);
  const query=new URL(req.url).searchParams;
  const parsed=filters.safeParse({page:query.get('page')??1,type:query.get('type')??'',from:query.get('from')??'',to:query.get('to')??''});
  if(!parsed.success)return error('Invalid timeline filters',422);
  const {page,type,from,to}=parsed.data;
  if(from&&to&&from>to)return error('Start date must precede end date',422);
  const account=await ctx.supabase.from('companies').select('id').eq('organization_id',ctx.org.organizationId).eq('id',id).is('deleted_at',null).maybeSingle();
  if(account.error)return pgError(account.error);if(!account.data)return error('Company not found',404);
  const result=await ctx.supabase.rpc('crm_relationship_timeline_filtered',{p_org:ctx.org.organizationId,p_company:id,p_offset:(page-1)*30,p_limit:30,p_type:type||null,p_from:from?`${from}T00:00:00Z`:null,p_to:to?new Date(Date.parse(`${to}T00:00:00Z`)+86400000).toISOString():null});
  if(result.error)return pgError(result.error);
  const activityIds=(result.data??[]).filter((e:{event_key:string})=>e.event_key.startsWith('activity:')).map((e:{event_key:string})=>e.event_key.slice(9));
  const actors=new Map<string,string>();
  if(activityIds.length){const people=await ctx.supabase.from('crm_activities').select('id,member:organization_members!crm_activities_member_id_fkey(profiles!organization_members_user_id_fkey(full_name))').eq('organization_id',ctx.org.organizationId).in('id',activityIds);if(people.error)return pgError(people.error);for(const row of people.data??[]){const member=row.member as unknown as {profiles?:{full_name?:string}};if(member?.profiles?.full_name)actors.set(`activity:${row.id}`,member.profiles.full_name)}}
  return success((result.data??[]).map((e:{event_key:string})=>({...e,responsible_name:actors.get(e.event_key)??null})),{page,total:result.data?.[0]?.total_count??0});
 }catch(cause){return serverError(cause,'Could not load relationship history.')}
}
