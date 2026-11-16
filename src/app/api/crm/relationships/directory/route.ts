import { z } from 'zod';
import { authorize } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { crmDatabaseError } from '@/lib/crm/database-error';
export async function GET(req:Request) {
 try {const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;
 const q=new URL(req.url).searchParams;
 const parsed=z.object({kind:z.enum(['company','contact']),ids:z.array(z.uuid()).min(1).max(100)}).safeParse({kind:q.get('kind'),ids:(q.get('ids')??'').split(',')});
 if(!parsed.success)return error('Invalid directory request',422);
 const result=await ctx.supabase.rpc('crm_relationship_directory',{p_org:ctx.org.organizationId,p_kind:parsed.data.kind,p_ids:parsed.data.ids});
 if(result.error)return crmDatabaseError(result.error);return success(result.data);
 }catch(cause){return serverError(cause,'Could not load relationship context.')}
}
