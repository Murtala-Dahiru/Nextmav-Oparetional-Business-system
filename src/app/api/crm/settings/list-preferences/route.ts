import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { crmObjectSchema } from '@/lib/crm/customization';
const schema=z.object({object:crmObjectSchema,version:z.number().int().nonnegative(),settings:z.object({density:z.enum(['comfortable','compact']),hidden:z.array(z.string().min(1).max(140)).max(140),order:z.array(z.string().min(1).max(140)).max(140)}).strict()}).strict();
export async function GET(req:Request) {
 const ctx=await authorize('crm');if(ctx instanceof Response)return ctx;
 const object=crmObjectSchema.safeParse(new URL(req.url).searchParams.get('object'));if(!object.success)return error('Invalid CRM object',422);
 const result=await ctx.supabase.from('crm_list_preferences').select('version,settings,default_view_id').eq('organization_id',ctx.org.organizationId).eq('member_id',ctx.org.memberId).eq('object',object.data).maybeSingle();
 return result.error?pgError(result.error):success(result.data??{version:0,settings:null});
}
export async function POST(req:Request) {
 const ctx=await authorize('crm');if(ctx instanceof Response)return ctx;
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return error('Invalid list presentation',422);
 const result=await ctx.supabase.rpc('crm_list_preferences_save',{p_org:ctx.org.organizationId,p_object:parsed.data.object,p_version:parsed.data.version,p_settings:parsed.data.settings});
 return result.error?pgError(result.error):success({version:result.data});
}
