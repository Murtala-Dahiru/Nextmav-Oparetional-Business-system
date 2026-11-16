/** Operator-only diagnostic command. Requires database credentials; no public endpoint.
 * Aggregates contain no notification content, recipient IDs, endpoints or keys. */
import { existsSync } from 'node:fs';
import { connect, readEnv } from './db-connect.mjs';
if (process.env.VAPID_ENV_FILE && existsSync(process.env.VAPID_ENV_FILE)) process.loadEnvFile(process.env.VAPID_ENV_FILE);
const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'), { statement_timeout: 15000 });
try {
  const report = { checkedAt: new Date().toISOString(), configuration: Object.fromEntries(
    ['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','NOTIFICATION_DISPATCH_SECRET'].map(key => [key, !!readEnv(key)])) };
  for (const [key, sql] of Object.entries({
    worker: 'SELECT * FROM notification_worker_health',
    deliveries: 'SELECT state,count(*)::int count,min(created_at) oldest FROM notification_deliveries GROUP BY state',
    devices: 'SELECT enabled,(retired_at IS NOT NULL) retired,count(*)::int count,max(last_accepted_at) last_acceptance FROM notification_devices GROUP BY 1,2',
    recentResults: "SELECT result,provider_code,count(*)::int count,max(started_at) last_attempt FROM notification_delivery_attempts WHERE started_at>now()-interval '24 hours' GROUP BY 1,2",
  })) report[key] = (await client.query(sql)).rows;
  report.scheduler = (await client.query("SELECT jobname,schedule,active FROM cron.job WHERE jobname='nextmav-push-recovery'")).rows;
  report.extensions = (await client.query("SELECT name,installed_version FROM pg_available_extensions WHERE name IN ('pg_cron','pg_net','supabase_vault')")).rows;
  report.wakeConfiguration = (await client.query("SELECT name FROM vault.secrets WHERE name IN ('notification_dispatch_url','notification_dispatch_secret')")).rows;
  report.recentWakeErrors = (await client.query("SELECT error_code,count(*)::int count FROM notification_dispatch_requests WHERE requested_at>now()-interval '24 hours' AND error_code IS NOT NULL GROUP BY error_code")).rows;
  if (report.extensions.some(e => e.name==='pg_net' && e.installed_version)) report.recentWakeResponses = (await client.query("SELECT r.status_code,r.timed_out,count(*)::int count FROM notification_dispatch_requests d JOIN net._http_response r ON r.id=d.request_id WHERE d.requested_at>now()-interval '24 hours' GROUP BY 1,2")).rows;
  console.log(JSON.stringify(report, null, 2));
} finally { await client.end(); }
