import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
export async function GET(){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const r=await ctx.supabase.from('crm_commercial_templates').select('*').eq('organization_id',ctx.org.organizationId).order('name').limit(100);return r.error?crmDatabaseError(r.error):success(r.data);}
export async function POST(req:Request){const ctx=await authorize('crm','manage');if(ctx instanceof Response)return ctx;const p=z.object({id:z.uuid().nullable(),revision:z.number().int().nonnegative(),name:z.string().trim().min(1).max(120),sections:z.array(z.object({title:z.string().min(1).max(200),body:z.string().max(20000)})).max(40)}).safeParse(await req.json().catch(()=>null));if(!p.success)return error('Invalid template',422);const r=await ctx.supabase.rpc('crm_commercial_template_save',{p_org:ctx.org.organizationId,p_id:p.data.id,p_revision:p.data.revision,p_name:p.data.name,p_sections:p.data.sections});return r.error?crmDatabaseError(r.error):success({id:r.data});}
