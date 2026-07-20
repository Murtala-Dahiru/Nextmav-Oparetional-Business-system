'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  DollarSign, Trophy, Percent, Hash, Star, Zap,
  FileDown, FileSpreadsheet, BarChart3, TrendingUp,
  ArrowUpRight, ArrowDownRight, ChevronRight,
  FileText, Receipt, PieChartIcon, Activity,
  Briefcase, Clock, Users, Target, CircleDot,
  Filter, CalendarDays,
} from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

import {
  leadsByStatus, salesBySource, revenueChart, projects,
  employees, invoices, expenses, tickets, products,
} from '@/lib/mock-data';

// ─── Color Palettes ───────────────────────────────────────────────────────────

const EMERALD = '#10b981';
const TEAL = '#14b8a6';
const PIE_COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6'];
const FUNNEL_COLORS = ['#0d9488', '#0f766e', '#115e59', '#134e4a', '#1a3a37', '#0a2f2b'];
const STAGE_COLORS = ['#10b981', '#14b8a6', '#0d9488', '#f59e0b', '#8b5cf6'];

// ─── Funnel Data ──────────────────────────────────────────────────────────────

const funnelStages = [
  { label: 'Leads', count: 284, color: '#0d9488' },
  { label: 'Contacted', count: 175, color: '#0f766e' },
  { label: 'Qualified', count: 112, color: '#115e59' },
  { label: 'Proposal', count: 68, color: '#134e4a' },
  { label: 'Negotiation', count: 42, color: '#1a3a37' },
  { label: 'Won', count: 23, color: '#10b981' },
];

// ─── Metric Cards ─────────────────────────────────────────────────────────────

const metricCards = [
  { label: 'Total Revenue', value: '$445K', change: 12.5, icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
  { label: 'Deals Won', value: '23', change: 15.4, icon: Trophy, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/40' },
  { label: 'Conversion Rate', value: '18.5%', change: 3.2, icon: Percent, color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-950/40' },
  { label: 'Avg Deal Size', value: '$19.3K', change: -2.1, icon: Hash, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/40' },
  { label: 'Customer Satisfaction', value: '4.2/5', change: 5.0, icon: Star, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/40' },
  { label: 'Team Productivity', value: '87%', change: 8.3, icon: Zap, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/40' },
];

// ─── Revenue + Target Data ───────────────────────────────────────────────────

const revenueWithTarget = revenueChart.map((d) => ({
  ...d,
  target: 40000,
}));

// ─── Team Performance (mock from employees) ──────────────────────────────────

const teamPerformance = employees.slice(0, 5).map((e, i) => ({
  name: `${e.firstName} ${e.lastName}`,
  tasks: [47, 42, 38, 35, 31][i],
  department: e.department,
}));

// ─── Top Deals (derived) ────────────────────────────────────────────────────

const topDeals = [
  { name: 'Data Analytics Platform', value: 250000, stage: 'Qualified', closeDate: '2026-10-01', owner: 'Alex Johnson' },
  { name: 'Platform Integration', value: 200000, stage: 'Negotiation', closeDate: '2026-07-30', owner: 'Alex Johnson' },
  { name: 'Digital Transformation', value: 150000, stage: 'Contract', closeDate: '2026-07-25', owner: 'David Kim' },
  { name: 'Cloud Infrastructure', value: 180000, stage: 'Qualified', closeDate: '2026-09-01', owner: 'Alex Johnson' },
  { name: 'Enterprise License Deal', value: 120000, stage: 'Qualified', closeDate: '2026-08-15', owner: 'Alex Johnson' },
].sort((a, b) => b.value - a.value);

// ─── Sales by Stage (monthly mock) ───────────────────────────────────────────

const salesByStage = [
  { month: 'Jan', qualified: 15, proposal: 10, negotiation: 6, won: 4 },
  { month: 'Feb', qualified: 18, proposal: 12, negotiation: 8, won: 5 },
  { month: 'Mar', qualified: 22, proposal: 15, negotiation: 10, won: 7 },
  { month: 'Apr', qualified: 20, proposal: 14, negotiation: 9, won: 6 },
  { month: 'May', qualified: 25, proposal: 18, negotiation: 12, won: 8 },
  { month: 'Jun', qualified: 28, proposal: 20, negotiation: 14, won: 10 },
  { month: 'Jul', qualified: 30, proposal: 22, negotiation: 16, won: 12 },
];

// ─── Project Status Distribution ─────────────────────────────────────────────

const projectStatusData = [
  { name: 'Active', value: projects.filter((p) => p.status === 'active').length, color: '#10b981' },
  { name: 'Completed', value: projects.filter((p) => p.status === 'completed').length, color: '#14b8a6' },
  { name: 'On Hold', value: projects.filter((p) => p.status === 'on-hold').length, color: '#f59e0b' },
  { name: 'Planning', value: projects.filter((p) => p.status === 'planning').length, color: '#8b5cf6' },
];

// ─── Budget vs Actual ────────────────────────────────────────────────────────

const budgetVsActual = projects.slice(0, 5).map((p) => ({
  name: p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name,
  budget: p.budget,
  actual: Math.round(p.budget * (0.7 + Math.random() * 0.5)),
}));

// ─── Team Workload (hours) ───────────────────────────────────────────────────

const teamWorkload = [
  { name: 'Maria Garcia', projectWork: 32, meetings: 8, admin: 4 },
  { name: 'John Smith', projectWork: 36, meetings: 6, admin: 3 },
  { name: 'David Kim', projectWork: 28, meetings: 10, admin: 5 },
  { name: 'Sarah Chen', projectWork: 34, meetings: 5, admin: 6 },
  { name: 'Emily Park', projectWork: 30, meetings: 7, admin: 4 },
];

// ─── P&L Summary ─────────────────────────────────────────────────────────────

const plSummary = [
  { label: 'Revenue', amount: '$445,000', change: 12.5, type: 'income' as const },
  { label: 'Cost of Goods Sold', amount: '$89,000', change: -3.2, type: 'cost' as const },
  { label: 'Gross Profit', amount: '$356,000', change: 18.7, type: 'profit' as const },
  { label: 'Operating Expenses', amount: '$156,000', change: 5.1, type: 'cost' as const },
  { label: 'Net Income', amount: '$200,000', change: 24.3, type: 'profit' as const },
];

// ─── Expense by Category ─────────────────────────────────────────────────────

const expenseByCategory = [
  { category: 'Cloud Services', amount: 12450, count: 3 },
  { category: 'Facilities', amount: 8500, count: 1 },
  { category: 'Marketing', amount: 15000, count: 2 },
  { category: 'Software', amount: 3200, count: 4 },
  { category: 'Travel', amount: 2800, count: 1 },
  { category: 'Equipment', amount: 4500, count: 1 },
  { category: 'Meals', amount: 450, count: 3 },
];

// ─── Accounts Receivable ─────────────────────────────────────────────────────

const accountsReceivable = invoices
  .filter((inv) => inv.status === 'overdue' || inv.status === 'sent')
  .map((inv) => {
    const daysSinceCreation = Math.floor(
      (Date.now() - new Date(inv.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    const aging =
      daysSinceCreation <= 30 ? '0-30' : daysSinceCreation <= 60 ? '31-60' : '61-90';
    return {
      invoiceNumber: inv.invoiceNumber,
      company: inv.companyName,
      total: inv.total,
      dueDate: inv.dueDate,
      status: inv.status,
      aging,
      daysSinceCreation,
    };
  });

// ─── Cash Flow ───────────────────────────────────────────────────────────────

const cashFlowData = [
  { month: 'Jan', inflow: 38000, outflow: 28000 },
  { month: 'Feb', inflow: 42000, outflow: 31000 },
  { month: 'Mar', inflow: 52000, outflow: 33000 },
  { month: 'Apr', inflow: 45000, outflow: 36000 },
  { month: 'May', inflow: 55000, outflow: 38000 },
  { month: 'Jun', inflow: 62000, outflow: 42000 },
  { month: 'Jul', inflow: 58000, outflow: 40000 },
];

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-lg dark:border-gray-700 dark:bg-gray-900/95">
      <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs text-gray-600 dark:text-gray-400">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-medium text-gray-900 dark:text-gray-100">${(entry.value / 1000).toFixed(1)}K</span>
        </p>
      ))}
    </div>
  );
}

function SimpleTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-lg dark:border-gray-700 dark:bg-gray-900/95">
      <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs text-gray-600 dark:text-gray-400">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-medium text-gray-900 dark:text-gray-100">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Tab Header ──────────────────────────────────────────────────────────────

function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="gap-1.5 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40" onClick={() => toast.success('PDF report exported')}>
          <FileDown className="h-4 w-4" /> PDF
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40" onClick={() => toast.success('Excel report exported')}>
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </Button>
      </div>
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, change, icon: Icon, color, bg, index }: {
  label: string; value: string; change: number; icon: React.ElementType;
  color: string; bg: string; index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
    >
      <Card className="relative overflow-hidden border-0 shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
              <div className="flex items-center gap-1">
                {change >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-rose-500" />
                )}
                <span className={cn('text-xs font-semibold', change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                  {Math.abs(change)}%
                </span>
                <span className="text-xs text-gray-400">vs last month</span>
              </div>
            </div>
            <div className={cn('rounded-xl p-2.5', bg)}>
              <Icon className={cn('h-5 w-5', color)} />
            </div>
          </div>
          {/* Decorative gradient bar */}
          <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500/60 via-teal-500/40 to-transparent" />
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Lead Conversion Funnel ──────────────────────────────────────────────────

function LeadConversionFunnel() {
  const maxCount = funnelStages[0].count;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <Filter className="h-4 w-4 text-emerald-600" />
          Lead Conversion Funnel
        </CardTitle>
        <CardDescription>Visual representation of your pipeline from lead to close</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="relative flex flex-col items-center gap-0">
          {funnelStages.map((stage, idx) => {
            const widthPercent = 30 + ((stage.count / maxCount) * 70);
            const conversionFromPrev = idx > 0 ? ((stage.count / funnelStages[idx - 1].count) * 100).toFixed(1) : '100';
            const isLast = idx === funnelStages.length - 1;
            return (
              <div key={stage.label} className="relative flex w-full flex-col items-center">
                {/* Connector arrow */}
                {idx > 0 && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.3, delay: idx * 0.1 }}
                    className="flex items-center gap-2 py-1"
                  >
                    <div className="h-4 w-px bg-gradient-to-b from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-500" />
                    <ChevronRight className="h-3 w-3 -rotate-90 text-gray-400" />
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      {conversionFromPrev}%
                    </span>
                  </motion.div>
                )}
                {/* Funnel bar */}
                <motion.div
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: 0.5, delay: idx * 0.1, ease: 'easeOut' }}
                  style={{ width: `${widthPercent}%` }}
                  className="relative"
                >
                  <div
                    className={cn(
                      'group relative flex items-center justify-between rounded-sm px-5 py-3 transition-all duration-300',
                      isLast
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-lg shadow-emerald-500/25'
                        : 'hover:brightness-110',
                    )}
                    style={
                      isLast
                        ? undefined
                        : {
                            background: `linear-gradient(135deg, ${stage.color}, ${stage.color}dd)`,
                            boxShadow: `0 2px 8px ${stage.color}30`,
                          }
                    }
                  >
                    {/* Animated shimmer effect */}
                    <div className="absolute inset-0 overflow-hidden rounded-sm">
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_3s_infinite]" />
                    </div>
                    {/* Stage label and count */}
                    <div className="relative z-10 flex items-center gap-3">
                      <div className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                        isLast ? 'bg-white/25 text-white' : 'bg-white/15 text-white/90',
                      )}>
                        {idx + 1}
                      </div>
                      <div>
                        <span className={cn(
                          'block text-sm font-semibold tracking-wide',
                          isLast ? 'text-white' : 'text-white/95',
                        )}>
                          {stage.label}
                        </span>
                      </div>
                    </div>
                    <div className="relative z-10 text-right">
                      <span className={cn(
                        'block text-xl font-bold tabular-nums',
                        isLast ? 'text-white' : 'text-white/95',
                      )}>
                        {stage.count.toLocaleString()}
                      </span>
                    </div>
                    {/* Drop percentage */}
                    {idx > 0 && (
                      <div className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full px-2 py-0.5">
                        <Badge variant="secondary" className="text-[10px] font-bold text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/50 border-0">
                          ↓ {((1 - stage.count / funnelStages[idx - 1].count) * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            );
          })}
          {/* Overall conversion rate callout */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.8 }}
            className="mt-4 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-3 text-center dark:border-emerald-800 dark:from-emerald-950/40 dark:to-teal-950/40"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Overall Conversion Rate</p>
            <p className="mt-0.5 text-2xl font-bold text-emerald-700 dark:text-emerald-300">
              {((funnelStages[funnelStages.length - 1].count / funnelStages[0].count) * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60">From Lead to Won</p>
          </motion.div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  return (
    <div className="space-y-6">
      <TabHeader title="Overview" description="High-level metrics and performance indicators for your business" />

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {metricCards.map((m, i) => (
          <MetricCard key={m.label} {...m} index={i} />
        ))}
      </div>

      {/* Revenue vs Target + Funnel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Revenue Chart */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="lg:col-span-3"
        >
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <BarChart3 className="h-4 w-4 text-emerald-600" />
                Revenue vs Target
              </CardTitle>
              <CardDescription>Monthly revenue performance against quarterly target</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={revenueWithTarget} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}K`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <ReferenceLine y={40000} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={2} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => {
                      if (value === 'value') return <span className="text-xs text-gray-600 dark:text-gray-400">Revenue</span>;
                      return <span className="text-xs text-gray-600 dark:text-gray-400">{value}</span>;
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex items-center gap-2 pl-2">
                <div className="h-0.5 w-5 bg-amber-500" style={{ borderStyle: 'dashed' }} />
                <span className="text-xs text-gray-500">Target: $40K/month</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Lead Conversion Funnel */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="lg:col-span-2"
        >
          <LeadConversionFunnel />
        </motion.div>
      </div>

      {/* Team Performance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Users className="h-4 w-4 text-emerald-600" />
              Team Performance
            </CardTitle>
            <CardDescription>Top 5 team members ranked by tasks completed this month</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={teamPerformance} layout="vertical" barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={120} />
                <Tooltip content={<SimpleTooltip />} />
                <Bar dataKey="tasks" name="Tasks Completed" fill="#14b8a6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ─── Sales Tab ───────────────────────────────────────────────────────────────

function SalesTab() {
  return (
    <div className="space-y-6">
      <TabHeader title="Sales Reports" description="Detailed analysis of your sales pipeline and performance" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Sales by Source Pie */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <PieChartIcon className="h-4 w-4 text-emerald-600" />
                Sales by Source
              </CardTitle>
              <CardDescription>Distribution of deals across lead sources</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={salesBySource}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {salesBySource.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<SimpleTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Monthly Sales Trend */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                Monthly Sales Trend
              </CardTitle>
              <CardDescription>Revenue trend over the past 7 months</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={revenueChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}K`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="value" name="Revenue" stroke="#10b981" strokeWidth={3} dot={{ fill: '#10b981', r: 5, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 7, stroke: '#10b981', strokeWidth: 2, fill: '#fff' }} />
                  <Line type="monotone" dataKey="value2" name="Expenses" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={{ fill: '#f59e0b', r: 4 }} />
                  <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Top Deals Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Target className="h-4 w-4 text-emerald-600" />
              Top Deals
            </CardTitle>
            <CardDescription>Highest value opportunities in your pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 dark:border-gray-800 hover:bg-transparent">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Deal</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Value</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Stage</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Close Date</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDeals.map((deal) => (
                  <TableRow key={deal.name} className="border-gray-50 dark:border-gray-800/50">
                    <TableCell className="font-medium text-gray-900 dark:text-gray-100">{deal.name}</TableCell>
                    <TableCell className="font-semibold text-emerald-600 dark:text-emerald-400">${(deal.value / 1000).toFixed(0)}K</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn(
                        'text-xs font-medium border-0',
                        deal.stage === 'Qualified' && 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400',
                        deal.stage === 'Proposal' && 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400',
                        deal.stage === 'Negotiation' && 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
                        deal.stage === 'Contract' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
                      )}>
                        {deal.stage}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500 dark:text-gray-400">{deal.closeDate}</TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">{deal.owner}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Sales by Stage */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Activity className="h-4 w-4 text-emerald-600" />
              Sales by Stage
            </CardTitle>
            <CardDescription>Monthly deal distribution across pipeline stages</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={salesByStage} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<SimpleTooltip />} />
                <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="qualified" name="Qualified" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="proposal" name="Proposal" stackId="a" fill="#14b8a6" />
                <Bar dataKey="negotiation" name="Negotiation" stackId="a" fill="#f59e0b" />
                <Bar dataKey="won" name="Won" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ─── Project Tab ─────────────────────────────────────────────────────────────

function ProjectTab() {
  return (
    <div className="space-y-6">
      <TabHeader title="Project Reports" description="Project health, budgets, and team workload analysis" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Project Status Distribution */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <PieChartIcon className="h-4 w-4 text-emerald-600" />
                Project Status Distribution
              </CardTitle>
              <CardDescription>Current status breakdown of all active projects</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={projectStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={4}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {projectStatusData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<SimpleTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Budget vs Actual */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <DollarSign className="h-4 w-4 text-emerald-600" />
                Budget vs Actual Spend
              </CardTitle>
              <CardDescription>Top 5 projects budget utilization comparison</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={budgetVsActual} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} angle={-15} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}K`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="budget" name="Budget" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" name="Actual" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Task Completion Progress */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <CircleDot className="h-4 w-4 text-emerald-600" />
              Task Completion by Project
            </CardTitle>
            <CardDescription>Progress of task completion across all projects</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {projects.map((project) => {
                const pct = Math.round((project.completedTaskCount / project.taskCount) * 100);
                return (
                  <div key={project.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{project.name}</span>
                        <Badge variant="outline" className={cn(
                          'text-[10px] capitalize border-0',
                          project.status === 'active' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
                          project.status === 'completed' && 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400',
                          project.status === 'on-hold' && 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
                          project.status === 'planning' && 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400',
                        )}>
                          {project.status}
                        </Badge>
                      </div>
                      <span className="text-xs tabular-nums font-semibold text-gray-600 dark:text-gray-400">
                        {project.completedTaskCount}/{project.taskCount} tasks ({pct}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className={cn(
                          'h-full rounded-full',
                          pct === 100
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                            : 'bg-gradient-to-r from-emerald-500 to-teal-500',
                        )}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Team Workload */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Clock className="h-4 w-4 text-emerald-600" />
              Team Workload Distribution
            </CardTitle>
            <CardDescription>Weekly hours allocated per team member by activity type</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={teamWorkload} layout="vertical" barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="h" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={120} />
                <Tooltip content={<SimpleTooltip />} />
                <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="projectWork" name="Project Work" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="meetings" name="Meetings" stackId="a" fill="#14b8a6" />
                <Bar dataKey="admin" name="Admin" stackId="a" fill="#f59e0b" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ─── Financial Tab ───────────────────────────────────────────────────────────

function FinancialTab() {
  return (
    <div className="space-y-6">
      <TabHeader title="Financial Reports" description="Profit & loss, expenses, receivables, and cash flow analysis" />

      {/* P&L Summary */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <FileText className="h-4 w-4 text-emerald-600" />
              Profit & Loss Summary
            </CardTitle>
            <CardDescription>Key financial metrics for the current quarter</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 dark:border-gray-800 hover:bg-transparent">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Line Item</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500 text-right">Amount</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500 text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plSummary.map((row) => (
                  <TableRow key={row.label} className={cn(
                    'border-gray-50 dark:border-gray-800/50',
                    row.label === 'Gross Profit' && 'bg-emerald-50/50 dark:bg-emerald-950/20',
                    row.label === 'Net Income' && 'bg-emerald-50/80 dark:bg-emerald-950/30',
                  )}>
                    <TableCell className={cn(
                      'font-medium',
                      (row.label === 'Gross Profit' || row.label === 'Net Income') ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-gray-900 dark:text-gray-100',
                      row.label === 'Cost of Goods Sold' && 'pl-4',
                      row.label === 'Operating Expenses' && 'pl-4',
                    )}>
                      {row.label === 'Cost of Goods Sold' && <span className="text-gray-400 mr-1">−</span>}
                      {row.label === 'Operating Expenses' && <span className="text-gray-400 mr-1">−</span>}
                      {row.label}
                    </TableCell>
                    <TableCell className={cn(
                      'text-right font-semibold tabular-nums',
                      (row.label === 'Gross Profit' || row.label === 'Net Income') ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100',
                    )}>
                      {row.amount}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        {row.change >= 0 ? (
                          <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5 text-rose-500" />
                        )}
                        <span className={cn(
                          'text-xs font-semibold tabular-nums',
                          row.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                        )}>
                          {Math.abs(row.change)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Expense by Category */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <Receipt className="h-4 w-4 text-emerald-600" />
                Expense by Category
              </CardTitle>
              <CardDescription>Grouped spending breakdown for the current period</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={expenseByCategory} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} angle={-25} textAnchor="end" height={65} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}K`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="amount" name="Amount" radius={[6, 6, 0, 0]}>
                    {expenseByCategory.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Monthly Cash Flow */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                Monthly Cash Flow
              </CardTitle>
              <CardDescription>Inflow vs outflow cash movement over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={cashFlowData}>
                  <defs>
                    <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}K`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="inflow" name="Inflow" stroke="#10b981" strokeWidth={2.5} fill="url(#inflowGrad)" />
                  <Area type="monotone" dataKey="outflow" name="Outflow" stroke="#f59e0b" strokeWidth={2.5} fill="url(#outflowGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Accounts Receivable */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <CalendarDays className="h-4 w-4 text-emerald-600" />
              Accounts Receivable
            </CardTitle>
            <CardDescription>Outstanding and overdue invoices with aging buckets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 dark:border-gray-800 hover:bg-transparent">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Invoice</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Company</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500 text-right">Amount</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Due Date</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Status</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500">Aging</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountsReceivable.map((ar) => (
                  <TableRow key={ar.invoiceNumber} className="border-gray-50 dark:border-gray-800/50">
                    <TableCell className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{ar.invoiceNumber}</TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">{ar.company}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">${ar.total.toLocaleString()}</TableCell>
                    <TableCell className="text-gray-500 dark:text-gray-400">{ar.dueDate}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn(
                        'text-xs font-medium border-0 capitalize',
                        ar.status === 'overdue' && 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400',
                        ar.status === 'sent' && 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
                      )}>
                        {ar.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        'text-xs font-mono border',
                        ar.aging === '0-30' && 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400',
                        ar.aging === '31-60' && 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400',
                        ar.aging === '61-90' && 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-400',
                      )}>
                        {ar.aging} days
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ─── Main Reports Module ─────────────────────────────────────────────────────

export default function ReportsModule() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-1"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Reports & Analytics
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Comprehensive business intelligence and performance reporting
            </p>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-0">
        <TabsList className="mb-6 w-full justify-start rounded-xl bg-gray-100/80 p-1 dark:bg-gray-800/60">
          <TabsTrigger
            value="overview"
            className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:dark:bg-gray-900"
          >
            <Activity className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="sales"
            className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:dark:bg-gray-900"
          >
            <TrendingUp className="h-4 w-4" />
            Sales
          </TabsTrigger>
          <TabsTrigger
            value="projects"
            className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:dark:bg-gray-900"
          >
            <Briefcase className="h-4 w-4" />
            Projects
          </TabsTrigger>
          <TabsTrigger
            value="financial"
            className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:dark:bg-gray-900"
          >
            <DollarSign className="h-4 w-4" />
            Financial
          </TabsTrigger>
        </TabsList>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
          >
            <TabsContent value="overview" className="mt-0">
              <OverviewTab />
            </TabsContent>
            <TabsContent value="sales" className="mt-0">
              <SalesTab />
            </TabsContent>
            <TabsContent value="projects" className="mt-0">
              <ProjectTab />
            </TabsContent>
            <TabsContent value="financial" className="mt-0">
              <FinancialTab />
            </TabsContent>
          </motion.div>
        </AnimatePresence>
      </Tabs>
    </div>
  );
}