import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
export async function GET(req:Request){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
 const q=new URL(req.url).searchParams;const from=z.iso.date().safeParse(q.get('from'));const to=z.iso.date().safeParse(q.get('to'));
 if(!from.success||!to.success||from.data>to.data||(Date.parse(to.data)-Date.parse(from.data))/86400000>730)return error('Choose a date range of at most two years.',422);
 const result=await ctx.supabase.rpc('crm_sales_targets',{p_org:ctx.org.organizationId,p_from:from.data,p_to:to.data,p_zone:ctx.org.timezone});
 if(result.error)return crmDatabaseError(result.error);return success(result.data);
}
