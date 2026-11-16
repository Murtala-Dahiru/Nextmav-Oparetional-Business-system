import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
process.loadEnvFile('.env');
const fixture = JSON.parse(readFileSync(join(tmpdir(), 'nextmav-notifications-fixture.json')));
const clients = await Promise.all(fixture.users.map(async user => {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.ifError(result.error); await client.realtime.setAuth(result.data.session.access_token); return client;
}));
const [sender, recipient] = clients, samples = [];
const received = new Map();
try {
  const channel = recipient.channel('notifications-acceptance-' + Date.now()).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${fixture.memberB}` }, event => received.set(event.new.entity_id, performance.now()));
  await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(Error('Realtime subscription timed out')),15000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}}); });
  for (let i = 0; i < 20; i++) {
    const started = performance.now();
    const result = await sender.from('messages').insert({ organization_id: fixture.orgId, channel_id: fixture.channelId, sender_id: fixture.memberA, body: `Isolated realtime timing ${i + 1}` }).select('id').single();
    assert.ifError(result.error);
    while (!received.has(result.data.id) && performance.now()-started < 10000) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(received.has(result.data.id), 'Expected exact committed message event');
    samples.push(Math.round(received.get(result.data.id)-started));
  }
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({ journey:'sender insert request start to authenticated Supabase Realtime recipient callback', samples:samples.length, p50Ms:samples[9], p95Ms:samples[18], maxMs:samples[19] }));
  await recipient.removeChannel(channel);
  const offline = await sender.from('messages').insert({ organization_id: fixture.orgId, channel_id: fixture.channelId, sender_id: fixture.memberA, body: 'Disconnected recipient acceptance' }).select('id').single();
  assert.ifError(offline.error);
  const history = await recipient.from('notifications').select('id').eq('entity_id',offline.data.id).single(); assert.ifError(history.error);
  console.log('PASS durable inbox reconciles after recipient disconnect');
} finally { for (const client of clients) { await client.removeAllChannels(); client.realtime.disconnect(); } }
