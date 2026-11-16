import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect,readEnv} from './db-connect.mjs';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-automation-fixture.json')));
const connection=readEnv('DIRECT_URL')||readEnv('DATABASE_URL');
const {client}=await connect(connection,{statement_timeout:20000});
const q=async(s,p=[]) => (await client.query(s,p)).rows;
const step=(type,text)=>({id:randomUUID(),type,text,minutes:1,memberId:f.ownerId,branch:'always'});
try {
 await q('begin');await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:f.userId,role:'authenticated'})]);
 const w={trigger:'company.created',conditions:{mode:'all',groups:[]},steps:[step('wait',''),step('create_task','Real clock follow-up')]};
 const id=(await q("select crm_automation_save($1,null,0,'Real clock concurrency acceptance','',$2,'publish') id",[f.orgId,w]))[0].id;
 const company=(await q("insert into companies(organization_id,name) values($1,'Concurrency isolated company') returning id",[f.orgId]))[0].id;
 await q('commit');
 const workers=await Promise.all([connect(connection,{statement_timeout:20000}),connect(connection,{statement_timeout:20000})]);
 await Promise.all(workers.map(({client:c})=>c.query('select crm_automation_worker(100,$1)',[f.orgId])));
 await Promise.all(workers.map(({client:c})=>c.end()));
 const run=(await q('select * from crm_automation_runs where automation_id=$1',[id]))[0];
 assert.equal(run.status,'waiting');assert.equal(run.cursor,1);
 assert.equal((await q('select count(*)::int n from crm_automation_steps where run_id=$1',[run.id]))[0].n,1);
 console.log('PASS two concurrent worker sessions commit the wait step exactly once');
 f.clockAutomationId=id;f.clockCompanyId=company;f.clockRunId=run.id;
 writeFileSync(join(tmpdir(),'nextmav-automation-fixture.json'),JSON.stringify(f));
 console.log('Real one-minute delay persisted. Both worker connections closed. Cron will resume it.');
} finally {await client.end();}
