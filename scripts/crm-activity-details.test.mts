import assert from 'node:assert/strict';
import { activityDetailsSchema } from '../src/lib/crm/activity-details.ts';
import { toCamel, toSnake } from '../src/lib/case.ts';

assert.equal(activityDetailsSchema.safeParse({ videoUrl: 'javascript:alert(1)' }).success, false);
assert.equal(activityDetailsSchema.safeParse({ timezone: 'Invalid/Zone' }).success, false);
assert.equal(activityDetailsSchema.safeParse({ participants: ['not-an-address'] }).success, false);
assert.equal(activityDetailsSchema.safeParse({ duration: -1 }).success, false);
const meeting = { videoUrl: 'https://meet.example.com/room', endsAt: '2026-11-05T10:00:00Z', timezone: 'Africa/Lagos', participants: ['synthetic@example.com'], duration: 30 };
assert.deepEqual(activityDetailsSchema.parse(toCamel(toSnake(meeting))), meeting);
console.log('PASS native activity detail validation assertions');
