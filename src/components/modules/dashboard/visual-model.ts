import type { DashboardProject, DashboardFinance } from './types';

export type ProjectBand = 'On track' | 'At risk' | 'Delayed';
/** A partition, not overlapping risk flags. Delayed always takes precedence. */
export function projectBand(project: DashboardProject): ProjectBand {
  if (project.daysLeft !== null && project.daysLeft < 0) return 'Delayed';
  return project.atRisk ? 'At risk' : 'On track';
}

export function expenseDistribution(finance: DashboardFinance, range: number) {
  const first = finance.revenueByMonth.slice(-range)[0]?.period;
  if (!first) return [];
  const categories = new Map<string, number>();
  for (const expense of finance.expenseCategories ?? []) {
    if (expense.expenseDate >= first) categories.set(expense.category, (categories.get(expense.category) ?? 0) + Number(expense.amount));
  }
  const sorted = [...categories].sort((a,b)=>b[1]-a[1]);
  const result = sorted.slice(0,4).map(([name,value])=>({name,value}));
  if (sorted.length > 4) result.push({name:'Other categories',value:sorted.slice(4).reduce((sum,e)=>sum+e[1],0)});
  return result;
}
