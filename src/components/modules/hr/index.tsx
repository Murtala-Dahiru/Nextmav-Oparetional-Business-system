'use client';

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  UserCog, UserPlus, Users, Clock, Building2, CheckCircle, XCircle,
  Pencil, Trash2, Plus, Loader2, MoreHorizontal, CalendarDays, ShieldCheck, ShieldX,
} from 'lucide-react';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { StatCard } from '@/components/shared/stat-card';
import { formatDate, formatRelativeTime, getInitials } from '@/lib/format';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Separator } from '@/components/ui/separator';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

interface UserRecord {
  id: string; email: string; firstName: string; lastName: string; avatar: string;
  jobTitle: string; phone: string; department: string; roleId: string;
  isActive: boolean; lastSeen: string; createdAt: string; updatedAt: string;
  role?: { id: string; name: string };
}

interface RoleRecord {
  id: string; name: string; description: string; isSystem: boolean;
  permissions: string; createdAt: string; _count?: { users: number };
}

interface LeaveRequest {
  id: string; requesterId: string; type: string; startDate: string; endDate: string;
  status: string; reason: string; approverId: string; createdAt: string; updatedAt: string;
  requester?: { id: string; firstName: string; lastName: string; avatar: string; department: string };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEPARTMENTS = [
  'Engineering', 'Sales', 'HR', 'Finance', 'Customer Success', 'Executive', 'Marketing', 'Operations',
];

const LEAVE_TYPES = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick Leave' },
  { value: 'personal', label: 'Personal' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'paternity', label: 'Paternity' },
];

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground',
};

const LEAVE_TYPE_COLORS: Record<string, string> = {
  vacation: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  sick: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  personal: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  maternity: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  paternity: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
};

const DEPARTMENT_FILTERS: DataTableFilter[] = [
  {
    key: 'department',
    label: 'Department',
    options: DEPARTMENTS.map((d) => ({ value: d, label: d })),
  },
  {
    key: 'isActive',
    label: 'Status',
    options: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
  },
];

const LEAVE_TYPE_FILTERS: DataTableFilter[] = [
  {
    key: 'type',
    label: 'Type',
    options: LEAVE_TYPES,
  },
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'approved', label: 'Approved' },
      { value: 'rejected', label: 'Rejected' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  API Helpers
// ═══════════════════════════════════════════════════════════════════════════

async function fetchList<T>(url: string): Promise<{ data: T[]; meta: ApiMeta }> {
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error((e as any).message || `Error ${res.status}`);
  }
  return res.json();
}

async function createRecord<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: 'Create failed' }));
    throw new Error((e as any).message || 'Create failed');
  }
  const json = await res.json();
  return json.data;
}

async function updateRecord<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: 'Update failed' }));
    throw new Error((e as any).message || 'Update failed');
  }
  const json = await res.json();
  return json.data;
}

async function deleteRecord(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: 'Delete failed' }));
    throw new Error((e as any).message || 'Delete failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Shared UI helpers
// ═══════════════════════════════════════════════════════════════════════════

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {error && <p className="text-red-500 text-xs">{error}</p>}
    </div>
  );
}

function StatusBadge({ status, colorMap }: { status: string; colorMap: Record<string, string> }) {
  return (
    <Badge variant="secondary" className={colorMap[status] || 'bg-muted text-muted-foreground'}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function computeDuration(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  const diffMs = e.getTime() - s.getTime();
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1);
}

function isDateInRange(dateStr: string, start: string, end: string): boolean {
  const d = new Date(dateStr);
  const s = new Date(start);
  const e = new Date(end);
  return d >= s && d <= e;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Employees Tab
// ═══════════════════════════════════════════════════════════════════════════

interface EmployeeFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  roleId: string;
}

const EMPLOYEE_DEFAULTS: EmployeeFormData = {
  firstName: '', lastName: '', email: '', phone: '',
  jobTitle: '', department: '', roleId: '',
};

function EmployeesTab() {
  // Table state
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersMeta, setUsersMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 10, totalPages: 0 });
  const [usersLoading, setUsersLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Stats
  const [activeCount, setActiveCount] = useState(0);
  const [onLeaveCount, setOnLeaveCount] = useState(0);
  const [deptCount, setDeptCount] = useState(0);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<UserRecord | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form, setForm] = useState<EmployeeFormData>(EMPLOYEE_DEFAULTS);

  // Roles
  const [roles, setRoles] = useState<RoleRecord[]>([]);

  // Fetch stats + roles
  const fetchStats = useCallback(async () => {
    try {
      const [allUsersRes, approvedLeavesRes] = await Promise.all([
        fetchList<UserRecord>('/api/admin/users?pageSize=100'),
        fetchList<LeaveRequest>('/api/hr/leave?status=approved&pageSize=1000'),
      ]);
      const allUsers = allUsersRes.data;
      setActiveCount(allUsers.filter((u) => u.isActive).length);
      const today = new Date().toISOString().split('T')[0];
      setOnLeaveCount(
        approvedLeavesRes.data.filter((l) => isDateInRange(today, l.startDate, l.endDate)).length,
      );
      const depts = new Set(allUsers.filter((u) => u.department).map((u) => u.department));
      setDeptCount(depts.size);
    } catch {
      // stats are non-critical
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetchList<RoleRecord>('/api/admin/roles?pageSize=100');
      setRoles(res.data);
    } catch {
      // non-critical
    }
  }, []);

  // Fetch paginated users
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page + 1));
      params.set('pageSize', String(pageSize));
      if (search) params.set('search', search);
      if (sorting[0]) {
        params.set('sort', sorting[0].id);
        params.set('sortDir', sorting[0].desc ? 'desc' : 'asc');
      }
      columnFilters.forEach((f) => {
        params.set(f.id, String(f.value));
      });
      const res = await fetchList<UserRecord>(`/api/admin/users?${params}`);
      setUsers(res.data);
      setUsersMeta(res.meta);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load employees');
    } finally {
      setUsersLoading(false);
    }
  }, [page, pageSize, search, sorting, columnFilters]);

  useEffect(() => {
    fetchStats();
    fetchRoles();
  }, [fetchStats, fetchRoles]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Column definitions
  const columns: ColumnDef<UserRecord>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {getInitials(u.firstName, u.lastName)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium whitespace-nowrap">{u.firstName} {u.lastName}</span>
          </div>
        );
      },
    },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'phone', header: 'Phone' },
    { accessorKey: 'jobTitle', header: 'Job Title' },
    { accessorKey: 'department', header: 'Department' },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => row.original.role?.name || '—',
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={row.original.isActive
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            : 'bg-muted text-muted-foreground'}
        >
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      accessorKey: 'lastSeen',
      header: 'Last Seen',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {formatRelativeTime(row.original.lastSeen)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 48,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setSelected(row.original); setForm({ firstName: row.original.firstName, lastName: row.original.lastName, email: row.original.email, phone: row.original.phone, jobTitle: row.original.jobTitle, department: row.original.department, roleId: row.original.roleId }); setEditOpen(true); }}>
              <Pencil className="size-4 mr-2" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={() => { setSelected(row.original); setDeleteOpen(true); }}>
              <Trash2 className="size-4 mr-2" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], []);

  // Create handler
  const handleCreate = async () => {
    if (!form.firstName || !form.lastName || !form.email) {
      toast.error('First name, last name, and email are required');
      return;
    }
    setFormLoading(true);
    try {
      await createRecord('/api/admin/users', { ...form, password: 'changeme' });
      toast.success('Employee created successfully');
      setCreateOpen(false);
      setForm(EMPLOYEE_DEFAULTS);
      fetchUsers();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create employee');
    } finally {
      setFormLoading(false);
    }
  };

  // Edit handler
  const handleEdit = async () => {
    if (!selected) return;
    setFormLoading(true);
    try {
      await updateRecord(`/api/admin/users/${selected.id}`, form);
      toast.success('Employee updated successfully');
      setEditOpen(false);
      setSelected(null);
      fetchUsers();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update employee');
    } finally {
      setFormLoading(false);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!selected) return;
    setFormLoading(true);
    try {
      await deleteRecord(`/api/admin/users/${selected.id}`);
      toast.success('Employee deleted successfully');
      setDeleteOpen(false);
      setSelected(null);
      fetchUsers();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete employee');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader title="HR Management" icon={UserCog}>
        <Button onClick={() => { setForm(EMPLOYEE_DEFAULTS); setCreateOpen(true); }} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <UserPlus className="size-4 mr-2" />Add Employee
        </Button>
      </PageHeader>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Employees" value={usersMeta.total} icon={Users} />
        <StatCard label="Active" value={activeCount} icon={CheckCircle} />
        <StatCard label="On Leave" value={onLeaveCount} icon={CalendarDays} />
        <StatCard label="Departments" value={deptCount} icon={Building2} />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={users}
        isLoading={usersLoading}
        searchPlaceholder="Search employees..."
        filters={DEPARTMENT_FILTERS}
        total={usersMeta.total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        onSortChange={setSorting}
        onFilterChange={(f) => { setColumnFilters(f); setPage(0); }}
      />

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Employee</DialogTitle>
            <DialogDescription>Create a new employee account.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="First Name *">
              <Input value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} placeholder="John" />
            </Field>
            <Field label="Last Name *">
              <Input value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} placeholder="Doe" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email *">
                <Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="john@example.com" />
              </Field>
            </div>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+1 555-0100" />
            </Field>
            <Field label="Job Title">
              <Input value={form.jobTitle} onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))} placeholder="Software Engineer" />
            </Field>
            <Field label="Department">
              <Select value={form.department} onValueChange={(v) => setForm((p) => ({ ...p, department: v }))}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Role">
              <Select value={form.roleId} onValueChange={(v) => setForm((p) => ({ ...p, roleId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={formLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {formLoading && <Loader2 className="size-4 mr-2 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>Update employee information.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <Field label="First Name *">
              <Input value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} />
            </Field>
            <Field label="Last Name *">
              <Input value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email *">
                <Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              </Field>
            </div>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            <Field label="Job Title">
              <Input value={form.jobTitle} onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))} />
            </Field>
            <Field label="Department">
              <Select value={form.department} onValueChange={(v) => setForm((p) => ({ ...p, department: v }))}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Role">
              <Select value={form.roleId} onValueChange={(v) => setForm((p) => ({ ...p, roleId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            {selected && (
              <div className="sm:col-span-2 flex items-center gap-3 pt-2">
                <Switch
                  checked={selected.isActive}
                  onCheckedChange={(checked) => {
                    setSelected((prev) => prev ? { ...prev, isActive: checked } : prev);
                  }}
                />
                <Label>Active</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setSelected(null); }}>Cancel</Button>
            <Button onClick={handleEdit} disabled={formLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {formLoading && <Loader2 className="size-4 mr-2 animate-spin" />}Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Employee"
        description={`Are you sure you want to delete ${selected?.firstName} ${selected?.lastName}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={formLoading}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Leave Management Tab
// ═══════════════════════════════════════════════════════════════════════════

interface LeaveFormData {
  requesterId: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
}

const LEAVE_DEFAULTS: LeaveFormData = {
  requesterId: '', type: 'vacation', startDate: '', endDate: '', reason: '',
};

function LeaveTab() {
  // Data state
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [leavesLoading, setLeavesLoading] = useState(false);

  // All leaves (for stats)
  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);

  // Users (for requester select)
  const [usersList, setUsersList] = useState<UserRecord[]>([]);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<LeaveFormData>(LEAVE_DEFAULTS);
  const [formLoading, setFormLoading] = useState(false);

  // Stats
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedThisMonth, setApprovedThisMonth] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);

  // Fetch all leaves for stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetchList<LeaveRequest>('/api/hr/leave?pageSize=1000');
      setAllLeaves(res.data);
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      setPendingCount(res.data.filter((l) => l.status === 'pending').length);
      setApprovedThisMonth(
        res.data.filter((l) => {
          if (l.status !== 'approved') return false;
          const d = new Date(l.startDate);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        }).length,
      );
      setRejectedCount(res.data.filter((l) => l.status === 'rejected').length);
    } catch {
      // non-critical
    }
  }, []);

  // Fetch leaves for table (client-side, use all data)
  const fetchLeaves = useCallback(async () => {
    setLeavesLoading(true);
    try {
      const res = await fetchList<LeaveRequest>('/api/hr/leave?pageSize=1000');
      setLeaves(res.data);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load leave requests');
    } finally {
      setLeavesLoading(false);
    }
  }, []);

  // Fetch users for requester select
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetchList<UserRecord>('/api/admin/users?pageSize=100');
      setUsersList(res.data);
      if (res.data.length > 0 && !form.requesterId) {
        setForm((p) => ({ ...p, requesterId: res.data[0].id }));
      }
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchLeaves();
    fetchUsers();
  }, [fetchStats, fetchLeaves, fetchUsers]);

  // Column definitions
  const columns: ColumnDef<LeaveRequest>[] = useMemo(() => [
    {
      accessorKey: 'requester',
      header: 'Requester',
      cell: ({ row }) => {
        const r = row.original.requester;
        if (!r) return '—';
        return (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {getInitials(r.firstName, r.lastName)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium whitespace-nowrap">{r.firstName} {r.lastName}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => <StatusBadge status={row.original.type} colorMap={LEAVE_TYPE_COLORS} />,
    },
    {
      accessorKey: 'startDate',
      header: 'Start Date',
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.startDate)}</span>,
    },
    {
      accessorKey: 'endDate',
      header: 'End Date',
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.endDate)}</span>,
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: ({ row }) => (
        <span>{computeDuration(row.original.startDate, row.original.endDate)} days</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={LEAVE_STATUS_COLORS} />,
    },
    {
      id: 'actions',
      header: '',
      size: 120,
      cell: ({ row }) => {
        const leave = row.original;
        if (leave.status !== 'pending') return null;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950"
              onClick={async () => {
                try {
                  await updateRecord(`/api/hr/leave/${leave.id}`, { status: 'approved' });
                  toast.success('Leave request approved');
                  fetchLeaves();
                  fetchStats();
                } catch (e: any) {
                  toast.error(e.message || 'Failed to approve');
                }
              }}
            >
              <ShieldCheck className="size-3.5 mr-1" />Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              onClick={async () => {
                try {
                  await updateRecord(`/api/hr/leave/${leave.id}`, { status: 'rejected' });
                  toast.success('Leave request rejected');
                  fetchLeaves();
                  fetchStats();
                } catch (e: any) {
                  toast.error(e.message || 'Failed to reject');
                }
              }}
            >
              <ShieldX className="size-3.5 mr-1" />Reject
            </Button>
          </div>
        );
      },
    },
  ], [fetchLeaves, fetchStats]);

  // Create handler
  const handleCreate = async () => {
    if (!form.requesterId || !form.startDate || !form.endDate) {
      toast.error('Requester, start date, and end date are required');
      return;
    }
    if (new Date(form.endDate) < new Date(form.startDate)) {
      toast.error('End date must be after start date');
      return;
    }
    setFormLoading(true);
    try {
      await createRecord('/api/hr/leave', form);
      toast.success('Leave request submitted');
      setCreateOpen(false);
      setForm(LEAVE_DEFAULTS);
      fetchLeaves();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit leave request');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader title="Leave Management" icon={CalendarDays}>
        <Button onClick={() => { setForm(LEAVE_DEFAULTS); setCreateOpen(true); }} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="size-4 mr-2" />Request Leave
        </Button>
      </PageHeader>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending" value={pendingCount} icon={Clock} />
        <StatCard label="Approved (This Month)" value={approvedThisMonth} icon={CheckCircle} />
        <StatCard label="Rejected" value={rejectedCount} icon={XCircle} />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={leaves}
        isLoading={leavesLoading}
        searchPlaceholder="Search leave requests..."
        filters={LEAVE_TYPE_FILTERS}
      />

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Request Leave</DialogTitle>
            <DialogDescription>Submit a new leave request.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <Field label="Requester *">
              <Select value={form.requesterId} onValueChange={(v) => setForm((p) => ({ ...p, requesterId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent className="max-h-48 overflow-y-auto">
                  {usersList.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Type">
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start Date *">
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                />
              </Field>
              <Field label="End Date *">
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Reason">
              <Textarea
                value={form.reason}
                onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                placeholder="Provide reason for leave..."
                rows={3}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={formLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {formLoading && <Loader2 className="size-4 mr-2 animate-spin" />}Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main HR Module
// ═══════════════════════════════════════════════════════════════════════════

export default function HrModule() {
  const [activeTab, setActiveTab] = useState('employees');

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 md:p-6 overflow-auto">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="overflow-x-auto w-full sm:w-auto">
          <TabsTrigger value="employees">
            <Users className="size-4 mr-1.5 hidden sm:inline" />Employees
          </TabsTrigger>
          <TabsTrigger value="leave">
            <CalendarDays className="size-4 mr-1.5 hidden sm:inline" />Leave Management
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AnimatePresence mode="wait">
        {activeTab === 'employees' && (
          <motion.div key="employees" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <EmployeesTab />
          </motion.div>
        )}
        {activeTab === 'leave' && (
          <motion.div key="leave" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <LeaveTab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}