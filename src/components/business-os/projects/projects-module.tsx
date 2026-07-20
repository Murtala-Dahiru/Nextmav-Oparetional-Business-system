'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Search, LayoutGrid, List, FolderKanban, GanttChart,
  Clock, Users, DollarSign, CalendarDays, ArrowUpDown,
  CheckCircle2, Circle, AlertCircle, Eye,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

import { projects, projectTasks } from '@/lib/mock-data';
import type { ProjectItem, ProjectTaskItem } from '@/types';

/* ---- helpers ---- */

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',
  high: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800',
  medium: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  low: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
};

const statusColors: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  'in-progress': 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800',
  review: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  done: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
};

const projectStatusColors: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
  completed: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800',
  'on-hold': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  planning: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800',
};

const projectBarColors: Record<string, string> = {
  active: 'bg-emerald-500',
  completed: 'bg-teal-500',
  'on-hold': 'bg-amber-400',
  planning: 'bg-purple-500',
};

const columnConfig = [
  { key: 'todo' as const, label: 'To Do', icon: Circle, dotColor: 'bg-gray-400' },
  { key: 'in-progress' as const, label: 'In Progress', icon: AlertCircle, dotColor: 'bg-teal-400' },
  { key: 'review' as const, label: 'Review', icon: Eye, dotColor: 'bg-amber-400' },
  { key: 'done' as const, label: 'Done', icon: CheckCircle2, dotColor: 'bg-green-400' },
];

/* ---- Sub-components ---- */

function TabHeader({ title, description, actionLabel }: { title: string; description: string; actionLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => toast.success(`${actionLabel} created`)}>
        <Plus className="h-4 w-4 mr-1.5" />{actionLabel}
      </Button>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border', priorityColors[priority] ?? 'bg-muted text-muted-foreground')}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border', statusColors[status] ?? 'bg-muted text-muted-foreground')}>
      {status === 'in-progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ProjectStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border', projectStatusColors[status] ?? 'bg-muted text-muted-foreground')}>
      {status === 'on-hold' ? 'On Hold' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function AvatarInitials({ name }: { name: string }) {
  const colors = ['bg-teal-500', 'bg-emerald-600', 'bg-cyan-600', 'bg-cyan-500', 'bg-violet-500'];
  const idx = name.length % colors.length;
  return (
    <div className={cn('flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-semibold text-white shrink-0', colors[idx])}>
      {getInitials(name)}
    </div>
  );
}

function MiniProgressBar({ logged, estimated }: { logged: number; estimated: number }) {
  const pct = estimated > 0 ? Math.min((logged / estimated) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{logged}h/{estimated}h</span>
    </div>
  );
}

/* ---- Kanban Task Card ---- */

function TaskCard({ task }: { task: ProjectTaskItem }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
      className="bg-card rounded-lg border border-border p-3 mb-2.5 cursor-pointer transition-colors"
    >
      <p className="text-sm font-semibold text-foreground mb-1.5 leading-snug">{task.title}</p>
      <p className="text-[11px] text-teal-600 font-medium mb-2">{task.projectName}</p>
      <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
        <PriorityBadge priority={task.priority} />
        {task.tags.map((tag) => (
          <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-100">
            {tag}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <AvatarInitials name={task.assigneeName} />
          <span className="text-[11px] text-muted-foreground hidden sm:inline">{task.assigneeName.split(' ')[0]}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <Clock className="h-3 w-3" />{task.loggedHours}h/{task.estimatedHours}h
          </span>
          <span className="flex items-center gap-0.5">
            <CalendarDays className="h-3 w-3" />{new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ---- Tab 1: Board (Kanban) ---- */

function BoardTab({ tasks }: { tasks: ProjectTaskItem[] }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return tasks;
    const q = search.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.projectName.toLowerCase().includes(q) ||
        t.assigneeName.toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const columns = useMemo(() => {
    return columnConfig.map((col) => {
      const colTasks = filtered.filter((t) => t.status === col.key);
      const totalHours = colTasks.reduce((s, t) => s + t.estimatedHours, 0);
      return { ...col, tasks: colTasks, totalHours };
    });
  }, [filtered]);

  return (
    <div>
      <TabHeader title="Task Board" description="Drag tasks across columns to update their status" actionLabel="New Task" />
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 max-w-sm" />
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <div key={col.key} className="min-w-[280px] w-[280px] shrink-0">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <div className={cn('h-2.5 w-2.5 rounded-full', col.dotColor)} />
                <span className="text-sm font-semibold text-foreground">{col.label}</span>
                <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-medium">{col.tasks.length}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">{col.totalHours}h</span>
            </div>
            <div className="bg-muted/40 rounded-xl p-2 min-h-[300px] border border-border">
              {col.tasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
              {col.tasks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No tasks</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Tab 2: List View ---- */

function ListViewTab({ tasks }: { tasks: ProjectTaskItem[] }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'priority' | 'dueDate' | 'title'>('priority');
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const filtered = useMemo(() => {
    let result = tasks;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.projectName.toLowerCase().includes(q) ||
          t.assigneeName.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      if (sortKey === 'priority') return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
      if (sortKey === 'dueDate') return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      return a.title.localeCompare(b.title);
    });
  }, [tasks, search, sortKey]);

  return (
    <div>
      <TabHeader title="Task List" description="View and manage all project tasks in a structured table" actionLabel="New Task" />
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortKey(sortKey === 'priority' ? 'dueDate' : sortKey === 'dueDate' ? 'title' : 'priority')}
        >
          <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
          Sort: {sortKey === 'priority' ? 'Priority' : sortKey === 'dueDate' ? 'Due Date' : 'Title'}
        </Button>
      </div>
      <div className="border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Priority</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assignee</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Due Date</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Progress</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((task, i) => (
              <TableRow key={task.id} className={cn('transition-colors', i % 2 === 0 ? 'bg-background' : 'bg-muted/30')}>
                <TableCell className="py-3">
                  <span className="text-sm font-semibold text-foreground">{task.title}</span>
                </TableCell>
                <TableCell className="py-3">
                  <span className="text-sm text-teal-600 font-medium">{task.projectName}</span>
                </TableCell>
                <TableCell className="py-3">
                  <StatusBadge status={task.status} />
                </TableCell>
                <TableCell className="py-3">
                  <PriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell className="py-3">
                  <div className="flex items-center gap-2">
                    <AvatarInitials name={task.assigneeName} />
                    <span className="text-sm text-foreground">{task.assigneeName}</span>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <span className="text-sm text-muted-foreground">{formatDate(task.dueDate)}</span>
                </TableCell>
                <TableCell className="py-3">
                  <MiniProgressBar logged={task.loggedHours} estimated={task.estimatedHours} />
                </TableCell>
                <TableCell className="py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    {task.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-100">
                        {tag}
                      </span>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No tasks match your search.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}

/* ---- Tab 3: Projects Grid ---- */

function ProjectsGridTab({ items }: { items: ProjectItem[] }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.ownerName.toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <div>
      <TabHeader title="Projects" description="Overview of all projects and their current progress" actionLabel="New Project" />
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((project) => (
          <motion.div
            key={project.id}
            whileHover={{ y: -4, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="bg-card rounded-xl border border-border p-5 cursor-pointer"
          >
            <div className="flex items-start justify-between mb-2">
              <h4 className="text-base font-semibold text-foreground leading-tight pr-2">{project.name}</h4>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2 leading-relaxed">{project.description}</p>
            <div className="flex items-center gap-2 mb-4">
              <PriorityBadge priority={project.priority} />
            </div>
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Progress</span>
                <span className={cn('font-semibold', project.progress >= 80 ? 'text-emerald-600' : project.progress >= 50 ? 'text-teal-600' : 'text-amber-600')}>
                  {project.progress}%
                </span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${project.progress}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className={cn('h-full rounded-full', project.progress >= 80 ? 'bg-emerald-500' : project.progress >= 50 ? 'bg-teal-500' : 'bg-amber-400')}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5 text-teal-500" />
                <span>{project.memberCount} members</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>{project.completedTaskCount}/{project.taskCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5 text-amber-500" />
                <span>{formatCurrency(project.budget)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border pt-3">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />{formatDate(project.startDate)}
              </span>
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />{formatDate(project.endDate)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border">
              <AvatarInitials name={project.ownerName} />
              <span className="text-xs font-medium text-muted-foreground">{project.ownerName}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---- Tab 4: Timeline ---- */

function TimelineTab({ items }: { items: ProjectItem[] }) {
  const allDates = useMemo(() => {
    const starts = items.map((p) => new Date(p.startDate).getTime());
    const ends = items.map((p) => new Date(p.endDate).getTime());
    return { min: Math.min(...starts), max: Math.max(...ends) };
  }, [items]);

  const totalSpan = allDates.max - allDates.min;

  function getLeft(startDate: string) {
    const ms = new Date(startDate).getTime() - allDates.min;
    return totalSpan > 0 ? (ms / totalSpan) * 100 : 0;
  }

  function getWidth(startDate: string, endDate: string) {
    const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
    return totalSpan > 0 ? Math.max((ms / totalSpan) * 100, 3) : 3;
  }

  const months = useMemo(() => {
    const start = new Date(allDates.min);
    const end = new Date(allDates.max);
    const result: string[] = [];
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      result.push(current.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
      current.setMonth(current.getMonth() + 1);
    }
    return result;
  }, [allDates]);

  return (
    <div>
      <TabHeader title="Timeline" description="Visualize project schedules and progress on a Gantt-like timeline" actionLabel="Add Project" />
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {/* Month header */}
        <div className="flex border-b border-border">
          <div className="w-52 shrink-0 px-4 py-3 border-r border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project</span>
          </div>
          <div className="flex-1 flex relative">
            {months.map((m, i) => {
              const monthStart = new Date(allDates.min);
              monthStart.setMonth(monthStart.getMonth() + i);
              const monthStartMs = monthStart.getTime() - allDates.min;
              const nextMonth = new Date(monthStart);
              nextMonth.setMonth(nextMonth.getMonth() + 1);
              const nextMonthMs = Math.min(nextMonth.getTime() - allDates.min, totalSpan);
              const widthPct = totalSpan > 0 ? ((nextMonthMs - monthStartMs) / totalSpan) * 100 : 0;
              return (
                <div
                  key={m}
                  className="flex items-center justify-center text-[11px] text-muted-foreground font-medium border-r border-border last:border-r-0"
                  style={{ width: `${widthPct}%` }}
                >
                  {m}
                </div>
              );
            })}
          </div>
        </div>
        {/* Rows */}
        {items.map((project, i) => (
          <div
            key={project.id}
            className={cn('flex items-center border-b border-border last:border-b-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/20')}
          >
            <div className="w-52 shrink-0 px-4 py-3.5 border-r border-border">
              <div className="flex items-center gap-2">
                <ProjectStatusBadge status={project.status} />
                <span className="text-sm font-medium text-foreground truncate">{project.name}</span>
              </div>
            </div>
            <div className="flex-1 py-3.5 px-2 relative" style={{ minHeight: '44px' }}>
              <div
                className="relative h-7 rounded-md overflow-hidden"
                style={{
                  position: 'absolute',
                  left: `${getLeft(project.startDate)}%`,
                  width: `${getWidth(project.startDate, project.endDate)}%`,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              >
                {/* Background bar */}
                <div className={cn('absolute inset-0 rounded-md opacity-20', projectBarColors[project.status] ?? 'bg-gray-400')} />
                {/* Progress fill */}
                <div
                  className={cn('absolute inset-y-0 left-0 rounded-md', projectBarColors[project.status] ?? 'bg-gray-400')}
                  style={{ width: `${project.progress}%` }}
                />
                {/* Label */}
                <span className="absolute inset-0 flex items-center px-2 text-[10px] font-semibold text-foreground truncate">
                  {project.progress}% — {formatDate(project.startDate).replace(/,\s*\d{4}$/, '')} to {formatDate(project.endDate).replace(/,\s*\d{4}$/, '')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Main Module ---- */

export default function ProjectsModule() {
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="board" className="flex-1 flex flex-col">
        <div className="px-6 pt-5 pb-0">
          <TabsList className="bg-muted p-1 h-10">
            <TabsTrigger value="board" className="text-xs gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <LayoutGrid className="h-3.5 w-3.5" />Board
            </TabsTrigger>
            <TabsTrigger value="list" className="text-xs gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <List className="h-3.5 w-3.5" />List View
            </TabsTrigger>
            <TabsTrigger value="projects" className="text-xs gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <FolderKanban className="h-3.5 w-3.5" />Projects
            </TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <GanttChart className="h-3.5 w-3.5" />Timeline
            </TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-6">
            <TabsContent value="board" className="mt-0">
              <BoardTab tasks={projectTasks} />
            </TabsContent>
            <TabsContent value="list" className="mt-0">
              <ListViewTab tasks={projectTasks} />
            </TabsContent>
            <TabsContent value="projects" className="mt-0">
              <ProjectsGridTab items={projects} />
            </TabsContent>
            <TabsContent value="timeline" className="mt-0">
              <TimelineTab items={projects} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}