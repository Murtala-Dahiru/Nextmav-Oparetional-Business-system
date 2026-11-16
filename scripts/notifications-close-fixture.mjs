import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
process.loadEnvFile('.env');
const file = join(tmpdir(), 'nextmav-notifications-fixture.json');
const fixture = JSON.parse(readFileSync(file));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const org = await admin.from('organizations').select('name').eq('id', fixture.orgId).single();
assert.equal(org.data?.name, 'Notification isolated acceptance');
for (const user of fixture.users) {
  assert.match(user.email, /^notifications-[a-f0-9-]{36}@example\.com$/);
  const existing = await admin.auth.admin.getUserById(user.id);
  assert.equal(existing.data.user?.email,user.email);
  const members = await admin.from('organization_members').select('organization_id').eq('user_id',user.id);
  assert.deepEqual(members.data?.map(row=>row.organization_id), [fixture.orgId]);
}
for (const user of fixture.users) {
  const updated = await admin.auth.admin.updateUserById(user.id, { password:randomBytes(48).toString('base64url'), ban_duration:'876000h' });
  assert.ifError(updated.error);
}
const devices = await admin.from('notification_devices').update({ enabled:false, retired_at:new Date().toISOString() }).eq('organization_id',fixture.orgId);
assert.ifError(devices.error);
const memberships = await admin.from('organization_members').update({ is_active:false }).eq('organization_id',fixture.orgId).neq('role','owner');
assert.ifError(memberships.error);
unlinkSync(file);
console.log('PASS isolated logins disabled, passwords rotated, devices retired, non-owner memberships deactivated, temporary credentials removed');
