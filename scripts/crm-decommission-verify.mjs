import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connect,readEnv} from './db-connect.mjs';

const {client}=await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'));
const query=async(sql)=>(await client.query(sql)).rows;
try {
  await query('BEGIN');
  const archive=['crm_sales_enrollments','crm_sales_sequences','crm_sales_templates','crm_mailboxes','crm_mail_credentials','crm_mail_oauth_states','crm_mail_associations','crm_mail_messages','crm_mail_outbox'];
  const counts=async()=>{const result=[];for(const table of archive)result.push((await query('select count(*)::text n from public.'+table))[0].n);return result;};
  const before=await counts();
  const sql=readFileSync(new URL('../supabase/migrations/0148_retire_sales_engagement.sql',import.meta.url),'utf8');
  await query(sql);
  await query(sql);
  assert.deepEqual(await counts(),before);
  for(const name of archive){
    const grants=await client.query("select bool_or(has_table_privilege(r,$1,p)) access from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p",[name]);
    assert.equal(grants.rows[0].access,false);
  }
  assert.equal((await query("select count(*)::int n from crm_sales_sequences s join crm_automations a on a.id=s.automation_id where not s.archived or a.status<>'archived'"))[0].n,0);
  assert.equal((await query("select count(*)::int n from crm_sales_enrollments where state in ('active','paused')"))[0].n,0);
  assert.equal((await query("select count(*)::int n from crm_automation_runs r join crm_sales_sequences s on r.automation_id=s.automation_id where r.status in ('pending','waiting','retrying')"))[0].n,0);
  assert.equal((await query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and (proname ~ '^crm_mail' or proname ~ '^crm_sales_(queue|activity_action|sequence|template|recipient|enrollment)')"))[0].n,0);
  assert.ok((await query("select to_regprocedure('crm_activity_action(uuid,uuid,timestamptz,text,timestamptz,uuid)') is not null ok"))[0].ok);
  console.log('PASS migration replay, archive counts, archive access, archived workflows, terminal executions, removed RPCs and native activity action');
  const commit=process.argv.includes('--apply');
  await query(commit?'COMMIT':'ROLLBACK');
  console.log(commit?'Committed verified forward migration':'Rolled back verification transaction');
}finally{await client.end()}
