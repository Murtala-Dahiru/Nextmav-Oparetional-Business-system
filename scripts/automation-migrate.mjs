import { readFileSync } from 'node:fs';
import { connect, readEnv } from './db-connect.mjs';
const connection = readEnv('DIRECT_URL') || readEnv('DATABASE_URL');
const api = new URL(readEnv('NEXT_PUBLIC_SUPABASE_URL')), db = new URL(connection);
const ref = api.hostname.split('.')[0];
if (!decodeURIComponent(db.username).endsWith(`.${ref}`) && db.hostname !== `db.${ref}.supabase.co`) throw Error('Database/application project mismatch');
const { client } = await connect(connection, { statement_timeout: 20000 });
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='3s'");
  await client.query(readFileSync('supabase/migrations/0094_crm_automation_studio.sql', 'utf8'));
  await client.query(readFileSync('supabase/migrations/0095_crm_automation_schedules.sql', 'utf8'));
  await client.query(readFileSync('supabase/migrations/0096_crm_automation_account_timers.sql', 'utf8'));
  await client.query(readFileSync('supabase/migrations/0097_crm_automation_monitoring_integrity.sql', 'utf8'));
  if (process.argv.includes('--apply')) { await client.query("NOTIFY pgrst, 'reload schema'"); await client.query('COMMIT'); console.log('Applied Automation Studio migrations 0094–0097'); }
  else { await client.query('ROLLBACK'); console.log('Automation Studio migrations 0094–0097 validated against live schema; rolled back'); }
} catch (e) { await client.query('ROLLBACK'); throw e; } finally { await client.end(); }
