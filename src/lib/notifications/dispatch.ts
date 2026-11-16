import { pushConfiguration } from './config';
import { createHash } from 'node:crypto';
import * as webpush from 'web-push';
import type { Client } from 'pg';
import { eventFromRow, preferencesSchema, isQuiet, retryDelay, permanentFailure, pushPresentation } from './model';

/** Existing durable dispatcher shared by CLI and secured Vercel Function. Owns the client. */
export async function dispatchNotifications(client: Client, org?: string, budgetMs = 180_000, sweep = process.env.NOTIFICATION_SKIP_SWEEPS !== '1', send = webpush.sendNotification) {
const deadline = Date.now() + budgetMs;
const metrics = { examined: 0, accepted: 0, skipped: 0, deferred: 0, failed: 0, retried: 0 };
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const configured = pushConfiguration().ready;
try {
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT!, vapidPublicKey!, process.env.VAPID_PRIVATE_KEY!);
  // Same durable sweeps as the existing platform; no browser is needed.
  await client.query(`INSERT INTO notification_worker_health(worker_id,configuration_ready) VALUES('dispatcher',$1) ON CONFLICT(worker_id) DO UPDATE SET last_started_at=now(),configuration_ready=$1`, [configured]);
  if (!org && sweep) for (const fn of ['sweep_todo_reminders', 'sweep_crm_reminders', 'notification_sweep_tasks', 'notification_sweep_deadlines']) await client.query(`SELECT ${fn}(200)`);
  if (!configured) throw Error('Push configuration unavailable');
  else for (let i = 0; i < 50 && Date.now() < deadline; i++) {
    const claimed = await client.query('SELECT * FROM public.notification_claim($1)', [org ?? null]);
    const job = claimed.rows[0];
    if (!job) break;
    metrics.examined++;
    const loaded = await client.query(`SELECT n.*,d.endpoint,d.p256dh,d.auth,d.enabled,d.retired_at,m.user_id,m.is_active,m.deleted_at AS member_deleted,m.notification_prefs
      FROM notification_deliveries j JOIN notifications n ON n.id=j.notification_id JOIN notification_devices d ON d.id=j.device_id
      JOIN organization_members m ON m.id=n.recipient_id AND m.id=d.member_id AND m.organization_id=n.organization_id AND d.organization_id=n.organization_id
      JOIN profiles p ON p.id=m.user_id AND p.is_active AND p.auth_deleted_at IS NULL AND NOT p.force_password_change
      WHERE j.id=$1 AND j.lease_token=$2
      AND (n.type NOT IN ('invoice_deadline','ticket_deadline','milestone_due','hr_action_due','sign_deadline','commercial_obligation_due','event_due') OR EXISTS(SELECT 1 FROM notification_deadlines d WHERE d.organization_id=n.organization_id AND d.recipient_id=n.recipient_id AND d.record_id=n.entity_id AND n.dedupe_key=d.kind||':'||d.source_id||':'||extract(epoch FROM d.due_at)::bigint))
      AND (n.type NOT IN ('task_due','task_overdue') OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=n.entity_id AND t.assignee_id=n.recipient_id AND n.dedupe_key='task:'||t.id||':'||t.due_date||':'||n.type))`, [job.id, job.lease_token]);
    const n = loaded.rows[0];
    let state = 'skipped', code: number | null = null, delay = 0;
    try {
      if (n && n.is_active && !n.member_deleted && n.enabled && !n.retired_at && !n.is_read && new Date(n.expires_at ?? new Date(n.created_at).getTime() + 172800000).getTime() > Date.now()) {
        // Impersonate only within a transaction, then reset before touching queue.
        await client.query('BEGIN');
        await client.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [n.user_id, JSON.stringify({ sub: n.user_id, role: 'authenticated' })]);
        await client.query('SET LOCAL ROLE authenticated');
        const access = await client.query('SELECT notification_record_visible($1,$2,$3,$4) AS allowed', [n.organization_id, n.type, n.entity_type, n.entity_id]);
        await client.query('ROLLBACK');
        const parsed = preferencesSchema.safeParse(n.notification_prefs);
        const event = eventFromRow(n);
        if (access.rows[0].allowed && parsed.success && (n.type === 'push_test' || (parsed.data.push && (event.priority === 'critical' || parsed.data.categories[event.category])))) {
          const recent = await client.query("SELECT count(*)::int AS count FROM notification_deliveries WHERE device_id=$1 AND state='accepted' AND completed_at>now()-interval '1 minute'", [job.device_id]);
          if (n.type !== 'push_test' && event.priority !== 'critical' && (isQuiet(new Date(), parsed.data) || recent.rows[0].count >= 10)) { state = 'pending'; delay = 60; metrics.deferred++; }
          else if (job.failures >= 8) state = 'failed';
          else {
            const group = n.entity_type === 'message' ? createHash('sha256').update(`${n.organization_id}:${n.recipient_id}:${n.link}`).digest('base64url').slice(0, 24) : `nm${n.id}`;
            const ttl = n.expires_at ? Math.min(300, Math.max(1, Math.floor((new Date(n.expires_at).getTime() - Date.now()) / 1000))) : 300;
            const response = await send(
              { endpoint: n.endpoint, keys: { p256dh: n.p256dh, auth: n.auth } },
              JSON.stringify({ presentation: pushPresentation(n, parsed.data), id: String(n.id), organizationId: n.organization_id, silent: parsed.data.silent, group }),
              { TTL: ttl, urgency: ['high', 'critical'].includes(n.priority) ? 'high' : 'normal', timeout: 10000, topic: group },
            );
            code = response.statusCode; state = 'accepted'; metrics.accepted++;
          }
        }
      }
    } catch (cause) {
      await client.query('ROLLBACK');
      code = Number((cause as { statusCode?: number }).statusCode) || null;
      if (code === 404 || code === 410) await client.query('UPDATE notification_devices SET enabled=false,retired_at=now() WHERE id=$1', [job.device_id]);
      state = job.failures >= 7 || permanentFailure(code ?? 0) ? 'failed' : 'pending';
      delay = retryDelay(job.failures + 1);
      await client.query('UPDATE notification_deliveries SET failures=failures+1 WHERE id=$1 AND lease_token=$2', [job.id, job.lease_token]);
      if (state === 'pending') metrics.retried++;
    }
    if (state === 'skipped') metrics.skipped++;
    if (state === 'failed') metrics.failed++;
    await client.query('BEGIN');
    const finalized = await client.query(`UPDATE notification_deliveries SET state=$3,last_code=$4,available_at=now()+$5*interval '1 second',lease_until=NULL,
      completed_at=CASE WHEN $3 IN ('accepted','failed','skipped') THEN now() END WHERE id=$1 AND lease_token=$2`, [job.id, job.lease_token, state, code, delay]);
    if (!finalized.rowCount) { await client.query('ROLLBACK'); continue; }
    await client.query('UPDATE notification_delivery_attempts SET finished_at=now(),result=$3,provider_code=$4 WHERE delivery_id=$1 AND attempt=$2', [job.id, job.attempts, state, code]);
    if (state === 'accepted') await client.query('UPDATE notification_devices SET last_accepted_at=now() WHERE id=$1', [job.device_id]);
    await client.query('COMMIT');
  }
  if (configured) await client.query("UPDATE notification_worker_health SET last_success_at=now(),last_sweep_at=CASE WHEN $1 THEN now() ELSE last_sweep_at END WHERE worker_id='dispatcher'", [!org && sweep]);
  // Continue a full/budget-limited batch immediately; cron recovers a lost wake-up.
  if (!org) await client.query("SELECT notification_request_dispatch() WHERE EXISTS(SELECT 1 FROM notification_deliveries WHERE state='pending' AND available_at<=now())");
  return metrics;
} finally { await client.end(); }

}
