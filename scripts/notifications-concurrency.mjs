// Isolated, retired device fixtures exercise competing database sessions.
// No transport is called. Foreign keys restrict cleanup to the exact test rows.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect,readEnv } from './db-connect.mjs';
const url=readEnv('DIRECT_URL')||readEnv('DATABASE_URL');
const {client:a}=await connect(url,{statement_timeout:15000});
const {client:b}=await connect(url,{statement_timeout:15000});
const nonce=randomUUID(); let org,notice;
try {
  await a.query('BEGIN');
  const user=(await a.query("SELECT id FROM profiles WHERE email LIKE 'notifications-%@example.com' AND is_active LIMIT 1")).rows[0];
  assert.ok(user,'Dedicated acceptance profile required');
  org=(await a.query("INSERT INTO organizations(name,slug) VALUES('Notification queue concurrency test',$1) RETURNING id",['notification-queue-'+nonce])).rows[0].id;
  const member=(await a.query('INSERT INTO organization_members(organization_id,user_id) VALUES($1,$2) RETURNING id',[org,user.id])).rows[0].id;
  notice=(await a.query("INSERT INTO notifications(organization_id,recipient_id,type,title) VALUES($1,$2,'push_test','Queue concurrency acceptance') RETURNING id",[org,member])).rows[0].id;
  for(let i=0;i<2;i++) {
    const device=(await a.query("INSERT INTO notification_devices(organization_id,member_id,endpoint,p256dh,auth,retired_at,enabled) VALUES($1,$2,$3,'fixture','fixture',now(),false) RETURNING id",[org,member,'https://fcm.googleapis.com/isolated-retired-'+nonce+'-'+i])).rows[0].id;
    await a.query('INSERT INTO notification_deliveries(organization_id,notification_id,device_id) VALUES($1,$2,$3)',[org,notice,device]);
  }
  await a.query('COMMIT');
  await Promise.all([a.query('BEGIN'),b.query('BEGIN')]);
  const [first,second]=await Promise.all([a.query('SELECT * FROM notification_claim($1)',[org]),b.query('SELECT * FROM notification_claim($1)',[org])]);
  assert.equal(first.rowCount,1);assert.equal(second.rowCount,1);assert.notEqual(first.rows[0].id,second.rows[0].id);
  await Promise.all([a.query('COMMIT'),b.query('COMMIT')]);
  assert.equal((await a.query('SELECT * FROM notification_claim($1)',[org])).rowCount,0);
  console.log('PASS two independent PostgreSQL sessions claimed distinct jobs concurrently. Active leases prevented another claim.');
} finally {
  await Promise.all([a.query('ROLLBACK'),b.query('ROLLBACK')]);
  if(org) await a.query("DELETE FROM organizations WHERE id=$1 AND slug=$2",[org,'notification-queue-'+nonce]);
  await Promise.all([a.end(),b.end()]);
}
