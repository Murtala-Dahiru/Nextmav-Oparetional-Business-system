'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  ListTodo, FolderKanban, Plus, MoreHorizontal, Pencil, Trash2,
  CheckCircle2, Clock, Loader2, CalendarDays, AlertTriangle, ArrowLeft,
} from 'lucide-react';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency, formatDate, getInitials, initialsOf } from '@/lib/format';
import { TASK_STATUSES, PROJECT_STATUSES } from '@/lib/constants';
import { createTaskSchema, createProjectSchema } from '@/lib/validations';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { useAppStore } from '@/store/app-store';
import { z } from 'zod';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ProjectWorkspace } from '@/components/modules/projects/project-workspace';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string;
  projectId: string;
  dueDate: string | null;
  estimatedHours: number;
  loggedHours: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  assignee?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } };
  project?: { id: string; name: string };
}

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  ownerId: string;
  /** The CRM company this project is for, and the whole basis of portal access. */
  clientCompanyId: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } };
  client?: { id: string; name: string } | null;
  /**
   * Health metrics, merged in by the endpoint from `v_project_health`.
   *
   * The card used to derive progress in the browser from `_count.tasks` and
   * a `tasks[]` array, neither of which the API returned — so every project
   * displayed 0 tasks and 0%. These share their definition with the reports.
   */
  totalTasks?: number;
  completedTasks?: number;
  blockedTasks?: number;
  overdueTasks?: number;
  totalMilestones?: number;
  health?: string;
  memberCount?: number;
  completedMilestones?: number;
  overdueMilestones?: number;
  progressPct?: number;
  daysRemaining?: number | null;
  isAtRisk?: boolean;
}

/**
 * A colleague, as `/api/directory` returns them.
 *
 * ── What was wrong before ─────────────────────────────────────────────────
 *
 * This was `{ id, firstName, lastName, email }` and the data came from
 * `/api/admin/users`. Two separate faults compounded:
 *
 *   1. That endpoint requires the admin module. Managers, HR, support staff
 *      and employees all got a 403, so the dropdown was empty for everyone
 *      except owners and administrators — which reads as "this company has no
 *      staff" rather than as a permission error.
 *
 *   2. It returns rows from `v_org_directory`, which has `memberId` and
 *      `fullName` — not `id`, `firstName` or `lastName`. So even for an owner,
 *      every option rendered "undefined undefined" against a `SelectItem` with
 *      `value={undefined}`, which React drops silently.
 *
 * `memberId` is the correct identifier here: `tasks.assignee_id` and
 * `projects.owner_id` both reference `organization_members`, not the account.
 */
interface DirectoryMember {
  memberId: string;
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
}

type TaskFormValues = z.infer<typeof createTaskSchema>;
type ProjectFormValues = z.infer<typeof createProjectSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Color Maps
// ═══════════════════════════════════════════════════════════════════════════

const TASK_STATUS_COLORS: Record<string, string> = {
  todo: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  'in_progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  'in_progress': 'In Progress',
  review: 'Review',
  done: 'Done',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const PROJECT_STATUS_COLORS: Record<string, string> = {
  planning: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'on_hold': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  archived: 'bg-muted text-muted-foreground',
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  active: 'Active',
  'on_hold': 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/**
 * The `priority_level` enum, as the database defines it.
 *
 * Named once rather than repeated as a literal in three places, because it is
 * also the allow-list that keeps a mistyped priority in the organisation's
 * settings out of a form the database would then reject.
 */
const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical'];

function progressColor(pct: number): string {
  if (pct > 60) return '[&>div]:bg-emerald-500';
  if (pct >= 30) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-red-500';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helper: API wrapper
// ═══════════════════════════════════════════════════════════════════════════

async function apiFetch<T>(url: string, init?: RequestInit): Promise<{ data: T; meta?: ApiMeta }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Module
// ═══════════════════════════════════════════════════════════════════════════

export default function ProjectsModule() {
  const [activeTab, setActiveTab] = useState('tasks');

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 overflow-auto h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="tasks" className="gap-1.5">
            <ListTodo className="size-4" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="projects" className="gap-1.5">
            <FolderKanban className="size-4" /> Projects
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          <TasksTab />
        </TabsContent>
        <TabsContent value="projects" className="mt-4">
          <ProjectsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tasks Tab
// ═══════════════════════════════════════════════════════════════════════════

function TasksTab() {
  // Data state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<DirectoryMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // Table state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);

  // Dialog state
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Stats
  const [stats, setStats] = useState({ total: 0, inProgress: 0, completed: 0 });

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page + 1));
      params.set('pageSize', String(pageSize));
      if (search) params.set('search', search);

      // Apply column filters
      const statusFilter = columnFilters.find((f) => f.id === 'status')?.value as string | undefined;
      const priorityFilter = columnFilters.find((f) => f.id === 'priority')?.value as string | undefined;
      const projectFilter = columnFilters.find((f) => f.id === 'projectId')?.value as string | undefined;
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (projectFilter) params.set('projectId', projectFilter);

      // Apply sorting
      if (sorting.length > 0) {
        params.set('sort', sorting[0].id);
        params.set('sortDir', sorting[0].desc ? 'desc' : 'asc');
      }

      const res = await apiFetch<Task[]>(`/api/projects/tasks?${params.toString()}`);
      setTasks(res.data || []);
      setTotal(res.meta?.total || 0);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, columnFilters, sorting]);

  // Fetch all tasks for stats (no pagination)
  /**
   * The three counters above the table.
   *
   * ── Why this is one await and one setState ────────────────────────────────
   *
   * It was three sequential requests, each awaited before the next was sent,
   * each followed by its own `setStats`. Two costs, both avoidable:
   *
   *   · Latency was the sum of three round trips rather than the slowest of
   *     them. On a connection where a request takes 200ms the counters took
   *     600ms to settle, and this runs again on every realtime nudge.
   *   · Three state writes meant three renders of a table that had not changed,
   *     with the numbers visibly arriving one at a time.
   *
   * They are independent reads of the same endpoint, so there is no ordering to
   * preserve. `Promise.all` makes it one round trip's wait, and building the
   * whole object before setting it makes it one render.
   *
   * Still three requests rather than one aggregate endpoint: `pageSize=1` means
   * each returns a single row and a count, the endpoint is already indexed on
   * `(organization_id, status)`, and inventing a counts endpoint for one screen
   * is a worse trade than three cheap parallel reads.
   */
  const fetchStats = useCallback(async () => {
    try {
      const [all, inProgress, done] = await Promise.all([
        apiFetch<Task[]>('/api/projects/tasks?page=1&pageSize=1'),
        apiFetch<Task[]>('/api/projects/tasks?status=in_progress&page=1&pageSize=1'),
        apiFetch<Task[]>('/api/projects/tasks?status=done&page=1&pageSize=1'),
      ]);
      setStats({
        total: all.meta?.total || 0,
        inProgress: inProgress.meta?.total || 0,
        completed: done.meta?.total || 0,
      });
    } catch {
      // Counters are not worth interrupting anyone over; the table still loads.
    }
  }, []);

  // Fetch users and projects for dropdowns
  const fetchDropdowns = useCallback(async () => {
    try {
      const [usersRes, projectsRes] = await Promise.all([
        apiFetch<DirectoryMember[]>('/api/directory'),
        apiFetch<Project[]>('/api/projects/projects?page=1&pageSize=100'),
      ]);
      setUsers(usersRes.data || []);
      setProjects(projectsRes.data || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchStats(); fetchDropdowns(); }, [fetchStats, fetchDropdowns]);

  /**
   * A task completed anywhere changes this table and its three counters.
   *
   * `projects` is watched too, because the table's Project column renders the
   * project's name — renaming one leaves every row referring to it stale.
   */
  useModuleRealtime('tasks', ['tasks', 'projects'], () => {
    fetchTasks();
    fetchStats();
  });

  // Form
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<TaskFormValues>({
     
    resolver: zodResolver(createTaskSchema) as any,
    defaultValues: {
      title: '', description: '', status: 'todo', priority: 'medium',
      assigneeId: undefined, projectId: '', dueDate: null as any, estimatedHours: 0, loggedHours: 0,
    },
  });

  // Open create dialog
  const openCreate = useCallback(() => {
    setEditingTask(null);
    reset({
      title: '', description: '', status: 'todo', priority: 'medium',
      assigneeId: undefined, projectId: projects[0]?.id || '', dueDate: null as any,
      estimatedHours: 0, loggedHours: 0,
    });
    setTaskDialogOpen(true);
  }, [reset, projects]);

  // Open edit dialog
  const openEdit = useCallback((task: Task) => {
    setEditingTask(task);
    reset({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      projectId: task.projectId,
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : null as any,
      estimatedHours: task.estimatedHours,
      loggedHours: task.loggedHours,
    });
    setTaskDialogOpen(true);
  }, [reset]);

  // Submit
  const onSubmit = useCallback(async (values: TaskFormValues) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        dueDate: values.dueDate || null,
        loggedHours: values.loggedHours ?? 0,
        sortOrder: values.sortOrder ?? 0,
      };
      if (editingTask) {
        await apiFetch(`/api/projects/tasks/${editingTask.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Task updated');
      } else {
        await apiFetch('/api/projects/tasks', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Task created');
      }
      setTaskDialogOpen(false);
      fetchTasks();
      fetchStats();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [editingTask, fetchTasks, fetchStats]);

  // Delete
  const confirmDelete = useCallback(() => {
    if (!deletingTask) return;
    setDeleting(true);
    apiFetch(`/api/projects/tasks/${deletingTask.id}`, { method: 'DELETE' })
      .then(() => {
        toast.success('Task deleted');
        setDeleteDialogOpen(false);
        setDeletingTask(null);
        fetchTasks();
        fetchStats();
      })
      .catch((err: any) => toast.error(err.message || 'Delete failed'))
      .finally(() => setDeleting(false));
  }, [deletingTask, fetchTasks, fetchStats]);

  // Table columns
  const columns = useMemo<ColumnDef<Task, any>[]>(() => [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.title}</span>
      ),
    },
    {
      accessorKey: 'project.name',
      id: 'project',
      header: 'Project',
      cell: ({ row }) => row.original.project ? (
        <Badge variant="outline" className="font-normal text-xs">{row.original.project.name}</Badge>
      ) : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      accessorKey: 'assignee',
      id: 'assignee',
      header: 'Assignee',
      cell: ({ row }) => {
        const a = row.original.assignee;
        return a ? (
          <div className="flex items-center gap-2">
            <Avatar className="size-6">
              <AvatarFallback className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {initialsOf(a.profiles?.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm">{a.profiles?.fullName || 'Unassigned'}</span>
          </div>
        ) : <span className="text-muted-foreground text-sm">—</span>;
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = row.original.status;
        return (
          <Badge variant="secondary" className={TASK_STATUS_COLORS[s] || ''}>
            {TASK_STATUS_LABELS[s] || s}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      cell: ({ row }) => {
        const p = row.original.priority;
        return (
          <Badge variant="secondary" className={PRIORITY_COLORS[p] || ''}>
            {PRIORITY_LABELS[p] || p}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => row.original.dueDate
        ? <span className="text-sm">{formatDate(row.original.dueDate)}</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      id: 'hours',
      header: 'Hours',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.loggedHours}/{row.original.estimatedHours}h
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 50,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEdit(row.original)}>
              <Pencil className="size-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => { setDeletingTask(row.original); setDeleteDialogOpen(true); }}
            >
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [openEdit]);

  // Filters for DataTable
  const filters = useMemo<DataTableFilter[]>(() => [
    {
      key: 'status',
      label: 'Status',
      options: TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] || s })),
    },
    {
      key: 'priority',
      label: 'Priority',
      options: PRIORITY_VALUES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] || p })),
    },
    {
      key: 'projectId',
      label: 'Project',
      options: projects.map((p) => ({ value: p.id, label: p.name })),
    },
  ], [projects]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader title="Tasks" icon={ListTodo}>
        <Button onClick={openCreate} className="bg-emerald-600 text-white hover:bg-emerald-700 gap-1.5">
          <Plus className="size-4" /> New Task
        </Button>
      </PageHeader>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Tasks" value={stats.total} icon={ListTodo} />
        <StatCard label="In Progress" value={stats.inProgress} icon={Clock} />
        <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={tasks}
        searchKey="title"
        searchPlaceholder="Search tasks..."
        filters={filters}
        isLoading={loading}
        emptyMessage="No tasks found. Create your first task!"
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        onFilterChange={(f) => { setColumnFilters(f); setPage(0); }}
        onSortChange={(s) => { setSorting(s); setPage(0); }}
      />

      {/* Create / Edit Dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? 'Edit Task' : 'New Task'}</DialogTitle>
            <DialogDescription>
              {editingTask ? 'Update task details below.' : 'Fill in the details to create a new task.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="task-title">Title *</Label>
              <Input id="task-title" {...register('title')} placeholder="Task title" />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-desc">Description</Label>
              <Textarea id="task-desc" {...register('description')} rows={3} placeholder="Task description" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s] || s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['low', 'medium', 'high', 'critical'].map((p) => (
                          <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assignee</Label>
                <Controller
                  control={control}
                  name="assigneeId"
                  render={({ field }) => (
                    <Select
                      value={field.value || '_unassigned'}
                      onValueChange={(v) => field.onChange(v === '_unassigned' ? undefined : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        {/*
                          Explicitly unassigned, rather than leaving the field
                          blank. Radix Select treats "" as "no value" and shows
                          the placeholder, so there was no way to *clear* an
                          assignee once one had been chosen.
                        */}
                        <SelectItem value="_unassigned">Unassigned</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.memberId} value={u.memberId}>
                            {u.fullName}
                            {u.jobTitle && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {u.jobTitle}
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {/*
                  An empty directory is a real state — a one-person workspace —
                  and silence looks identical to the permission failure this
                  picker used to have. Say which it is.
                */}
                {users.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No colleagues found in this workspace yet.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Project *</Label>
                <Controller
                  control={control}
                  name="projectId"
                  render={({ field }) => (
                    <Select value={field.value || '_none'} onValueChange={(v) => field.onChange(v === '_none' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.projectId && <p className="text-sm text-destructive">{errors.projectId.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="task-due">Due Date</Label>
                <Input id="task-due" type="date" {...register('dueDate')} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-hours">Estimated Hours</Label>
                <Input id="task-hours" type="number" step="0.5" min="0" {...register('estimatedHours', { valueAsNumber: true })} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTaskDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {saving && <Loader2 className="size-4 animate-spin mr-1.5" />}
                {editingTask ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Task"
        description={`Are you sure you want to delete "${deletingTask?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={deleting}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Projects Tab
// ═══════════════════════════════════════════════════════════════════════════

function ProjectsTab() {
  // Data state
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<DirectoryMember[]>([]);
  /**
   * CRM companies, for the client picker.
   *
   * Read from the CRM rather than a separate client list: a client *is* a
   * company in the CRM, and keeping a second directory of customers is how the
   * two drift apart.
   */
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  /**
   * Which project's workspace is open, if any.
   *
   * Held here rather than routed, to match how the rest of the shell works:
   * modules are swapped inside one page and there are no per-module routes to
   * hang a project id off. The notification deep-link parameter is picked up
   * below so a "new message on X" click still lands on the right project.
   */
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  /**
   * The organisation's project vocabulary, from the Admin module.
   *
   * ── What was wrong ────────────────────────────────────────────────────────
   *
   * `project_defaults` holds statuses, priorities, a default status, a default
   * priority and a set of templates. The administration screen renders and
   * saves all of it, `org-settings.ts` validates it, and the settings endpoint
   * stores it — and this form read none of it. The status list came from a
   * constant, the priority list from an array literal, and a new project always
   * opened as `planning` / `medium` whatever an administrator had chosen.
   *
   * An organisation that renamed its stages saw the change on the settings
   * screen and nowhere else, which is precisely the "settings that are stored
   * but never read" problem the platform is supposed to have finished with.
   *
   * Falls back to the constants when a policy row has not been written yet, so
   * a workspace created before this existed still has a usable form.
   */
  const policies = useAppStore(s => s.organization?.policies);
  const projectDefaults = (policies?.projectDefaults ?? {}) as {
    statuses?: string[];
    priorities?: string[];
    defaultStatus?: string;
    defaultPriority?: string;
    templates?: { name: string; description: string; milestones: string[] }[];
  };

  const statusOptions = useMemo(() => {
    const configured = (projectDefaults.statuses ?? [])
      .filter(s => (PROJECT_STATUSES as readonly string[]).includes(s));
    return configured.length ? configured : [...PROJECT_STATUSES];
  }, [projectDefaults.statuses]);

  const priorityOptions = useMemo(() => {
    const configured = (projectDefaults.priorities ?? [])
      .filter(p => PRIORITY_VALUES.includes(p));
    return configured.length ? configured : PRIORITY_VALUES;
  }, [projectDefaults.priorities]);

  /**
   * Only offer a default the list actually contains.
   *
   * An administrator can remove `planning` from the statuses without touching
   * `defaultStatus`, and a Radix Select whose value is not among its items shows
   * the placeholder — so the form would open apparently blank on a required
   * field.
   */
  const defaultStatus = statusOptions.includes(projectDefaults.defaultStatus ?? '')
    ? projectDefaults.defaultStatus!
    : statusOptions[0];
  const defaultPriority = priorityOptions.includes(projectDefaults.defaultPriority ?? '')
    ? projectDefaults.defaultPriority!
    : (priorityOptions.includes('medium') ? 'medium' : priorityOptions[0]);

  const templates = projectDefaults.templates ?? [];
  /** Which template a new project is being created from, if any. */
  const [templateName, setTemplateName] = useState<string>('');

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get('project');
    if (fromLink) setOpenProjectId(fromLink);
  }, []);

  // Dialog state
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * Fetch projects. `silent` refreshes in place, for a realtime nudge.
   *
   * Without it, a colleague completing a task would replace the whole board
   * with six skeleton cards for the length of a request — a visible flicker
   * caused by somebody else's work, which is worse than the staleness it fixes.
   * A failure on a silent refresh is also not worth a toast: the board still
   * shows the last good data.
   */
  const fetchProjects = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' });
      const res = await apiFetch<Project[]>(`/api/projects/projects?${params.toString()}`);
      setProjects(res.data || []);
    } catch (err: any) {
      if (!silent) toast.error(err.message || 'Failed to load projects');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const [dir, cos] = await Promise.all([
        apiFetch<DirectoryMember[]>('/api/directory'),
        /**
         * Companies are best-effort.
         *
         * A role that can create projects but has no CRM access — `manager`
         * holds projects at department scope and CRM only at `WRITE`, but a
         * future role need not — should still get the project form. It simply
         * cannot attach a client, and the picker says so rather than the whole
         * dialog failing to populate.
         */
        apiFetch<{ id: string; name: string }[]>('/api/crm/companies?pageSize=100')
          .catch(() => ({ data: [] as { id: string; name: string }[] })),
      ]);
      setUsers(dir.data || []);
      setCompanies(cos.data || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => { fetchProjects(); fetchUsers(); }, [fetchProjects, fetchUsers]);

  /**
   * Every card shows progress, health and task counts computed by
   * `v_project_health`, so the board is stale after a write to any of the
   * tables that view reads. This is "project edited — immediately updates
   * everywhere" and "task completed — project progress updates immediately",
   * for the board rather than one project.
   *
   * Suspended while a project's workspace is open: that screen has its own,
   * narrower subscription, and refetching a hundred cards behind it is work
   * nobody can see.
   */
  useModuleRealtime(
    'projects-board',
    ['projects', 'tasks', 'milestones', 'files'],
    () => fetchProjects(true),
    !openProjectId,
  );

  // Form
  const { register, handleSubmit, control, reset, setValue, formState: { errors } } = useForm<ProjectFormValues>({
     
    resolver: zodResolver(createProjectSchema) as any,
    defaultValues: {
      name: '', description: '', status: 'planning', priority: 'medium',
      startDate: null as any, endDate: null as any, budget: 0, ownerId: undefined,
      clientCompanyId: null as any,
    },
  });

  // Open create dialog
  const openCreate = useCallback(() => {
    setEditingProject(null);
    setTemplateName('');
    reset({
      name: '', description: '', status: defaultStatus, priority: defaultPriority,
      startDate: null as any, endDate: null as any, budget: 0, ownerId: undefined,
      clientCompanyId: null as any,
    });
    setProjectDialogOpen(true);
  }, [reset, defaultStatus, defaultPriority]);

  /**
   * Applying a template fills the form; it does not create anything yet.
   *
   * The phases are created after the project is, in `onSubmit`, because a
   * milestone needs a project id. Filling the description too, since a template
   * that only sets a name is barely a template — and it is left editable,
   * because a template is a starting point rather than a form the user is
   * locked into.
   */
  const applyTemplate = useCallback((name: string) => {
    setTemplateName(name);
    const t = templates.find(x => x.name === name);
    if (!t) return;
    setValue('name', t.name);
    if (t.description) setValue('description', t.description);
  }, [templates, setValue]);

  // Open edit dialog (click card)
  const openEdit = useCallback((project: Project) => {
    setEditingProject(project);
    reset({
      name: project.name,
      description: project.description,
      status: project.status,
      priority: project.priority,
      startDate: project.startDate ? project.startDate.slice(0, 10) : null as any,
      endDate: project.endDate ? project.endDate.slice(0, 10) : null as any,
      budget: project.budget,
      ownerId: project.ownerId,
      // Carried into the edit form so opening a linked project and saving it
      // does not silently unlink the client.
      clientCompanyId: (project.clientCompanyId ?? null) as any,
    });
    setProjectDialogOpen(true);
  }, [reset]);

  // Submit
  const onSubmit = useCallback(async (values: ProjectFormValues) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
      };
      if (editingProject) {
        await apiFetch(`/api/projects/projects/${editingProject.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Project updated');
      } else {
        // `apiFetch` returns the whole envelope; the project is on `.data`.
        const { data: created } = await apiFetch<Project>('/api/projects/projects', {
          method: 'POST', body: JSON.stringify(payload),
        });

        /**
         * A template's phases, created against the new project.
         *
         * Sequentially rather than in parallel: `sort_order` is what puts a
         * roadmap in the order somebody wrote it, and firing five creates at
         * once means five rows whose order depends on which request the database
         * happens to serve first.
         *
         * A failure here is reported but does not undo the project. Losing a
         * project because one of its phases could not be written would be a far
         * worse outcome than a roadmap the user has to finish by hand, and the
         * message says which happened.
         */
        const template = templates.find(t => t.name === templateName);
        const phases = template?.milestones ?? [];
        if (created?.id && phases.length) {
          try {
            for (let i = 0; i < phases.length; i++) {
              await apiFetch('/api/projects/milestones', {
                method: 'POST',
                body: JSON.stringify({
                  projectId: created.id, name: phases[i], sortOrder: i,
                }),
              });
            }
            toast.success(`Project created with ${phases.length} phases`);
          } catch {
            toast.warning('Project created, but its phases could not be added.');
          }
        } else {
          toast.success('Project created');
        }
      }
      setProjectDialogOpen(false);
      fetchProjects();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [editingProject, fetchProjects]);

  // Delete
  const confirmDelete = useCallback(() => {
    if (!deletingProject) return;
    setDeleting(true);
    apiFetch(`/api/projects/projects/${deletingProject.id}`, { method: 'DELETE' })
      .then(() => {
        toast.success('Project deleted');
        setDeleteDialogOpen(false);
        setDeletingProject(null);
        fetchProjects();
      })
      .catch((err: any) => toast.error(err.message || 'Delete failed'))
      .finally(() => setDeleting(false));
  }, [deletingProject, fetchProjects]);

  /**
   * The workspace replaces the board rather than opening beside it.
   *
   * A project has six panels of its own — overview, roadmap, team, timeline,
   * files, discussion — and none of them fit in a dialog. Taking over the
   * whole tab is what lets the roadmap be readable.
   */
  if (openProjectId) {
    return (
      <ProjectWorkspace
        projectId={openProjectId}
        directory={users}
        onBack={() => {
          setOpenProjectId(null);
          // Refreshed on the way out: milestones completed or members added
          // inside the workspace change the numbers on the card behind it.
          fetchProjects();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader title="Projects" icon={FolderKanban}>
        <Button onClick={openCreate} className="bg-emerald-600 text-white hover:bg-emerald-700 gap-1.5">
          <Plus className="size-4" /> New Project
        </Button>
      </PageHeader>

      {/* Project Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5 flex flex-col gap-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-2 w-full mt-2" />
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to get started."
          action={{ label: 'New Project', onClick: openCreate }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => {
            const taskCount = project.totalTasks ?? 0;
            const doneCount = project.completedTasks ?? 0;
            const pct = project.progressPct ?? 0;

            return (
              <Card
                key={project.id}
                className="group cursor-pointer transition-shadow hover:shadow-md"
                /*
                  Opens the project's workspace, not the edit form.
                  Clicking a project card and getting a settings dialog was
                  backwards: the common intent is "show me this project", and
                  editing its name and budget is the rare administrative act.
                  Editing moved to the menu in the corner.
                */
                onClick={() => setOpenProjectId(project.id)}
              >
                <CardContent className="p-5 flex flex-col gap-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground leading-tight line-clamp-1">
                      {project.name}
                    </h3>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="secondary" className={PROJECT_STATUS_COLORS[project.status] || ''}>
                        {PROJECT_STATUS_LABELS[project.status] || project.status}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 opacity-0 transition group-hover:opacity-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => openEdit(project)}>
                            <Pencil className="mr-2 size-4" /> Edit details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => { setDeletingProject(project); setDeleteDialogOpen(true); }}
                          >
                            <Trash2 className="mr-2 size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/*
                    The health verdict from v_project_health. `isAtRisk` was a
                    boolean the card never showed at all, so a project a month
                    past its deadline looked identical to one running to plan.
                  */}
                  {project.health && project.health !== 'on_track' && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'w-fit gap-1',
                        project.health === 'off_track'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                      )}
                    >
                      <AlertTriangle className="size-3" />
                      {project.health === 'off_track' ? 'Off track' : 'At risk'}
                    </Badge>
                  )}

                  {/* Description */}
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {project.description || 'No description'}
                  </p>

                  {/* Priority + Budget row */}
                  <div className="flex items-center justify-between text-sm">
                    <Badge variant="secondary" className={PRIORITY_COLORS[project.priority] || ''}>
                      {PRIORITY_LABELS[project.priority] || project.priority}
                    </Badge>
                    <span className="text-muted-foreground font-medium">
                      {formatCurrency(project.budget)}
                    </span>
                  </div>

                  {/* Progress */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{doneCount} of {taskCount} tasks done</span>
                      <span className="font-medium">{pct}%</span>
                    </div>
                    <Progress value={pct} className={`h-2 ${progressColor(pct)}`} />
                  </div>

                  {/* Date range + Owner */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" />
                      {project.startDate && project.endDate
                        ? `${formatDate(project.startDate, { month: 'short', day: 'numeric' })} – ${formatDate(project.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : project.startDate
                          ? `Starts ${formatDate(project.startDate)}`
                          : 'No dates set'}
                    </div>
                    {project.owner && (
                      <div className="flex items-center gap-1.5">
                        <Avatar className="size-5">
                          <AvatarFallback className="text-[8px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            {initialsOf(project.owner.profiles?.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{project.owner.profiles?.fullName || 'Unassigned'}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProject ? 'Edit Project' : 'New Project'}</DialogTitle>
            <DialogDescription>
              {editingProject ? 'Update project details below.' : 'Fill in the details to create a new project.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {/*
              Project templates, from the organisation's own settings.

              Offered only when creating: applying a template to an existing
              project would either duplicate its phases or silently replace
              them, and neither is what anybody means by the word. Hidden
              entirely when none are configured, rather than showing an empty
              picker that reads as a broken control.
            */}
            {!editingProject && templates.length > 0 && (
              <div className="space-y-2">
                <Label>Start from a template</Label>
                <Select
                  value={templateName || '_blank'}
                  onValueChange={(v) => (v === '_blank' ? setTemplateName('') : applyTemplate(v))}
                >
                  <SelectTrigger><SelectValue placeholder="Blank project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_blank">Blank project</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {templateName && (
                  <p className="text-xs text-muted-foreground">
                    {(templates.find(t => t.name === templateName)?.milestones ?? []).length} phases
                    will be created with this project:{' '}
                    {(templates.find(t => t.name === templateName)?.milestones ?? []).join(' → ')}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="proj-name">Name *</Label>
              <Input id="proj-name" {...register('name')} placeholder="Project name" />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="proj-desc">Description</Label>
              <Textarea id="proj-desc" {...register('description')} rows={3} placeholder="Project description" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROJECT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{PROJECT_STATUS_LABELS[s] || s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {priorityOptions.map((p) => (
                          <SelectItem key={p} value={p}>{PRIORITY_LABELS[p] || p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="proj-start">Start Date</Label>
                <Input id="proj-start" type="date" {...register('startDate')} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="proj-end">End Date</Label>
                <Input id="proj-end" type="date" {...register('endDate')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="proj-budget">Budget</Label>
                <Input
                  id="proj-budget"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('budget', { valueAsNumber: true })}
                  placeholder="0"
                />
              </div>

              {/*
                The owner picker. The directory was already being fetched here
                and nothing rendered it, so a project's owner could only ever
                be whoever created it — the endpoint defaults `owner_id` to the
                caller. Accountability for a project is rarely the person who
                happened to type it in.
              */}
              <div className="space-y-2">
                <Label>Owner</Label>
                <Controller
                  control={control}
                  name="ownerId"
                  render={({ field }) => (
                    <Select
                      value={field.value || '_me'}
                      onValueChange={(v) => field.onChange(v === '_me' ? undefined : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="You" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_me">Me</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.memberId} value={u.memberId}>
                            {u.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {/*
              ── The client, and what selecting one actually does ────────────

              This is the link between the CRM and the client portal, and it
              was the missing piece that made the portal look broken.
              `projects.client_company_id` has existed since the first business
              migration and every portal read resolves through it — but no form
              ever set it, so it was null on every project and a client who
              signed in correctly saw an empty portal.

              Choosing a company here grants that customer's portal accounts
              visibility of this project immediately: the RLS policy
              `projects_client_select` matches on this column against
              `auth_client_company_id()`. There is no separate permission to
              grant and no second progress figure — the portal reads the same
              `v_project_health` row the board does, so the two can never
              disagree.
            */}
            <div className="space-y-2">
              <Label>Client</Label>
              <Controller
                control={control}
                name="clientCompanyId"
                render={({ field }) => (
                  <Select
                    value={field.value || '_internal'}
                    onValueChange={(v) => field.onChange(v === '_internal' ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Internal project — no client" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_internal">Internal — no client</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {companies.length === 0
                  ? 'No companies in the CRM yet — add one there to link a client.'
                  : 'The client’s portal accounts see this project’s roadmap, progress and shared files as soon as it is linked.'}
              </p>
            </div>

            {/* Delete button for editing */}
            {editingProject && (
              <div className="flex justify-end pt-2 border-t">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive gap-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjectDialogOpen(false);
                    setDeletingProject(editingProject);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="size-4" /> Delete Project
                </Button>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProjectDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {saving && <Loader2 className="size-4 animate-spin mr-1.5" />}
                {editingProject ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Project"
        description={`Are you sure you want to delete "${deletingProject?.name}"? All associated tasks will also be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={deleting}
      />
    </div>
  );
}