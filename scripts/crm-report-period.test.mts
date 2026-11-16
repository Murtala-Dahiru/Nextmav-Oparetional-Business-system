import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportPeriod, reportPreset } from '../src/lib/crm/report-period';

test('report comparison uses inclusive equal-length calendar periods across leap days', () => {
  assert.deepEqual(reportPeriod('2024-03-01', '2024-03-31'), { days:31, previousFrom:'2024-01-30', previousTo:'2024-02-29' });
  assert.deepEqual(reportPeriod('2026-01-01', '2026-01-01'), { days:1, previousFrom:'2025-12-31', previousTo:'2025-12-31' });
  for (const [from,to] of [['2026-02-30','2026-03-01'],['','2026-01-01'],['2026-02-01','2026-01-01'],['2020-01-01','2026-01-01']]) assert.equal(reportPeriod(from,to),null);
});
test('report presets respect organization date and include today in a 30-day period', () => {
  assert.deepEqual(reportPreset('2026-10-27','quarter'),{from:'2026-10-01',to:'2026-10-27'});
  const range=reportPreset('2024-03-01','30days');
  assert.deepEqual(range,{from:'2024-02-01',to:'2024-03-01'});
  assert.equal(reportPeriod(range.from,range.to)?.days,30);
});
