import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { crmObjectSchema, presentationSchema } from '@/lib/crm/customization';
import { parseCustomFilter } from '@/lib/crm/custom-filter';
const settings = z.object({presentation:presentationSchema.optional(),search:z.string().max(250),sort:z.string().max(40),sortDir:z.enum(['asc','desc']),filters:z.record(z.string().max(40),z.string().max(12000))}).strict();
const save=z.object({object:crmObjectSchema,name:z.string().trim().min(1).max(60),scope:z.enum(['organization','team','personal']),settings}).strict();
export async function GET(req:Request) {
 const ctx=await authorize('crm');if(ctx instanceof Response)return ctx;
 const obj=crmObjectSchema.safeParse(new URL(req.url).searchParams.get('object'));if(!obj.success)return error('Invalid object',422);
 const result=await ctx.supabase.from('crm_shared_views').select('id,name,department_id,settings,is_personal').eq('organization_id',ctx.org.organizationId).eq('object',obj.data).order('name').limit(120);
 if(result.error)return pgError(result.error);
 return success({rows:result.data,organization:['owner','administrator'].includes(ctx.org.role),team:!!ctx.org.departmentId&&['owner','administrator','manager'].includes(ctx.org.role)});
}
export async function POST(req:Request) {
 const ctx=await authorize('crm');if(ctx instanceof Response)return ctx;
 const raw=await req.json().catch(()=>null);const parsed=save.safeParse(raw);
 if(!parsed.success)return error('Invalid view settings',422);
 const p=parsed.data;
 try{if(p.settings.filters.custom)parseCustomFilter(p.settings.filters.custom);}catch{return error('Invalid custom filter',422);}
 const result=await ctx.supabase.rpc('crm_shared_view_save',{p_org:ctx.org.organizationId,p_object:p.object,p_name:p.name,p_scope:p.scope,p_settings:p.settings});
 return result.error?pgError(result.error):success({id:result.data});
}
export async function DELETE(req:Request) {
 const ctx=await authorize('crm');if(ctx instanceof Response)return ctx;
 const p=z.object({id:z.uuid(),object:crmObjectSchema}).strict().safeParse(await req.json().catch(()=>null));if(!p.success)return error('Invalid view',422);
 const result=await ctx.supabase.rpc('crm_shared_view_save',{p_org:ctx.org.organizationId,p_object:p.data.object,p_name:null,p_scope:null,p_settings:null,p_remove:p.data.id});
 return result.error?pgError(result.error):success({id:result.data});
}
