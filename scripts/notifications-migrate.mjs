import { readFileSync } from 'node:fs';
import { connect, readEnv } from './db-connect.mjs';
const connection = readEnv('DIRECT_URL') || readEnv('DATABASE_URL');
if (!connection) throw Error('Database connection unavailable');
const api = new URL(readEnv('NEXT_PUBLIC_SUPABASE_URL')), db = new URL(connection), ref = api.hostname.split('.')[0];
if (!decodeURIComponent(db.username).endsWith(`.${ref}`) && db.hostname !== `db.${ref}.supabase.co`) throw Error('Database/application project mismatch');
const { client } = await connect(connection, { statement_timeout: 20000 });
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='3s'");
  const files = [
    '0150_notification_delivery.sql', '0151_notification_visibility.sql', '0152_notification_lifecycle.sql',
    '0153_notification_business_events.sql', '0154_notification_deadlines.sql', '0155_notification_preferences.sql',
    '0156_notification_delivery_guards.sql', '0157_notification_claim.sql', '0158_notification_business_api.sql', '0159_notification_scope.sql', '0160_notification_dispatch.sql', '0161_notification_serverless.sql', '0162_notification_descriptions.sql', '0163_notification_task_actor.sql',
  ];
  const from = process.argv.find(arg => arg.startsWith('--from='))?.slice(7) ?? '0150';
  if (!files.some(file => file.startsWith(from + '_'))) throw Error('Unknown starting migration');
  for (const file of files.filter(file => file.slice(0, 4) >= from)) {
    await client.query(readFileSync('supabase/migrations/' + file, 'utf8'));
    console.log('Validated ' + file);
  }
  if (process.argv.includes('--apply')) { await client.query("NOTIFY pgrst,'reload schema'"); await client.query('COMMIT'); console.log('Notification migrations committed'); }
  else { await client.query('ROLLBACK'); console.log('Validation rolled back; no persistent changes'); }
} catch (cause) { await client.query('ROLLBACK'); throw cause; }
finally { await client.end(); }
