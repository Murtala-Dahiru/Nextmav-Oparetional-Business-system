import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {crmDatabaseError as pgError} from '@/lib/crm/database-error';
import {success,error} from '@/lib/api-response';
const kinds=z.enum(['lead','contact','company','deal']);
const types=new Set(['application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export async function GET(req:Request){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const q=new URL(req.url).searchParams;const kind=kinds.safeParse(q.get('kind'));const id=z.uuid().safeParse(q.get('id'));if(!kind.success||!id.success)return error('Invalid record',422);const page=z.coerce.number().int().min(1).max(10000).safeParse(q.get('page')??1);if(!page.success)return error('Invalid page',422);const pageSize=25;const r=await ctx.supabase.from('crm_files').select('id,filename,mime_type,size_bytes,created_by,created_at',{count:'exact'}).eq('organization_id',ctx.org.organizationId).eq('record_kind',kind.data).eq('record_id',id.data).order('created_at',{ascending:false}).order('id',{ascending:false}).range((page.data-1)*pageSize,page.data*pageSize-1);if(r.error)return pgError(r.error);return success(r.data,{page:page.data,pageSize,total:r.count??0,totalPages:Math.ceil((r.count??0)/pageSize)});}
export async function POST(req:Request){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;const q=new URL(req.url).searchParams;const kind=kinds.safeParse(q.get('kind'));const record=z.uuid().safeParse(q.get('id'));if(!kind.success||!record.success)return error('Invalid record',422);
 let filename:string;try{filename=decodeURIComponent(req.headers.get('x-file-name')??'').replace(/[\x00-\x1f\/\\]/g,'_');}catch{return error('Invalid filename',422);}if(!filename||filename.length>250)return error('Filename must be 1–250 characters',422);
 const mime=req.headers.get('content-type')?.split(';')[0]??'';if(!types.has(mime))return error('Choose a PDF, image, text, CSV, Word or Excel file.',415);
 const access=await ctx.supabase.rpc('crm_entity_visible',{p_org:ctx.org.organizationId,p_kind:kind.data,p_id:record.data});if(access.error)return pgError(access.error);if(!access.data)return error('Record not found',404);
 const reader=req.body?.getReader();if(!reader)return error('File required',422);const chunks:Uint8Array[]=[];let size=0;try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>10485760){await reader.cancel();return error('Maximum attachment size is 10 MB.',413);}chunks.push(p.value);}}catch{return error('Upload interrupted',422);}if(!size)return error('Empty files are not supported',422);
 const id=randomUUID();const path=`${ctx.org.organizationId}/${kind.data}/${record.data}/${id}`;
 const uploaded=await ctx.supabase.storage.from('crm-files').upload(path,Buffer.concat(chunks),{contentType:mime,upsert:false});if(uploaded.error)return error('File storage is unavailable. Check that the CRM storage migration has been applied.',503);
 const r=await ctx.supabase.from('crm_files').insert({id,organization_id:ctx.org.organizationId,record_kind:kind.data,record_id:record.data,filename,mime_type:mime,size_bytes:size,storage_path:path,created_by:ctx.org.memberId});if(r.error){await ctx.supabase.storage.from('crm-files').remove([path]);return pgError(r.error);}return success({id},undefined,201);
}
