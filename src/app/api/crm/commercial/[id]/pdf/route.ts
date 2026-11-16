import PDFDocument from 'pdfkit';
import {z} from 'zod';
import {authorize} from '@/lib/auth-context';
import {error} from '@/lib/api-response';
import {crmDatabaseError} from '@/lib/crm/database-error';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const {id}=await params;if(!z.uuid().safeParse(id).success)return error('Invalid record',422);
 const record=await ctx.supabase.from('crm_commercial_records').select('*,company:companies(name)').eq('organization_id',ctx.org.organizationId).eq('id',id).maybeSingle();if(record.error)return crmDatabaseError(record.error);if(!record.data)return error('Record not found',404);
 let r=record.data;const version=new URL(req.url).searchParams.get('version');
 if(version){if(!z.uuid().safeParse(version).success)return error('Invalid version',422);const v=await ctx.supabase.from('crm_commercial_versions').select('snapshot').eq('organization_id',ctx.org.organizationId).eq('record_id',id).eq('id',version).maybeSingle();if(v.error)return crmDatabaseError(v.error);if(!v.data)return error('Version not found',404);r={...v.data.snapshot,company:r.company};}
 const doc=new PDFDocument({size:'A4',margins:{top:64,bottom:60,left:48,right:48},bufferPages:true,info:{Title:r.title,Author:ctx.org.organizationName,Subject:`${r.number} revision ${r.revision}`}});
 const chunks:Buffer[]=[];const done=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(b:Buffer)=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const text=(value:unknown)=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
 const heading=(title:string)=>{if(doc.y>710)doc.addPage();doc.moveDown(.7).font('Helvetica-Bold').fontSize(12).fillColor('#162033').text(text(title));doc.moveDown(.35).font('Helvetica').fontSize(10).fillColor('#334155');};
 doc.font('Helvetica-Bold').fontSize(23).fillColor('#162033').text(text(r.title));doc.moveDown(.5).font('Helvetica').fontSize(10).fillColor('#475569').text(`${r.number}  |  Revision ${r.revision}  |  ${version?'Historical snapshot':r.status}`);
 doc.moveDown().text(`Prepared for: ${text(r.customerName??r.company?.name)}`).text(`Issue date: ${r.issue_date}`).text(`Validity / expiration: ${r.expires_on??'Not specified'}`);
 const c=r.content??{};if(c.parties){heading('Legal parties');doc.text(text(c.parties));}
 for(const s of c.sections??[]){heading(s.title);doc.text(text(s.body),{lineGap:3});}
 const p=r.pricing??{};heading(r.quote_version_id?'Commercial investment — linked quote snapshot':'Commercial investment');
 for(const [i,line] of (p.lines??[]).entries()){
  if(doc.y>680)doc.addPage();doc.font('Helvetica-Bold').text(`${i+1}. ${text(line.description)}`);doc.font('Helvetica').text(`${line.quantity} ${text(line.unit)} x ${r.currency} ${line.unitPrice} | Discount ${line.discount} | ${text(line.taxName)} (${line.taxRate}%) ${line.tax} | Total ${line.total}`,{lineGap:3}).moveDown(.5);
 }
 for(const [label,key] of [['Subtotal','subtotal'],['Discount','discount'],['Tax','tax'],['Additional non-taxable charges','charges'],['Total','total']])doc.font(key==='total'?'Helvetica-Bold':'Helvetica').text(`${label}: ${r.currency} ${p[key]??'0'}`,{align:'right'});
 for(const [label,key] of [['Payment terms','paymentTerms'],['Delivery terms','deliveryTerms'],['Commercial notes','notes'],['Billing frequency','billingFrequency'],['Termination terms','terminationTerms']])if(c[key]){heading(label);doc.text(text(c[key]),{lineGap:3});}
 if(r.kind==='contract'){heading('Term and renewal');doc.text(`Effective: ${r.effective_on??'Not specified'} | Expires: ${r.expires_on??'Not specified'}\nRenewal: ${c.renewalType??'unknown'} | Notice period: ${c.noticeDays??0} days`);}
 heading('Document information');doc.fontSize(8).text('Commercial values are not invoices or collected revenue. Internal approval and document export are not customer signatures.');
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(text(r.organizationName??ctx.org.organizationName),48,30,{lineBreak:false});doc.text(`${r.number}  |  ${i+1} / ${range.count}`,48,810,{lineBreak:false});}
 doc.end();const bytes=await done;
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${r.number}.pdf"`,'Cache-Control':'private, no-store'}});
}
