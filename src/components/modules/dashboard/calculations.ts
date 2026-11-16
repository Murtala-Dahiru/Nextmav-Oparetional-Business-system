import { dateIn } from '@/lib/org-time';

export interface FinanceInvoice {
  id: string; invoice_number: string; total: number; amount_paid: number;
  currency: string; status: string; issue_date: string; due_date: string;
  company?: { name: string } | null;
}
export interface FinanceExpense { amount: number; category: string; expense_date: string; currency: string }
export interface FinancePayment { amount: number; paid_at: string; invoice: { currency: string } }

export function financialHistory(today: string, timezone: string, currency: string,
  invoices: FinanceInvoice[], payments: FinancePayment[], expenses: FinanceExpense[]) {
  const end = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + i, 1));
    return { period: date.toISOString().slice(0, 10), revenue: 0, invoiced: 0, expenses: 0 };
  });
  const byMonth = new Map(monthly.map(m => [m.period.slice(0, 7), m]));
  for (const p of payments) {
    const day = dateIn(new Date(p.paid_at), timezone);
    const row = byMonth.get(day.slice(0, 7));
    if (row && day <= today && p.invoice?.currency.trim() === currency) row.revenue += Number(p.amount);
  }
  for (const inv of invoices) {
    const row = byMonth.get(inv.issue_date.slice(0, 7));
    if (row && inv.issue_date <= today && inv.currency.trim() === currency && !['draft', 'cancelled'].includes(inv.status)) row.invoiced += Number(inv.total);
  }
  for (const expense of expenses) {
    const row = byMonth.get(expense.expense_date.slice(0, 7));
    if (row && expense.expense_date <= today && expense.currency.trim() === currency) row.expenses += Number(expense.amount);
  }
  return monthly;
}

export function ageInvoices(invoices: FinanceInvoice[], today: string, currency: string) {
  return invoices.filter(i => i.currency.trim() === currency && !['draft', 'paid', 'cancelled'].includes(i.status) && Number(i.total) > Number(i.amount_paid))
    .map(i => {
      const days = Math.floor((Date.parse(today) - Date.parse(i.due_date)) / 86400000);
      return { invoice_id: i.id, invoice_number: i.invoice_number, company_name: i.company?.name,
        balance: Math.max(0, Number(i.total) - Number(i.amount_paid)), days_overdue: days,
        ageing_bucket: days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+' };
    }).sort((a, b) => b.days_overdue - a.days_overdue);
}
