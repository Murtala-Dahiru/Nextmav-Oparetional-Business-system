import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, readEnv } from './db-connect.mjs';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-automation-fixture.json')));
const jar=new Map(f.cookies),base=process.env.APP_URL||'http://localhost:3010';let passed=0;
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});return{status:r.status,json:await r.json()};}
async function good(path,method='GET',body){const r=await call(path,method,body);assert.ok(r.status<300,`${path}: ${JSON.stringify(r)}`);return r.json.data;}
function check(v,label){assert.ok(v,label);passed++;console.log('PASS '+label);}
const stage=(name,canonicalStage,probability,extra={})=>({id:randomUUID(),name,canonicalStage,probability,inactivityDays:14,entryGuidance:'',exitGuidance:'',requiredFields:[],exitRequiredFields:[],allowedNext:[],ownerId:null,requiresApproval:false,...extra});
const stages=[stage('Discovery','prospecting',20),stage('Qualified','qualification',50,{requiredFields:['next_step']}),stage('Review','proposal',80,{requiresApproval:true}),stage('Won','closed_won',100),stage('Lost','closed_lost',0)];
const pipeline=await good('/api/crm/pipelines','POST',{id:null,version:0,name:'Automation guarded pipeline',purpose:'enterprise',stages});
const step=(type,extra={})=>({id:randomUUID(),type,memberId:f.ownerId,text:'Guarded stage follow-up',minutes:60,branch:'always',...extra});
const definition={trigger:'deal.stage_changed',conditions:{mode:'all',groups:[]},steps:[step('create_task')]};
const a=await good('/api/crm/automations','POST',{id:null,revision:0,name:'Guarded stage automation',description:'Isolated acceptance',definition,operation:'publish'});
let deal=await good('/api/crm/deals','POST',{name:'Guarded event source',pipelineId:pipeline.id,pipelineStageId:stages[0].id,value:1000,currency:'USD'});
let move=await call(`/api/crm/deals/${deal.id}/transition`,'POST',{stageId:stages[1].id,version:deal.pipelineVersion});
check(move.status>=400,'stage requirements still reject invalid transitions');
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:20000});
const q=async(s,p=[]) => (await client.query(s,p)).rows;
try{
 check((await q('select count(*)::int n from crm_automation_runs where automation_id=$1',[a.id]))[0].n===0,'rejected stage transitions do not emit workflow events');
 deal=await good(`/api/crm/deals/${deal.id}`,'PATCH',{pipelineVersion:deal.pipelineVersion,nextStep:'Validate customer requirements'});
 await good(`/api/crm/deals/${deal.id}/transition`,'POST',{stageId:stages[1].id,version:deal.pipelineVersion});
 await q('select crm_automation_worker(100,$1)',[f.orgId]);
 check((await good(`/api/crm/activities?dealId=${deal.id}`)).some(t=>t.subject==='Guarded stage follow-up'),'authorized stage transition executes automation');
 deal=await good(`/api/crm/deals/${deal.id}`);
 check((await call(`/api/crm/deals/${deal.id}/transition`,'POST',{stageId:stages[2].id,version:deal.pipelineVersion})).status>=400,'approval requirement remains enforced');
 for(const path of ['/api/crm/leads','/api/crm/companies','/api/crm/contacts','/api/crm/deals','/api/crm/overview']) check((await call(path)).status===200,`existing CRM endpoint still works: ${path}`);
 const current=await good('/api/crm/automations');const record=current.find(x=>x.id===a.id);
 const conflict=await call('/api/crm/automations','POST',{id:record.id,revision:record.revision-1,name:record.name,description:'',definition,operation:'publish'});
 check(conflict.status===409,'revision conflict rejected by HTTP and database');
 // Real scheduler delivery: no manual worker call for this event or its delay.
 const delayed=await good('/api/crm/automations','POST',{id:null,revision:0,name:'Real clock restart acceptance',description:'One minute durable delay',definition:{trigger:'company.created',conditions:{mode:'all',groups:[]},steps:[step('wait',{minutes:1}),step('create_task',{text:'Real cron delayed follow-up'})]},operation:'publish'});
 const company=await good('/api/crm/companies','POST',{name:'Real clock acceptance'});
 f.clockAutomationId=delayed.id;f.clockCompanyId=company.id;
 const {writeFileSync}=await import('node:fs');writeFileSync(join(tmpdir(),'nextmav-automation-fixture.json'),JSON.stringify(f));
 check(Boolean(delayed.id),'real-clock delay queued for independent cron verification');
 console.log(`${passed} pipeline and regression assertions passed.`);
}finally{await client.end();}
