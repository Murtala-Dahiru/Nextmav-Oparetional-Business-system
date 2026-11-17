import assert from 'node:assert/strict';
import { defaultPreferences, preferencesSchema, isQuiet, safeDestination, retryDelay, permanentFailure, categoryOf, pushPresentation, plainPreview } from '../src/lib/notifications/model';
assert.equal(isQuiet(new Date('2026-11-15T23:00:00Z'), { ...defaultPreferences, quietEnabled: true }), true);
assert.equal(isQuiet(new Date('2026-11-15T12:00:00Z'), { ...defaultPreferences, quietEnabled: true }), false);
assert.equal(isQuiet(new Date('2026-11-15T21:30:00Z'), { ...defaultPreferences, quietEnabled: true, timezone: 'Africa/Lagos' }), true);
assert.equal(isQuiet(new Date('2026-11-15T12:00:00Z'), { ...defaultPreferences, quietEnabled: true, quietStart: 9, quietEnd: 17 }), true);
assert.equal(preferencesSchema.safeParse({ timezone: 'not/a-zone' }).success, false);
assert.equal(preferencesSchema.safeParse({ push: 'true' }).success, false);
assert.equal(safeDestination('https://evil.example/dashboard'), '/dashboard');
assert.equal(safeDestination('//evil.example'), '/dashboard');
assert.equal(safeDestination('/dashboard-evil'), '/dashboard');
assert.equal(safeDestination('/dashboard?module=crm&token=secret&lead=123'), '/dashboard?module=crm&lead=123');
assert.equal(retryDelay(1, 0), 15); assert.equal(retryDelay(3, 0), 60); assert.equal(retryDelay(20, 0), 3600);
assert.equal(permanentFailure(410), true); assert.equal(permanentFailure(429), false); assert.equal(permanentFailure(503), false);
assert.equal(categoryOf('crm_automation', 'agreement'), 'sign');
assert.equal(categoryOf('leave_approved'), 'hr');
console.log('PASS 18 notification policy assertions (quiet hours, timezone, validation, URLs, retry, privacy category)');

const message = { type: 'message_received', entity_type: 'message', title: 'Alex sent you a message', body: '<b>Review proposal</b> · Project' };
assert.equal(pushPresentation(message, defaultPreferences).title, 'New message');
assert.ok(!pushPresentation(message, defaultPreferences).body.includes('proposal'));
assert.equal(pushPresentation(message, { ...defaultPreferences, messagePreviews: true }).body, 'Review proposal · Project');
for (const [type, entity_type] of [['leave_approved','leave_request'],['expense_submitted','expense'],['crm_automation','agreement'],['commercial_executed','commercial']]) {
  const presentation = pushPresentation({type, entity_type, title:'SECRET',body:'SECRET'}, {...defaultPreferences,messagePreviews:true,businessPreviews:true});
  assert.ok(!JSON.stringify(presentation).includes('SECRET'));
}
assert.equal(plainPreview('x'.repeat(300),240).length,240);
assert.equal(categoryOf('sign_deadline'), 'sign');
console.log('PASS 9 preview policy assertions (opt-in, sensitive categories, truncation)');

assert.deepEqual(pushPresentation(message, { ...defaultPreferences, senderNames: true }), { title: message.title, body: 'Open NextMav to view the details.' });
