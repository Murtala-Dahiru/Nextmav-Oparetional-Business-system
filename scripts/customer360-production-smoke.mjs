import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-customer360-fixture.json'))),jar=new Map();
const base=process.env.APP_URL||'http://127.0.0.1:3011';
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',redirect:'manual',headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1))}assert.equal(r.status,200,`${path} returned ${r.status}`);return r}
await call('/api/auth/login',{email:f.email,password:f.password});
let count=0;
for(const path of ['/dashboard','/api/crm/companies','/api/crm/contacts',`/api/crm/companies/${f.companyId}/overview`,`/api/crm/companies/${f.companyId}/activities?due=open`,`/api/crm/companies/${f.companyId}/relationships`,`/api/crm/companies/${f.companyId}/plan`,`/api/crm/companies/${f.companyId}/plan/history`,`/api/crm/companies/${f.companyId}/timeline`,`/api/crm/companies/${f.companyId}/related?kind=projects`]){
 await call(path);count++;console.log('PASS production '+path.replace(f.companyId,'<fixture-account>'));
}
console.log(`${count} built-production HTTP smoke checks passed. No browser rendering claim.`);
