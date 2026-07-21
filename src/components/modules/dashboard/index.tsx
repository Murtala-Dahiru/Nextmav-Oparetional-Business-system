'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  DollarSign,
  Handshake,
  TicketCheck,
  FolderKanban,
  ListTodo,
  UserPlus,
  Activity,
  User,
  Plus,
  FileText,
  CalendarDays,
  BarChart3,
  TrendingUp,
  Package,
  Settings,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency, formatRelativeTime, getInitials } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import type { ModuleId } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ApiResponse<T> {
  data: T[];
  meta: ApiMeta;
}

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  status: string;
  score: number;
  value: number;
  createdAt: string;
}

interface Deal {
  id: string;
  name: string;
  value: number;
  stage: string;
  probability: number;
  closeDate: string;
  contactName: string;
  companyName: string;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  status: string;
  priority: string;
  createdAt: string;
  _count: { tasks: number };
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: string;
  category: string;
  contactName: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  contactName: string;
  companyName: string;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
}

interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  status: string;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  module: string;
  action: string;
  title: string;
  description: string;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; avatar: string } | null;
}

interface DashboardData {
  leads: Lead[];
  deals: Deal[];
  projects: Project[];
  tasks: Task[];
  tickets: Ticket[];
  invoices: Invoice[];
  expenses: Expense[];
  activities: ActivityItem[];
  topDeals: any[];
  leadByStatus: any[];
  dealsByStage: any[];
  revenueByMonth: any[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_COLORS = ['#10b981', '#14b8a6', '#06b6d4', '#f59e0b', '#f43f5e'];

const MODULE_ICON_MAP: Record<string, string> = {
  crm: '👥',
  projects: '📁',
  support: '📧',
  finance: '💰',
  hr: '👤',
  inventory: '📦',
  calendar: '📅',
  communication: '📣',
  admin: '⚙️',
  workspace: '📓',
};

const LEAD_STATUS_COLORS: Record<string, string> = {
  new: '#06b6d4',
  contacted: '#10b981',
  qualified: '#14b8a6',
  proposal: '#f59e0b',
  negotiation: '#8b5cf6',
  won: '#22c55e',
  lost: '#f43f5e',
};

const QUICK_ACTIONS: { label: string; module: ModuleId; icon: React.ElementType }[] = [
  { label: 'New Lead', module: 'crm', icon: UserPlus },
  { label: 'Create Project', module: 'projects', icon: FolderKanban },
  { label: 'Add Invoice', module: 'finance', icon: FileText },
  { label: 'New Ticket', module: 'support', icon: TicketCheck },
  { label: 'Schedule Event', module: 'calendar', icon: CalendarDays },
  { label: 'View Reports', module: 'admin', icon: BarChart3 },
];

const DEAL_STAGE_ORDER = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won', 'closed-lost'];

// ---------------------------------------------------------------------------
// Skeleton helpers
// ---------------------------------------------------------------------------

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className ?? ''}`} />;
}

function KpiSkeletons() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-card rounded-lg border p-4">
          <SkeletonPulse className="mb-2 h-4 w-24" />
          <SkeletonPulse className="mb-2 h-8 w-32" />
          <SkeletonPulse className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <SkeletonPulse className="h-5 w-36" />
      </CardHeader>
      <CardContent>
        <SkeletonPulse className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip for charts
// ---------------------------------------------------------------------------

function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; dataKey: string; color?: string }>;
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border/50 bg-background rounded-lg border px-3 py-2 text-xs shadow-xl">
      {label && <p className="font-medium text-foreground mb-1">{label}</p>}
      {payload.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color ?? CHART_COLORS[0] }}
          />
          <span className="text-muted-foreground">
            {item.name}: {formatter ? formatter(item.value) : item.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DashboardModule() {
  const { setActiveModule } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch dashboard data on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchDashboard() {
      try {
        setLoading(true);
        const res = await fetch('/api/dashboard');
        if (!res.ok) throw new Error(`Failed to fetch dashboard: ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json.data);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Computed KPIs ----

  const kpis = useMemo(() => {
    if (!data) return null;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const calcChange = (thisCount: number, lastCount: number) =>
      lastCount > 0
        ? ((thisCount - lastCount) / lastCount) * 100
        : thisCount > 0
          ? 100
          : 0;

    // Total Revenue from paid invoices
    const totalRevenue = data.invoices
      .filter((inv) => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.total, 0);
    const thisMonthRevenue = data.invoices
      .filter((inv) => inv.status === 'paid' && new Date(inv.paidAt ?? inv.createdAt) >= thisMonthStart)
      .reduce((sum, inv) => sum + inv.total, 0);
    const lastMonthRevenue = data.invoices
      .filter((inv) => inv.status === 'paid' && new Date(inv.paidAt ?? inv.createdAt) >= lastMonthStart && new Date(inv.paidAt ?? inv.createdAt) < thisMonthStart)
      .reduce((sum, inv) => sum + inv.total, 0);
    const revenueChange = calcChange(thisMonthRevenue, lastMonthRevenue);

    // Active Deals
    const activeDealsCount = data.deals.filter(
      (d) => d.stage !== 'closed-won' && d.stage !== 'closed-lost',
    ).length;
    const thisMonthDeals = data.deals.filter(
      (d) => new Date(d.createdAt) >= thisMonthStart,
    ).length;
    const lastMonthDeals = data.deals.filter(
      (d) => new Date(d.createdAt) >= lastMonthStart && new Date(d.createdAt) < thisMonthStart,
    ).length;
    const dealsChange = calcChange(thisMonthDeals, lastMonthDeals);

    // Open Tickets
    const openTicketsCount = data.tickets.filter(
      (t) => t.status === 'open' || t.status === 'in-progress' || t.status === 'pending',
    ).length;
    const thisMonthTickets = data.tickets.filter(
      (t) => new Date(t.createdAt) >= thisMonthStart,
    ).length;
    const lastMonthTickets = data.tickets.filter(
      (t) => new Date(t.createdAt) >= lastMonthStart && new Date(t.createdAt) < thisMonthStart,
    ).length;
    const ticketsChange = calcChange(thisMonthTickets, lastMonthTickets);

    // Active Projects
    const activeProjectsCount = data.projects.filter((p) => p.status === 'active').length;
    const thisMonthProjects = data.projects.filter(
      (p) => new Date(p.createdAt) >= thisMonthStart,
    ).length;
    const lastMonthProjects = data.projects.filter(
      (p) => new Date(p.createdAt) >= lastMonthStart && new Date(p.createdAt) < thisMonthStart,
    ).length;
    const projectsChange = calcChange(thisMonthProjects, lastMonthProjects);

    // Tasks Due This Week
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    weekFromNow.setHours(23, 59, 59, 999);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tasksDueThisWeek = data.tasks.filter(
      (t) =>
        t.dueDate &&
        t.status !== 'done' &&
        new Date(t.dueDate) >= todayStart &&
        new Date(t.dueDate) <= weekFromNow,
    ).length;

    // New Leads This Month
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newLeadsThisMonth = data.leads.filter(
      (l) => new Date(l.createdAt) >= thirtyDaysAgo,
    ).length;
    const thisMonthLeads = data.leads.filter(
      (l) => new Date(l.createdAt) >= thisMonthStart,
    ).length;
    const lastMonthLeads = data.leads.filter(
      (l) => new Date(l.createdAt) >= lastMonthStart && new Date(l.createdAt) < thisMonthStart,
    ).length;
    const leadsChange = calcChange(thisMonthLeads, lastMonthLeads);

    return {
      totalRevenue,
      revenueChange,
      activeDealsCount,
      dealsChange,
      openTicketsCount,
      ticketsChange,
      activeProjectsCount,
      projectsChange,
      tasksDueThisWeek,
      newLeadsThisMonth,
      leadsChange,
    };
  }, [data]);

  // ---- Chart: Monthly Revenue ----

  const revenueChartData = useMemo(() => {
    if (!data) return [];

    const paidInvoices = data.invoices.filter((inv) => inv.status === 'paid' && inv.paidAt);

    // Group by month (last 6 months)
    const monthMap = new Map<string, number>();
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      monthMap.set(key, 0);
    }

    paidInvoices.forEach((inv) => {
      const d = new Date(inv.paidAt!);
      const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      if (monthMap.has(key)) {
        monthMap.set(key, monthMap.get(key)! + inv.total);
      }
    });

    return Array.from(monthMap.entries()).map(([month, revenue]) => ({ month, revenue }));
  }, [data]);

  // ---- Chart: Deal Pipeline ----

  const pipelineChartData = useMemo(() => {
    if (!data) return [];

    const stageMap = new Map<string, { count: number; value: number }>();

    DEAL_STAGE_ORDER.forEach((stage) => {
      stageMap.set(stage, { count: 0, value: 0 });
    });

    data.deals.forEach((deal) => {
      const entry = stageMap.get(deal.stage);
      if (entry) {
        entry.count += 1;
        entry.value += deal.value;
      }
    });

    return Array.from(stageMap.entries())
      .filter(([, v]) => v.count > 0)
      .map(([stage, v]) => ({
        stage: stage.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        count: v.count,
        value: v.value,
      }));
  }, [data]);

  // ---- Chart: Lead Status Distribution ----

  const leadChartData = useMemo(() => {
    if (!data?.leadByStatus) return [];
    return data.leadByStatus
      .map((s: any) => ({
        name: (s.status as string).replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        value: s.count,
        color: LEAD_STATUS_COLORS[s.status] ?? '#94a3b8',
      }))
      .sort((a: any, b: any) => b.value - a.value);
  }, [data]);

  // ---- Top Deals ----

  const topDeals = useMemo(() => {
    if (!data) return [];
    return [...data.deals]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [data]);

  // ---- Quick Action Handler ----

  const handleQuickAction = useCallback(
    (module: ModuleId) => {
      setActiveModule(module);
    },
    [setActiveModule],
  );

  // ---- Module navigation from activity ----

  const handleActivityClick = useCallback(
    (moduleName: string) => {
      const moduleMap: Record<string, ModuleId> = {
        crm: 'crm',
        projects: 'projects',
        support: 'support',
        finance: 'finance',
        hr: 'hr',
        inventory: 'inventory',
        calendar: 'calendar',
        communication: 'communication',
        admin: 'admin',
        workspace: 'workspace',
      };
      if (moduleMap[moduleName]) {
        setActiveModule(moduleMap[moduleName]);
      }
    },
    [setActiveModule],
  );

  // ---- Error State ----

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Overview of your business operations"
          icon={TrendingUp}
        />
        <EmptyState
          icon={Activity}
          title="Unable to load dashboard"
          description={error}
        />
      </div>
    );
  }

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Dashboard"
        description="Overview of your business operations"
        icon={TrendingUp}
      />

      {/* Section 1: KPI Cards */}
      {loading ? (
        <KpiSkeletons />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard
            label="Total Revenue"
            value={formatCurrency(kpis!.totalRevenue)}
            change={kpis!.revenueChange}
            changeLabel="vs last month"
            icon={DollarSign}
          />
          <StatCard
            label="Active Deals"
            value={kpis!.activeDealsCount}
            change={kpis!.dealsChange}
            changeLabel="vs last month"
            icon={Handshake}
          />
          <StatCard
            label="Open Tickets"
            value={kpis!.openTicketsCount}
            change={kpis!.ticketsChange}
            changeLabel="vs last month"
            icon={TicketCheck}
          />
          <StatCard
            label="Active Projects"
            value={kpis!.activeProjectsCount}
            change={kpis!.projectsChange}
            changeLabel="vs last month"
            icon={FolderKanban}
          />
          <StatCard
            label="Tasks Due This Week"
            value={kpis!.tasksDueThisWeek}
            icon={ListTodo}
          />
          <StatCard
            label="New Leads"
            value={kpis!.newLeadsThisMonth}
            change={kpis!.leadsChange}
            changeLabel="vs last month"
            icon={UserPlus}
          />
        </div>
      )}

      {/* Section 2: Revenue Chart */}
      {loading ? (
        <ChartSkeleton />
      ) : revenueChartData.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={DollarSign}
              title="No revenue data yet"
              description="Paid invoices will appear as monthly revenue here."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<ChartTooltipContent formatter={(v: number) => formatCurrency(v)} />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#revenueGradient)"
                    name="Revenue"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 3: Deal Pipeline */}
      {loading ? (
        <ChartSkeleton />
      ) : pipelineChartData.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Deal Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Handshake}
              title="No deals in pipeline"
              description="Create deals to see your pipeline breakdown here."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Deal Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pipelineChartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                  />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v: number) => formatCurrency(v)}
                      />
                    }
                  />
                  <Bar
                    dataKey="value"
                    fill="#10b981"
                    radius={[0, 4, 4, 0]}
                    name="Pipeline Value"
                    barSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 4: Recent Activity + Quick Actions */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ChartSkeleton />
          </div>
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Recent Activity */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {data!.activities.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No recent activity"
                  description="Activity from all modules will appear here."
                />
              ) : (
                <ScrollArea className="max-h-96">
                  <div className="space-y-1">
                    {data!.activities.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleActivityClick(item.module)}
                        className="flex items-start gap-3 w-full rounded-lg p-3 text-left transition-colors hover:bg-muted/50 cursor-pointer"
                      >
                        <div
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-base"
                          aria-hidden="true"
                        >
                          {MODULE_ICON_MAP[item.module] ?? '📋'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground truncate">
                              {item.title}
                            </p>
                            {item.user && (
                              <Avatar className="size-5 shrink-0">
                                <AvatarFallback className="text-[9px]">
                                  {getInitials(item.user.firstName, item.user.lastName)}
                                </AvatarFallback>
                              </Avatar>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {item.description}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatRelativeTime(item.createdAt)}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                          {item.module}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Right: Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Button
                      key={action.module}
                      variant="outline"
                      className="flex h-auto flex-col items-center gap-2 py-4 cursor-pointer hover:bg-emerald-500/10 hover:border-emerald-500/50 hover:text-emerald-600 transition-colors"
                      onClick={() => handleQuickAction(action.module)}
                    >
                      <Icon className="size-5" />
                      <span className="text-xs font-medium">{action.label}</span>
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Section 5: Top Deals + Lead Distribution */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ChartSkeleton />
          </div>
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Top Deals Table */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Top Deals</CardTitle>
            </CardHeader>
            <CardContent>
              {topDeals.length === 0 ? (
                <EmptyState
                  icon={Handshake}
                  title="No deals yet"
                  description="Create deals in CRM to see your top opportunities here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-3 text-left font-medium text-muted-foreground">Deal</th>
                        <th className="pb-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Company</th>
                        <th className="pb-3 text-left font-medium text-muted-foreground hidden md:table-cell">Stage</th>
                        <th className="pb-3 text-right font-medium text-muted-foreground">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topDeals.map((deal) => (
                        <tr key={deal.id} className="border-b border-border/50 last:border-0">
                          <td className="py-3">
                            <span className="font-medium text-foreground">{deal.name}</span>
                          </td>
                          <td className="py-3 text-muted-foreground hidden sm:table-cell">
                            {deal.companyName || '—'}
                          </td>
                          <td className="py-3 hidden md:table-cell">
                            <Badge
                              variant="outline"
                              className="capitalize text-[10px]"
                            >
                              {deal.stage.replace(/-/g, ' ')}
                            </Badge>
                          </td>
                          <td className="py-3 text-right font-medium text-foreground">
                            {formatCurrency(deal.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Lead Status Distribution Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Lead Status</CardTitle>
            </CardHeader>
            <CardContent>
              {leadStatusData.length === 0 ? (
                <EmptyState
                  icon={User}
                  title="No leads yet"
                  description="Add leads in CRM to see status distribution."
                />
              ) : (
                <div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={leadStatusData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {leadStatusData.map((entry, index) => (
                            <Cell key={entry.name} fill={entry.color} stroke="none" />
                          ))}
                        </Pie>
                        <Tooltip
                          content={<ChartTooltipContent />}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 justify-center">
                    {leadStatusData.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-muted-foreground">
                          {entry.name} ({entry.value})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
