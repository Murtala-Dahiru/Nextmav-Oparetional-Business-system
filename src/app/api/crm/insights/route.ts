import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {crmDatabaseError as pgError} from '@/lib/crm/database-error';
import {success,error} from '@/lib/api-response';
import {todayIn} from '@/lib/org-time';
export async function GET(req:Request){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const q=new URL(req.url).searchParams;const zone=ctx.org.timezone;const today=todayIn(zone);const from=q.get('from')??`${today.slice(0,4)}-01-01`;const to=q.get('to')??today;if(!z.iso.date().safeParse(from).success||!z.iso.date().safeParse(to).success||from>to||(Date.parse(to)-Date.parse(from))/86400000>730)return error('Choose a date range of at most two years.',422);const r=await ctx.supabase.rpc('crm_sales_insights',{p_org:ctx.org.organizationId,p_from:from,p_to:to,p_zone:zone});if(r.error)return pgError(r.error);return success(r.data);}
