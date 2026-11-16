import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Handler unit tests only. These do not contact a push provider or prove display.
const handlers = new Map(), shown = [], navigated = [];
const self = { location: { origin: 'https://nextmav.example' }, addEventListener: (name, handler) => handlers.set(name, handler), registration: { showNotification: async (title, options) => shown.push({ title, options }) }, clients: { matchAll: async () => [{ url: 'https://nextmav.example/dashboard', navigate: async url => navigated.push(url), focus: async () => {} }], openWindow: async url => navigated.push(url) } };
vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL });
let pending;
handlers.get('push')({ data: { json: () => ({ id: '42', organizationId: '12345678-1234-1234-1234-123456789abc', body: 'Confidential amount', url: 'https://attacker.example' }) }, waitUntil: promise => pending = promise });
await pending;
assert.equal(shown.length, 1); assert.equal(shown[0].title, 'NextMav');
assert.equal(shown[0].options.body, 'You have a new notification in your workspace.');
assert.ok(shown[0].options.data.url.startsWith('/api/notifications/open?id=42&'));
handlers.get('push')({ data: { json: () => ({ id: '<script>', organizationId: 'invalid' }) }, waitUntil() { throw Error('Invalid payload should not display'); } });
assert.equal(shown.length, 1);
handlers.get('notificationclick')({ notification: { close() {}, data: shown[0].options.data }, waitUntil: promise => pending = promise }); await pending;
assert.ok(navigated[0].startsWith('https://nextmav.example/api/notifications/open?'));
handlers.get('notificationclick')({ notification: { close() {}, data: { url: 'https://attacker.example' } }, waitUntil: promise => pending = promise }); await pending;
assert.equal(navigated[1], 'https://nextmav.example/dashboard');
console.log('PASS 7 service-worker handler assertions; no provider delivery or OS display simulated as evidence');

handlers.get('push')({ data: { json: () => ({ id: '43', organizationId: '12345678-1234-1234-1234-123456789abc', presentation: { title: 'Alex sent you a message', body: 'Review the proposal.' } }) }, waitUntil: promise => pending = promise }); await pending;
assert.equal(shown[1].title, 'Alex sent you a message');
assert.equal(shown[1].options.body, 'Review the proposal.');
assert.ok(!shown[1].options.data.url.includes('proposal'));
console.log('PASS 3 rich service-worker presentation assertions');
