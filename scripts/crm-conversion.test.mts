import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversionSchema } from '../src/lib/crm/conversion';

test('conversion rejects invalid money, dates, identities and malformed options', () => {
  for (const input of [
    { dealValue: -1 }, { dealValue: Infinity }, { dealValue: NaN }, { dealValue: 1000000000000 },
    { dealValue: '100' }, { createDeal: 'true' }, { expectedClose: '2026-02-30' },
    { expectedClose: 'tomorrow' }, { contactId: 'not-an-id' }, { companyId: 'not-an-id' },
    { dealName: 'a'.repeat(251) }, null, [],
  ]) assert.equal(conversionSchema.safeParse(input).success, false, JSON.stringify(input));
});
test('conversion preserves optional defaults and valid leap dates', () => {
  assert.deepEqual(conversionSchema.parse({}), { createDeal: false });
  assert.deepEqual(conversionSchema.parse({ createDeal: true, dealName: ' Quote ', dealValue: 0, expectedClose: '2028-02-29' }), {
    createDeal: true, dealName: 'Quote', dealValue: 0, expectedClose: '2028-02-29',
  });
  assert.equal('organizationId' in conversionSchema.parse({ organizationId: 'forged' }), false);
});
