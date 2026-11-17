// Test the deployed schema using transaction-local fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, readEnv } from './db-connect.mjs';
const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'), { statement_timeout: 20000 });
const q = async (sql, values = []) => (await client.query(sql, values)).rows;
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS ' + label); };
async function asUser(user, fn) {
  await q('SAVEPOINT identity');
  await q("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [user, JSON.stringify({ sub: user, role: 'authenticated' })]);
  await q('SET LOCAL ROLE authenticated');
  try { return await fn(); } finally { await q('ROLLBACK TO SAVEPOINT identity'); }
}
try {
  await q('BEGIN');
  await q("SET LOCAL lock_timeout='2s'");
  const users = [];
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    await q("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)", [
      id, 'rollback-'+id+'@example.com', JSON.stringify({ first_name: 'Acceptance', last_name: String(i) }),
    ]);
    users.push({ id });
  }
  const org = (await q("INSERT INTO organizations(name,slug) VALUES('Notification rollback acceptance',$1) RETURNING id", ['notification-test-' + randomUUID()]))[0].id;
  const members = [];
  for (let i = 0; i < 3; i++) members.push((await q("INSERT INTO organization_members(organization_id,user_id,role,notification_prefs) VALUES($1,$2,$3,$4) RETURNING id", [org, users[i].id, i === 0 ? 'owner' : 'employee', JSON.stringify({ push: true })]))[0].id);
  const channel = (await q("INSERT INTO channels(organization_id,name,type,created_by) VALUES($1,'Acceptance private','private',$2) RETURNING id", [org, members[0]]))[0].id;
  await q('INSERT INTO channel_members(channel_id,member_id) VALUES($1,$2),($1,$3)', [channel, members[0], members[1]]);
  // No actual provider endpoint or delivery: fixtures only exercise durable queue.
  const device = (await q("INSERT INTO notification_devices(organization_id,member_id,endpoint,p256dh,auth) VALUES($1,$2,'https://fcm.googleapis.com/acceptance-not-a-subscription','fixture','fixture') RETURNING id", [org, members[1]]))[0].id;
  const secondDevice = (await q("INSERT INTO notification_devices(organization_id,member_id,endpoint,p256dh,auth) VALUES($1,$2,'https://fcm.googleapis.com/acceptance-second-not-a-subscription','fixture','fixture') RETURNING id", [org, members[1]]))[0].id;
  await q('SAVEPOINT direct_test');
  const direct = (await q("INSERT INTO channels(organization_id,name,type,created_by) VALUES($1,$2,'direct',$3) RETURNING id", [org,'dm-'+members[0]+'-'+members[1],members[0]]))[0].id;
  await q('INSERT INTO channel_members(channel_id,member_id) VALUES($1,$2),($1,$3)',[direct,members[0],members[1]]);
  const dm = (await q("INSERT INTO messages(organization_id,channel_id,sender_id,body) VALUES($1,$2,$3,'Direct acceptance') RETURNING id",[org,direct,members[0]]))[0].id;
  const copies = await q("SELECT title,body FROM notifications WHERE recipient_id=$1 AND type IN ('message_received','message','message_mention','mention') AND entity_id IN ($2,$3)",[members[1],dm,direct]);
  check(copies.length===1 && copies[0].title==='Acceptance 0 sent you a message' && copies[0].body==='Direct acceptance','One direct message creates one named notification without internal identifiers');
  await q('ROLLBACK TO SAVEPOINT direct_test');
  const start = performance.now();
  const message = (await q("INSERT INTO messages(organization_id,channel_id,sender_id,body,mentions) VALUES($1,$2,$3,'PRIVATE TEST CONTENT',$4) RETURNING id", [org, channel, members[0], [members[2]]]))[0].id;
  const notices = await q('SELECT * FROM notifications WHERE entity_id=$1', [message]);
  check(notices.length === 1 && notices[0].recipient_id === members[1], 'Message targets channel member; sender and outsider mention excluded');
  check(notices[0].body.includes('PRIVATE TEST CONTENT') && !!notices[0].actor_id, 'Authorized inbox includes source message and actor');
  check((await q('SELECT * FROM notification_deliveries WHERE notification_id=$1', [notices[0].id])).length === 2, 'One durable job per registered device');
  console.log('MEASURE transaction message insert + durable fanout + query ' + Math.round(performance.now() - start) + 'ms (one sample, not p95 realtime)');
  await q("INSERT INTO notifications(organization_id,recipient_id,type,title,dedupe_key) SELECT organization_id,recipient_id,type,title,dedupe_key FROM notifications WHERE id=$1 ON CONFLICT DO NOTHING", [notices[0].id]);
  check((await q('SELECT * FROM notifications WHERE entity_id=$1', [message])).length === 1, 'Repeated stable event key suppressed');
  await asUser(users[1].id, async () => {
    check((await q('SELECT * FROM notifications WHERE id=$1', [notices[0].id])).length === 1, 'Recipient can read notification');
    check((await q('SELECT notification_record_visible($1,$2,$3,$4) allowed', [org, 'message_received', 'message', message]))[0].allowed, 'Recipient message access checked with RLS');
    await q('UPDATE notifications SET is_read=true,read_at=now() WHERE id=$1', [notices[0].id]);
    check((await q('SELECT is_read FROM notifications WHERE id=$1', [notices[0].id]))[0].is_read, 'Read state persists inside transaction');
  });
  await asUser(users[2].id, async () => {
    check((await q('SELECT * FROM notifications WHERE id=$1', [notices[0].id])).length === 0, 'Unrelated member cannot read notification');
    check((await q('DELETE FROM notification_devices WHERE id=$1 RETURNING id', [device])).length === 0, 'Unrelated member cannot remove device');
    check(!(await q('SELECT notification_record_visible($1,$2,$3,$4) allowed', [org, 'message_received', 'message', message]))[0].allowed, 'Private conversation inaccessible to unrelated member');
  });
  for (const [sql, values, label] of [
    ["INSERT INTO notifications(organization_id,recipient_id,title) VALUES($1,$2,'forged')", [org, members[1]], 'Arbitrary notification creation denied'],
    ["SELECT notify_members($1,$2,'forged','forged')", [org, [members[1]]], 'Generic fanout RPC denied'],
    ["UPDATE notifications SET title='forged' WHERE id=$1", [notices[0].id], 'Recipient content mutation denied'],
  ]) {
    let denied = false;
    try { await asUser(users[1].id, () => q(sql, values)); } catch (cause) { denied = cause.code === '42501'; }
    check(denied, label);
  }
  const job = (await q('SELECT * FROM notification_claim($1)', [org]))[0];
  const otherJob = (await q('SELECT * FROM notification_claim($1)', [org]))[0];
  check(job.id !== otherJob.id && job.device_id !== otherJob.device_id, 'Claim isolates one delivery per device');
  check((await q('SELECT * FROM notification_claim($1)', [org])).length === 0, 'Active leases prevent repeat claims');
  await q("UPDATE notification_deliveries SET lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
  const recovered = (await q('SELECT * FROM notification_claim($1)', [org]))[0];
  check(recovered.id === job.id && recovered.lease_token !== job.lease_token && recovered.attempts === 2, 'Expired worker lease recovered with new fencing token');
  check((await q("SELECT * FROM notification_delivery_attempts WHERE delivery_id=$1 AND result='lease_expired'", [job.id])).length === 1, 'Abandoned attempt remains observable');
  await q('UPDATE channel_members SET is_muted=true WHERE channel_id=$1 AND member_id=$2', [channel, members[1]]);
  const muted = (await q("INSERT INTO messages(organization_id,channel_id,sender_id,body) VALUES($1,$2,$3,'Muted') RETURNING id", [org, channel, members[0]]))[0].id;
  check((await q('SELECT * FROM notifications WHERE entity_id=$1', [muted])).length === 0, 'Muted conversation suppresses routine message');
  const mention = (await q("INSERT INTO messages(organization_id,channel_id,sender_id,body,mentions,parent_id) VALUES($1,$2,$3,'Reply mentioning you',$4,$5) RETURNING id", [org,channel,members[0],[members[1]],message]))[0].id;
  check((await q("SELECT * FROM notifications WHERE entity_id=$1 AND type='message_mention'", [mention])).length===1, 'Mention reaches muted conversation member');
  await q('UPDATE channel_members SET is_muted=false WHERE channel_id=$1 AND member_id=$2',[channel,members[1]]);
  const reply = (await q("INSERT INTO messages(organization_id,channel_id,sender_id,body,parent_id) VALUES($1,$2,$3,'Thread reply',$4) RETURNING id", [org,channel,members[0],message]))[0].id;
  check((await q("SELECT * FROM notifications WHERE entity_id=$1 AND title LIKE '% replied'", [reply])).length===1, 'Reply carries actual sender and reply description');
  await asUser(users[1].id,async()=>{
    await q('SELECT notification_preferences($1,$2)',[org,{push:true,messagePreviews:true,businessPreviews:false}]);
    check((await q('SELECT notification_prefs FROM organization_members WHERE id=$1',[members[1]]))[0].notification_prefs.messagePreviews===true,'Message preview opt-in persists');
  });
  await q('DELETE FROM channel_members WHERE channel_id=$1 AND member_id=$2', [channel, members[1]]);
  await asUser(users[1].id, async () => check(!(await q('SELECT notification_record_visible($1,$2,$3,$4) allowed', [org, 'message_received', 'message', message]))[0].allowed, 'Conversation revocation blocks queued delivery'));
  const task = (await q("INSERT INTO tasks(organization_id,title,assignee_id,due_date) VALUES($1,'Rollback task',$2,current_date) RETURNING id", [org, members[1]]))[0].id;
  check((await q("SELECT * FROM notifications WHERE entity_id=$1 AND type='task_assigned'", [task])).length === 1, 'Existing task assignment producer reused');
  await q('SAVEPOINT actor_test');
  await q("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [users[0].id,JSON.stringify({sub:users[0].id,role:'authenticated'})]);
  const assigned = (await q("INSERT INTO tasks(organization_id,title,reporter_id,assignee_id) VALUES($1,'Actual assigner',$2,$3) RETURNING id", [org,members[2],members[1]]))[0];
  const description = (await q("SELECT actor_id, body FROM notifications WHERE entity_id=$1 AND type='task_assigned'", [assigned.id]))[0];
  check(description?.actor_id === members[0] && description.body.includes('Assigned by Acceptance 0'), 'Task description names the transaction actor rather than the original reporter');
  await q('ROLLBACK TO SAVEPOINT actor_test');
  await q('SELECT notification_sweep_tasks(500)'); await q('SELECT notification_sweep_tasks(500)');
  check((await q("SELECT * FROM notifications WHERE entity_id=$1 AND type='task_due'", [task])).length === 1, 'Repeated reminder sweep deduplicated');
  await q("UPDATE tasks SET status='done',completed_at=now() WHERE id=$1", [task]);
  await asUser(users[1].id, async () => check(!(await q('SELECT notification_record_visible($1,$2,$3,$4) allowed', [org, 'task_due', 'task', task]))[0].allowed, 'Completed task blocks queued reminder'));
  const noticeFor = async (id, type, recipient) => (await q('SELECT id FROM notifications WHERE entity_id=$1 AND type=$2 AND recipient_id=$3', [id,type,recipient])).length === 1;
  const leave = (await q('INSERT INTO leave_requests(organization_id,member_id,start_date,end_date) VALUES($1,$2,current_date+12,current_date+13) RETURNING id', [org,members[1]]))[0].id;
  check(await noticeFor(leave,'leave_requested',members[0]), 'HR leave request reaches authorized approver');
  await q("UPDATE leave_requests SET status='approved',approved_by=$2 WHERE id=$1", [leave,members[0]]);
  check(await noticeFor(leave,'leave_approved',members[1]), 'HR leave approval reaches employee');
  const rejectedLeave = (await q('INSERT INTO leave_requests(organization_id,member_id,start_date,end_date) VALUES($1,$2,current_date+20,current_date+21) RETURNING id',[org,members[1]]))[0].id;
  await q("UPDATE leave_requests SET status='rejected',approved_by=$2 WHERE id=$1",[rejectedLeave,members[0]]);
  check(await noticeFor(rejectedLeave,'leave_rejected',members[1]),'HR rejection reaches requesting employee');
  const expense = (await q("INSERT INTO expenses(organization_id,title,amount,submitted_by) VALUES($1,'Test expense',20,$2) RETURNING id", [org,members[1]]))[0].id;
  check(await noticeFor(expense,'expense_submitted',members[0]), 'Finance expense review reaches approver');
  await q("UPDATE expenses SET status='approved',approved_by=$2 WHERE id=$1", [expense,members[0]]);
  check(await noticeFor(expense,'expense_approved',members[1]), 'Finance approval returns to submitter');
  const ticket = (await q("INSERT INTO support_tickets(organization_id,ticket_number,subject,assignee_id,requester_id) VALUES($1,'TEST-1','Test ticket',$2,$3) RETURNING id", [org,members[1],members[0]]))[0].id;
  check(await noticeFor(ticket,'ticket_assigned',members[1]), 'Support assignment at creation');
  await q("UPDATE support_tickets SET assignee_id=$2 WHERE id=$1", [ticket,members[2]]);
  check(await noticeFor(ticket,'ticket_assigned',members[2]), 'Support reassignment targets new owner');
  await q("INSERT INTO ticket_comments(ticket_id,author_id,body) VALUES($1,$2,'Requester replied')", [ticket,members[0]]);
  check(await noticeFor(ticket,'ticket_response',members[2]), 'Support requester reply targets assignee');
  const lead = (await q("INSERT INTO leads(organization_id,first_name,last_name,owner_id) VALUES($1,'Test','Lead',$2) RETURNING id", [org,members[0]]))[0].id;
  check(await noticeFor(lead,'lead_assigned',members[0]), 'CRM lead assignment captured');
  const deal = (await q("INSERT INTO deals(organization_id,name,owner_id) VALUES($1,'Approval fixture',$2) RETURNING id", [org,members[1]]))[0].id;
  const pipeline = (await q("INSERT INTO crm_pipelines(organization_id,name) VALUES($1,'Fixture pipeline') RETURNING id", [org]))[0].id;
  const stage = (await q("INSERT INTO crm_pipeline_stages(organization_id,pipeline_id,name,position,canonical_stage,probability) VALUES($1,$2,'Review',1,'prospecting',10) RETURNING id", [org,pipeline]))[0].id;
  await q("INSERT INTO crm_stage_approvals(organization_id,deal_id,to_stage_id,deal_version,pipeline_version,requested_by) VALUES($1,$2,$3,1,1,$4)", [org,deal,stage,members[1]]);
  check(await noticeFor(deal,'deal_approval_pending',members[0]), 'CRM stage approval reaches decision maker');
  const hrCase = (await q("INSERT INTO hr_cases(organization_id,subject,raised_by,assigned_to) VALUES($1,'Document request',$2,$3) RETURNING id", [org,members[1],members[0]]))[0].id;
  check(await noticeFor(hrCase,'hr_case_assigned',members[0]), 'HR case routed to assigned member');
  const company = (await q("INSERT INTO companies(organization_id,name) VALUES($1,'Test company') RETURNING id", [org]))[0].id;
  const record = (await q("INSERT INTO crm_commercial_records(organization_id,kind,number,title,company_id,owner_id,created_by,currency) VALUES($1,'proposal','TEST-1','Test proposal',$2,$3,$3,'USD') RETURNING id", [org,company,members[1]]))[0].id;
  await q("UPDATE crm_commercial_records SET status='pending_approval',revision=revision+1 WHERE id=$1", [record]);
  check(await noticeFor(record,'commercial_pending_approval',members[0]), 'Commercial proposal review targets independent approver');
  await q("UPDATE crm_commercial_records SET status='approved',revision=revision+1 WHERE id=$1", [record]);
  check(await noticeFor(record,'commercial_approved',members[1]), 'Commercial proposal approval reaches owner');
  await q("UPDATE crm_commercial_records SET status='accepted',revision=revision+1 WHERE id=$1", [record]);
  check(await noticeFor(record,'commercial_accepted',members[1]), 'Commercial proposal acceptance reaches owner');
  const contract = (await q("INSERT INTO crm_commercial_records(organization_id,kind,number,title,company_id,owner_id,created_by,currency) VALUES($1,'contract','TEST-2','Test contract',$2,$3,$3,'USD') RETURNING id", [org,company,members[1]]))[0].id;
  await q("UPDATE crm_commercial_records SET status='executed',revision=revision+1 WHERE id=$1", [contract]);
  check(await noticeFor(contract,'commercial_executed',members[1]), 'Contract execution reaches owner');
  const envelope = randomUUID();
  await q("INSERT INTO sign_envelopes(id,organization_id,owner_id,title,data) VALUES($1,$2,$3,'Test agreement','{}')", [envelope,org,members[0]]);
  await q("UPDATE sign_envelopes SET status='sent' WHERE id=$1", [envelope]);
  check(await noticeFor(envelope,'sign_sent',members[0]), 'Signing request sent reaches internal owner');
  await q("UPDATE sign_envelopes SET data=jsonb_build_object('actions',jsonb_build_array(jsonb_build_object('action','signed','recipientRole','witness','recipientId',$2::text))),status='in_progress' WHERE id=$1", [envelope,randomUUID()]);
  check(await noticeFor(envelope,'sign_witness_signed',members[0]), 'Witness signature notifies internal owner');
  await q("UPDATE sign_envelopes SET status='completed' WHERE id=$1", [envelope]);
  check(await noticeFor(envelope,'crm_automation',members[0]), 'Existing signing completion reaches internal owner');
  const activity = (await q("INSERT INTO crm_activities(organization_id,company_id,member_id,activity_type,subject,due_at,remind_at) VALUES($1,$2,$3,'followup','Test follow-up',now(),now()-interval '1 minute') RETURNING id", [org,company,members[1]]))[0].id;
  check(await noticeFor(activity,'crm_activity_assigned',members[1]), 'CRM activity assignment captured');
  await q('SELECT sweep_crm_reminders(500)');
  check(await noticeFor(activity,'crm_followup_due',members[1]), 'Scheduled CRM follow-up delivered');
  await q("UPDATE support_tickets SET due_at=now()+interval '10 minutes' WHERE id=$1", [ticket]);
  await q('SELECT notification_sweep_deadlines(500)'); await q('SELECT notification_sweep_deadlines(500)');
  check(await noticeFor(ticket,'ticket_deadline',members[2]), 'SLA scheduler emits one reminder in two sweeps');
  await q("DELETE FROM notifications WHERE entity_id=$1 AND type='ticket_deadline'", [ticket]);
  await q('SELECT notification_sweep_deadlines(500)');
  check(!await noticeFor(ticket,'ticket_deadline',members[2]), 'Dismissed SLA reminder stays dismissed');
  await q("UPDATE tasks SET status='todo',completed_at=NULL,assignee_id=$2,due_date=current_date-1 WHERE id=$1", [task,members[2]]);
  await q('SELECT notification_sweep_tasks(500)');
  check(await noticeFor(task,'task_overdue',members[2]), 'Overdue rescheduled task reaches new assignee');
  await asUser(users[1].id,async()=>check(!(await q('SELECT notification_record_visible($1,$2,$3,$4) allowed',[org,'task_assigned','task',task]))[0].allowed,'Reassignment cancels prior recipient dispatch'));
  const foreignOrg=(await q("INSERT INTO organizations(name,slug) VALUES('Rollback foreign org',$1) RETURNING id",['foreign-'+randomUUID()]))[0].id;
  await asUser(users[1].id,async()=>check(!(await q('SELECT notification_record_visible($1,$2,$3,$4) allowed',[foreignOrg,'push_test',null,null]))[0].allowed,'Cross-tenant membership denied'));
  await q('UPDATE organization_members SET is_active=false WHERE id=$1', [members[1]]);
  await asUser(users[1].id, async () => check((await q('SELECT * FROM notifications WHERE id=$1', [notices[0].id])).length === 0, 'Removed membership loses notification access'));
  check((await q('SELECT count(*)::int n FROM notification_devices WHERE id=ANY($1)', [[device, secondDevice]]))[0].n === 2, 'Unauthorized device deletion preserved both devices');
  console.log(`PASS ${checks} live PostgreSQL checks; all temporary fixtures rolled back`);
} finally { await q('ROLLBACK'); await client.end(); }
