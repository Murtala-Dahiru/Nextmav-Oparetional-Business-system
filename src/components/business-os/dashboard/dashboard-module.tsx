'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  ResponsiveContainer,
} from 'recharts';
import {
  DollarSign, Users, Target, TrendingUp, FolderKanban, CheckCircle,
  BarChart3, PieChartIcon, LayoutDashboard, CalendarDays, Activity,
  Zap, UserPlus, PlusCircle, FileText, CalendarClock, Handshake,
  CheckCircle2, LifeBuoy, UserCheck, MessageSquare, Clock, MapPin,
  ArrowUpRight, ArrowDownRight, CircleDot, Briefcase,
} from 'lucide-react';

import { toast } from 'sonner';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

import {
  kpiData, revenueChart, salesBySource,
  activities, projects, calendarEvents,
  currentUser, companyInfo,
} from '@/lib/mock-data';

// ─── Constants ──────────────────────────────────────────────────────────────

const PIE_COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6'];

const kpiIconMap: Record<string, React.ElementType> = {
  DollarSign,
  Users,
  Target,
  TrendingUp,
  FolderKanban,
  CheckCircle,
};

const kpiIconBgMap: Record<string, string> = {
  DollarSign: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  Users: 'bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400',
  Target: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  TrendingUp: 'bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400',
  FolderKanban: 'bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400',
  CheckCircle: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
};

const activityIconMap: Record<string, React.ElementType> = {
  deal: Handshake,
  task: CheckCircle2,
  invoice: DollarSign,
  lead: UserPlus,
  ticket: LifeBuoy,
  hr: UserCheck,
  project: FolderKanban,
  message: MessageSquare,
};

const activityColorMap: Record<string, string> = {
  deal: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  task: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400',
  invoice: 'bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400',
  lead: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  ticket: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
  hr: 'bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400',
  project: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400',
  message: 'bg-pink-100 text-pink-600 dark:bg-pink-950 dark:text-pink-400',
};

const moduleColorMap: Record<string, string> = {
  CRM: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  Projects: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  Finance: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  Support: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
  HR: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  Communication: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400',
};

const statusColorMap: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  completed: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400 border-teal-200 dark:border-teal-800',
  'on-hold': 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  planning: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400 border-violet-200 dark:border-violet-800',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Custom Tooltip Components ──────────────────────────────────────────────

function CustomBarTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="mb-1 text-sm font-semibold text-foreground">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: ${entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

function CustomPieTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { name: string; value: number } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="text-sm font-semibold text-foreground">{payload[0].name}</p>
      <p className="text-sm text-muted-foreground">{payload[0].value}%</p>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DashboardModule() {
  const activeProjects = projects.filter((p) => p.status === 'active').slice(0, 5);
  const upcomingEvents = calendarEvents.slice(0, 4);

  return (
    <div className="space-y-6">
      {/* ── 1. Welcome Banner ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 p-6 md:p-8 text-white"
      >
        {/* Decorative background blobs */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-white/5 blur-2xl" />

        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-100">{formatDate()}</p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {getGreeting()}, {currentUser.firstName}
            </h1>
            <p className="max-w-xl text-emerald-50/80">
              Welcome back to{' '}
              <span className="font-semibold text-white">{companyInfo.name}</span>.
              Here&apos;s what&apos;s happening with your business today.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start rounded-xl bg-white/15 backdrop-blur-sm px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">12</p>
              <p className="mt-0.5 text-xs text-emerald-100">Tasks due today</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Main Grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* ── 2. KPI Cards (6 cards) ──────────────────────────────────────── */}
        {kpiData.map((kpi, idx) => {
          const IconComp = kpiIconMap[kpi.icon] || CircleDot;
          const isPositive = kpi.change >= 0;
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: idx * 0.06 }}
              whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
              className="rounded-xl border bg-card p-6 shadow-sm transition-colors"
            >
              <div className="flex items-start justify-between">
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg',
                    kpiIconBgMap[kpi.icon]
                  )}
                >
                  <IconComp className="h-5 w-5" />
                </div>
                <div
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                    isPositive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                      : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'
                  )}
                >
                  {isPositive ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {Math.abs(kpi.change)}%
                </div>
              </div>
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{kpi.value}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{kpi.changeLabel}</p>
            </motion.div>
          );
        })}

        {/* ── 3. Revenue Chart (2/3 width) ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="md:col-span-2"
        >
          <Card className="h-full rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-5 w-5 text-emerald-600" />
                Revenue Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={revenueChart} barGap={4} barCategoryGap="20%">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    content={<CustomBarTooltip />}
                    cursor={{ fill: 'hsl(var(--muted))', radius: 4 }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                  />
                  <Bar
                    dataKey="value"
                    name="Revenue"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    dataKey="value2"
                    name="Expenses"
                    fill="#14b8a6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 4. Sales by Source (1/3 width) ───────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          <Card className="h-full rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChartIcon className="h-5 w-5 text-teal-600" />
                Sales by Source
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={salesBySource}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {salesBySource.map((_entry, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                {salesBySource.map((item, idx) => (
                  <div
                    key={item.name}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                    />
                    {item.name} ({item.value}%)
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 5. Active Projects (1 col) ──────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <Card className="h-full rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Briefcase className="h-5 w-5 text-teal-600" />
                Active Projects
                <Badge variant="secondary" className="ml-auto text-xs">
                  {activeProjects.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activeProjects.map((project) => {
                  const progressColor =
                    project.progress >= 75
                      ? 'bg-emerald-500'
                      : project.progress >= 50
                        ? 'bg-teal-500'
                        : project.progress >= 25
                          ? 'bg-amber-500'
                          : 'bg-rose-500';
                  return (
                    <div key={project.id} className="group space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="text-xs font-semibold bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
                              {getInitials(project.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium leading-tight">
                              {project.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {project.completedTaskCount}/{project.taskCount} tasks
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] capitalize shrink-0',
                            statusColorMap[project.status]
                          )}
                        >
                          {project.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-primary/20">
                          <div
                            className={cn(
                              'absolute inset-y-0 left-0 rounded-full transition-all',
                              progressColor
                            )}
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums">
                          {project.progress}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Due {formatShortDate(project.endDate)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 6. Upcoming Meetings (1 col) ────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
        >
          <Card className="h-full rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-5 w-5 text-rose-600" />
                Upcoming Meetings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {upcomingEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-lg border-l-4 bg-muted/40 p-3 transition-colors hover:bg-muted/70"
                    style={{ borderLeftColor: event.color }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium leading-tight truncate">
                          {event.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {event.allDay
                              ? 'All day'
                              : `${formatTime(event.startDate)} – ${formatTime(event.endDate)}`}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {event.location}
                          </span>
                        </div>
                      </div>
                      <span
                        className="mt-0.5 inline-block h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: event.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 7. Recent Activities (full width) ────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="md:col-span-2 lg:col-span-3"
        >
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-5 w-5 text-emerald-600" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <ScrollArea className="max-h-80 overflow-hidden px-4">
                <div className="space-y-1">
                  {activities.map((activity, idx) => {
                    const ActIcon = activityIconMap[activity.type] || CircleDot;
                    return (
                      <div
                        key={activity.id}
                        className={cn(
                          'group flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50',
                          idx < activities.length - 1 &&
                            'border-b border-border/50'
                        )}
                      >
                        {/* Activity type icon */}
                        <div
                          className={cn(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                            activityColorMap[activity.type]
                          )}
                        >
                          <ActIcon className="h-4 w-4" />
                        </div>

                        {/* User avatar */}
                        <Avatar className="mt-0.5 h-7 w-7 shrink-0">
                          <AvatarFallback className="text-[10px] font-semibold">
                            {getInitials(activity.userName)}
                          </AvatarFallback>
                        </Avatar>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-semibold">
                              {activity.userName}
                            </span>{' '}
                            <span className="text-muted-foreground">
                              {activity.description}
                            </span>
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {timeAgo(activity.createdAt)}
                            </span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                'text-[10px] font-medium',
                                moduleColorMap[activity.module] ||
                                  'bg-muted text-muted-foreground'
                              )}
                            >
                              {activity.module}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── 8. Quick Actions (full width) ────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.45 }}
          className="md:col-span-2 lg:col-span-3"
        >
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-5 w-5 text-amber-500" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Button
                  variant="outline"
                  className="h-auto flex flex-col items-center gap-2.5 rounded-xl border-dashed border-2 py-5 hover:border-emerald-400 hover:bg-emerald-50/50 hover:text-emerald-700 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
                  onClick={() => toast.success('New lead form opened')}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                    <UserPlus className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">New Lead</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto flex flex-col items-center gap-2.5 rounded-xl border-dashed border-2 py-5 hover:border-teal-400 hover:bg-teal-50/50 hover:text-teal-700 dark:hover:border-teal-600 dark:hover:bg-teal-950/30 dark:hover:text-teal-400"
                  onClick={() => toast.success('New project created')}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                    <FolderKanban className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">Create Project</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto flex flex-col items-center gap-2.5 rounded-xl border-dashed border-2 py-5 hover:border-emerald-400 hover:bg-emerald-50/50 hover:text-emerald-700 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
                  onClick={() => toast.success('New invoice created')}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                    <FileText className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">Add Invoice</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto flex flex-col items-center gap-2.5 rounded-xl border-dashed border-2 py-5 hover:border-teal-400 hover:bg-teal-50/50 hover:text-teal-700 dark:hover:border-teal-600 dark:hover:bg-teal-950/30 dark:hover:text-teal-400"
                  onClick={() => toast.success('Meeting scheduler opened')}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">Schedule Meeting</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}