import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
const base=process.env.APP_URL||'http://localhost:3018';const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const f={email:`sign-${randomUUID()}@example.com`,password:`Test!${randomUUID()}9a`};const jar=new Map();let passed=0;
function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++;}
async function request(path,body,cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; '),extra={}){const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,'Content-Type':'application/json',...extra.headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000),...extra});const json=await res.json().catch(()=>null);return {res,json,status:res.status};}
async function good(path,body){const r=await request(path,body);assert.ok(r.status>=200&&r.status<300,`${path}: ${JSON.stringify(r.json)}`);return r.json;}
const created=await admin.auth.admin.createUser({email:f.email,password:f.password,email_confirm:true,user_metadata:{first_name:'Sign',last_name:'Acceptance'}});assert.ifError(created.error);
const login=await request('/api/auth/login',{email:f.email,password:f.password});assert.equal(login.status,200);for(const raw of login.res.headers.getSetCookie()){const p=raw.split(';')[0],i=p.indexOf('=');jar.set(p.slice(0,i),p.slice(i+1));}
f.orgId=(await good('/api/organizations',{name:'NextMav Sign acceptance '+randomUUID().slice(0,8)})).data.id;
// Deliberately do not visit Settings: verify first-use Standard Signing.
check(!(await admin.from('sign_settings').select('organization_id').eq('organization_id',f.orgId)).data.length,'first-use organization has no signing settings');
const pdf=await PDFDocument.create();pdf.addPage().drawText('NextMav Sign synthetic agreement - Page 1');pdf.addPage().drawText('Synthetic agreement - Page 2');const bytes=await pdf.save();
const cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
async function upload(data=bytes,type='application/pdf'){const res=await fetch(base+'/api/sign',{method:'POST',headers:{cookie,'Content-Type':type,'X-File-Name':'Synthetic agreement.pdf'},body:data});return {status:res.status,json:await res.json()};}
check((await upload('<html>bad</html>')).status===422,'malformed PDF rejected');check((await upload(bytes,'text/html')).status===422,'unauthorized MIME rejected');
let uploaded=await upload();assert.equal(uploaded.status,200,JSON.stringify(uploaded.json));let e=uploaded.json.data;f.envelopeId=e.id;check((await admin.from('sign_settings').select('data').eq('organization_id',f.orgId).single()).data.data.allowPossession===true,'standard defaults initialize without Settings');check(e.data.source.pages.length===2,'valid two-page PDF parsed and privately stored');
const recipients=[1,2].map(order=>({id:randomUUID(),name:order===1?'Alex Buyer':'Jordan Counterparty',email:'',role:'signer',order,verification:'possession',generation:0}));
const fields=recipients.flatMap((r,i)=>[{id:randomUUID(),recipientId:r.id,type:'signature',page:i+1,x:.15,y:.7,width:.3,height:.08,required:true,label:'Signature',placeholder:''},{id:randomUUID(),recipientId:r.id,type:'checkbox',page:i+1,x:.15,y:.8,width:.04,height:.025,required:true,label:'Agree',placeholder:''}]);
async function op(operation,extra={}){const r=await good(`/api/sign/${e.id}`,{operation,revision:e.revision,...extra});e=r.data;return r;}
await op('save',{data:{title:'Synthetic sequential agreement',sequential:true,expiresAt:new Date(Date.now()+86400000).toISOString(),recipients,fields}});
e=(await good(`/api/sign/${e.id}`)).data;check(e.data.fields.length===4,'draft saves and reopens page-relative fields');
await op('send');check(e.status==='sent','send locks prepared agreement');check((await request(`/api/sign/${e.id}`,{operation:'save',revision:e.revision,data:{}})).status===409,'issued draft mutation rejected');
check((await request(`/api/sign/${e.id}`,{operation:'link',revision:e.revision,recipientId:recipients[1].id})).status===409,'future signer cannot receive usable signing link');
const link=(await op('link',{recipientId:recipients[0].id})).link;f.link=link;
async function exchange(link){const r=await request('/api/sign-portal',{operation:'exchange',token:new URL(link).hash.slice(1)},'');return {...r,cookie:r.res.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
check((await request('/api/sign-portal',{operation:'exchange',token:'invalid'},'')).status===409,'invalid link denied');
let session=await exchange(link);assert.equal(session.status,200,JSON.stringify(session.json));check(session.json.data.recipient.id===recipients[0].id,'passwordless access grants only assigned recipient');
const doc=await fetch(base+'/api/sign-portal?file=original',{headers:{cookie:session.cookie}});check(doc.status===200&&createHash('sha256').update(Buffer.from(await doc.arrayBuffer())).digest('hex')===e.data.source.hash,'recipient downloads exact immutable original');
check((await request('/api/sign',undefined,session.cookie)).status===401,'recipient session cannot access internal BOS API');
check((await request('/api/sign-portal',{operation:'complete',values:{}},session.cookie)).status===409,'completion without explicit consent rejected');
const complete={operation:'complete',consent:true,confirmation:'confirm-electronic-action'};
check((await request('/api/sign-portal',{...complete,values:{}},session.cookie)).status===409,'required fields enforced');
check((await request('/api/sign-portal',{...complete,values:{[fields[2].id]:'Forged'}},session.cookie)).status===409,'another recipient field rejected');
const [opened,first]=await Promise.all([request('/api/sign-portal',{operation:'viewed'},session.cookie),request('/api/sign-portal',{...complete,values:{[fields[0].id]:'Alex Buyer',[fields[1].id]:true}},session.cookie)]);check(opened.status===200&&first.status===200,'document-open and completion race both succeed');assert.equal(first.status,200,JSON.stringify(first.json));check(first.json.data.status==='in_progress','first signer completion leaves agreement incomplete');
e=(await good(`/api/sign/${e.id}`)).data;const link2=(await op('link',{recipientId:recipients[1].id})).link;const second=await exchange(link2);assert.equal(second.status,200,JSON.stringify(second.json));
const results=await Promise.all([1,2].map(()=>request('/api/sign-portal',{...complete,values:{[fields[2].id]:'Jordan Counterparty',[fields[3].id]:true}},second.cookie)));
check(results.some(x=>x.status===200),'concurrent completion commits a successful action');e=(await good(`/api/sign/${e.id}`)).data;
if(e.status==='finalizing'){console.log('Finalization pending; retrying through authorized endpoint');await op('finalize');}
check(e.status==='completed'&&e.data.actions.length===2,'exactly two recipient actions and one completed agreement');
check((await op('verify')).verified===true,'original, completed, certificate and evidence chain integrity verified');
mkdirSync('docs/sign-evidence',{recursive:true});for(const file of ['completed','certificate']){const res=await fetch(`${base}/api/sign/${e.id}?file=${file}`,{headers:{cookie}});check(res.status===200,`authorized ${file} download`);writeFileSync(`docs/sign-evidence/${file}.pdf`,Buffer.from(await res.arrayBuffer()));}
const copied=await upload();let revoke=copied.json.data;let rr=await good(`/api/sign/${revoke.id}`,{operation:'save',revision:0,data:{title:'Revocation test',sequential:false,expiresAt:new Date(Date.now()+86400000).toISOString(),recipients:[recipients[0]],fields:fields.slice(0,2)}});revoke=rr.data;revoke=(await good(`/api/sign/${revoke.id}`,{operation:'send',revision:revoke.revision})).data;rr=await good(`/api/sign/${revoke.id}`,{operation:'link',revision:revoke.revision,recipientId:recipients[0].id});revoke=rr.data;await good(`/api/sign/${revoke.id}`,{operation:'revoke',revision:revoke.revision});check((await exchange(rr.link)).status===409,'revoked link denied');
await good('/api/sign/settings',{allowPossession:false,defaultDays:14});
let strict=(await good('/api/sign',{sample:true})).data;
check(strict.record_id===null&&strict.title.startsWith('TEST ONLY'),'practice document is labelled and has no commercial relationship');
check((await admin.from('sign_settings').select('data').eq('organization_id',f.orgId).single()).data.data.allowPossession===false,'initialization preserves explicit mandatory verification');
strict=(await good(`/api/sign/${strict.id}`,{operation:'save',revision:strict.revision,data:{title:strict.title,sequential:false,expiresAt:strict.data.expiresAt,recipients:[recipients[0]],fields:[fields[0]]}})).data;
check((await request(`/api/sign/${strict.id}`,{operation:'send',revision:strict.revision})).status===409,'Standard Signing cannot bypass mandatory verification');
await good('/api/sign/settings',{allowPossession:true,defaultDays:14});
writeFileSync(join(tmpdir(),'nextmav-sign-fixture.json'),JSON.stringify({...f,cookie,recipients,fields}));console.log(`${passed} live acceptance assertions passed.`);
