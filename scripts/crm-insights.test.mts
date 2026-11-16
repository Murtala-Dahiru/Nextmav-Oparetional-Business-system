import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acquisitionSources, openDealAging, recordedLossReasons } from '../src/lib/crm/insights';

test('sources reconcile counts and real conversion markers without inventing attribution', () => {
  const rows = acquisitionSources([
    { source: ' WEB ', converted_at: '2026-01-02', created_at: '2026-01-01' },
    { source: 'web', converted_at: null, created_at: '2026-01-01' },
    { source: null, converted_at: null, created_at: '2026-01-01' },
  ]);
  assert.deepEqual(rows, [{ source: 'web', count: 2, converted: 1 }, { source: 'unknown', count: 1, converted: 0 }]);
  assert.deepEqual(acquisitionSources([]), []);
});

test('aging assigns every boundary once using organization calendar, including DST', () => {
  const today = '2026-11-02';
  const ages = [0, 14, 15, 30, 31, 60, 61, 90, 91, 400];
  const deals = ages.map(age => ({ created_at: new Date(Date.parse(today + 'T12:00:00Z') - age * 86400000).toISOString(), value: '10.50' }));
  const result = openDealAging(deals, today, 'America/New_York');
  assert.deepEqual(result.buckets.map(b => b.count), [2, 2, 2, 2, 2]);
  assert.equal(result.buckets.reduce((s, b) => s + b.value, 0), 105);
  assert.equal(result.excluded, 0);
  assert.equal(openDealAging([{ created_at: '2026-11-02T00:30:00Z', value: 10 }], '2026-11-01', 'America/New_York').excluded, 0);
});

test('invalid, future, and negative-value aging records are disclosed as excluded', () => {
  const result = openDealAging([
    { created_at: 'invalid', value: 1 }, { created_at: '2027-01-01', value: 1 },
    { created_at: '2026-01-01', value: -1 }, { created_at: '2026-01-01', value: 'NaN' },
  ], '2026-10-25', 'Africa/Lagos');
  assert.equal(result.excluded, 4);
  assert.equal(result.buckets.reduce((s, b) => s + b.count, 0), 0);
});

test('loss analysis excludes won business and exposes missing reasons', () => {
  assert.deepEqual(recordedLossReasons([
    { stage: 'closed_won', lost_reason: 'Stale reason' },
    { stage: 'closed_lost', lost_reason: ' Price ' },
    { stage: 'closed_lost', lost_reason: 'Price' },
    { stage: 'closed_lost', lost_reason: ' ' },
  ]), [{ reason: 'Price', count: 2 }, { reason: 'Not recorded', count: 1 }]);
});
