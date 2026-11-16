import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
export async function GET(){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
 const results=await Promise.all([
  ctx.supabase.from('crm_commercial_policies').select('*').eq('organization_id',ctx.org.organizationId).maybeSingle(),
  ctx.supabase.from('crm_commercial_taxes').select('*').eq('organization_id',ctx.org.organizationId).eq('active',true).order('name').limit(100),
  ctx.supabase.from('crm_commercial_currencies').select('*').order('code'),
 ]);for(const r of results)if(r.error)return crmDatabaseError(r.error);
 return success({policy:results[0].data??{revision:0,allow_self_approval:false,approver_roles:['owner','administrator']},taxes:results[1].data,currencies:results[2].data});
}
export async function POST(req:Request){const ctx=await authorize('crm','manage');if(ctx instanceof Response)return ctx;
 const p=z.object({revision:z.number().int().nonnegative(),allowSelfApproval:z.boolean(),taxName:z.string().max(100).default(''),taxRate:z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).default('0')}).safeParse(await req.json().catch(()=>null));if(!p.success)return error('Invalid policy or tax rate',422);
 const r=await ctx.supabase.rpc('crm_commercial_settings',{p_org:ctx.org.organizationId,p_revision:p.data.revision,p_self:p.data.allowSelfApproval,p_tax_name:p.data.taxName,p_tax_rate:p.data.taxRate});return r.error?crmDatabaseError(r.error):success({saved:true});
}
