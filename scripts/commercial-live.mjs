import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {connect,readEnv} from './db-connect.mjs';
process.loadEnvFile('.env');
const base=process.env.APP_URL||'http://localhost:3012',admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const fixture={email:`commercial-${randomUUID()}@example.com`,password:`Test!${randomUUID()}9a`};
const jar=new Map();let passed=0;
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000)});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return {status:r.status,json:await r.json().catch(()=>null)};}
async function good(path,method='GET',body){const r=await call(path,method,body);assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${JSON.stringify(r.json)}`);return r.json.data;}
function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++;}
const created=await admin.auth.admin.createUser({email:fixture.email,password:fixture.password,email_confirm:true,user_metadata:{first_name:'Commercial',last_name:'Acceptance'}});assert.ifError(created.error);fixture.userId=created.data.user.id;
await good('/api/auth/login','POST',{email:fixture.email,password:fixture.password});fixture.orgId=(await good('/api/organizations','POST',{name:'Commercial Hub isolated acceptance'})).id;
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:20000});const sql=async(q,p=[]) => (await client.query(q,p)).rows;
try{
 fixture.ownerId=(await sql('select id from organization_members where organization_id=$1 and user_id=$2',[fixture.orgId,fixture.userId]))[0].id;
 const backup=await admin.auth.admin.createUser({email:`commercial-backup-${randomUUID()}@example.com`,password:`Test!${randomUUID()}9a`,email_confirm:true});assert.ifError(backup.error);
 await sql("insert into organization_members(organization_id,user_id,role) values($1,$2,'owner')",[fixture.orgId,backup.data.user.id]);
 fixture.companyId=(await good('/api/crm/companies','POST',{name:'Northstar Acceptance Ltd'})).id;
 fixture.contactId=(await good('/api/crm/contacts','POST',{firstName:'Alex',lastName:'Buyer',companyId:fixture.companyId})).id;
 const blank={items:[],sections:[],discountPercent:'0',charges:'0',taxInclusive:false,paymentTerms:'Net 30 days',deliveryTerms:'Milestones agreed in writing',notes:'Acceptance fixture',internalNotes:'PRIVATE INTERNAL NOTE',parties:'',contractType:'Service agreement',billingFrequency:'Monthly',terminationTerms:'30 days written notice',renewalType:'manual',noticeDays:30};
 const form=(kind,title,extra={})=>({id:null,revision:0,kind,title,companyId:fixture.companyId,contactId:fixture.contactId,dealId:'',ownerId:fixture.ownerId,parentId:'',quoteVersionId:'',currency:'USD',issueDate:'2026-10-29',expiresOn:'2027-10-29',effectiveOn:'2026-10-01',content:{...blank},...extra});
 const load=id=>good(`/api/crm/commercial/${id}`);const save=async body=>load((await good('/api/crm/commercial','POST',body)).id);const act=async(r,operation,note='',evidenceId=null)=>load((await good(`/api/crm/commercial/${r.id}`,'POST',{revision:r.revision,operation,note,evidenceId})).id);
 const asForm=r=>({id:r.id,revision:r.revision,kind:r.kind,title:r.title,companyId:r.companyId,contactId:r.contactId??'',dealId:r.dealId??'',ownerId:r.ownerId,parentId:r.parentId??'',quoteVersionId:r.quoteVersionId??'',currency:r.currency,issueDate:r.issueDate,expiresOn:r.expiresOn??'',effectiveOn:r.effectiveOn??'',content:r.content});
 await good('/api/crm/commercial/settings','POST',{revision:0,allowSelfApproval:false,taxName:'Explicit test VAT',taxRate:'7.5'});
 const settings=await good('/api/crm/commercial/settings');const tax=settings.taxes[0].id;
 const line={description:'Implementation consulting',quantity:'3',unit:'day',unitPrice:'0.10',discountPercent:'0',taxId:tax};
 let quote=await save(form('quote','Northstar implementation offer',{content:{...blank,items:[line],discountPercent:'10',charges:'0.02'}}));fixture.quoteId=quote.id;
 check(quote.pricing.subtotal==='0.30'&&quote.pricing.discount==='0.03'&&quote.pricing.tax==='0.02'&&quote.pricing.total==='0.31','decimal-safe line, document discount, tax and charge totals');
 let wrong=await call('/api/crm/commercial','POST',{...asForm(quote),content:{...quote.content,items:[{...line,unitPrice:'0.001'}]}});check(wrong.status===422,'invalid monetary precision rejected, not silently rounded');
 quote=await save({...asForm(quote),content:{...quote.content,items:[{...line,unitPrice:'1250.50'},{...line,description:'Optional workshop',quantity:'2',unitPrice:'500.25'}]}});
 check(quote.pricing.lines.length===2,'edit quote and add line item');
 const old=quote;quote=await save({...asForm(quote),content:{...quote.content,items:quote.content.items.slice(0,1)}});check(quote.pricing.lines.length===1,'remove line item');
 check((await call('/api/crm/commercial','POST',asForm(old))).status===409,'stale draft save rejected');
 quote=await act(quote,'submit');check(quote.status==='pending_approval','submit quote for immutable revision review');
 check((await call(`/api/crm/commercial/${quote.id}`,'POST',{revision:quote.revision,operation:'approve',note:''})).status===403,'default self-approval denied');
 await good('/api/crm/commercial/settings','POST',{revision:settings.policy.revision,allowSelfApproval:true,taxName:'',taxRate:'0'});
 const pending=quote;const race=await Promise.all([call(`/api/crm/commercial/${quote.id}`,'POST',{revision:quote.revision,operation:'approve',note:'Reviewed'}),call(`/api/crm/commercial/${quote.id}`,'POST',{revision:quote.revision,operation:'approve',note:'Duplicate'})]);
 check(race.filter(x=>x.status===200).length===1&&race.filter(x=>x.status===409).length===1,'approval race permits one decision only');quote=await load(quote.id);
 check((await call(`/api/crm/commercial/${quote.id}`,'POST',{revision:pending.revision,operation:'reject',note:'Stale'})).status===409,'stale approval rejected');
 quote=await act(quote,'issue');check(!!quote.issuedVersionId,'approved quote issued as immutable version');
 const issuedVersion=quote.issuedVersionId,issuedTotal=quote.total;
 const revision=await act(quote,'revise','New scope');check(revision.id!==quote.id&&(await load(quote.id)).total===issuedTotal,'revision creates new draft preserving original offer');
 const second=await save(form('quote','JPY offer',{currency:'JPY',content:{...blank,items:[{...line,unitPrice:'100',taxId:''}]}}));check(second.total===300,'zero-decimal currency supported');
 const overview=await good('/api/crm/commercial?view=overview');check(overview.currencies.some(x=>x.currency==='JPY')&&overview.currencies.some(x=>x.currency==='USD'),'overview keeps currency totals separate');
 let proposal=await save(form('proposal','Northstar delivery proposal',{quoteVersionId:issuedVersion,content:{...blank,sections:[{title:'Executive summary',body:'Improve commercial operations with connected delivery.'},{title:'Scope of work',body:'Discovery, configuration and adoption.\n'+('Detailed delivery milestone and acceptance criteria. '.repeat(120))},{title:'Next steps',body:'Review the proposal and confirm the decision in writing.'}]}}));fixture.proposalId=proposal.id;
 check(proposal.pricing.total===quote.pricing.total,'proposal references authoritative approved quote snapshot');
 proposal=await save({...asForm(proposal),content:{...proposal.content,sections:[proposal.content.sections[1],proposal.content.sections[0],proposal.content.sections[2]]}});check(proposal.content.sections[0].title==='Scope of work','proposal section order saved');
 let contract=await save(form('contract','Northstar service agreement',{content:{...blank,parties:'Commercial Hub Acceptance and Northstar Acceptance Ltd',items:[{...line,unitPrice:'5000',quantity:'1',taxId:''}]}}));fixture.contractId=contract.id;
 contract=await act(contract,'submit');contract=await act(contract,'approve');
 check((await call(`/api/crm/commercial/${contract.id}`,'POST',{revision:contract.revision,operation:'execute',note:'No evidence',evidenceId:null})).status===403,'execution without private evidence denied');
 mkdirSync('docs/commercial-evidence',{recursive:true});
 const cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
 for(const [name,record] of [['quote',quote],['proposal',proposal],['contract',contract]]){const response=await fetch(`${base}/api/crm/commercial/${record.id}/pdf`,{headers:{cookie}});assert.equal(response.status,200,`${name} PDF`);const bytes=Buffer.from(await response.arrayBuffer());check(bytes.subarray(0,5).toString()==='%PDF-'&&bytes.length>1000,`${name} complete PDF generated`);writeFileSync(`docs/commercial-evidence/${name}.pdf`,bytes);if(name==='contract'){
 const upload=await fetch(`${base}/api/crm/commercial/${contract.id}/files`,{method:'POST',headers:{cookie,'X-File-Name':'externally-executed-test.pdf'},body:bytes});assert.equal(upload.status,200);fixture.fileId=(await upload.json()).data.id;
 const download=await fetch(`${base}/api/crm/commercial/${contract.id}/files?file=${fixture.fileId}`,{headers:{cookie}});check(download.status===200&&Buffer.from(await download.arrayBuffer()).equals(bytes),'private contract upload and authorized byte-identical retrieval');}}
 contract=await act(contract,'execute','Isolated acceptance evidence, not an actual customer signature',fixture.fileId);check(contract.status==='executed'&&!!contract.executedVersionId,'authorized external execution evidence recorded');contract=await act(contract,'activate');check(contract.status==='active','only executed effective contract becomes active');
 const obligation=await good('/api/crm/commercial/obligations','POST',{id:null,recordId:contract.id,revision:0,description:'Deliver onboarding evidence',ownerId:fixture.ownerId,dueOn:'2026-10-28',priority:'high',status:'open',evidence:''});
 contract=await load(contract.id);let ob=contract.obligations.find(x=>x.id===obligation.id);check(!!ob.activityId,'contract obligation creates real linked CRM follow-up');
 await good('/api/crm/commercial/obligations','POST',{id:ob.id,recordId:contract.id,revision:ob.revision,description:ob.description,ownerId:ob.ownerId,dueOn:ob.dueOn,priority:ob.priority,status:'completed',evidence:'Delivery receipt verified'});
 check((await load(contract.id)).obligations[0].status==='completed','obligation completion retains evidence');
 const renewal=await save(form('renewal','Northstar 2027 renewal',{parentId:contract.id,content:{...blank,renewalType:'manual',noticeDays:30}}));fixture.renewalId=renewal.id;check(renewal.status==='upcoming','renewal created from executed contract');
 check((await call(`/api/crm/commercial/${renewal.id}`,'POST',{revision:renewal.revision,operation:'renewed',note:'No agreement',evidenceId:contract.id})).status===422,'renewal cannot claim completion without new executed agreement');
 check((await sql('select count(*)::int n from invoices where organization_id=$1',[fixture.orgId]))[0].n===0,'commercial workflows do not create Finance revenue or invoices');
 await sql('BEGIN');await sql('SET LOCAL ROLE authenticated');await sql("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:fixture.userId,role:'authenticated'})]);
 check((await sql('select count(*)::int n from crm_commercial_records where organization_id<>$1',[fixture.orgId]))[0].n===0,'RLS hides other tenant commercial records');
 check(!(await sql("select has_table_privilege('authenticated','crm_commercial_versions','UPDATE') allowed"))[0].allowed,'authenticated clients cannot overwrite historical snapshots');await sql('ROLLBACK');
 await sql("update organization_members set role='sales_staff' where id=$1",[fixture.ownerId]);check((await call('/api/crm/commercial/settings','POST',{revision:2,allowSelfApproval:true,taxName:'',taxRate:'0'})).status===403,'restricted role cannot configure approval policy');await sql("update organization_members set role='owner' where id=$1",[fixture.ownerId]);
 fixture.cookies=[...jar];writeFileSync(join(tmpdir(),'nextmav-commercial-fixture.json'),JSON.stringify(fixture));console.log(`${passed} Commercial Hub live assertions passed.`);
}finally{await client.end();writeFileSync(join(tmpdir(),'nextmav-commercial-fixture.json'),JSON.stringify({...fixture,cookies:[...jar]}));}
