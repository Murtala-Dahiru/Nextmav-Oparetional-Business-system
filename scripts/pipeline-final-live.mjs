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
const prior=await good('/api/crm/pipelines/views');
const view={name:'December commit',pipelineId:fixture.pipelineId,view:'table',filters:{search:'',ownerId:'',companyId:'',teamMemberId:'',pipelineStageId:'',closeFrom:'2026-12-01',closeTo:'2026-12-31',minValue:'0',maxValue:'',forecastCategory:'commit',stage:'open',sort:'value',sortDir:'desc'}};
await good('/api/crm/pipelines/views','PUT',{version:prior.version,views:[view]});
const reopened=await good('/api/crm/pipelines/views');check(reopened.views[0].name===view.name&&reopened.views[0].filters.forecastCategory==='commit','save and reopen account view with pipeline, presentation and filters');
check((await call('/api/crm/pipelines/views','PUT',{version:prior.version,views:[]})).status===409,'concurrent saved-view revision rejected');
const audit=await good(`/api/crm/deals/${fixture.dealId}/audit`);check(audit.durations.some(d=>d.stageName==='Commercial review')&&audit.durations[0].days===null,'custom stage durations and closed-state aging');
const report=await good(`/api/crm/pipelines/${fixture.pipelineId}/workspace?stage=open&forecastCategory=commit`);
check(report.metrics.openValue===5000&&report.periods.find(p=>p.period==='2026-12')?.weightedValue===1000,'forecast period and category filters agree');
const list=await good(`/api/crm/deals?pipelineId=${fixture.pipelineId}&stage=open&forecastCategory=commit`);check(list.length===1&&list[0].value===5000,'forecast drill-down list matches contributing opportunities');
const full=await good(`/api/crm/pipelines/${fixture.pipelineId}/workspace`);check(full.stageConversion.length>0&&full.stageAging.length>0,'stage progression and aging use recorded histories');
check((await call(`/api/crm/deals?minValue=100&maxValue=10`)).status===422,'reversed value range rejected');
check((await call(`/api/crm/deals?closeFrom=2026-12-01&closeTo=2026-01-01`)).status===422,'reversed date range rejected');
check((await call('/api/crm/deals','POST',{name:'Rejected currency fixture',currency:'ZZZ',value:100})).status>=400,'unsupported deal currency is rejected rather than silently combined');
const pipelines=await good('/api/crm/pipelines');const pipeline=pipelines.find(p=>p.id===fixture.pipelineId);
const raced=await good('/api/crm/deals','POST',{name:'Stage race acceptance',pipelineId:pipeline.id,pipelineStageId:pipeline.stages[0].id,value:1000});
const results=await Promise.all(['closed_won','closed_lost'].map(outcome=>call(`/api/crm/deals/${raced.id}/transition`,'POST',{stageId:pipeline.stages.find(s=>s.canonicalStage===outcome).id,version:raced.pipelineVersion,outcome:{lostReason:'Timing'}})));
check(results.filter(r=>r.status===200).length===1&&results.filter(r=>r.status===409).length===1,'simultaneous stage moves have exactly one winner');
const facts=await good(`/api/crm/deals?pipelineId=${pipeline.id}&facts=true&pageSize=100`);
check(Boolean(facts.find(d=>d.id===fixture.dealId)?.lastActivityAt),'deal cards expose actual recorded engagement');
const approvalDeal=await good('/api/crm/deals','POST',{name:'Stale approval acceptance',pipelineId:pipeline.id,pipelineStageId:pipeline.stages[0].id,value:1000});
const review=pipeline.stages.find(s=>s.requiresApproval);
const approval=await good(`/api/crm/deals/${approvalDeal.id}/approvals`,'POST',{stageId:review.id});
await good(`/api/crm/deals/${approvalDeal.id}`,'PATCH',{pipelineVersion:approvalDeal.pipelineVersion,value:1500});
check((await call(`/api/crm/approvals/${approval.id}`,'PATCH',{approve:true,note:'Old revision'})).status===409,'approver cannot decide stale commercial evidence');
console.log(`${passed} final live assertions passed.`);
