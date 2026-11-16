/** Activate only after the secured production route is deployed. Never prints secrets. */
import { connect, readEnv } from './db-connect.mjs';
if (process.env.VAPID_ENV_FILE) process.loadEnvFile(process.env.VAPID_ENV_FILE);
const origin = new URL(process.env.APP_URL || readEnv('NEXT_PUBLIC_APP_URL'));
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw Error('Canonical HTTPS production origin required');
const destination = new URL('/api/internal/notifications/dispatch', origin).href;
const secret = readEnv('NOTIFICATION_DISPATCH_SECRET');
if (secret.length < 32) throw Error('Load the protected dispatcher credential first');
const probe = await fetch(destination, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, redirect: 'manual', signal: AbortSignal.timeout(290000) });
if (probe.status !== 200) throw Error(`Production dispatcher probe failed (${probe.status}); Vault not changed`);
const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'), { statement_timeout: 15000 });
try {
  await client.query('BEGIN');
  for (const [name,value] of [['notification_dispatch_url',destination],['notification_dispatch_secret',secret]]) {
    const existing = (await client.query('SELECT id FROM vault.secrets WHERE name=$1',[name])).rows[0];
    if (existing) await client.query('SELECT vault.update_secret($1,$2)',[existing.id,value]);
    else await client.query('SELECT vault.create_secret($1,$2)',[value,name]);
  }
  await client.query('COMMIT');
  await client.query('SELECT notification_request_dispatch()');
  console.log('Production dispatcher authenticated; Vault wake-up configuration activated. Inspect notifications:health for HTTP and provider results.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
