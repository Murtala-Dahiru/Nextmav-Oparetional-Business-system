import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {success,error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
type Context={params:Promise<{id:string}>};
export async function POST(req:Request,{params}:Context){
 const ctx=await authorize('crm','edit');if(ctx instanceof Response)return ctx;const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid record',422);
 const visible=await ctx.supabase.rpc('crm_commercial_visible',{p_org:ctx.org.organizationId,p_id:id});if(visible.error)return crmDatabaseError(visible.error);if(!visible.data)return error('Record not found',404);
 let name:string;try{name=decodeURIComponent(req.headers.get('x-file-name')??'').replace(/[\x00-\x1f\/\\]/g,'_');}catch{return error('Invalid filename',422);}if(!name||name.length>250)return error('Invalid filename',422);
 const reader=req.body?.getReader();if(!reader)return error('File required',422);let size=0;const chunks:Uint8Array[]=[];
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>10485760){await reader.cancel();return error('Maximum size is 10 MB',413);}chunks.push(part.value);}
 const bytes=Buffer.concat(chunks);const mime=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
 if(!mime)return error('Upload a PDF, PNG or JPEG with valid file content',415);
 const fileId=randomUUID(),path=`${ctx.org.organizationId}/commercial/${id}/${fileId}`;
 const upload=await ctx.supabase.storage.from('crm-files').upload(path,bytes,{contentType:mime,upsert:false});if(upload.error)return error('Private upload failed',503);
 const r=await ctx.supabase.from('crm_commercial_files').insert({id:fileId,organization_id:ctx.org.organizationId,record_id:id,filename:name,mime_type:mime,size_bytes:size,storage_path:path,sha256:createHash('sha256').update(bytes).digest('hex'),created_by:ctx.org.memberId});
 return r.error?crmDatabaseError(r.error):success({id:fileId});
}
export async function GET(req:Request,{params}:Context){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const {id}=await params;const fileId=new URL(req.url).searchParams.get('file');if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(fileId).success)return error('Invalid file',422);
 const r=await ctx.supabase.from('crm_commercial_files').select('*').eq('organization_id',ctx.org.organizationId).eq('record_id',id).eq('id',fileId!).maybeSingle();if(r.error)return crmDatabaseError(r.error);if(!r.data)return error('File not found',404);
 const file=await ctx.supabase.storage.from('crm-files').download(r.data.storage_path);if(file.error)return error('Private file unavailable',404);
 return new Response(file.data,{headers:{'Content-Type':r.data.mime_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.data.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
}
