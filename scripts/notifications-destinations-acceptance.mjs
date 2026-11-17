import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {connect,readEnv} from './db-connect.mjs';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-notifications-fixture.json')));
assert.ok(f.users.every(u=>/^notifications-[a-f0-9-]{36}@example\.com$/.test(u.email)));
const {request}=await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const ctx=await request.newContext();const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'));
const sql=async(q,args)=>(await client.query(q,args)).rows[0];
const o=f.orgId,a=f.memberA,b=f.memberB;
try{
assert.equal((await sql('select name from organizations where id=$1',[o])).name,'Notification isolated acceptance');
assert.ok((await ctx.post(f.base+'/api/auth/login',{data:f.users[0]})).ok());
async function test(record,type,key) {
 const n=await sql('select id from notifications where recipient_id=$1 and organization_id=$2 and entity_id=$3 and type=$4 order by id desc limit 1',[a,o,record.id,type]);assert.ok(n,type+' emitted');
 const res=await ctx.get(f.base+'/api/notifications/open?'+new URLSearchParams({id:n.id,organizationId:o}),{maxRedirects:0});
 assert.equal(res.status(),303,type);const url=new URL(res.headers().location); assert.equal(url.searchParams.get(key),record.id,type+' exact destination');
 console.log('PASS authorized production resolver for '+type);
}
const expense=await sql("insert into expenses(organization_id,title,amount,submitted_by) values($1,'Acceptance expense',12,$2) returning id",[o,b]); await test(expense,'expense_submitted','expense');
const leave=await sql('insert into leave_requests(organization_id,member_id,start_date,end_date) values($1,$2,current_date+80,current_date+81) returning id',[o,b]);await test(leave,'leave_requested','leave');
const ticket=await sql("insert into support_tickets(organization_id,ticket_number,subject,assignee_id,requester_id) values($1,$2,'Acceptance ticket',$3,$4) returning id",[o,randomUUID(),a,b]);await test(ticket,'ticket_assigned','ticket');
const lead=await sql("insert into leads(organization_id,first_name,last_name,owner_id) values($1,'Test','Lead',$2) returning id",[o,a]);await test(lead,'lead_assigned','lead');
const deal=await sql("insert into deals(organization_id,name,owner_id) values($1,'Acceptance deal',$2) returning id",[o,b]);
const pipeline=await sql("insert into crm_pipelines(organization_id,name) values($1,$2) returning id",[o,'Review '+randomUUID()]);
const stage=await sql("insert into crm_pipeline_stages(organization_id,pipeline_id,name,position,canonical_stage,probability) values($1,$2,'Review',1,'prospecting',10) returning id",[o,pipeline.id]);
await sql('insert into crm_stage_approvals(organization_id,deal_id,to_stage_id,deal_version,pipeline_version,requested_by) values($1,$2,$3,1,1,$4)',[o,deal.id,stage.id,b]);await test(deal,'deal_approval_pending','deal');
const company=await sql("insert into companies(organization_id,name) values($1,'Acceptance company') returning id",[o]);
const proposal=await sql("insert into crm_commercial_records(organization_id,kind,number,title,company_id,owner_id,created_by,currency) values($1,'proposal',$2,'Acceptance proposal',$3,$4,$4,'USD') returning id",[o,randomUUID(),company.id,b]);
await sql("update crm_commercial_records set status='pending_approval',revision=revision+1 where id=$1",[proposal.id]);await test(proposal,'commercial_pending_approval','commercial');
const agreement=await sql("insert into sign_envelopes(id,organization_id,owner_id,title,data) values($1,$2,$3,'Acceptance agreement','{}') returning id",[randomUUID(),o,a]);
await sql("update sign_envelopes set status='sent' where id=$1",[agreement.id]);await test(agreement,'sign_sent','agreement');
const session=(await(await ctx.get(f.base+'/api/auth/session')).json()).data;assert.equal(session.user.role,'owner');assert.equal(session.organization.id,o);
}finally{await client.end();await ctx.dispose();}
