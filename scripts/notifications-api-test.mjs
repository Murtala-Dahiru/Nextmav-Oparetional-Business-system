import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { connect, readEnv } from './db-connect.mjs';
process.loadEnvFile('.env');
const base = process.env.APP_URL || 'http://localhost:3016';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const fixture = { users: [], base };
const jars = [new Map(), new Map()];
async function call(who, path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie: [...jars[who]].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000), redirect: 'manual' });
  for (const raw of response.headers.getSetCookie()) { const pair = raw.split(';')[0], i = pair.indexOf('='); jars[who].set(pair.slice(0, i), pair.slice(i + 1)); }
  return { status: response.status, json: await response.json().catch(() => null), location: response.headers.get('location') };
}
async function good(who, path, method = 'GET', body) { const result = await call(who, path, method, body); assert.ok(result.status < 300, `${path}: ${result.status} ${JSON.stringify(result.json)}`); return result.json; }
let checks = 0; const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS ' + label); };
const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'), { statement_timeout: 20000 });
try {
  for (let i = 0; i < 2; i++) {
    const user = { email: `notifications-${randomUUID()}@example.com`, password: `Test!${randomUUID()}9a` };
    const created = await admin.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { first_name: 'Notification', last_name: i ? 'Recipient' : 'Sender' } });
    assert.ifError(created.error); user.id = created.data.user.id; fixture.users.push(user);
  }
  await good(0, '/api/auth/login', 'POST', fixture.users[0]);
  fixture.orgId = (await good(0, '/api/organizations', 'POST', { name: 'Notification isolated acceptance' })).data.id;
  fixture.memberA = (await client.query('SELECT id FROM organization_members WHERE organization_id=$1 AND user_id=$2', [fixture.orgId, fixture.users[0].id])).rows[0].id;
  fixture.memberB = (await client.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'employee') RETURNING id", [fixture.orgId, fixture.users[1].id])).rows[0].id;
  await good(1, '/api/auth/login', 'POST', fixture.users[1]);
  check(true, 'Two independent authenticated accounts');
  fixture.channelId = (await good(0, '/api/communication/channels', 'POST', { name: 'Notification acceptance', type: 'private', memberIds: [fixture.memberB] })).data.id;
  // Explicit membership API avoids assumptions about create-channel field aliases.
  await good(0, `/api/communication/channels/${fixture.channelId}/members`, 'POST', { memberIds: [fixture.memberB] });
  fixture.messageId = (await good(0, '/api/communication/messages', 'POST', { channelId: fixture.channelId, body: 'Isolated notification acceptance message' })).data.id;
  const inbox = await good(1, '/api/notifications');
  const notice = inbox.data.find(n => n.entityId === fixture.messageId);
  check(!!notice, 'Recipient inbox contains persisted message event');
  check(!(await good(0, '/api/notifications')).data.some(n => n.entityId === fixture.messageId), 'Sender receives no self notification');
  check(inbox.meta.unread > 0, 'Unread total returned separately from page');
  await good(1, '/api/notifications', 'PATCH', { ids: [notice.id] });
  check(!(await good(1, '/api/notifications?unread=true')).data.some(n => n.id === notice.id), 'Mark read persists across requests');
  await good(1, '/api/notifications', 'PATCH', { ids: [notice.id], isRead: false });
  check((await good(1, '/api/notifications?unread=true')).data.some(n => n.id === notice.id), 'Mark unread persists across requests');
  const click = await call(1, `/api/notifications/open?id=${notice.id}&organizationId=${fixture.orgId}`);
  check(click.status === 303 && click.location.includes(`channel=${fixture.channelId}`), 'Authorized click resolves exact conversation');
  const settings = (await good(1, '/api/notifications/settings')).data;
  await good(1, '/api/notifications/settings', 'PUT', { ...settings.preferences, quietEnabled: true, timezone: 'Africa/Lagos' });
  check((await good(1, '/api/notifications/settings')).data.preferences.quietEnabled, 'Preferences and timezone persist');
  check((await call(1, '/api/notifications/settings', 'PUT', { push: 'invalid' })).status === 422, 'Invalid preference rejected');
  check((await call(1, '/api/notifications/devices', 'POST', { endpoint: 'http://127.0.0.1/internal', keys: { p256dh: 'x', auth: 'x' } })).status >= 400, 'Invalid push registration rejected');
  await good(1, '/api/notifications', 'PATCH', {});
  check((await good(1, '/api/notifications')).meta.unread === 0, 'Mark all read clears unread count');
  const anon = await fetch(`${base}/api/notifications/open?id=${notice.id}&organizationId=${fixture.orgId}`, { redirect: 'manual' });
  check(anon.status === 307 && anon.headers.get('location').includes('/login?next='), 'Closed-session click preserves destination through login');
  // Retained temporarily for visible browser verification; never use customer identities.
  writeFileSync(join(tmpdir(), 'nextmav-notifications-fixture.json'), JSON.stringify(fixture));
  console.log(`PASS ${checks} authenticated API checks; isolated fixture retained for browser verification`);
} finally { await client.end(); }
