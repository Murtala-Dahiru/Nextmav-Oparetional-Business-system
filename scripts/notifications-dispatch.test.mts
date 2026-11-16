import assert from 'node:assert/strict';
import { generateVAPIDKeys } from 'web-push';
import type { Client } from 'pg';
import { dispatchNotifications } from '../src/lib/notifications/dispatch';
import { authenticate } from '../src/lib/notifications/dispatch-auth';

// Isolated in-memory keys and transport; these tests do not prove provider delivery.
const keys = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
const org = '11111111-1111-1111-1111-111111111111';
async function scenario({ allowed = true, status = 201, read = false, rich = false, leaseOwned = true, failures = 0 } = {}) {
  let claimed = false, sent = 0, ended = false;
  let payload: { presentation: { title: string; body: string } } | undefined;
  const statements: { sql: string; args: unknown[] }[] = [];
  const client = {
    async query(sql: string, args: unknown[] = []) {
      statements.push({ sql, args });
      if (sql.includes('SELECT * FROM public.notification_claim')) {
        if (claimed) return { rows: [] };
        claimed = true; return { rows: [{ id: 1, device_id: 'device', lease_token: 'lease', attempts: 1, failures }] };
      }
      if (sql.includes('SELECT n.*,d.endpoint')) return { rows: [{
        id: 42, organization_id: org, recipient_id: 'recipient', user_id: 'user',
        type: 'message_received', entity_type: 'message', title: 'Alex sent you a message', body: 'Review the proposal',
        is_active: true, member_deleted: null, enabled: true, retired_at: null, is_read: read,
        created_at: new Date().toISOString(), event_id: 'event', link: '/dashboard?module=communication&channel=example',
        notification_prefs: { push: true, messagePreviews: rich }, endpoint: 'https://fcm.googleapis.com/test',
      }] };
      if (sql.includes('AS allowed')) return { rows: [{ allowed }] };
      if (sql.includes('count(*)')) return { rows: [{ count: 0 }] };
      return { rows: [], rowCount: leaseOwned ? 1 : 0 };
    },
    async end() { ended = true; },
  };
  const send = (async (_subscription: unknown, value: string) => {
    sent++; payload = JSON.parse(value);
    if (status !== 201) throw Object.assign(new Error('Provider rejection'), { statusCode: status });
    return { statusCode: status };
  }) as Parameters<typeof dispatchNotifications>[4];
  const result = await dispatchNotifications(client as unknown as Client, org, 10000, false, send);
  assert.ok(ended);
  return { result, statements, sent, payload };
}
const accepted = await scenario({ rich: true });
assert.equal(accepted.result.accepted, 1);
assert.equal(accepted.payload?.presentation.body, 'Review the proposal');
assert.ok(accepted.statements.some(s => s.sql.includes('notification_delivery_attempts SET finished_at') && s.args[2] === 'accepted'));
assert.ok(!(await scenario()).payload?.presentation.body.includes('proposal'));
assert.equal((await scenario({ allowed: false })).sent, 0);
assert.equal((await scenario({ read: true })).sent, 0);
const gone = await scenario({ status: 410 });
assert.equal(gone.result.failed, 1);
assert.ok(gone.statements.some(s => s.sql.includes('SET enabled=false,retired_at=now()')));
assert.equal((await scenario({ status: 503 })).result.retried, 1);
assert.equal((await scenario({ status: 429 })).result.retried, 1);
assert.equal((await scenario({ status: 403 })).result.failed, 1);
assert.equal((await scenario({ status: 503, failures: 7 })).result.failed, 1);
const lost = await scenario({ leaseOwned: false });
assert.ok(!lost.statements.some(s => s.sql.includes('notification_delivery_attempts SET finished_at')));
assert.ok(lost.statements.some(s => s.sql.includes('WHERE id=$1 AND lease_token=$2')));
delete process.env.NOTIFICATION_DISPATCH_SECRET;
assert.equal(authenticate(new Request('https://example.com'))?.status, 503);
process.env.NOTIFICATION_DISPATCH_SECRET = 'a'.repeat(48);
assert.equal(authenticate(new Request('https://example.com', { headers: { cookie: 'session=present' } }))?.status, 401);
assert.equal(authenticate(new Request('https://example.com', { headers: { authorization: 'Bearer wrong' } }))?.status, 401);
assert.equal(authenticate(new Request('https://example.com', { headers: { authorization: `Bearer ${'a'.repeat(48)}` } })), null);
console.log('PASS dispatch transport policy, access revocation, privacy, retry, retirement, fencing and machine authentication tests (mock transport)');
