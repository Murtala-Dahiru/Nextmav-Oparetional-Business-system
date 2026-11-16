import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {connect,readEnv} from './db-connect.mjs';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-automation-fixture.json')));
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:30000});
const q=async(s,p=[]) => (await client.query(s,p)).rows;
try {
 await q('begin');
 await q("select pg_advisory_xact_lock(hashtextextended('automation-worker:'||$1::text,0))",[f.orgId]);
 await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:f.userId,role:'authenticated'})]);
 await q("update crm_automations set status='paused' where organization_id=$1",[f.orgId]);
 const workflow={trigger:'contact.created',conditions:{mode:'all',groups:[]},steps:[{id:randomUUID(),type:'notify',memberId:f.ownerId,text:'Isolated load acceptance',minutes:1,branch:'always'}]};
 const id=(await q("select crm_automation_save($1,null,0,'Isolated load acceptance','',$2,'publish') id",[f.orgId,workflow]))[0].id;
 const started=performance.now();
 await q("insert into contacts(organization_id,first_name) select $1,'Load fixture '||i from generate_series(1,200) i",[f.orgId]);
 const captureMs=performance.now()-started;
 assert.equal((await q('select count(*)::int n from crm_automation_runs where automation_id=$1',[id]))[0].n,200);
 const batches=[];
 for(let i=0;i<20;i++) {
  const start=performance.now();await q('select crm_automation_worker(100,$1)',[f.orgId]);batches.push(performance.now()-start);
  const done=(await q("select count(*)::int n from crm_automation_runs where automation_id=$1 and status='succeeded'",[id]))[0].n;
  assert.equal(done,(i+1)*10,'ten-step tenant bound and forward progress');
 }
 assert.equal((await q("select count(*)::int n from notifications where organization_id=$1 and title='Isolated load acceptance'",[f.orgId]))[0].n,200);
 await q('select crm_automation_worker(100,$1)',[f.orgId]);
 assert.equal((await q('select count(*)::int n from crm_automation_steps s join crm_automation_runs r on r.id=s.run_id where r.automation_id=$1',[id]))[0].n,200);
 console.log('PASS 200 real captured events, 200 notifications, 20 bounded batches, no replay effects');
 console.log(JSON.stringify({captureMs:Math.round(captureMs),batchMinMs:Math.round(Math.min(...batches)),batchMaxMs:Math.round(Math.max(...batches)),batchMeanMs:Math.round(batches.reduce((a,b)=>a+b,0)/batches.length)}));
 console.log('Single isolated tenant, one connection, rollback fixtures. These measurements do not establish production-scale or cross-tenant latency guarantees.');
} finally {await q('rollback');await client.end();}
