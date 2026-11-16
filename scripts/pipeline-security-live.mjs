import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
const base=process.env.APP_URL||'http://localhost:3010';
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-pipeline-fixture.json')));
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const jar=new Map();let passes=0;
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return{status:r.status,json:await r.json().catch(()=>null)};}
async function good(path,method='GET',body){const r=await call(path,method,body);assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${r.json?.error?.message}`);return r.json.data;}
function check(value,label){assert.ok(value,label);passes++;console.log('PASS '+label);}
async function login(user){jar.clear();await good('/api/auth/login','POST',{email:user.email,password:user.password});}
async function user(role,org){const u={email:`pipeline-access-${randomUUID()}@example.com`,password:`Test!${randomUUID()}9a`};const r=await admin.auth.admin.createUser({...u,email_confirm:true});assert.ifError(r.error);u.id=r.data.user.id;if(org){const m=await admin.from('organization_members').insert({organization_id:org,user_id:u.id,role}).select('id').single();assert.ifError(m.error);u.memberId=m.data.id;}return u;}
await login(fixture);const pipelines=await good('/api/crm/pipelines');const pipeline=pipelines.find(p=>p.id===fixture.pipelineId);assert.ok(pipeline);
const deal=await good(`/api/crm/deals/${fixture.dealId}`);
await good(`/api/crm/deals/${deal.id}/plan`,'PUT',{version:0,data:{businessNeed:'Reduce manual work',decisionProcess:'Buyer review',closePlan:'Agree scope then sign',stakeholders:[{contactId:deal.contactId,role:'decision_maker'}]}});
check((await good(`/api/crm/deals/${deal.id}/plan`)).stakeholders[0].contactId===deal.contactId,'explicit stakeholder relationship persists');
check((await call(`/api/crm/deals/${deal.id}/plan`,'PUT',{version:0,data:{businessNeed:'Stale',decisionProcess:'',closePlan:'',stakeholders:[]}})).status===409,'stale close plan rejected');
const race=await good('/api/crm/deals','POST',{name:'Concurrency acceptance',pipelineId:pipeline.id,pipelineStageId:pipeline.stages[0].id,value:1000});
const results=await Promise.all(['A','B'].map(nextStep=>call(`/api/crm/deals/${race.id}`,'PATCH',{pipelineVersion:race.pipelineVersion,nextStep})));
check(results.filter(r=>r.status===200).length===1&&results.filter(r=>r.status===409).length===1,'simultaneous commercial writes have exactly one winner');
const sales=await user('sales_staff',fixture.orgId);await login(sales);
check((await call(`/api/crm/deals/${deal.id}`)).status===404,'own-scope cannot read another owner deal');
check((await good(`/api/crm/pipelines/${pipeline.id}/workspace`)).metrics.openCount===0,'own-scope aggregates exclude other owners');
check((await good(`/api/crm/deals/${deal.id}/audit`)).events.length===0,'own-scope audit has no leaked events');
check((await call('/api/crm/pipelines','POST',{id:null,version:0,name:'Unauthorized',purpose:'enterprise',stages:pipeline.stages})).status===403,'restricted role cannot configure pipelines');
check((await call(`/api/crm/deals/${deal.id}/transition`,'POST',{stageId:pipeline.stages[0].id,version:deal.pipelineVersion})).status===404,'own-scope cannot transition another owner deal');
const outsider=await user('owner');await login(outsider);await good('/api/organizations','POST',{name:'Pipeline isolated boundary acceptance'});
check((await call(`/api/crm/deals/${deal.id}`)).status===404,'cross-tenant deal read denied');
check((await good(`/api/crm/pipelines/${pipeline.id}/workspace`)).metrics.openCount===0,'cross-tenant workspace values empty');
check((await good(`/api/crm/deals/${deal.id}/audit`)).events.length===0,'cross-tenant audit empty');
check((await call(`/api/crm/pipelines/${pipeline.id}/lifecycle`,'PATCH',{version:pipeline.version,description:'Unauthorized',active:false,isDefault:false})).status===404,'cross-tenant pipeline mutation denied');
console.log(`${passes} live security, planning and concurrency assertions passed. Only isolated test organizations modified.`);
