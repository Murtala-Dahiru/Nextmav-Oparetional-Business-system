import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connect,readEnv} from './db-connect.mjs';

const fixture=JSON.parse(readFileSync(process.env.CRM_AUDIT_FIXTURE));
const {client}=await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'));
try {
  const {rows}=await client.query(`
    select r.id,r.status,e.record_id
    from crm_automation_runs r
    join crm_automations a on a.id=r.automation_id
    join crm_automation_events e on e.id=r.event_id
    join sign_envelopes s on s.id=e.record_id
    join crm_commercial_records c on c.id=s.record_id
    where a.organization_id=$1 and a.name='Sign acceptance workflow'
      and c.title in ('Sign acceptance quote','Sign acceptance proposal','Sign acceptance contract')
      and e.trigger='agreement.completed'`,[fixture.orgId]);
  assert.equal(rows.length,3);
  assert.ok(rows.every(row=>row.status==='succeeded'));
  for(const row of rows) {
    const notifications=await client.query(`select count(*)::int n from notifications
      where organization_id=$1 and entity_id=$2 and title='Agreement completed'`,[fixture.orgId,row.record_id]);
    assert.equal(notifications.rows[0].n,1);
  }
  const runs=rows.map(row=>row.id);
  const count=async()=>Number((await client.query('select count(*) n from crm_automation_steps where run_id=any($1::uuid[])',[runs])).rows[0].n);
  const before=await count();
  assert.equal(before,3);
  await client.query('select crm_automation_worker(100,$1)',[fixture.orgId]);
  assert.equal(await count(),before);
  console.log('PASS three scoped commercial completion events succeeded, one completion notification each, durable replay has no duplicate steps');
} finally {await client.end();}
