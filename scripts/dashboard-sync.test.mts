import assert from 'node:assert/strict';
import { createSyncQueue } from '../src/components/modules/dashboard/sync-queue';

let now = 0, visible = true, calls = 0, nextId = 0;
let release: () => void = () => {};
const timers = new Map<number, { at: number; callback: () => void }>();
const queue = createSyncQueue(() => { calls++; return new Promise<void>(resolve => { release = resolve; }); }, {
  visible: () => visible, now: () => now,
  delay: (callback, ms) => { const id = ++nextId; timers.set(id, {at: now + ms, callback}); return id as unknown as ReturnType<typeof setTimeout>; },
  cancel: timer => { timers.delete(timer as unknown as number); },
});
async function advance(ms: number) {
  now += ms;
  for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.callback(); }
  await Promise.resolve(); await Promise.resolve();
}
queue.request(); queue.request(); queue.request();
await advance(0);
assert.equal(calls, 1, 'a burst creates one request');
queue.request(); queue.request();
await advance(5000);
assert.equal(calls, 1, 'events cannot overlap an in-flight request');
release(); await advance(0); await advance(0);
assert.equal(calls, 2, 'events during a request get one trailing read');
release(); await advance(0);
queue.request(); await advance(3999);
assert.equal(calls, 2, 'minimum start interval is respected');
await advance(1);
assert.equal(calls, 3);
release(); await advance(0);
visible = false; queue.request(); await advance(60000);
assert.equal(calls, 3, 'hidden/offline pages defer work');
visible = true; queue.resume(); await advance(0);
assert.equal(calls, 4, 'deferred events catch up on visibility/connection return');
queue.request(); queue.stop(); release(); await advance(10000);
assert.equal(calls, 4, 'cleanup prevents trailing work after unmount');
assert.equal(timers.size, 0);
console.log('PASS: burst coalescing, in-flight serialization, trailing invalidation, throttle, hidden recovery and cleanup');
