import {authorize,pgError} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {z} from 'zod';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}) {
  const ctx=await authorize('crm','view');if(ctx instanceof Response) return ctx;
  const {id}=await params;if(!z.uuid().safeParse(id).success) return error('Invalid lead',422);
  const result=await ctx.supabase.rpc('crm_lead_duplicates',{p_org:ctx.org.organizationId,p_lead:id});
  if(result.error?.code==='PGRST202') return error('Duplicate review requires the CRM merge migration.',503,'CRM_SCHEMA_REQUIRED');
  if(result.error) return pgError(result.error);
  return success(result.data ?? []);
}
