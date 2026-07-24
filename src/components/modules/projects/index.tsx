'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  ListTodo, FolderKanban, Plus, MoreHorizontal, Pencil, Trash2,
  CheckCircle2, Clock, Loader2, CalendarDays,
} from 'lucide-react';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency, formatDate, getInitials } from '@/lib/format';
import { TASK_STATUSES, PROJECT_STATUSES } from '@/lib/constants';
import { createTaskSchema, createProjectSchema } from '@/lib/validations';
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
  assignee?: { id: string; firstName: string; lastName: string; email: string };
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
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; firstName: string; lastName: string; email: string };
  _count?: { tasks: number };
  tasks?: Task[];
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
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
  const [users, setUsers] = useState<User[]>([]);
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
  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('pageSize', '1');
      const res = await apiFetch<Task[]>(`/api/projects/tasks?${params.toString()}`);
      setStats((prev) => ({ ...prev, total: res.meta?.total || 0 }));

      // In progress count
      const res2 = await apiFetch<Task[]>('/api/projects/tasks?status=in-progress&page=1&pageSize=1');
      setStats((prev) => ({ ...prev, inProgress: res2.meta?.total || 0 }));

      // Completed count
      const res3 = await apiFetch<Task[]>('/api/projects/tasks?status=done&page=1&pageSize=1');
      setStats((prev) => ({ ...prev, completed: res3.meta?.total || 0 }));
    } catch {
      // silent
    }
  }, []);

  // Fetch users and projects for dropdowns
  const fetchDropdowns = useCallback(async () => {
    try {
      const [usersRes, projectsRes] = await Promise.all([
        apiFetch<User[]>('/api/admin/users?pageSize=100'),
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

  // Form
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<TaskFormValues>({
     
    resolver: zodResolver(createTaskSchema) as any,
    defaultValues: {
      title: '', description: '', status: 'todo', priority: 'medium',
      assigneeId: 'u1', projectId: '', dueDate: null as any, estimatedHours: 0, loggedHours: 0,
    },
  });

  // Open create dialog
  const openCreate = useCallback(() => {
    setEditingTask(null);
    reset({
      title: '', description: '', status: 'todo', priority: 'medium',
      assigneeId: 'u1', projectId: projects[0]?.id || '', dueDate: null as any,
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
                {getInitials(a.firstName, a.lastName)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm">{a.firstName} {a.lastName}</span>
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
      options: ['low', 'medium', 'high', 'critical'].map((p) => ({ value: p, label: PRIORITY_LABELS[p] || p })),
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
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue placeholder="Select assignee" /></SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.firstName} {u.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
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
  const [users, setUsers] = useState<User[]>([]);

  // Dialog state
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' });
      const res = await apiFetch<Project[]>(`/api/projects/projects?${params.toString()}`);
      setProjects(res.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const res = await apiFetch<User[]>('/api/admin/users?pageSize=100');
      setUsers(res.data || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => { fetchProjects(); fetchUsers(); }, [fetchProjects, fetchUsers]);

  // Form
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<ProjectFormValues>({
     
    resolver: zodResolver(createProjectSchema) as any,
    defaultValues: {
      name: '', description: '', status: 'planning', priority: 'medium',
      startDate: null as any, endDate: null as any, budget: 0, ownerId: 'u1',
    },
  });

  // Open create dialog
  const openCreate = useCallback(() => {
    setEditingProject(null);
    reset({
      name: '', description: '', status: 'planning', priority: 'medium',
      startDate: null as any, endDate: null as any, budget: 0, ownerId: 'u1',
    });
    setProjectDialogOpen(true);
  }, [reset]);

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
        await apiFetch('/api/projects/projects', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Project created');
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
            const taskCount = project._count?.tasks ?? 0;
            const doneCount = project.tasks?.filter((t) => t.status === 'done').length ?? 0;
            const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

            return (
              <Card
                key={project.id}
                className="group cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => openEdit(project)}
              >
                <CardContent className="p-5 flex flex-col gap-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground leading-tight line-clamp-1">
                      {project.name}
                    </h3>
                    <Badge variant="secondary" className={PROJECT_STATUS_COLORS[project.status] || ''}>
                      {PROJECT_STATUS_LABELS[project.status] || project.status}
                    </Badge>
                  </div>

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
                            {getInitials(project.owner.firstName, project.owner.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{project.owner.firstName} {project.owner.lastName}</span>
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
                <Label htmlFor="proj-start">Start Date</Label>
                <Input id="proj-start" type="date" {...register('startDate')} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="proj-end">End Date</Label>
                <Input id="proj-end" type="date" {...register('endDate')} />
              </div>
            </div>

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