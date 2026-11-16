import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leadListScope } from '../src/lib/crm/lead-list-scope';
import type { RequestContext } from '../src/lib/auth-context';
import { createLeadSchema, updateLeadSchema } from '../src/lib/validations';
import { companyListScope } from '../src/lib/crm/company-list-scope';

test('account segment narrows the existing JSON profile with a parameterized equality', () => {
  const constraints: string[][] = [];
  const query = { eq(column: string, value: string) { constraints.push([column,value]);return this; } };
  assert.equal(companyListScope(query, {}, new URL('https://local.test/?segment=%20Strategic%20')), query);
  assert.deepEqual(constraints, [['crm_profile->>segment','Strategic']]);
  companyListScope(query, {}, new URL('https://local.test/?segment='));
  assert.equal(constraints.length,1);
});

test('manual campaign attribution is bounded and partial updates preserve omitted attribution', () => {
  assert.equal(createLeadSchema.shape.campaign.parse('  Autumn outreach  '), 'Autumn outreach');
  assert.equal(createLeadSchema.shape.campaign.safeParse(42).success, false);
  assert.equal(createLeadSchema.shape.campaign.safeParse('x'.repeat(251)).success, false);
  assert.deepEqual(updateLeadSchema.parse({ notes: 'Follow-up scheduled' }), { notes: 'Follow-up scheduled' });
  assert.equal(updateLeadSchema.parse({ campaign: '' }).campaign, '');
});

test('unassigned inbox narrows rather than replaces sales ownership restrictions', () => {
  for (const role of ['sales_staff', 'owner'] as const) {
    const constraints: unknown[][] = [];
    const query = { eq: (...args: unknown[]) => { constraints.push(['eq', ...args]); return query; }, is: (...args: unknown[]) => { constraints.push(['is', ...args]); return query; } };
    const context = { org: { role, memberId: 'current-member' } } as RequestContext;
    leadListScope(query, context, new URL('https://local.test/api/crm/leads?unassigned=true&ownerId=foreign'));
    assert.deepEqual(constraints, role === 'sales_staff' ? [['eq', 'owner_id', 'current-member'], ['is', 'owner_id', null]] : [['is', 'owner_id', null]]);
  }
});
