import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-commercial-fixture.json'))),base=process.env.APP_URL||'http://localhost:3012';let cookie='';let passed=0;
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password})});assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const j=await r.json();assert.ok(r.ok,`${r.status} ${JSON.stringify(j)}`);return j.data;}
const load=id=>api(`/api/crm/commercial/${id}`);const act=async(r,operation,evidenceId=null)=>load((await api(`/api/crm/commercial/${r.id}`,{revision:r.revision,operation,note:'Isolated renewal acceptance evidence',evidenceId})).id);function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++;}
let previous=await load(f.contractId),next=await act(previous,'revise');next=await act(next,'submit');next=await act(next,'approve');
const bytes=readFileSync('docs/commercial-evidence/contract.pdf');const upload=await fetch(`${base}/api/crm/commercial/${next.id}/files`,{method:'POST',headers:{cookie,'X-File-Name':'renewal-executed-test.pdf'},body:bytes});assert.equal(upload.status,200,await upload.clone().text());
next=await act(next,'execute',(await upload.json()).data.id);next=await act(next,'activate');check(next.status==='active'&&(await load(previous.id)).status==='superseded','new executed contract activation supersedes prior active term');
let renewal=await load(f.renewalId);renewal=await act(renewal,'prepare');renewal=await act(renewal,'negotiate');renewal=await act(renewal,'propose_renewal');renewal=await act(renewal,'renewed',next.id);check(renewal.status==='renewed','renewal completes only against the newly executed contract revision');
check((await load(previous.id)).versions.some(v=>v.id===previous.executedVersionId),'prior executed contract evidence/version retained after renewal');
console.log(`${passed} renewal acceptance assertions passed.`);
