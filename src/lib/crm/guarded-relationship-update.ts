import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { toSnake } from '@/lib/case';
import { recordActivity } from '@/lib/activity';
/** Compare-and-swap for profile forms; legacy callers retain their existing handler. */
export function guardedRelationshipUpdate(table:'companies'|'contacts',schema:z.ZodType,select:string,legacy:(req:Request,p:{params:Promise<{id:string}>})=>Promise<Response>) {
 return async(req:Request,p:{params:Promise<{id:string}>})=>{
  try {
   const body=await req.clone().json();
   if(!Object.hasOwn(body,'expectedUpdatedAt'))return legacy(req,p);
   const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;
   const{id}=await p.params;
   if(!z.uuid().safeParse(id).success||!z.iso.datetime({offset:true}).safeParse(body.expectedUpdatedAt).success)return error('Invalid record version',422);
   const {expectedUpdatedAt,...values}=body;
   const parsed=schema.safeParse(values);if(!parsed.success)return error(parsed.error.issues[0]?.message||'Invalid profile',422);
   const result=await ctx.supabase.from(table).update(toSnake<Record<string,unknown>>(parsed.data)).eq('organization_id',ctx.org.organizationId).eq('id',id).eq('updated_at',expectedUpdatedAt).is('deleted_at',null).select(select).maybeSingle();
   if(result.error)return pgError(result.error);
   if(!result.data)return error('This record changed or is no longer available. Your draft is preserved; reopen the record before saving.',409,'CRM_RECORD_CONFLICT');
   recordActivity(ctx,{table,action:'update',row:result.data});
   return success(result.data);
  }catch(cause){return serverError(cause,'Could not save relationship details.')}
 }
}
