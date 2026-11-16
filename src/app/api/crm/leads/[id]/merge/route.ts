import {authorize,pgError} from '@/lib/auth-context';
import {success,error,serverError} from '@/lib/api-response';
import {leadMergeSchema} from '@/lib/crm/merge';
import {z} from 'zod';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
  const ctx=await authorize('crm','delete');if(ctx instanceof Response) return ctx;
  const {id}=await params;if(!z.uuid().safeParse(id).success) return error('Invalid lead',422);
  let body:unknown;try{body=await req.json();}catch{return error('Invalid JSON',422);}
  const parsed=leadMergeSchema.safeParse(body);if(!parsed.success) return error('Review every field and both current records before merging.',422);
  const p=parsed.data;
  try {
    const result=await ctx.supabase.rpc('crm_merge_leads',{p_org:ctx.org.organizationId,p_source:id,p_target:p.targetId,p_source_updated:p.sourceUpdated,p_target_updated:p.targetUpdated,p_choices:p.choices,p_request:p.requestKey});
    if(result.error?.code==='40001') return error('A lead changed. Reload both records and review your choices again.',409,'CRM_MERGE_CONFLICT');
    if(result.error?.code==='PGRST202') return error('Merging requires the CRM merge migration.',503,'CRM_SCHEMA_REQUIRED');
    if(result.error) return pgError(result.error);
    return success(result.data);
  } catch(cause) {return serverError(cause,'Could not merge these leads.');}
}
