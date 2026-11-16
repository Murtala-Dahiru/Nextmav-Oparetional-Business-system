import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-pipeline-fixture.json')));
const base=process.env.APP_URL||'http://localhost:3010';const jar=new Map();let passed=0;
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return {status:r.status,json:await r.json().catch(()=>null)};}
async function good(path,method='GET',body){const r=await call(path,method,body);assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${r.json?.error?.message}`);return r.json.data;}
function check(value,label){assert.ok(value,label);passed++;console.log('PASS '+label);}
await good('/api/auth/login','POST',{email:fixture.email,password:fixture.password});

const pipelines=await good('/api/crm/pipelines');const pipeline=pipelines.find(p=>p.id===fixture.pipelineId);
const company=await good('/api/crm/companies','POST',{name:'Currency acceptance '+Date.now()});
const make=currency=>good('/api/crm/deals','POST',{name:'Currency acceptance '+currency,companyId:company.id,pipelineId:pipeline.id,pipelineStageId:pipeline.stages[0].id,value:currency==='USD'?1200:3000,currency,expectedClose:'2026-12-15',forecastCategory:'commit'});
const usd=await make('USD'),eur=await make('EUR');
check(usd.currency==='USD'&&eur.currency==='EUR','create deals with independent native currencies');
for(const d of [usd,eur]){
 const q=`currency=${d.currency}&companyId=${company.id}`;
 const report=await good(`/api/crm/pipelines/${pipeline.id}/workspace?${q}`);
 check(report.metrics.openValue===d.value&&report.metrics.weightedValue===d.value*d.probability/100&&report.currency===d.currency,`${d.currency} forecast contains only its native amount and probability`);
 const list=await good(`/api/crm/deals?pipelineId=${pipeline.id}&${q}`);
 check(list.length===1&&list[0].id===d.id,`${d.currency} drill-down matches its forecast`);
}
const account=await good(`/api/crm/companies/${company.id}/overview`);
check(account.summary.dealCurrencies.some(c=>c.currency==='USD'&&c.openValue===1200)&&account.summary.dealCurrencies.some(c=>c.currency==='EUR'&&c.openValue===3000),'Customer 360 keeps amounts in separate currency groups');
check((await call(`/api/crm/deals/${usd.id}`,'PATCH',{pipelineVersion:usd.pipelineVersion,currency:'ZZZ'})).status===422,'unsupported currency edit rejected');
const approval=await good(`/api/crm/deals/${usd.id}/approvals`,'POST',{stageId:pipeline.stages.find(s=>s.requiresApproval).id});
const edited=await good(`/api/crm/deals/${usd.id}`,'PATCH',{pipelineVersion:usd.pipelineVersion,currency:'GBP',value:1400});
check(edited.currency==='GBP'&&edited.value===1400,'explicit currency and negotiated amount edit persists without conversion');
check((await call(`/api/crm/deals/${usd.id}`,'PATCH',{pipelineVersion:usd.pipelineVersion,currency:'USD'})).status===409,'stale currency edit rejected');
check((await call(`/api/crm/approvals/${approval.id}`,'PATCH',{approve:true,note:'Old currency'})).status===409,'currency edits invalidate stale approval evidence');
const audit=await good(`/api/crm/deals/${usd.id}/audit`);
check(audit.events.some(e=>e.changes?.currency?.before==='USD'&&e.changes?.currency?.after==='GBP'),'currency changes appear in opportunity audit');
const won=await good(`/api/crm/deals/${usd.id}/transition`,'POST',{stageId:pipeline.stages.find(s=>s.canonicalStage==='closed_won').id,version:edited.pipelineVersion});
const report=await good(`/api/crm/pipelines/${pipeline.id}/workspace?currency=GBP&companyId=${company.id}`);
check(report.metrics.wonValue===1400&&report.metrics.openValue===0,'won reporting keeps the deal native currency');

process.loadEnvFile('.env');
const {createClient}=await import('@supabase/supabase-js');
const scoped=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=await scoped.auth.signInWithPassword({email:fixture.email,password:fixture.password});assert.ifError(auth.error);
const event=await scoped.from('business_events').select('payload').eq('entity_id',usd.id).eq('event_type','deal.won').single();assert.ifError(event.error);
check(event.data.payload.currency==='GBP'&&Number(event.data.payload.value)===1400,'won event freezes the opportunity currency for downstream reporting');
const direct=await scoped.from('deals').update({currency:'ZZZ'}).eq('id',eur.id);
check(Boolean(direct.error),'direct database writes cannot bypass supported currency validation');
await scoped.auth.signOut();
console.log(`${passed} multicurrency assertions passed.`);

