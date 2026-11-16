import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect,readEnv} from './db-connect.mjs';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-commercial-fixture.json'))),base=process.env.APP_URL||'http://localhost:3012';
const cookie=f.cookies.map(([k,v])=>`${k}=${v}`).join('; ');let passed=0;
function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++;}
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});return {status:r.status,json:await r.json().catch(()=>null)};}
async function api(path,body){const r=await call(path,body);assert.ok(r.status>=200&&r.status<300,`${path} ${r.status} ${JSON.stringify(r.json)}`);return r.json.data;}
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:20000});const sql=async(q,p=[]) => (await client.query(q,p)).rows;
const load=id=>api(`/api/crm/commercial/${id}`);const act=async(r,operation,evidenceId=null)=>load((await api(`/api/crm/commercial/${r.id}`,{revision:r.revision,operation,note:'Final isolated acceptance evidence',evidenceId})).id);
const form=r=>({id:r.id,revision:r.revision,kind:r.kind,title:r.title,companyId:r.companyId,contactId:r.contactId??'',dealId:r.dealId??'',ownerId:r.ownerId,parentId:r.parentId??'',quoteVersionId:r.quoteVersionId??'',currency:r.currency,issueDate:r.issueDate,expiresOn:r.expiresOn??'',effectiveOn:r.effectiveOn??'',content:r.content});
try{
 let source=await load(f.quoteId),revised=await act(source,'revise');revised=await act(revised,'submit');revised=await act(revised,'approve');revised=await act(revised,'issue');
 check((await load(source.id)).status==='superseded','issued replacement supersedes prior offer without deleting its versions');
 check((await load(source.id)).versions.some(v=>v.id===source.issuedVersionId),'superseded historical offer remains available');
 revised=await act(revised,'record_sent');revised=await act(revised,'accept');check(revised.status==='accepted','authorized customer acceptance is recorded with evidence');
 const template=await api('/api/crm/commercial/templates',{id:null,revision:0,name:'Reusable acceptance '+Date.now(),sections:[{title:'Scope',body:'Reusable customer scope'}]});
 let t=(await api('/api/crm/commercial/templates')).find(x=>x.id===template.id);check(t.sections[0].body==='Reusable customer scope','organization proposal template persists');
 await api('/api/crm/commercial/templates',{id:t.id,revision:t.revision,name:t.name,sections:[{title:'Updated scope',body:'Updated template content'}]});
 check((await call('/api/crm/commercial/templates',{id:t.id,revision:t.revision,name:t.name,sections:t.sections})).status===409,'stale template update rejected');
 const company=await api('/api/crm/companies',{name:'Alternate customer acceptance'});
 const draft=await act(revised,'revise');
 check((await call('/api/crm/commercial',{...form(draft),companyId:company.id})).status===403,'contact/customer mismatch rejected');
 const foreign=(await sql("select c.id from companies c join organizations o on o.id=c.organization_id where o.name='Commercial Hub isolated acceptance' and c.organization_id<>$1 limit 1",[f.orgId]))[0];
 check((await call('/api/crm/commercial',{...form(draft),companyId:foreign.id,contactId:''})).status===403,'cross-tenant customer association rejected');
 const results=await Promise.all([call('/api/crm/commercial',{...form(draft),title:'Race save A'}),call('/api/crm/commercial',{...form(draft),title:'Race save B'})]);check(results.filter(x=>x.status===200).length===1&&results.filter(x=>x.status===409).length===1,'concurrent draft saves preserve one revision winner');
 const badUpload=await fetch(`${base}/api/crm/commercial/${f.contractId}/files`,{method:'POST',headers:{cookie,'X-File-Name':'fake.pdf'},body:'<html>not a PDF</html>'});check(badUpload.status===415,'file content masquerading as PDF rejected');
 const unauthorizedPdf=await fetch(`${base}/api/crm/commercial/${f.quoteId}/pdf`);check(unauthorizedPdf.status===401,'unauthenticated export denied');
 const quotePdf=await fetch(`${base}/api/crm/commercial/${f.quoteId}/pdf?version=${source.issuedVersionId}`,{headers:{cookie}});check(quotePdf.status===200,'historical quote PDF remains downloadable');
 writeFileSync('docs/commercial-evidence/historical-quote.pdf',Buffer.from(await quotePdf.arrayBuffer()));
 const backup=(await sql('select id from organization_members where organization_id=$1 and id<>$2 and role=$3 limit 1',[f.orgId,f.ownerId,'owner']))[0].id;
 await sql('update crm_commercial_records set owner_id=$1 where id=$2',[backup,draft.id]);await sql("update organization_members set role='sales_staff' where id=$1",[f.ownerId]);
 try{check((await call(`/api/crm/commercial/${draft.id}`)).status===404,'sales staff cannot read another owner commercial record');check((await call(`/api/crm/commercial/${draft.id}/pdf`)).status===404,'restricted record PDF export denied');}
 finally{await sql("update organization_members set role='owner' where id=$1",[f.ownerId]);}
 const p=(await sql('select crm_commercial_price($1,$2,$3) p',[f.orgId,'KWD',{...source.content,items:[{description:'Three decimal currency',quantity:'1.5',unit:'unit',unitPrice:'1.001',discountPercent:'0',taxId:''}],discountPercent:'0',charges:'0',taxInclusive:false}]))[0].p;check(p.total==='1.502','three-decimal currency uses explicit half-up rounding');
 check((await api(`/api/crm/commercial?companyId=${f.companyId}`)).length>0,'company-linked commercial directory returns authorized records');
 console.log(`${passed} final acceptance assertions passed.`);
}finally{await client.end();}
