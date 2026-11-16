import {authorize} from '@/lib/auth-context';
import {crmDatabaseError as pgError} from '@/lib/crm/database-error';
import {success,error} from '@/lib/api-response';
import {captureFormSchema} from '@/lib/crm/capture';
export async function GET(){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const r=await ctx.supabase.from('crm_capture_forms').select('*').eq('organization_id',ctx.org.organizationId).order('created_at',{ascending:false});if(r.error)return pgError(r.error);return success(r.data);}
export async function POST(req:Request){const ctx=await authorize('crm','manage');if(ctx instanceof Response)return ctx;let raw:unknown;try{raw=await req.json();}catch{return error('Invalid JSON',422);}const p=captureFormSchema.safeParse(raw);if(!p.success)return error(p.error.issues[0]?.message??'Invalid form',422);const{id,version,...config}=p.data;const r=await ctx.supabase.rpc('crm_save_capture_form',{p_org:ctx.org.organizationId,p_id:id,p_version:version,p_config:config});if(r.error?.code==='40001')return error('This capture form changed. Reload before saving.',409);if(r.error)return pgError(r.error);return success({id:r.data});}
