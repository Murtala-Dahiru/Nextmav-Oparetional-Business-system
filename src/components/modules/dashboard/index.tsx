'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  DollarSign, Handshake, TicketCheck, FolderKanban, ListTodo, Users, Activity,
  Plus, FileText, CalendarDays, TrendingUp, TrendingDown, Package, AlertTriangle,
  ArrowRight, Clock, RefreshCw, Bell, UserCog, CheckCircle2, CircleAlert,
  Star, Target, Receipt, PackageX,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency, formatRelativeTime, formatDate, getInitials } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { useModuleRealtime } from '@/hooks/use-realtime';
import type { ModuleId } from '@/lib/constants';
import { roleLabel as labelForRole, type Action } from '@/lib/permissions';

// ═══════════════════════════════════════════════════════════════════════════
//  Types — mirror of the /api/dashboard aggregation
// ═══════════════════════════════════════════════════════════════════════════

interface DashboardData {
  generatedAt: string;
  /** Who this payload was built for — the server decides, not the client. */
  viewer?: {
    id: string; firstName: string; lastName: string;
    role: string; department: string; jobTitle: string;
  };
  company?: {
    headcount: number; departments: number; onlineNow: number; newHires: number;
    revenue: number; revenueThisMonth: number; revenueTrend: number | null;
    pipelineValue: number; weightedPipeline: number; openDeals: number;
    activeProjects: number; openTickets: number; warehouses: number;
  };
  crm?: {
    totalLeads: number; newLeads: number; qualifiedLeads: number;
    pipelineValue: number; weightedPipeline: number; wonValue: number; winRate: number;
    dealsByStage: { stage: string; count: number; value: number }[];
    leadsByStatus: { status: string; count: number }[];
    topDeals: { id: string; name: string; companyName: string; value: number; stage: string; probability: number }[];
  };
  finance?: {
    revenue: number; revenueThisMonth: number; revenueTrend: number | null;
    outstanding: number; overdueCount: number; overdueValue: number;
    totalExpenses: number; expensesThisMonth: number;
    pendingExpenseCount: number; pendingExpenseValue: number; netPosition: number;
    revenueByMonth: { month: string; revenue: number; expenses: number }[];
    recentInvoices: { id: string; invoiceNumber: string; companyName: string; status: string; total: number; dueDate: string }[];
  };
  projects?: {
    total: number; active: number; atRisk: number; totalBudget: number;
    overdueTasks: number; tasksDueThisWeek: number;
    progress: {
      id: string; name: string; status: string; priority: string;
      totalTasks: number; doneTasks: number; progress: number;
      daysLeft: number | null; atRisk: boolean;
    }[];
  };
  myWork: {
    userId: string; openTasks: number;
    tasks: { id: string; title: string; status: string; priority: string; dueDate: string | null; projectName: string | null; overdue: boolean }[];
  };
  support?: {
    open: number; breached: number; critical: number; resolvedThisMonth: number;
    byPriority: { priority: string; count: number }[];
    recent: { id: string; ticketNumber: string; subject: string; status: string; priority: string; dueDate: string | null }[];
  };
  hr?: {
    headcount: number; departments: number; newHires: number; pendingLeave: number;
    leaveRequests: { id: string; type: string; startDate: string; endDate: string; requester?: { firstName: string; lastName: string; avatar: string; department: string } }[];
    team: { id: string; firstName: string; lastName: string; jobTitle: string; department: string; avatar: string; lastSeen: string }[];
  };
  inventory?: {
    products: number; lowStockCount: number; outOfStockCount: number; stockValue: number;
    alerts: { id: string; name: string; sku: string; stock: number; reorderLevel: number; unit: string; severity: string }[];
  };
  calendar: {
    todayCount: number;
    upcoming: { id: string; title: string; startDate: string; endDate: string; allDay: boolean; location: string; color: string; creator?: { firstName: string; lastName: string } }[];
  };
  notifications: {
    unread: number;
    items: { id: string; title: string; message: string; type: string; isRead: boolean; createdAt: string }[];
  };
  activity?: { id: string; module: string; action: string; title: string; description: string; createdAt: string; user?: { firstName: string; lastName: string; avatar: string } }[];
  recentFiles?: { id: string; title: string; icon: string; color: string; updatedAt: string; isStarred: boolean }[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Presentation helpers
// ═══════════════════════════════════════════════════════════════════════════

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
};

const STAGE_LABELS: Record<string, string> = {
  prospecting: 'Prospecting', qualification: 'Qualification', proposal: 'Proposal',
  negotiation: 'Negotiation', 'closed_won': 'Closed Won',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A dashboard panel with a title and an optional "open module" affordance. */
function Panel({
  title, subtitle, icon: Icon, action, children, className = '',
}: {
  title: string; subtitle?: string; icon: React.ElementType;
  action?: { label: string; onClick: () => void };
  children: ReactNode; className?: string;
}) {
  return (
    <Card className={`flex flex-col gap-0 py-0 ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="bg-emerald-500/10 text-emerald-600 flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            {subtitle && <p className="text-muted-foreground truncate text-xs">{subtitle}</p>}
          </div>
        </div>
        {action && (
          <Button variant="ghost" size="sm"
            className="text-muted-foreground hover:text-foreground -mr-2 h-7 shrink-0 gap-1 text-xs"
            onClick={action.onClick}>
            {action.label} <ArrowRight className="size-3" />
          </Button>
        )}
      </div>
      <CardContent className="flex-1 p-5">{children}</CardContent>
    </Card>
  );
}

/** Headline KPI tile. */
function Kpi({
  label, value, icon: Icon, trend, hint, tone = 'default', onClick,
}: {
  label: string; value: string | number; icon: React.ElementType;
  trend?: number | null; hint?: string;
  tone?: 'default' | 'warning' | 'danger'; onClick?: () => void;
}) {
  const toneRing =
    tone === 'danger' ? 'text-rose-600 bg-rose-500/10'
      : tone === 'warning' ? 'text-amber-600 bg-amber-500/10'
        : 'text-emerald-600 bg-emerald-500/10';

  return (
    <Card
      onClick={onClick}
      className={onClick ? 'cursor-pointer py-0 transition-shadow hover:shadow-md' : 'py-0'}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs font-medium">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {trend !== undefined && trend !== null ? (
            <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {trend >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {trend >= 0 ? '+' : ''}{trend}%
              <span className="text-muted-foreground font-normal">vs last month</span>
            </p>
          ) : hint ? (
            <p className="text-muted-foreground mt-1 truncate text-xs">{hint}</p>
          ) : null}
        </div>
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneRing}`}>
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover rounded-lg border px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.color }}>
          {p.name}: <span className="font-medium">{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dashboard — executive command centre
// ═══════════════════════════════════════════════════════════════════════════

export default function DashboardModule() {
  const { user, setActiveModule, allows, activeRole } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load dashboard');
      setData(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * The dashboard is the widest claim in the specification — "leave approved,
   * dashboard updates instantly", "attendance recorded, HR updates instantly",
   * "invoice created, Finance updates instantly" — and it aggregates all of
   * them, so it watches every table that feeds a tile.
   *
   * One endpoint behind it, so one refetch however many tables changed; the
   * hook's debounce collapses a burst into a single call.
   */
  useModuleRealtime('dashboard', [
    'projects', 'tasks', 'milestones',
    'leave_requests', 'attendance_records',
    'invoices', 'expenses', 'support_tickets',
  ], () => load(true));

  const go = (m: ModuleId) => () => setActiveModule(m);

  // ── Loading skeleton (mirrors the real layout so nothing jumps) ─────────
  if (loading) {
    return (
      <div className="flex-1 space-y-6 overflow-auto p-6">
        <div className="space-y-2">
          <div className="bg-muted h-7 w-64 animate-pulse rounded" />
          <div className="bg-muted h-4 w-96 animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-muted h-[104px] animate-pulse rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="bg-muted h-[360px] animate-pulse rounded-xl lg:col-span-2" />
          <div className="bg-muted h-[360px] animate-pulse rounded-xl" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-muted h-[300px] animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <EmptyState
          icon={CircleAlert}
          title="Couldn’t load your dashboard"
          description={error ?? 'Something went wrong while gathering your organisation’s data.'}
          action={{ label: 'Try again', onClick: () => load() }}
        />
      </div>
    );
  }

  const {
    company, crm, finance, projects, myWork, support, hr,
    inventory, calendar, notifications, activity, recentFiles,
  } = data;

  /**
   * Quick actions are filtered to what this role may actually do. Offering
   * "Create Invoice" to someone who will get a 403 is worse than not offering
   * it — the shortcut has to be a promise the platform keeps.
   */
  const quickActions = (
    [
      { label: 'New Lead', icon: Handshake, module: 'crm', action: 'create' },
      { label: 'New Project', icon: FolderKanban, module: 'projects', action: 'create' },
      { label: 'Create Invoice', icon: Receipt, module: 'finance', action: 'create' },
      { label: 'Log Ticket', icon: TicketCheck, module: 'support', action: 'create' },
      { label: 'Schedule Event', icon: CalendarDays, module: 'calendar', action: 'create' },
      { label: 'New Document', icon: FileText, module: 'workspace', action: 'create' },
      { label: 'Request Leave', icon: Clock, module: 'hr', action: 'create' },
    ] as { label: string; icon: React.ElementType; module: ModuleId; action: Action }[]
  ).filter(a => allows(a.module, a.action));

  /**
   * The headline strip, assembled from whichever sections this role received.
   * A CEO sees revenue and pipeline; an employee sees their own workload.
   */
  const kpis: {
    key: string; label: string; value: string | number; icon: React.ElementType;
    trend?: number | null; hint?: string; tone?: 'default' | 'warning' | 'danger';
    onClick?: () => void;
  }[] = [];

  if (finance) {
    kpis.push({
      key: 'revenue', label: 'Revenue (MTD)', value: formatCurrency(finance.revenueThisMonth),
      icon: DollarSign, trend: finance.revenueTrend, onClick: go('finance'),
    });
  }
  if (crm) {
    kpis.push({
      key: 'pipeline', label: 'Weighted pipeline', value: formatCurrency(crm.weightedPipeline),
      icon: Target, hint: `${crm.dealsByStage.reduce((s, d) => s + d.count, 0)} deals`, onClick: go('crm'),
    });
  }
  if (projects) {
    kpis.push({
      key: 'projects', label: 'Active projects', value: projects.active, icon: FolderKanban,
      hint: projects.atRisk > 0 ? `${projects.atRisk} at risk` : 'All on track',
      tone: projects.atRisk > 0 ? 'warning' : 'default', onClick: go('projects'),
    });
  }
  if (support) {
    kpis.push({
      key: 'tickets', label: 'Open tickets', value: support.open, icon: TicketCheck,
      hint: support.breached > 0 ? `${support.breached} past due` : 'Within SLA',
      tone: support.breached > 0 ? 'danger' : 'default', onClick: go('support'),
    });
  }
  if (finance) {
    kpis.push({
      key: 'outstanding', label: 'Outstanding', value: formatCurrency(finance.outstanding),
      icon: Receipt,
      hint: finance.overdueCount > 0 ? `${finance.overdueCount} overdue` : 'Nothing overdue',
      tone: finance.overdueCount > 0 ? 'warning' : 'default', onClick: go('finance'),
    });
  }
  if (inventory) {
    kpis.push({
      key: 'stock', label: 'Stock alerts', value: inventory.lowStockCount, icon: Package,
      hint: inventory.outOfStockCount > 0 ? `${inventory.outOfStockCount} out of stock` : 'All above reorder point',
      tone: inventory.outOfStockCount > 0 ? 'danger' : 'default', onClick: go('inventory'),
    });
  }
  if (hr && hr.headcount > 0) {
    kpis.push({
      key: 'people', label: 'Headcount', value: hr.headcount, icon: Users,
      hint: hr.pendingLeave > 0 ? `${hr.pendingLeave} leave requests` : `${hr.departments} departments`,
      tone: hr.pendingLeave > 0 ? 'warning' : 'default', onClick: go('hr'),
    });
  }
  // Personal workload — always meaningful, and the only KPI an employee or
  // client is guaranteed to see.
  kpis.push({
    key: 'mytasks', label: 'My open tasks', value: myWork.tasks.length, icon: ListTodo,
    hint: myWork.tasks.some(t => t.overdue)
      ? `${myWork.tasks.filter(t => t.overdue).length} overdue`
      : 'Nothing overdue',
    tone: myWork.tasks.some(t => t.overdue) ? 'danger' : 'default',
    onClick: allows('projects') ? go('projects') : undefined,
  });

  return (
    <div className="flex-1 space-y-6 overflow-auto p-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}{user?.firstName ? `, ${user.firstName}` : ''}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatDate(data.generatedAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {company
              ? ` · ${company.onlineNow > 0
                ? `${company.onlineNow} of ${company.headcount} teammates online`
                : `${company.headcount} people across ${company.departments} departments`}`
              : ''}
          </p>
          <p className="text-muted-foreground/80 mt-0.5 text-xs">
            {data.viewer?.jobTitle || labelForRole(activeRole)}
            {data.viewer?.department ? ` · ${data.viewer.department}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notifications.unread > 0 && (
            <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <Bell className="size-3" /> {notifications.unread} new
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Company overview ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map(k => (
          <Kpi key={k.key} label={k.label} value={k.value} icon={k.icon}
            trend={k.trend} hint={k.hint} tone={k.tone} onClick={k.onClick} />
        ))}
      </div>

      {/* ── Revenue + pipeline (finance / sales leadership) ─────────────── */}
      {(finance || crm) && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {finance && (<Panel title="Revenue vs spend" subtitle="Trailing six months" icon={TrendingUp}
          action={{ label: 'Finance', onClick: go('finance') }} className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-6">
            <div>
              <p className="text-muted-foreground text-xs">Collected</p>
              <p className="text-xl font-semibold tabular-nums">{formatCurrency(finance.revenue)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Spend</p>
              <p className="text-xl font-semibold tabular-nums">{formatCurrency(finance.totalExpenses)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Net position</p>
              <p className={`text-xl font-semibold tabular-nums ${finance.netPosition >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(finance.netPosition)}
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={finance.revenueByMonth} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs" />
              <YAxis tickLine={false} axisLine={false} className="text-xs"
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} fill="url(#revFill)" />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#f43f5e" strokeWidth={2} fill="url(#expFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>)}

        {crm && (<Panel title="Sales pipeline" subtitle={`${crm.winRate}% win rate · ${crm.newLeads} new leads`}
          icon={Handshake} action={{ label: 'CRM', onClick: go('crm') }}>
          <div className="mb-4">
            <p className="text-muted-foreground text-xs">Weighted forecast</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCurrency(crm.weightedPipeline)}</p>
            <p className="text-muted-foreground text-xs">of {formatCurrency(crm.pipelineValue)} total</p>
          </div>
          <div className="flex flex-col gap-2.5">
            {crm.dealsByStage.map(s => {
              const share = crm.pipelineValue ? (s.value / crm.pipelineValue) * 100 : 0;
              return (
                <div key={s.stage}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-medium">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {s.count} · {formatCurrency(s.value)}
                    </span>
                  </div>
                  <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                    <div className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.max(share, s.count ? 3 : 0)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>)}
      </div>
      )}

      {/* ── My tasks · Project health · Meetings ───────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="My tasks" subtitle={`${myWork.tasks.length} assigned to you`} icon={ListTodo}
          action={{ label: 'Projects', onClick: go('projects') }}>
          {myWork.tasks.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing assigned" description="You have no open tasks right now." />
          ) : (
            <ul className="flex flex-col gap-3">
              {myWork.tasks.map(t => (
                <li key={t.id} className="flex items-start gap-2.5">
                  <div className={`mt-1.5 size-2 shrink-0 rounded-full ${t.overdue ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                      {t.projectName && <span className="truncate">{t.projectName}</span>}
                      {t.dueDate && (
                        <span className={t.overdue ? 'font-medium text-rose-600' : ''}>
                          {t.overdue ? 'Overdue · ' : 'Due '}
                          {formatDate(t.dueDate, { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge className={`${PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.low} shrink-0 text-[10px]`}>
                    {t.priority}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {projects && (<Panel title="Project health" subtitle={`${projects.active} active · ${projects.overdueTasks} overdue tasks`}
          icon={FolderKanban} action={{ label: 'Projects', onClick: go('projects') }}>
          {projects.progress.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No active projects" description="Projects you start will appear here." />
          ) : (
            <ul className="flex flex-col gap-3.5">
              {projects.progress.slice(0, 5).map(p => (
                <li key={p.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{p.progress}%</span>
                  </div>
                  <Progress value={p.progress} className="h-1.5" />
                  <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                    <span>{p.doneTasks}/{p.totalTasks} tasks</span>
                    {p.daysLeft !== null && (
                      <span className={p.daysLeft < 0 ? 'text-rose-600' : ''}>
                        · {p.daysLeft < 0 ? `${Math.abs(p.daysLeft)}d overdue` : `${p.daysLeft}d left`}
                      </span>
                    )}
                    {p.atRisk && (
                      <Badge className="ml-auto bg-amber-100 px-1.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        At risk
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>)}

        <Panel title="Upcoming meetings"
          subtitle={calendar.todayCount > 0 ? `${calendar.todayCount} today` : 'Next 7 days'}
          icon={CalendarDays} action={{ label: 'Calendar', onClick: go('calendar') }}>
          {calendar.upcoming.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nothing scheduled" description="Your next 7 days are clear." />
          ) : (
            <ul className="flex flex-col gap-3">
              {calendar.upcoming.slice(0, 5).map(ev => (
                <li key={ev.id} className="flex items-start gap-3">
                  <div className="flex w-11 shrink-0 flex-col items-center rounded-lg border py-1">
                    <span className="text-muted-foreground text-[10px] uppercase">
                      {formatDate(ev.startDate, { month: 'short' })}
                    </span>
                    <span className="text-sm font-semibold leading-none">
                      {formatDate(ev.startDate, { day: 'numeric' })}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ev.title}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {ev.allDay ? 'All day' : formatDate(ev.startDate, { hour: 'numeric', minute: '2-digit' })}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </p>
                  </div>
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: ev.color }} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Support · Inventory · People ───────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {support && (<Panel title="Support queue" subtitle={`${support.resolvedThisMonth} resolved this month`}
          icon={TicketCheck} action={{ label: 'Support', onClick: go('support') }}>
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border p-2">
              <p className="text-lg font-semibold tabular-nums">{support.open}</p>
              <p className="text-muted-foreground text-[11px]">Open</p>
            </div>
            <div className="rounded-lg border p-2">
              <p className={`text-lg font-semibold tabular-nums ${support.breached ? 'text-rose-600' : ''}`}>
                {support.breached}
              </p>
              <p className="text-muted-foreground text-[11px]">Past due</p>
            </div>
            <div className="rounded-lg border p-2">
              <p className={`text-lg font-semibold tabular-nums ${support.critical ? 'text-rose-600' : ''}`}>
                {support.critical}
              </p>
              <p className="text-muted-foreground text-[11px]">Critical</p>
            </div>
          </div>
          {support.recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">No open tickets.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {support.recent.slice(0, 4).map(t => (
                <li key={t.id} className="flex items-center gap-2">
                  <Badge className={`${PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.low} shrink-0 text-[10px]`}>
                    {t.priority}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.subject}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{t.ticketNumber}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>)}

        {inventory && (<Panel title="Inventory alerts" subtitle={`${formatCurrency(inventory.stockValue)} stock on hand`}
          icon={Package} action={{ label: 'Inventory', onClick: go('inventory') }}>
          {inventory.alerts.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Everything well stocked"
              description={`${inventory.products} products above their reorder point.`} />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                  {inventory.outOfStockCount} out of stock
                </Badge>
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {inventory.lowStockCount} low
                </Badge>
              </div>
              <ul className="flex flex-col gap-2.5">
                {inventory.alerts.map(a => (
                  <li key={a.id} className="flex items-center gap-2.5">
                    {a.severity === 'out_of_stock'
                      ? <PackageX className="size-4 shrink-0 text-rose-600" />
                      : <AlertTriangle className="size-4 shrink-0 text-amber-600" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      <p className="text-muted-foreground text-xs">{a.sku}</p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums">
                      <span className={a.stock <= 0 ? 'font-medium text-rose-600' : 'font-medium'}>{a.stock}</span>
                      <span className="text-muted-foreground">/{a.reorderLevel}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>)}

        {hr && (<Panel title="People" subtitle={`${hr.newHires} joined recently`} icon={UserCog}
          action={{ label: 'HR', onClick: go('hr') }}>
          {hr.pendingLeave > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                <Clock className="size-3.5" />
                {hr.pendingLeave} leave request{hr.pendingLeave > 1 ? 's' : ''} awaiting approval
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {hr.leaveRequests.slice(0, 3).map(l => (
                  <li key={l.id} className="text-xs text-amber-700 dark:text-amber-400">
                    {l.requester ? `${l.requester.firstName} ${l.requester.lastName}` : 'Someone'} · {l.type} ·{' '}
                    {formatDate(l.startDate, { day: 'numeric', month: 'short' })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground mb-2 text-xs font-medium">Team</p>
          <div className="flex flex-col gap-2.5">
            {hr.team.slice(0, 5).map(m => (
              <div key={m.id} className="flex items-center gap-2.5">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-emerald-500/10 text-[10px] text-emerald-700">
                    {getInitials(m.firstName, m.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.firstName} {m.lastName}</p>
                  <p className="text-muted-foreground truncate text-xs">{m.jobTitle || m.department || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>)}
      </div>

      {/* ── Activity · Notifications · Files ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {activity && (<Panel title="Team activity" subtitle="Across every module" icon={Activity}>
          {activity.length === 0 ? (
            <EmptyState icon={Activity} title="No recent activity" description="Actions across modules will appear here." />
          ) : (
            <ul className="flex flex-col gap-3.5">
              {activity.slice(0, 6).map(a => (
                <li key={a.id} className="flex items-start gap-2.5">
                  <Avatar className="mt-0.5 size-7 shrink-0">
                    <AvatarFallback className="bg-emerald-500/10 text-[10px] text-emerald-700">
                      {a.user ? getInitials(a.user.firstName, a.user.lastName) : '—'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{a.title}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {a.module} · {formatRelativeTime(a.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>)}

        <Panel title="Notifications"
          subtitle={notifications.unread > 0 ? `${notifications.unread} unread` : 'All caught up'} icon={Bell}>
          {notifications.items.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications" description="You’re all caught up." />
          ) : (
            <ul className="flex flex-col gap-3">
              {notifications.items.slice(0, 6).map(n => (
                <li key={n.id} className="flex items-start gap-2.5">
                  <div className={`mt-1.5 size-2 shrink-0 rounded-full ${n.isRead ? 'bg-muted-foreground/30' : 'bg-emerald-500'}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${n.isRead ? '' : 'font-medium'}`}>{n.title}</p>
                    <p className="text-muted-foreground truncate text-xs">{n.message}</p>
                    <p className="text-muted-foreground/70 text-[11px]">{formatRelativeTime(n.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {recentFiles && (<Panel title="Recent documents" subtitle="Recently edited in Workspace" icon={FileText}
          action={{ label: 'Workspace', onClick: go('workspace') }}>
          {recentFiles.length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet" description="Pages you create will show up here." />
          ) : (
            <ul className="flex flex-col gap-3">
              {recentFiles.slice(0, 6).map(f => (
                <li key={f.id} className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${f.color}1a`, color: f.color }}>
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.title}</p>
                    <p className="text-muted-foreground text-xs">Edited {formatRelativeTime(f.updatedAt)}</p>
                  </div>
                  {f.isStarred && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                </li>
              ))}
            </ul>
          )}
        </Panel>)}
      </div>

      {/* ── Quick actions ──────────────────────────────────────────────── */}
      <Panel title="Quick actions" subtitle="Jump straight into a workflow" icon={Plus}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {quickActions.map(a => (
            <button key={a.label} onClick={() => setActiveModule(a.module)}
              className="group hover:border-emerald-500/40 hover:bg-emerald-500/5 flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors">
              <div className="bg-emerald-500/10 text-emerald-600 flex size-9 items-center justify-center rounded-lg transition-transform group-hover:scale-105">
                <a.icon className="size-4" />
              </div>
              <span className="text-center text-xs font-medium">{a.label}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}
