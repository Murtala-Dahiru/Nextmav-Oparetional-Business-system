import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
if(process.env.CRM_DISPOSABLE_TEST!=='true')throw Error('Explicit disposable test authorization required');
const base=process.env.APP_URL||'http://localhost:3010';
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const jar=new Map();let passed=0;
async function call(path,method='GET',body,headers={}){const r=await fetch(base+path,{method,redirect:'manual',headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1))}let json;try{json=await r.json()}catch{}return{status:r.status,json}}
async function good(path,method='GET',body,headers){const r=await call(path,method,body,headers);assert.ok(r.status>=200&&r.status<300,`${method} ${path}: ${r.status} ${r.json?.error?.message}`);return r.json.data}
function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++}
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-customer360-fixture.json')));
const createdUsers=[];let otherOrg;
async function login(email,password){jar.clear();await good('/api/auth/login','POST',{email,password})}
async function makeUser(role,org){const email=`customer360-${role}-${randomUUID()}@example.com`,password=`Test!${randomUUID()}9a`;const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{first_name:'Access',last_name:role}});assert.ifError(r.error);createdUsers.push(r.data.user.id);if(org){const m=await admin.from('organization_members').insert({organization_id:org,user_id:r.data.user.id,role}).select('id').single();assert.ifError(m.error)}return{email,password,id:r.data.user.id}}
try {
 await login(fixture.email,fixture.password);
 const account=await good(`/api/crm/companies/${fixture.companyId}/overview`);
 const contact=account.contacts[0];
 const privateActivity=await good('/api/crm/activities','POST',{activityType:'note',subject:'Restricted opportunity discussion',companyId:fixture.companyId,contactId:contact.id,dealId:account.deals[0].id});
 const existingFiles=await good(`/api/crm/files?kind=company&id=${fixture.companyId}`);
 const file=existingFiles[0]??await good(`/api/crm/files?kind=company&id=${fixture.companyId}`,'POST','Private scope test',{'Content-Type':'text/plain','X-File-Name':'private-scope.txt'});
 const sales=await makeUser('sales_staff',fixture.orgId);
 await login(sales.email,sales.password);
 const limited=await good(`/api/crm/companies/${fixture.companyId}/overview`);
 check(!limited.activities.some(a=>a.id===privateActivity.id),'company activity preview hides restricted opportunity details');
 check(!(await good(`/api/crm/contacts/${contact.id}/activities`)).some(a=>a.id===privateActivity.id),'contact activity history hides restricted opportunity details');
 check(!(await good(`/api/crm/companies/${fixture.companyId}/activities`)).some(a=>a.id===privateActivity.id),'paginated account activity hides restricted opportunity details');
 check(!('invoices' in limited)&&!('tickets' in limited),'sales role cannot read cross-module datasets through account overview');
 check(limited.intelligence.signals.every(s=>!['support','collections'].includes(s.key)),'restricted financial/support facts do not leak through signals');
 for(const kind of ['invoices','payments','tickets'])check((await call(`/api/crm/companies/${fixture.companyId}/related?kind=${kind}`)).status===403,`${kind} paginated context denied without source-module permission`);
 check(limited.projects.length===0,'unassigned project records hidden by RLS');
 for(const kind of ['projects','milestones'])check((await good(`/api/crm/companies/${fixture.companyId}/related?kind=${kind}`)).length===0,`unassigned ${kind} hidden by RLS`);
 const events=await good(`/api/crm/companies/${fixture.companyId}/timeline`);
 check(events.every(e=>!['finance','support'].includes(e.module)),'timeline hides restricted source-module events');
 check(limited.deals.length===0&&limited.summary.openDeals===0,'sales scope excludes another owner opportunities and totals');
 const support=await makeUser('support_staff',fixture.orgId);
 await login(support.email,support.password);
 check((await call(`/api/crm/companies/${fixture.companyId}`,'PATCH',{name:'Unauthorized'})).status===403,'read-only support cannot modify company');
 check((await call(`/api/crm/contacts/${contact.id}`,'PATCH',{firstName:'Unauthorized'})).status===403,'read-only support cannot modify contact');
 check((await call(`/api/crm/files/${file.id}`,'DELETE')).status===403,'read-only support cannot remove documents');
 const outsider=await makeUser('owner');await login(outsider.email,outsider.password);otherOrg=(await good('/api/organizations','POST',{name:'Customer360 isolation boundary'})).id;
 for(const path of [`companies/${fixture.companyId}`,`contacts/${contact.id}`,`companies/${fixture.companyId}/overview`,`companies/${fixture.companyId}/timeline`,`companies/${fixture.companyId}/related?kind=invoices`,`files/${file.id}`])check((await call(`/api/crm/${path}`)).status===404,`cross-tenant read denied: ${path.split('/')[0]}`);
 check((await good(`/api/crm/relationships/directory?kind=company&ids=${fixture.companyId}`)).length===0,'directory aggregation excludes foreign tenant ids');
 const local=await good('/api/crm/companies','POST',{name:'Other tenant account'});
 check((await call(`/api/crm/companies/${local.id}/relationships`,'POST',{companyId:fixture.companyId,type:'Partner'})).status>=400,'cross-tenant peer relationship refused');
 check((await call(`/api/crm/contacts/${contact.id}/activities`)).status===404,'cross-tenant contact activity endpoint refused');
 const profile=await good(`/api/crm/profiles/company/${local.id}`);
 check((await call(`/api/crm/profiles/company/${local.id}`,'PUT',{...profile,parentId:fixture.companyId})).status>=400,'cross-tenant parent association rejected');
 await login(fixture.email,fixture.password);
 await good(`/api/crm/files/${file.id}`,'DELETE');
 check((await good(`/api/crm/companies/${fixture.companyId}/activities?due=open`)).some(a=>a.subject==='Contact-only account commitment'),'paginated account commitments include contact-linked follow-ups');
 for(const kind of ['contacts','deals','projects','milestones','invoices','payments','tickets']){const rows=await good(`/api/crm/companies/${fixture.companyId}/related?kind=${kind}`);check(Array.isArray(rows),`authorized paginated ${kind} works`)}
 console.log(`${passed} live security and related-record checks passed.`);
}finally{
 if(otherOrg){const r=await admin.from('organizations').delete().eq('id',otherOrg);if(r.error)console.error('Temporary organization cleanup:',r.error.message)}
 for(const id of createdUsers){const r=await admin.auth.admin.deleteUser(id);if(r.error)console.error('Temporary user cleanup:',r.error.message)}
}
