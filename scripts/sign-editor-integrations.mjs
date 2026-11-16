import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env');
const base = process.env.APP_URL || 'http://localhost:3018';
const fixture = (kind) =>
  JSON.parse(readFileSync(join(tmpdir(), 'nextmav-' + kind + '-fixture.json')));
const sign = fixture('sign'),
  commercial = fixture('commercial'),
  draft = fixture('sign-customization');
assert.notEqual(sign.orgId, commercial.orgId);
async function login(user) {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  assert.equal(response.status, 200);
  return response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
}
async function api(cookie, path, data) {
  const res = await fetch(base + path, {
    method: data ? 'POST' : 'GET',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}
const sender = await login(sign),
  other = await login(commercial);
assert.equal((await api(other, '/api/sign/' + draft.envelopeId)).status, 404);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
assert.ifError(
  (
    await db.auth.signInWithPassword({
      email: commercial.email,
      password: commercial.password,
    })
  ).error,
);
const hidden = await db
  .from('sign_envelopes')
  .select('id')
  .eq('id', draft.envelopeId);
assert.ifError(hidden.error);
assert.deepEqual(hidden.data, []);
console.log(
  'PASS separate acceptance tenant cannot read the fixture envelope via the API or RLS',
);
const copy = await api(sender, '/api/sign/templates', {
  id: draft.templateId,
  operation: 'duplicate',
});
assert.equal(copy.status, 200);
const name = 'TEST ONLY renamed ' + copy.body.data.id;
const edit = await api(sender, '/api/sign/templates', {
  id: copy.body.data.id,
  operation: 'rename',
  name,
});
assert.equal(edit.status, 200);
const list = await api(sender, '/api/sign/templates');
assert.ok(
  list.body.data.some((t) => t.id === copy.body.data.id && t.name === name),
);
assert.equal(
  (
    await api(sender, '/api/sign/templates', {
      id: copy.body.data.id,
      operation: 'archive',
    })
  ).status,
  200,
);
console.log(
  'PASS cloned template renames, persists and archives independently',
);
const records = await api(other, '/api/crm/commercial');
assert.equal(records.status, 200);
const record = records.body.data.find(
  (r) =>
    ['approved', 'issued', 'sent', 'shared', 'sent_for_signature'].includes(
      r.status,
    ) && ['quote', 'contract', 'proposal'].includes(r.kind),
);
if (!record) {
  console.log(
    'SKIP Commercial acceptance tenant has no eligible source in its current record list',
  );
} else {
  const result = await api(other, '/api/sign', { recordId: record.id });
  assert.equal(result.status, 200, result.body.error);
  assert.equal(result.body.data.record_id, record.id);
  assert.ok(result.body.data.version_id);
  console.log(
    'PASS Commercial Hub prepares a new draft bound to the source record and its version',
  );
}
