import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, readEnv } from './db-connect.mjs';

// Exercise the deployed business triggers and retain the rows only in the disposable
// acceptance organization. Receive and inspect notifications using its authenticated browser.
export async function verifyBusinessPush({ fixture, ctx, base, device, dispatch, observed }) {
  const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'), { statement_timeout: 15000 });
  const { orgId: org, memberB: recipient, memberA: sender } = fixture;
  const q = async (sql, args) => (await client.query(sql, args)).rows;
  const id = async (sql, args) => (await q(sql, args))[0].id;
  try {
    await client.query('BEGIN');
    const members = await q(`SELECT m.id,m.user_id,p.email,o.name FROM organization_members m
      JOIN organizations o ON o.id=m.organization_id JOIN profiles p ON p.id=m.user_id WHERE o.id=$1`, [org]);
    assert.equal(members.length, 2);
    for (const [i, member] of [sender, recipient].entries()) {
      const m=members.find(row=>row.id===member);
      assert.equal(m?.name,'Notification isolated acceptance');
      assert.equal(m.user_id,fixture.users[i].id);
      assert.match(m.email,/^notifications-[a-f0-9-]{36}@example\.com$/);
    }
    await q('UPDATE notification_devices SET enabled=false WHERE organization_id=$1 AND member_id=$2 AND id<>$3',[org,recipient,device]);
    await q("UPDATE organization_members SET role='administrator' WHERE id=$1 AND organization_id=$2", [recipient,org]);
    const task=await id("INSERT INTO tasks(organization_id,title,assignee_id,due_date) VALUES($1,'Device acceptance',$2,current_date) RETURNING id",[org,recipient]);
    await q('SELECT notification_sweep_tasks(200)');
    const leave=await id('INSERT INTO leave_requests(organization_id,member_id,start_date,end_date) VALUES($1,$2,current_date+20,current_date+21) RETURNING id',[org,sender]);
    const lead=await id("INSERT INTO leads(organization_id,first_name,last_name,owner_id) VALUES($1,'Device','Acceptance',$2) RETURNING id",[org,recipient]);
    const company=await id("INSERT INTO companies(organization_id,name) VALUES($1,'Device acceptance') RETURNING id",[org]);
    const record=await id("INSERT INTO crm_commercial_records(organization_id,kind,number,title,company_id,owner_id,created_by,currency) VALUES($1,'proposal',$2,'Device acceptance',$3,$4,$4,'USD') RETURNING id",[org,randomUUID(),company,recipient]);
    for(const status of ['pending_approval','approved']) await q('UPDATE crm_commercial_records SET status=$2,revision=revision+1 WHERE id=$1',[record,status]);
    const sign=await id("INSERT INTO sign_envelopes(id,organization_id,owner_id,title,data) VALUES($3,$1,$2,'Device acceptance','{}') RETURNING id",[org,recipient,randomUUID()]);
    for(const status of ['sent','completed']) await q('UPDATE sign_envelopes SET status=$2 WHERE id=$1',[sign,status]);
    const ticket=await id("INSERT INTO support_tickets(organization_id,ticket_number,subject,assignee_id,requester_id) VALUES($1,$2,'Device acceptance',$3,$4) RETURNING id",[org,randomUUID(),recipient,sender]);
    await client.query('COMMIT');
    await dispatch();
    const scenarios=[['task_assigned',task],['task_due',task],['leave_requested',leave],['lead_assigned',lead],['commercial_approved',record],['crm_automation',sign],['ticket_assigned',ticket]];
    for(const [type,entity] of scenarios) {
      const [row]=await q(`SELECT n.id,d.state,d.last_code FROM notifications n JOIN notification_deliveries d ON d.notification_id=n.id
        WHERE n.organization_id=$1 AND n.recipient_id=$2 AND n.entity_id=$3 AND n.type=$4 AND d.device_id=$5`,[org,recipient,entity,type,device]);
      assert.ok(row,`Missing job for ${type}`);
      const receipt=row.state==='accepted' && await observed(row.id);
      const opened=await ctx.request.get(base+'/api/notifications/open?id='+row.id+'&organizationId='+org,{maxRedirects:0});
      const dest=new URL(opened.headers().location,base);
      const authorized=opened.status()===303 && dest.pathname==='/dashboard' && dest.searchParams.has('module');
      console.log(JSON.stringify({type,state:row.state,providerCode:row.last_code,receipt,authorized,module:dest.searchParams.get('module'),recordInLink:[...dest.searchParams.values()].includes(entity)}));
      if(!receipt || !authorized) process.exitCode=1;
    }
  } finally {await client.query('ROLLBACK'); await client.end();}
}
