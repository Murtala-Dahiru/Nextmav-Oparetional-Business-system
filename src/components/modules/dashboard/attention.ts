import { money as fmtMoney } from '@/components/shared/readout/viz';
import type { Action } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';
import type { AttentionItem, DashboardData, Severity } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What needs a person, assembled from what the platform already knows
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The dashboard already held every one of these facts and buried each of them
 * in a different panel, as a subtitle. A breached SLA was grey helper text
 * under a number; a project at risk was a badge in the fourth row of a list;
 * leave awaiting approval was an amber box inside a panel called "People",
 * below the fold. So the screen could say a great deal and still never say
 * *what to do next*.
 *
 * This turns those facts into one ordered queue. Nothing here is computed from
 * anything the API does not send, and nothing is invented: every rule below is
 * a field of the payload, and every row leads to the module that owns it.
 *
 * ── Three rules it follows ────────────────────────────────────────────────
 *
 *  1. **One row per concern, not per record.** "Two tickets past their SLA" is
 *     a decision; twenty rows of tickets is the Support module. Where exactly
 *     one record is involved, the row names it and opens it directly.
 *  2. **Never offer an action the role cannot take.** `pendingLeave` is sent to
 *     everyone who can see HR at all, including an employee who may only file
 *     their own leave — telling them three requests await approval is telling
 *     them about somebody else's job. Each rule is gated on the capability the
 *     action would actually need.
 *  3. **Module names are proper nouns; record types are not.** "Open Finance"
 *     opens a module and is capitalised the way the navigation capitalises it;
 *     "Open ticket" opens one record and is not. The distinction is the row's
 *     only signal about where the click lands, so it is worth being exact
 *     about — a column that read "Open support", "Open tasks", "Open HR" was
 *     three conventions in three rows.
 *  4. **Only the caller's own overdue work is critical.** Organisation-wide
 *     overdue tasks are worth knowing and are not personally urgent, so they
 *     rank below, and are only shown when they exceed the caller's own — two
 *     rows saying the same thing at different scopes is noise.
 */

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** `allows(module, action)` from the store — the client's mirror of the grant. */
type Allows = (module: ModuleId, action?: Action) => boolean;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * Money inside an attention row.
 *
 * `formatCurrencyCompact` rather than the full formatter: these are sentences,
 * and "₦24,400.00 is overdue" reads as a ledger entry that wandered into prose.
 */
const money = (n: number) => fmtMoney(n);

export function buildAttention(data: DashboardData, allows: Allows): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { support, projects, myWork, hr, finance, inventory } = data;

  // ── Support: an SLA that has already passed is the most expensive thing
  //    on this page, because somebody outside the company is waiting.
  if (support && allows('support')) {
    const pastDue = support.recent.filter(
      t => t.dueDate && new Date(t.dueDate).getTime() < Date.now(),
    );

    if (support.breached > 0) {
      const only = support.breached === 1 && pastDue.length === 1 ? pastDue[0] : null;
      items.push({
        id: 'sla',
        state: 'Past deadline',
        severity: 'critical',
        title: `${support.breached} ${plural(support.breached, 'ticket')} past the response deadline`,
        detail: only
          ? `${only.ticketNumber} · ${only.subject}`
          : pastDue.length
            ? `Oldest: ${pastDue[0].subject}`
            : 'Customers are waiting on a first response.',
        action: only
          ? { label: 'Open ticket', module: 'support', record: { type: 'ticket', id: only.id } }
          : { label: 'Open Support', module: 'support' },
      });
    }

    // Critical priority is a separate concern from a missed deadline; only
    // raised on its own so a breached critical ticket is not counted twice.
    if (support.critical > 0 && support.breached === 0) {
      const first = support.recent.find(t => t.priority === 'critical');
      items.push({
        id: 'critical-tickets',
        state: 'Highest priority',
        severity: 'critical',
        title: `${support.critical} critical ${plural(support.critical, 'ticket')} open`,
        detail: first ? `${first.ticketNumber} · ${first.subject}` : 'Raised at the highest priority.',
        action: first
          ? { label: 'Open ticket', module: 'support', record: { type: 'ticket', id: first.id } }
          : { label: 'Open Support', module: 'support' },
      });
    }
  }

  // ── The caller's own overdue work.
  const myOverdue = myWork.tasks.filter(t => t.overdue);
  if (myOverdue.length > 0) {
    const only = myOverdue.length === 1 ? myOverdue[0] : null;
    items.push({
      id: 'my-overdue',
      state: 'Assigned to you',
      severity: 'critical',
      title: only
        ? 'One of your tasks is overdue'
        : `${myOverdue.length} of your tasks are overdue`,
      detail: only
        ? `${only.title}${only.projectName ? ` · ${only.projectName}` : ''}`
        : `Oldest: ${myOverdue[0].title}`,
      action: allows('projects')
        ? only
          ? { label: 'Open task', module: 'projects', record: { type: 'task', id: only.id } }
          : { label: 'Open Projects', module: 'projects' }
        : { label: 'Open My Work', module: 'mywork' },
    });
  }

  // ── Delivery: at risk, or already past its end date.
  if (projects && allows('projects')) {
    const troubled = projects.progress.filter(p => p.atRisk || (p.daysLeft ?? 1) < 0);
    if (troubled.length > 0) {
      const only = troubled.length === 1 ? troubled[0] : null;
      const late = troubled.filter(p => (p.daysLeft ?? 1) < 0).length;
      items.push({
        id: 'projects-at-risk',
        state: 'Behind schedule',
        severity: 'warning',
        title: only
          ? `${only.name} needs attention`
          : `${troubled.length} projects need attention`,
        detail: only
          ? [
              `${only.doneTasks} of ${only.totalTasks} tasks done`,
              only.daysLeft === null
                ? null
                : only.daysLeft < 0
                  ? `${Math.abs(only.daysLeft)} ${plural(Math.abs(only.daysLeft), 'day')} past its end date`
                  : `${only.daysLeft} ${plural(only.daysLeft, 'day')} left`,
            ].filter(Boolean).join(' · ')
          : late > 0
            ? `${late} past the end date, ${troubled.length - late} flagged at risk`
            : 'Flagged at risk against their remaining time.',
        action: only
          ? { label: 'Open project', module: 'projects', record: { type: 'project', id: only.id } }
          : { label: 'Open Projects', module: 'projects' },
      });
    }

    /**
     * ── A deadline inside a week ──────────────────────────────────────────
     *
     * Explicitly excludes anything `troubled` already covered. A project that
     * is at risk *and* due on Friday is one concern, and the at-risk row above
     * says more about it than this one would; two rows for the same project is
     * the noise this queue exists to prevent.
     *
     * Info rather than warning: a deadline that is approaching on schedule is
     * something to know about, not something that has gone wrong. It earns a
     * warning only by also being at risk, which is the row above.
     */
    const troubledIds = new Set(troubled.map(p => p.id));
    const soon = projects.progress
      .filter(p => !troubledIds.has(p.id) && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 7)
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

    if (soon.length > 0) {
      const only = soon.length === 1 ? soon[0] : null;
      items.push({
        id: 'deadline-soon',
        state: 'Due within 7 days',
        severity: 'info',
        title: only
          ? `${only.name} is due in ${only.daysLeft} ${plural(only.daysLeft as number, 'day')}`
          : `${soon.length} projects are due within a week`,
        detail: only
          ? `${only.doneTasks} of ${only.totalTasks} tasks done · ${Math.round(only.progress)}% complete`
          : `Soonest: ${soon[0].name}, ${soon[0].daysLeft} ${plural(soon[0].daysLeft as number, 'day')} away`,
        action: only
          ? { label: 'Open project', module: 'projects', record: { type: 'project', id: only.id } }
          : { label: 'Open Projects', module: 'projects' },
      });
    }

    // Only when it says something the personal row did not.
    if (projects.overdueTasks > myOverdue.length) {
      items.push({
        id: 'org-overdue-tasks',
        state: 'Company-wide',
        severity: 'info',
        title: `${projects.overdueTasks} overdue ${plural(projects.overdueTasks, 'task')} across the organisation`,
        detail: myOverdue.length
          ? `${myOverdue.length} of them ${plural(myOverdue.length, 'is', 'are')} yours.`
          : 'None of them are assigned to you.',
        action: { label: 'Open Projects', module: 'projects' },
      });
    }
  }

  // ── Approvals. Gated on the capability the action needs, not on sight of
  //    the module — see rule 2.
  if (hr && hr.pendingLeave > 0 && allows('hr', 'approve')) {
    const first = hr.leaveRequests[0];
    items.push({
      id: 'leave-approvals',
      state: 'Awaiting you',
      severity: 'warning',
      title: `${hr.pendingLeave} leave ${plural(hr.pendingLeave, 'request')} awaiting approval`,
      detail: first?.requester
        ? `${first.requester.firstName} ${first.requester.lastName} · ${first.type}`
        : 'Nobody can plan around an unanswered request.',
      action: { label: 'Open HR', module: 'hr' },
    });
  }

  /**
   * ── Overdue invoices ────────────────────────────────────────────────────
   *
   * This rule could not exist before: `finance.overdueCount` was a hard-coded
   * zero, so the condition was unreachable and every organisation was told
   * implicitly that nothing was overdue. It reads `receivables`, which comes
   * from `v_receivables_ageing` and counts only invoices that are genuinely
   * past their due date and not paid, cancelled or draft.
   *
   * Critical rather than a warning: unlike an overdue task, the money has
   * already been earned and somebody outside the company is holding it.
   */
  if (finance && allows('finance')) {
    const r = finance.receivables;
    if (r && r.overdueCount > 0) {
      const worst = r.worst[0];
      items.push({
        id: 'overdue-invoices',
        state: 'Past due',
        severity: 'critical',
        title: `${r.overdueCount} overdue ${plural(r.overdueCount, 'invoice')} worth ${money(r.overdueValue)}`,
        detail: worst
          ? `Oldest: ${worst.company ?? worst.number} · ${worst.daysOverdue} ${plural(worst.daysOverdue, 'day')} overdue`
          : 'Invoiced, past the due date and unpaid.',
        action: { label: 'Open Finance', module: 'finance' },
      });
    }
  }

  if (finance && finance.pendingExpenseCount > 0 && allows('finance', 'approve')) {
    items.push({
      id: 'expense-approvals',
      state: 'Awaiting you',
      severity: 'warning',
      title: `${finance.pendingExpenseCount} ${plural(finance.pendingExpenseCount, 'expense')} awaiting approval`,
      detail: 'Submitted and not yet approved or rejected.',
      action: { label: 'Open Finance', module: 'finance' },
    });
  }

  // ── Stock. Out is critical — it stops fulfilment; low is a warning.
  if (inventory && allows('inventory')) {
    if (inventory.outOfStockCount > 0) {
      const first = inventory.alerts.find(a => a.severity === 'out_of_stock');
      items.push({
        id: 'out-of-stock',
        state: 'Cannot fulfil',
        severity: 'critical',
        title: `${inventory.outOfStockCount} ${plural(inventory.outOfStockCount, 'product')} out of stock`,
        detail: first ? `${first.name} · ${first.sku}` : 'Nothing can be fulfilled from this stock.',
        action: first
          ? { label: 'Open product', module: 'inventory', record: { type: 'product', id: first.id } }
          : { label: 'Open Inventory', module: 'inventory' },
      });
    }

    const low = inventory.lowStockCount - inventory.outOfStockCount;
    if (low > 0) {
      const first = inventory.alerts.find(a => a.severity !== 'out_of_stock');
      items.push({
        id: 'low-stock',
        state: 'Below reorder',
        severity: 'warning',
        title: `${low} ${plural(low, 'product')} below the reorder point`,
        detail: first
          ? `${first.name} · ${first.stock} left of ${first.reorderLevel}`
          : 'Reorder before they run out.',
        action: first
          ? { label: 'Open product', module: 'inventory', record: { type: 'product', id: first.id } }
          : { label: 'Open Inventory', module: 'inventory' },
      });
    }
  }

  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/**
 * Is this workspace still empty?
 *
 * Used to decide between the working dashboard and a set-up screen. It asks
 * about *records*, not about permissions: a finance clerk in a busy company
 * sees no projects section, and that is not an empty workspace.
 */
export function isNewWorkspace(data: DashboardData): boolean {
  const { projects, crm, support, finance, inventory, myWork, activity } = data;
  return (
    (projects?.total ?? 0) === 0 &&
    (crm?.totalLeads ?? 0) === 0 &&
    (crm?.dealsByStage.length ?? 0) === 0 &&
    (support?.open ?? 0) === 0 &&
    (support?.resolvedThisMonth ?? 0) === 0 &&
    (finance?.revenue ?? 0) === 0 &&
    (finance?.outstanding ?? 0) === 0 &&
    (inventory?.products ?? 0) === 0 &&
    myWork.tasks.length === 0 &&
    (activity?.length ?? 0) === 0
  );
}
