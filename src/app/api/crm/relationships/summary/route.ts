import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
export async function GET(req:Request){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const kind=new URL(req.url).searchParams.get('kind');if(kind!=='company'&&kind!=='contact')return error('Invalid relationship kind',422);const result=await ctx.supabase.rpc('crm_directory_summary',{p_org:ctx.org.organizationId,p_kind:kind});if(result.error)return crmDatabaseError(result.error);return success(result.data)}
