/**
 * The dashboard's attention queue.
 *
 *     npm run test:dashboard
 *
 * ── What this exists to prevent ───────────────────────────────────────────
 *
 * The queue is the one piece of the dashboard that *decides* something rather
 * than displaying it, and two of its decisions are the kind that fail quietly:
 *
 *   1. **Offering an action the role cannot take.** `pendingLeave` is sent to
 *      everyone who can see HR at all — including an employee who may only
 *      file their own leave. Telling them three requests await approval is
 *      telling them about somebody else's job, and the row leads to a screen
 *      that will refuse them. Nothing else in the harness would notice.
 *   2. **Ordering by accident.** The whole point of the queue is that the most
 *      serious thing is first. A sort that quietly stops sorting still renders
 *      a plausible-looking list.
 *
 * Both are asserted below against the real capability model.
 */
import { ROLE_GRANTS, type Action } from '../src/lib/permissions';
import type { ModuleId } from '../src/lib/constants';
import { buildAttention, isNewWorkspace } from '../src/components/modules/dashboard/attention';
import type { DashboardData } from '../src/components/modules/dashboard/types';

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
};

/** The same rule the store applies, straight from the capability model. */
const allowsFor = (role: keyof typeof ROLE_GRANTS) =>
  (module: ModuleId, action: Action = 'view') =>
    !!ROLE_GRANTS[role]?.[module]?.actions.includes(action);

const empty: DashboardData = {
  generatedAt: new Date().toISOString(),
  myWork: { openTasks: 0, attendanceToday: null, tasks: [] },
  calendar: { todayCount: 0, upcoming: [] },
};

const yesterday = new Date(Date.now() - 86_400_000).toISOString();

const busy: DashboardData = {
  ...empty,
  myWork: {
    openTasks: 4,
    attendanceToday: null,
    tasks: [
      { id: 't1', title: 'Sign off the migration plan', status: 'todo', priority: 'high', dueDate: '2026-01-01', projectName: 'Rollout', overdue: true },
      { id: 't2', title: 'Write the release notes', status: 'todo', priority: 'low', dueDate: '2026-01-02', projectName: null, overdue: true },
      { id: 't3', title: 'Review the contract', status: 'todo', priority: 'low', dueDate: null, projectName: null, overdue: false },
    ],
  },
  support: {
    open: 4, breached: 2, critical: 1, resolvedThisMonth: 3,
    byPriority: [],
    recent: [
      { id: 'k1', ticketNumber: 'TKT-1', subject: 'Payments API failing', status: 'open', priority: 'critical', dueDate: yesterday },
      { id: 'k2', ticketNumber: 'TKT-2', subject: 'Export times out', status: 'open', priority: 'high', dueDate: yesterday },
    ],
  },
  projects: {
    total: 3, active: 3, atRisk: 1, overdueTasks: 5,
    progress: [
      { id: 'p1', name: 'Website Redesign', status: 'active', priority: 'high', totalTasks: 4, doneTasks: 1, progress: 25, daysLeft: 3, atRisk: true },
    ],
  },
  hr: {
    headcount: 12, departments: 3, pendingLeave: 2,
    leaveRequests: [{ id: 'l1', type: 'vacation', startDate: '2026-09-01', endDate: '2026-09-05', requester: { firstName: 'Priya', lastName: 'Raman' } }],
  },
  finance: {
    revenue: 100, revenueThisMonth: 10, revenueTrend: 5, outstanding: 50,
    totalExpenses: 40, expensesThisMonth: 4, pendingExpenseCount: 3, netPosition: 60,
    revenueByMonth: [],
  },
  inventory: {
    products: 10, lowStockCount: 3, outOfStockCount: 1, stockValue: 500,
    alerts: [
      { id: 'x1', name: 'Sensor Module', sku: 'HW-1', stock: 0, reorderLevel: 100, unit: 'unit', severity: 'out_of_stock' },
      { id: 'x2', name: 'Cable Loom', sku: 'HW-2', stock: 12, reorderLevel: 40, unit: 'unit', severity: 'low' },
    ],
  },
};

console.log('\n  An owner sees everything that is wrong\n  ─────────────────────────────────────');
const forOwner = buildAttention(busy, allowsFor('owner'));
console.log(forOwner.map(i => `      ${i.severity.padEnd(8)} ${i.title}`).join('\n'));

// Eight: two support concerns collapse into one (a breached ticket is not
// also counted as critical), and stock splits into out-of-stock and low.
check(forOwner.length === 8, `every concern is raised (${forOwner.length})`);
check(
  forOwner.map(i => i.severity).join(',') ===
    'critical,critical,critical,warning,warning,warning,warning,info',
  'the most serious come first, information last',
  forOwner.map(i => i.severity).join(','),
);
check(
  forOwner.every(i => i.title && i.detail && i.action.label),
  'every row says what, why and where',
);

const sla = forOwner.find(i => i.id === 'sla')!;
check(sla.title.startsWith('2 tickets'), 'concerns are counted, not listed one per record', sla.title);
check(!sla.action.record, 'and with two of them, the row opens the module rather than one ticket');

const single = buildAttention(
  { ...busy, support: { ...busy.support!, breached: 1, recent: [busy.support!.recent[0]] } },
  allowsFor('owner'),
).find(i => i.id === 'sla')!;
check(
  single.action.record?.type === 'ticket' && single.action.record.id === 'k1',
  'a single breach opens that ticket directly',
);

const overdue = forOwner.find(i => i.id === 'my-overdue')!;
check(overdue.severity === 'critical', 'your own overdue work is critical');
const orgTasks = forOwner.find(i => i.id === 'org-overdue-tasks')!;
check(orgTasks.severity === 'info' && orgTasks.detail.includes('2 of them'),
  'the organisation-wide figure is context, and says how much of it is yours',
  orgTasks?.detail);

console.log('\n  An employee is not shown other people’s decisions\n  ────────────────────────────────────────────────');
const forEmployee = buildAttention(busy, allowsFor('employee'));
console.log(forEmployee.map(i => `      ${i.severity.padEnd(8)} ${i.title}`).join('\n') || '      (nothing)');

check(!forEmployee.some(i => i.id === 'leave-approvals'),
  'no leave approvals — an employee cannot approve leave');
check(!forEmployee.some(i => i.id === 'expense-approvals'),
  'no expense approvals — nor expenses');
check(!forEmployee.some(i => i.id === 'sla' || i.id === 'critical-tickets'),
  'no support queue — the module is not theirs to open');
check(!forEmployee.some(i => i.id.includes('stock')),
  'no stock alerts');
check(forEmployee.some(i => i.id === 'my-overdue'),
  'but their own overdue work still reaches them');

console.log('\n  Approvers see the approvals they own\n  ───────────────────────────────────');
const forHr = buildAttention(busy, allowsFor('hr_staff'));
check(forHr.some(i => i.id === 'leave-approvals'), 'HR staff are shown leave awaiting approval');
check(!forHr.some(i => i.id === 'expense-approvals'), 'and not expenses, which they cannot approve');

const forFinance = buildAttention(busy, allowsFor('finance_staff'));
check(forFinance.some(i => i.id === 'expense-approvals'), 'finance staff are shown expenses');
check(!forFinance.some(i => i.id === 'leave-approvals'), 'and not leave');

console.log('\n  An empty workspace\n  ──────────────────');
check(buildAttention(empty, allowsFor('owner')).length === 0, 'raises nothing at all');
check(isNewWorkspace(empty), 'and is recognised as new');
check(!isNewWorkspace(busy), 'a working one is not');
check(
  !isNewWorkspace({ ...empty, projects: { total: 1, active: 1, atRisk: 0, overdueTasks: 0, progress: [] } }),
  'one project is enough to stop being new',
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
