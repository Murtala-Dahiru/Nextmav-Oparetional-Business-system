import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readReportRows, activityWeeks, shiftCalendarDay } from '../src/lib/crm/reporting';

test('reports read beyond the API cap using actual returned offsets', async () => {
  const source = Array.from({ length: 2207 }, (_, id) => ({ id }));
  const offsets: number[] = [];
  const result = await readReportRows(async (from, to) => {
    offsets.push(from);
    return { data: source.slice(from, Math.min(to + 1, from + 137)), count: source.length, error: null };
  });
  assert.deepEqual(result.data, source);
  assert.equal(offsets[1], 137);
  assert.equal(result.error, null);
});

test('empty reports are successful; failed, oversized and incomplete reports return no partial data', async () => {
  assert.deepEqual((await readReportRows(async () => ({ data: [], count: 0, error: null }))).data, []);
  for (const page of [
    { data: [], count: 1, error: null },
    { data: [], count: null, error: null },
    { data: [], count: 50_001, error: null },
    { data: null, count: null, error: { code: '42501', message: 'denied' } },
  ]) {
    const result = await readReportRows(async () => page);
    assert.equal(result.data, null);
    assert.ok(result.error);
  }
});

test('a failed later page or changing row count invalidates the whole report', async () => {
  for (const failure of [
    { data: [2], count: 3, error: null },
    { data: null, count: null, error: { code: 'TIMEOUT' } },
  ]) {
    const result = await readReportRows(async from => from === 0
      ? { data: [1], count: 2, error: null } : failure);
    assert.equal(result.data, null);
    assert.ok(result.error);
  }
});

test('eight weeks include every one of 56 calendar days exactly once', () => {
  const today = '2026-10-24';
  const instants = Array.from({ length: 56 }, (_, i) => `${shiftCalendarDay(today, -i)}T12:00:00Z`);
  instants.push('2026-08-29T12:00:00Z', '2026-10-25T12:00:00Z', 'invalid');
  const weeks = activityWeeks(instants, today, 'Africa/Lagos');
  assert.equal(weeks[0].week, '2026-08-30');
  assert.equal(weeks[7].week, '2026-10-18');
  assert.deepEqual(weeks.map(w => w.count), Array(8).fill(7));
});

test('organization dates include local midnight and survive DST/leap transitions', () => {
  assert.equal(activityWeeks(['2026-08-29T23:30:00Z'], '2026-10-24', 'Africa/Lagos')[0].count, 1);
  assert.equal(activityWeeks(['2026-10-24T23:30:00Z'], '2026-10-24', 'Africa/Lagos')[7].count, 0);
  assert.equal(shiftCalendarDay('2024-03-01', -1), '2024-02-29');
  const instants = Array.from({ length: 56 }, (_, i) => `${shiftCalendarDay('2026-03-15', -i)}T12:00:00Z`);
  assert.deepEqual(activityWeeks(instants, '2026-03-15', 'America/New_York').map(w => w.count), Array(8).fill(7));
});
