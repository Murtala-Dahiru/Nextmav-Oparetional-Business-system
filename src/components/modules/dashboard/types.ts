import type { ModuleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The dashboard payload, as `/api/dashboard` actually returns it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this file was rewritten rather than copied ────────────────────────
 *
 * The previous declaration was a *plausible* description of the response, not
 * a true one, and TypeScript cannot tell the difference: a hand-written
 * interface over a `fetch().json()` is an assertion, and three of its fields
 * were wrong. Each one rendered as blank text rather than as an error.
 *
 *   calendar.upcoming  declared `startDate` / `endDate` / `color`
 *                      the endpoint sends `startsAt` / `endsAt` / `colour`
 *                      → every meeting's date and time rendered empty, and the
 *                        colour dot was transparent
 *
 *   notifications      declared `message`; the column is `body`
 *                      → every notification's second line was blank
 *
 * Both were verified against a live response before this file was written.
 * Anything below that the endpoint does not genuinely populate is called out
 * where it is declared, so the next person does not build on it.
 *
 * ── Fields the endpoint still pins to a constant ──────────────────────────
 *
 * These exist in the response, always hold the same value, and are therefore
 * *not read by this screen*: `finance.pendingExpenseValue`, `hr.newHires`,
 * `projects.totalBudget`, `projects.tasksDueThisWeek`, `company.warehouses`,
 * `crm.leadsByStatus`, `crm.topDeals`, `finance.recentInvoices`,
 * `hr.team[].lastSeen`, and `recentFiles[].isStarred` / `.color`.
 *
 * Rendering a hard-coded zero as though it were a measurement is worse than
 * omitting it: the old dashboard said "Nothing overdue" to every organisation
 * on earth, including the ones with overdue invoices.
 *
 * `finance.overdueCount` and `finance.overdueValue` used to be on that list.
 * They are real now — the Executive Overview pass pointed the route at
 * `v_receivables_ageing`, a view that had existed since migration 0007 and
 * that nothing had ever selected from. Nothing was computed to make them true;
 * the numbers were already in the database and the endpoint was answering zero
 * over the top of them.
 *
 * ── What arrives, and what it will not stretch to ─────────────────────────
 *
 * `finance.revenueByMonth` is at most twelve months, in chronological order,
 * ending on the current one. The grain is a month, so no range shorter than a
 * month is derivable — 7D and 30D cannot be honest here whatever the period
 * control might like to offer. `work.completionByWeek` is eight weeks of
 * completion counts and is not a velocity, a burndown or a forecast.
 * `crm.stalled` counts records nobody has written to in thirty days, which is
 * the only claim `deals.updated_at` supports.
 */

export interface DashboardViewer {
  id: string;
  firstName: string;
  fullName: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  organizationName: string | null;
}

export interface DashboardCompany {
  headcount: number;
  departments: number;
  onlineNow: number;
  activeProjects: number;
  openTickets: number;
  pipelineValue: number;
  weightedPipeline: number;
  openDeals: number;
  revenue: number;
  revenueThisMonth: number;
  revenueTrend: number | null;
}

export interface DashboardTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectName: string | null;
  overdue: boolean;
}

/** Today's attendance row for the signed-in member, or null if not clocked in. */
export interface AttendanceToday {
  id: string;
  workDate: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  status: string;
  workedMinutes: number;
  isRemote: boolean;
}

export interface DashboardDeal {
  id: string;
  name: string;
  stage: string;
  value: number;
  probability: number;
  expectedClose: string | null;
}

export interface DashboardCrm {
  totalLeads: number;
  newLeads: number;
  qualifiedLeads: number;
  pipelineValue: number;
  weightedPipeline: number;
  wonValue: number;
  winRate: number;
  dealsByStage: { stage: string; count: number; value: number }[];

  /* ── Momentum ───────────────────────────────────────────────────────────
     All four are derived from columns on the deals rows the endpoint already
     reads. `stalled` means nobody has written to the record in thirty days —
     which is what `updated_at` records and the limit of what it can claim. */
  stalled: number;
  closingThisMonth: number;
  wonThisMonth: number;
  wonValueThisMonth: number;
  topOpen: DashboardDeal[];
}

/** One ageing band from `v_receivables_ageing`. */
export interface ReceivablesBucket {
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
  count: number;
  value: number;
}

export interface DashboardReceivables {
  /** Sum of `total - amount_paid` over every unpaid, uncancelled invoice. */
  outstanding: number;
  /** Invoiced and not yet due. */
  current: number;
  overdueValue: number;
  overdueCount: number;
  invoiceCount: number;
  buckets: ReceivablesBucket[];
  worst: {
    id: string;
    number: string;
    company: string | null;
    balance: number;
    daysOverdue: number;
  }[];
}

/**
 * Work across the organisation.
 *
 * `completionByWeek` is eight Monday-anchored weeks of `tasks.completed_at`,
 * bucketed in the organisation's timezone. It is a count of completions, not
 * a rate and not a forecast — the payload cannot support either.
 */
export interface DashboardWork {
  openTasks: number;
  overdueTasks: number;
  completedLast8Weeks: number;
  completionByWeek: { week: string; start: string; count: number }[];
}

export interface DashboardFinance {
  revenue: number;
  revenueThisMonth: number;
  /** Real month-on-month change, or null when there is no prior month. */
  revenueTrend: number | null;
  outstanding: number;
  /** Real counts now, from v_receivables_ageing — no longer pinned to zero. */
  overdueCount: number;
  overdueValue: number;
  totalExpenses: number;
  expensesThisMonth: number;
  pendingExpenseCount: number;
  netPosition: number;
  /**
   * At most twelve months, chronological, ending on the most recent one that
   * has any activity.
   *
   * `current` marks the row that is the organisation's month in progress — a
   * *partial* measurement standing beside eleven complete ones. It is decided
   * on the server because the comparison belongs in the organisation's
   * timezone and because `month` is "Aug", which two Augusts both answer to.
   * Nothing on this page may compare a `current` row against a complete one
   * without saying so; see the note in `/api/dashboard`.
   */
  revenueByMonth: {
    month: string;
    revenue: number;
    expenses: number;
    invoiced: number;
    current?: boolean;
  }[];
  /** How far into the current month the organisation is, in its own days. */
  monthToDate?: { elapsed: number; days: number };
  receivables: DashboardReceivables;
}

export interface DashboardProject {
  id: string;
  name: string;
  status: string;
  priority: string;
  totalTasks: number;
  doneTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  progress: number;
  daysLeft: number | null;
  endDate: string | null;
  atRisk: boolean;
  /** Zero total means the project has no milestones, not that none are done. */
  milestones: { total: number; done: number; overdue: number };
}

export interface DashboardProjects {
  total: number;
  active: number;
  atRisk: number;
  /** Past its end date. Overlaps atRisk, so the two are never added. */
  delayed: number;
  onTrack: number;
  overdueTasks: number;
  progress: DashboardProject[];
}

export interface DashboardTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  /** The SLA deadline (`due_at`), not a calendar date. */
  dueDate: string | null;
}

export interface DashboardSupport {
  open: number;
  breached: number;
  critical: number;
  resolvedThisMonth: number;
  byPriority: { priority: string; count: number }[];
  recent: DashboardTicket[];
}

export interface DashboardHr {
  headcount: number;
  departments: number;
  pendingLeave: number;
  /** Only populated for roles that may approve; the count is sent to everyone. */
  leaveRequests: {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
    requester?: { firstName: string; lastName: string };
  }[];
}

export interface DashboardInventory {
  products: number;
  lowStockCount: number;
  outOfStockCount: number;
  stockValue: number;
  alerts: {
    id: string;
    name: string;
    sku: string;
    stock: number;
    reorderLevel: number;
    unit: string;
    severity: string;
  }[];
}

export interface DashboardEvent {
  id: string;
  title: string;
  /** `starts_at`, camelised. Not `startDate` — that field does not exist. */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  colour: string | null;
}

export interface DashboardActivity {
  id: string;
  module: string;
  action: string;
  title: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: string;
  user?: { firstName: string; lastName: string; avatar: string };
}

export interface DashboardData {
  generatedAt: string;
  viewer?: DashboardViewer;
  company?: DashboardCompany;
  myWork: {
    openTasks: number;
    attendanceToday: AttendanceToday | null;
    tasks: DashboardTask[];
  };
  calendar: { todayCount: number; upcoming: DashboardEvent[] };
  /**
   * `notifications` is deliberately absent.
   *
   * The endpoint sends it, and the dashboard used to render a panel of it —
   * beside the shell's notification bell, which shows the same tray. One of
   * the two was always going to be the stale one. The bell is the tray now,
   * and a type that declared this would be an invitation to bring the panel
   * back.
   */
  crm?: DashboardCrm;
  finance?: DashboardFinance;
  projects?: DashboardProjects;
  support?: DashboardSupport;
  hr?: DashboardHr;
  inventory?: DashboardInventory;
  work?: DashboardWork;
  activity?: DashboardActivity[];
}

/* -------------------------------------------------------------------------- */
/*  Attention queue                                                           */
/* -------------------------------------------------------------------------- */

export type Severity = 'critical' | 'warning' | 'info';

/**
 * One thing that needs a person.
 *
 * `title` is what happened, `detail` is why it matters or who it concerns,
 * `state` is the condition it is in, and `action` is where it is dealt with.
 * An item without all four is a statistic, and statistics belong in the
 * position bar.
 *
 * ── On `state` ────────────────────────────────────────────────────────────
 *
 * Two or three words naming the condition — "Past deadline", "Awaiting you",
 * "Behind schedule". It is *not* a second measurement and nothing computes it
 * from the payload: it restates the rule in `attention.ts` that produced the
 * row, which is the one thing about the row that is known for certain.
 *
 * It exists because the queue was answering "what" and "where" and leaving
 * "why is this on my list" to be inferred from the title. It also earns the
 * column: at 1400px the rows ran a sentence, then four hundred pixels of
 * nothing, then a module name.
 */
export interface AttentionItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The condition this item is in. Two or three words, not a sentence. */
  state: string;
  /** Where this is resolved. `record` opens one row; otherwise the module. */
  action: {
    label: string;
    module: ModuleId;
    record?: { type: string; id: string };
  };
}
