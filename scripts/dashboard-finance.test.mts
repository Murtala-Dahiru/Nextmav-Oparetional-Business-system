import assert from 'node:assert/strict';
import { financialHistory, ageInvoices, type FinanceInvoice } from '../src/components/modules/dashboard/calculations';
const invoice: FinanceInvoice = { id: 'one', invoice_number: 'INV1', total: 100, amount_paid: 25, currency: 'NGN', status: 'sent', issue_date: '2026-08-01', due_date: '2026-09-24' };
const monthly = financialHistory('2026-10-24', 'Africa/Lagos', 'NGN', [invoice, {...invoice, id: 'draft', status: 'draft', total: 999}], [{ amount: 25, paid_at: '2026-09-30T23:30:00Z', invoice: { currency: 'NGN' } }, { amount: 500, paid_at: '2026-10-01T00:00:00Z', invoice: {currency:'USD'} }], [{amount: 10, category:'general', expense_date:'2026-10-02', currency:'NGN'}]);
assert.equal(monthly.length, 12);
assert.equal(monthly.at(-1)?.revenue, 25, 'partial payment uses organization-local receipt month');
assert.equal(monthly.at(-2)?.revenue, 0, 'missing months are zero-filled');
assert.equal(monthly.find(m=>m.period==='2026-08-01')?.invoiced, 100, 'drafts excluded');
assert.equal(monthly.at(-1)?.expenses, 10);
assert.equal(ageInvoices([invoice], '2026-10-24','NGN')[0].balance, 75);
assert.equal(ageInvoices([invoice], '2026-10-24','NGN')[0].ageing_bucket, '1-30');
assert.equal(ageInvoices([{...invoice,due_date:'2026-09-23'}], '2026-10-24','NGN')[0].ageing_bucket, '31-60');
assert.equal(ageInvoices([{...invoice,due_date:'2026-10-24'}], '2026-10-24','NGN')[0].ageing_bucket, 'current');
assert.equal(ageInvoices([{...invoice,amount_paid:100}], '2026-10-24','NGN').length, 0);
assert.equal(ageInvoices([{...invoice,currency:'USD'}], '2026-10-24','NGN').length, 0);
console.log('PASS: receipt dates, partial payments, currency isolation, drafts, calendar continuity and aging boundaries');
import { toCamel } from '../src/lib/case';
const payload = toCamel({expenseCategories:[{amount:10,expense_date:'2026-10-02',category:'general'}]}) as {expenseCategories:{expenseDate:string}[]};
assert.equal(payload.expenseCategories[0].expenseDate,'2026-10-02','expense chart follows API camelCase contract');

// Financial Report regressions: sparse, signed and sub-unit amounts remain exact.
const signed = financialHistory('2026-10-24', 'Africa/Lagos', 'NGN', [], [
  {amount: -0.25, paid_at:'2026-10-02T12:00:00Z', invoice:{currency:'NGN'}},
  {amount: 1_500_000_000, paid_at:'2026-09-01T12:00:00Z', invoice:{currency:'NGN'}},
  {amount: 999, paid_at:'2026-10-25T12:00:00Z', invoice:{currency:'NGN'}},
], [{amount:-12.5,category:'general',expense_date:'2026-10-02',currency:'NGN'}]);
assert.equal(signed.at(-1)?.revenue,-0.25);
assert.equal(signed.at(-1)?.expenses,-12.5);
assert.equal(signed.at(-2)?.revenue,1_500_000_000);
for (const range of [3,6,12]) {
  const selected=signed.slice(-range);
  assert.equal(selected.reduce((sum,row)=>sum+row.revenue,0),1_499_999_999.75);
  assert.equal(selected.length,range);
}
console.log('PASS signed values, small/large amounts, future exclusion and date-window totals');
