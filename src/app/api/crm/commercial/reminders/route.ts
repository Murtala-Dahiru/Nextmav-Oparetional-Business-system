import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
export async function POST(req:Request){const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;
const p=z.object({recordId:z.uuid(),revision:z.number().int().positive(),days:z.array(z.number().int().min(0).max(3650)).min(1).max(12)}).safeParse(await req.json().catch(()=>null));if(!p.success)return error('Choose 1–12 reminder offsets between 0 and 3650 days',422);
const r=await ctx.supabase.rpc('crm_commercial_remind',{p_org:ctx.org.organizationId,p_record:p.data.recordId,p_revision:p.data.revision,p_days:p.data.days});return r.error?crmDatabaseError(r.error):success({created:r.data});}
