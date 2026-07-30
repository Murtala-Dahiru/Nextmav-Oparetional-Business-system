'use client';

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  UserCog, UserPlus, Users, Clock, Building2, CheckCircle, XCircle,
  Pencil, Trash2, Plus, Loader2, MoreHorizontal, CalendarDays, ShieldCheck, ShieldX, KeyRound,
} from 'lucide-react';

import AttendanceTab from './attendance-tab';
import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { StatCard } from '@/components/shared/stat-card';
import { formatDate, formatRelativeTime, initialsOf } from '@/lib/format';
import { normalizeRole, roleLabel } from '@/lib/permissions';
import { LEAVE_TYPES as LEAVE_TYPE_VALUES, statusLabel } from '@/lib/constants';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { useAppStore } from '@/store/app-store';

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

/**
 * A row of `v_org_directory`, which is what `/api/admin/users` returns.
 *
 * This previously described the pre-migration ORM's user shape — `id`,
 * `firstName`/`lastName`, `department`, `roleId` — none of which the view has.
 * Every column in the employee table rendered blank, and edit and deactivate
 * addressed `undefined`, because the primary key here is `memberId`: the
 * membership, not the account. One person can hold memberships in several
 * organizations, so the account id is not what a per-organization screen acts
 * on.
 */
interface UserRecord {
  memberId: string; userId: string; organizationId: string;
  email: string; fullName: string; avatarUrl: string | null;
  jobTitle: string | null; phone: string | null;
  role: string; departmentId: string | null; departmentName: string | null;
  managerId: string | null; managerName: string | null;
  employeeNumber: string | null; employmentType: string | null;
  hiredOn: string | null; isActive: boolean; lastSeenAt: string | null;
  /** Added in 0012 alongside is_active, which remains the access gate. */
  status: 'active' | 'suspended' | 'terminated';
  terminatedOn: string | null;
  forcePasswordChange: boolean;
  passwordChangedAt: string | null;
}

interface RoleRecord {
  id: string; name: string; description: string; isSystem: boolean;
  permissions: string; createdAt: string; _count?: { users: number };
}

/**
 * A row of `/api/hr/leave`. The person is `member` — the membership that filed
 * the request — with their name on the joined profile, not a flat `requester`
 * carrying `firstName`/`lastName`.
 */
interface LeaveRequest {
  id: string; memberId: string; type: string; startDate: string; endDate: string;
  status: string; reason: string; isHalfDay: boolean;
  approvedBy: string | null; decidedAt: string | null;
  createdAt: string; updatedAt: string;
  member?: { id: string; departmentId: string | null; profiles?: { fullName: string; avatarUrl: string | null } };
  approver?: { id: string; profiles?: { fullName: string } } | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEPARTMENTS = [
  'Engineering', 'Sales', 'HR', 'Finance', 'Customer Success', 'Executive', 'Marketing', 'Operations',
];

/**
 * Every leave type the database can store.
 *
 * This was a hard-coded list of five that omitted `bereavement` and `unpaid`,
 * so two kinds of leave the `leave_type` enum has always accepted could not be
 * requested through the product at all. It is now the *filter* vocabulary —
 * you can still search for a type nobody may currently request — while the
 * request form below offers only what the organisation's `leave_policy`
 * setting says it offers.
 */
const LEAVE_TYPES = LEAVE_TYPE_VALUES.map(value => ({ value, label: statusLabel(value) }));

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
    throw new Error((e as any).error?.message ?? `Error ${res.status}`);
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
    throw new Error((e as any).error?.message ?? 'Create failed');
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
    throw new Error((e as any).error?.message ?? 'Update failed');
  }
  const json = await res.json();
  return json.data;
}

async function deleteRecord(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: 'Delete failed' }));
    throw new Error((e as any).error?.message ?? 'Delete failed');
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

/**
 * What `/api/admin/users` accepts. `role` is the membership's role enum and
 * `departmentId` a department foreign key; the previous `roleId` and free-text
 * `department` matched nothing and were dropped on save, as was the
 * `password: 'changeme'` this form used to send with every new employee.
 */
interface EmployeeFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  employmentType: string;
  role: string;
  departmentId: string;
  managerId: string;
  hiredOn: string;
}

const EMPLOYEE_DEFAULTS: EmployeeFormData = {
  firstName: '', lastName: '', email: '', phone: '', jobTitle: '',
  employmentType: 'full_time', role: 'employee', departmentId: '',
  managerId: '', hiredOn: '',
};

const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
  { value: 'temporary', label: 'Temporary' },
];

/** What an administrator is handed after provisioning, shown exactly once. */
interface IssuedCredential {
  email: string;
  temporaryPassword: string;
  loginUrl: string;
}

interface DepartmentOption { id: string; name: string }

/** Radix Select reads "" as "no value", so "unassigned" needs its own token. */
const NO_DEPARTMENT = '__none__';
const NO_MANAGER = '__no_manager__';

function EmployeesTab() {
  // Table state
  const [users, setUsers] = useState<UserRecord[]>([]);

  /** How the new employee gets an account. Invitation is the default. */
  const [mode, setMode] = useState<'invite' | 'direct'>('invite');
  /** The generated link, shown until dismissed — nothing emails it for us. */
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  /** The temporary password, held only for as long as the dialog is open. */
  const [issued, setIssued] = useState<IssuedCredential | null>(null);

  /**
   * Departments, derived from the directory rather than fetched — no endpoint
   * lists them, and the assignment dropdown needs real ids to store. Covers
   * every department that already has a member.
   */
  const departments = useMemo<DepartmentOption[]>(() => {
    const seen = new Map<string, string>();
    for (const u of users) {
      if (u.departmentId && !seen.has(u.departmentId)) {
        seen.set(u.departmentId, u.departmentName ?? 'Unnamed department');
      }
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);
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
      const depts = new Set(allUsers.filter((u) => u.departmentId).map((u) => u.departmentId));
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

  /**
   * The "on leave today" counter on this tab is derived from approved leave, so
   * a decision made elsewhere changes a number on this screen. `leave_requests`
   * rather than the employee table for that reason.
   */
  useModuleRealtime('hr-employees', ['leave_requests'], () => fetchStats());

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
                {initialsOf(u.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium whitespace-nowrap">{u.fullName || '—'}</span>
          </div>
        );
      },
    },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'phone', header: 'Phone' },
    { accessorKey: 'jobTitle', header: 'Job Title' },
    { accessorKey: 'departmentName', header: 'Department' },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => roleLabel(normalizeRole(row.original.role)),
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
          {row.original.lastSeenAt ? formatRelativeTime(row.original.lastSeenAt) : 'Never'}
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
            <DropdownMenuItem onClick={() => { setSelected(row.original); setForm({ ...EMPLOYEE_DEFAULTS, email: row.original.email, role: row.original.role, departmentId: row.original.departmentId ?? '' }); setEditOpen(true); }}>
              <Pencil className="size-4 mr-2" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => resetPassword(row.original)}>
              <KeyRound className="size-4 mr-2" />Reset password
            </DropdownMenuItem>
            {row.original.status === 'active' ? (
              <DropdownMenuItem onClick={() => setStatus(row.original, 'suspended')}>
                <ShieldX className="size-4 mr-2" />Suspend
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => setStatus(row.original, 'active')}>
                <ShieldCheck className="size-4 mr-2" />Reactivate
              </DropdownMenuItem>
            )}
            {row.original.status !== 'terminated' && (
              <DropdownMenuItem className="text-red-600" onClick={() => setStatus(row.original, 'terminated')}>
                <Trash2 className="size-4 mr-2" />Terminate employment
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], []);

  /**
   * Add an employee, either by invitation or by provisioning directly.
   *
   * Invitation is the default and the better path: the person sets their own
   * password and proves they control the address. Direct provisioning exists
   * for staff who cannot be reached by email yet, and tells the administrator
   * what has to happen next rather than implying an email was sent.
   */
  const handleCreate = async () => {
    if (!form.email) {
      toast.error('An email address is required');
      return;
    }
    if (mode === 'direct' && (!form.firstName || !form.lastName)) {
      toast.error('First and last name are required when adding someone directly');
      return;
    }
    setFormLoading(true);
    try {
      if (mode === 'invite') {
        const res = await createRecord<{ inviteUrl: string }>('/api/auth/invite', {
          email: form.email,
          role: form.role,
          departmentId: form.departmentId || null,
        });
        setInviteUrl(res.inviteUrl);
        // Kept on screen rather than toasted away: nothing sends this link, so
        // it is the administrator's job to pass it on and they need to be able
        // to copy it.
        toast.success('Invitation created — copy the link to send it.');
      } else {
        const res = await createRecord<{ temporaryPassword: string | null; nextStep: string }>(
          '/api/admin/users',
          {
            email: form.email,
            firstName: form.firstName,
            lastName: form.lastName,
            phone: form.phone || null,
            jobTitle: form.jobTitle || null,
            employmentType: form.employmentType,
            role: form.role,
            departmentId: form.departmentId || null,
            managerId: form.managerId || null,
            hiredOn: form.hiredOn || null,
          },
        );

        if (res.temporaryPassword) {
          // Held on screen rather than toasted, because this is the only time
          // it exists anywhere. Nothing emails it and nothing can retrieve it
          // afterwards — closing this dialog without copying it means issuing
          // a new one.
          setIssued({
            email: form.email,
            temporaryPassword: res.temporaryPassword,
            loginUrl: `${window.location.origin}/login`,
          });
        } else {
          // An address that already had an account keeps its own password.
          toast.success(res.nextStep ?? 'Employee added');
          setCreateOpen(false);
        }
      }
      setForm(EMPLOYEE_DEFAULTS);
      fetchUsers();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create employee');
    } finally {
      setFormLoading(false);
    }
  };

  /**
   * Issue a fresh temporary password.
   *
   * Reuses the same one-time panel as provisioning, because it is the same
   * situation: a password that exists only in this response and cannot be
   * fetched again.
   */
  const resetPassword = async (u: UserRecord) => {
    try {
      const res = await createRecord<{ temporaryPassword: string }>(
        `/api/admin/users/${u.memberId}/reset-password`, {},
      );
      setIssued({
        email: u.email,
        temporaryPassword: res.temporaryPassword,
        loginUrl: `${window.location.origin}/login`,
      });
      setCreateOpen(true);
      fetchUsers();
    } catch (e: any) {
      toast.error(e.message || 'Could not reset the password');
    }
  };

  /** Suspend, reactivate or terminate. The server keeps is_active in step. */
  const setStatus = async (u: UserRecord, status: 'active' | 'suspended' | 'terminated') => {
    try {
      await updateRecord(`/api/admin/users/${u.memberId}`, { status });
      toast.success(
        status === 'active' ? `${u.fullName || u.email} reactivated`
          : status === 'suspended' ? `${u.fullName || u.email} suspended`
            : `${u.fullName || u.email} marked as terminated`,
      );
      fetchUsers();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || 'Could not change the status');
    }
  };

  // Edit handler
  const handleEdit = async () => {
    if (!selected) return;
    setFormLoading(true);
    try {
      await updateRecord(`/api/admin/users/${selected.memberId}`, { role: form.role, departmentId: form.departmentId });
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
      await deleteRecord(`/api/admin/users/${selected.memberId}`);
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
            <DialogDescription>
              Invite them to join, or create the account yourself.
            </DialogDescription>
          </DialogHeader>

          {issued ? (
            /*
              The one and only sight of this password. It is not stored by the
              application, is not in the directory, and no endpoint can return
              it — losing it means issuing a new one from the row menu.
            */
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm">
                <span className="font-medium">{issued.email}</span> can now sign in.
                Give them this password — they will be asked to choose their own
                straight away.
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={issued.temporaryPassword}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-base tracking-wide"
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(issued.temporaryPassword);
                      toast.success('Password copied');
                    } catch {
                      toast.error('Could not copy — select the text and copy it manually.');
                    }
                  }}
                >
                  Copy password
                </Button>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issued.loginUrl);
                    toast.success('Login link copied');
                  } catch {
                    toast.error('Could not copy the link.');
                  }
                }}
              >
                Copy login link
              </Button>
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                This password is shown once and cannot be looked up again — not
                by you, and not by anyone else. Copy it before closing.
              </p>
            </div>
          ) : inviteUrl ? (
            /*
              Shown instead of the form once an invitation exists. Delivery is
              not wired up, so this link is the whole deliverable — dismissing
              the dialog without showing it would lose it, and the only way to
              recover is to re-invite, which invalidates the first link.
            */
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm">
                Invitation created. Send this link to{' '}
                <span className="font-medium">{form.email || 'them'}</span> — it expires in 7 days
                and can only be used by that address.
              </p>
              <div className="flex gap-2">
                <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteUrl);
                      toast.success('Link copied');
                    } catch {
                      toast.error('Could not copy — select the link and copy it manually.');
                    }
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                No email is sent from here yet, so the link has to be passed on by hand.
              </p>
            </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="sm:col-span-2">
              <Field label="How should they get access?">
                <Select value={mode} onValueChange={(v) => setMode(v as 'invite' | 'direct')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invite">Invite by email (recommended)</SelectItem>
                    <SelectItem value="direct">Create the account directly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {mode === 'direct' && (
              <>
                <Field label="First Name *">
                  <Input value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} placeholder="John" />
                </Field>
                <Field label="Last Name *">
                  <Input value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} placeholder="Doe" />
                </Field>
              </>
            )}
            <div className="sm:col-span-2">
              <Field label="Email *">
                <Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="john@example.com" />
              </Field>
            </div>
            {/*
              Only offered for direct provisioning. An invitation records the
              role and department on the invitation itself and lets the person
              fill in their own details when they accept, so asking for their
              phone number and start date here would be asking the wrong
              person.
            */}
            {mode === 'direct' && (
              <>
                <Field label="Phone">
                  <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+44 7700 900000" />
                </Field>
                <Field label="Job Title">
                  <Input value={form.jobTitle} onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))} placeholder="Payroll Officer" />
                </Field>
                <Field label="Employment Type">
                  <Select value={form.employmentType} onValueChange={(v) => setForm((p) => ({ ...p, employmentType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Start Date">
                  <Input type="date" value={form.hiredOn} onChange={(e) => setForm((p) => ({ ...p, hiredOn: e.target.value }))} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Manager">
                    <Select
                      value={form.managerId || NO_MANAGER}
                      onValueChange={(v) => setForm((p) => ({ ...p, managerId: v === NO_MANAGER ? '' : v }))}
                    >
                      <SelectTrigger><SelectValue placeholder="No manager" /></SelectTrigger>
                      <SelectContent className="max-h-48">
                        <SelectItem value={NO_MANAGER}>No manager</SelectItem>
                        {users.filter((u) => u.isActive).map((u) => (
                          <SelectItem key={u.memberId} value={u.memberId}>
                            {u.fullName || u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </>
            )}
            <Field label="Department">
              <Select
                value={form.departmentId || NO_DEPARTMENT}
                onValueChange={(v) => setForm((p) => ({ ...p, departmentId: v === NO_DEPARTMENT ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>Unassigned</SelectItem>
                  {departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Role">
              <Select value={form.role} onValueChange={(v) => setForm((p) => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          )}
          <DialogFooter>
            {issued ? (
              <>
                <Button variant="outline" onClick={() => setIssued(null)}>
                  Add another
                </Button>
                <Button
                  onClick={() => { setIssued(null); setCreateOpen(false); }}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  I have copied it
                </Button>
              </>
            ) : inviteUrl ? (
              <>
                <Button variant="outline" onClick={() => { setInviteUrl(null); }}>
                  Invite someone else
                </Button>
                <Button
                  onClick={() => { setInviteUrl(null); setCreateOpen(false); }}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={formLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">
                  {formLoading && <Loader2 className="size-4 mr-2 animate-spin" />}
                  {mode === 'invite' ? 'Create invitation' : 'Add employee'}
                </Button>
              </>
            )}
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
            <Field label="Department">
              <Select
                value={form.departmentId || NO_DEPARTMENT}
                onValueChange={(v) => setForm((p) => ({ ...p, departmentId: v === NO_DEPARTMENT ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>Unassigned</SelectItem>
                  {departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Role">
              <Select value={form.role} onValueChange={(v) => setForm((p) => ({ ...p, role: v }))}>
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
        description={`Are you sure you want to delete ${selected?.fullName || selected?.email}? This action cannot be undone.`}
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
  /**
   * What this company actually offers.
   *
   * The request form used to render a fixed list of five types regardless of
   * organisation. `leave_policy.types` is what an administrator chose on the
   * Workplace tab, and it arrives with the session — so the form offers
   * exactly what the endpoint will accept, and adding `bereavement` in
   * settings makes it selectable here without a deployment.
   *
   * Falling back to the full enum rather than an empty list: an organisation
   * whose policy row has not been written yet must still be able to request
   * leave.
   */
  const policies = useAppStore(s => s.organization?.policies);
  const offeredTypes = useMemo(() => {
    const configured = (policies?.leavePolicy?.types ?? []) as string[];
    const usable = configured.filter(t => (LEAVE_TYPE_VALUES as readonly string[]).includes(t));
    return (usable.length ? usable : LEAVE_TYPE_VALUES).map(value => ({
      value, label: statusLabel(value),
    }));
  }, [policies]);

  const leavePolicy = (policies?.leavePolicy ?? {}) as {
    allowHalfDay?: boolean; maxConsecutiveDays?: number; minNoticeDays?: number;
  };

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
        setForm((p) => ({ ...p, requesterId: res.data[0].memberId }));
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

  // "Leave approved — dashboard updates instantly", and the approver's own
  // queue with it: a request decided by a colleague leaves this table.
  useModuleRealtime('hr-leave', ['leave_requests'], () => {
    fetchStats();
    fetchLeaves();
  });

  // Column definitions
  const columns: ColumnDef<LeaveRequest>[] = useMemo(() => [
    {
      accessorKey: 'requester',
      header: 'Requester',
      cell: ({ row }) => {
        const r = row.original.member;
        if (!r) return '—';
        return (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {initialsOf(r.profiles?.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium whitespace-nowrap">{r.profiles?.fullName || '—'}</span>
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
                    <SelectItem key={u.memberId} value={u.memberId}>
                      {u.fullName || u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Type">
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {offeredTypes.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
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
//  Attendance & Shifts Tab
// ═══════════════════════════════════════════════════════════════════════════

// AttendanceTab now lives in ./attendance-tab.tsx — backed by the
// AttendanceRecord model, not hardcoded rows.

// ═══════════════════════════════════════════════════════════════════════════
//  Onboarding & Recruitment Tab
// ═══════════════════════════════════════════════════════════════════════════

function OnboardingTab() {
  const [candidates] = useState([
    { id: '1', name: 'Marcus Vance', role: 'Senior Frontend Engineer', stage: 'Technical Interview', score: '4.8/5.0', progress: 75 },
    { id: '2', name: 'Emily Chen', role: 'Product Marketing Manager', stage: 'Offer Sent', score: '4.9/5.0', progress: 90 },
    { id: '3', name: 'David Ross', role: 'DevOps Specialist', stage: 'Screening', score: '4.2/5.0', progress: 30 },
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Recruitment & Onboarding" description="Manage candidate pipelines, interview schedules, and new-hire onboarding checklists">
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <UserPlus className="size-4 mr-2" /> Add Candidate
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {candidates.map((c) => (
          <Card key={c.id} className="border hover:border-emerald-500/50 transition-all">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600">
                  {c.stage}
                </Badge>
                <span className="text-xs font-semibold text-emerald-600">{c.score}</span>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">{c.name}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{c.role}</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Onboarding Checklist</span>
                  <span>{c.progress}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${c.progress}%` }} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Payroll & Compensation Structure Tab
// ═══════════════════════════════════════════════════════════════════════════

function PayrollTab() {
  const [payroll] = useState([
    { id: '1', name: 'Alex Morgan', role: 'Platform Administrator', baseSalary: '$145,000', bonus: '$12,000', netPay: '$9,850/mo', status: 'Ready' },
    { id: '2', name: 'Sarah Jenkins', role: 'Account Executive', baseSalary: '$110,000', bonus: '$25,000', netPay: '$8,400/mo', status: 'Ready' },
    { id: '3', name: 'Jordan Lee', role: 'Lead UX Designer', baseSalary: '$125,000', bonus: '$8,000', netPay: '$8,200/mo', status: 'Ready' },
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Payroll & Compensation Structure" description="Overview of employee salary structures, bonuses, tax withholdings, and monthly dispatches">
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          Run Payroll Batch
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Monthly Payroll" value="$285,400" icon={UserCog} />
        <StatCard label="Active Direct Deposits" value="100%" icon={CheckCircle} />
        <StatCard label="Next Pay Date" value="Aug 01, 2026" icon={CalendarDays} />
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="p-3 text-left font-medium text-muted-foreground">Employee</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Base Salary</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Annual Bonus</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Est. Net Pay</th>
              <th className="p-3 text-right font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {payroll.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-accent/30">
                <td className="p-3 font-medium text-foreground">{p.name}</td>
                <td className="p-3 text-muted-foreground">{p.role}</td>
                <td className="p-3 text-muted-foreground">{p.baseSalary}</td>
                <td className="p-3 text-muted-foreground">{p.bonus}</td>
                <td className="p-3 font-medium text-foreground">{p.netPay}</td>
                <td className="p-3 text-right">
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    {p.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal HR Case & Incident Desk Tab
// ═══════════════════════════════════════════════════════════════════════════

function InternalHrCasesTab() {
  const [cases, setCases] = useState([
    { id: 'HRC-801', category: 'Workplace Incident', title: 'Ergonomic Desk Adjustment Request', submittedBy: 'Jordan Lee', assignedTo: 'Elena Rostova (HR Lead)', status: 'In Progress', priority: 'Medium', date: '2026-07-21' },
    { id: 'HRC-802', category: 'Payroll Question', title: 'Q2 Commuter Tax Withholding Clarification', submittedBy: 'Sarah Jenkins', assignedTo: 'Elena Rostova (HR Lead)', status: 'Open', priority: 'High', date: '2026-07-22' },
    { id: 'HRC-803', category: 'Policy Inquiry', title: 'Remote Work & International Travel Guidelines', submittedBy: 'Marcus Vance', assignedTo: 'David Ross (People Ops)', status: 'Resolved', priority: 'Low', date: '2026-07-15' },
  ]);

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('HR Question');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) {
      toast.error('Case title is required');
      return;
    }
    const newCase = {
      id: `HRC-${Math.floor(804 + Math.random() * 100)}`,
      category,
      title,
      submittedBy: 'Alex Morgan',
      assignedTo: 'Unassigned (HR Queue)',
      status: 'Open',
      priority: 'Medium',
      date: new Date().toISOString().substring(0, 10),
    };
    setCases([newCase, ...cases]);
    toast.success('Internal HR Case submitted successfully');
    setOpen(false);
    setTitle('');
    setDetails('');
  };

  const handleResolve = (id: string) => {
    setCases(prev => prev.map(c => c.id === id ? { ...c, status: 'Resolved' } : c));
    toast.success(`HR Case ${id} resolved`);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Internal HR Case & Incident Desk" description="Private employee channel for workplace complaints, payroll issues, policy inquiries, and HR support">
        <Button onClick={() => setOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> Submit HR Case
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Open HR Cases" value={cases.filter(c => c.status !== 'Resolved').length} icon={UserCog} />
        <StatCard label="Avg Resolution Time" value="18 Hours" icon={Clock} />
        <StatCard label="SLA Compliance" value="98.2%" icon={CheckCircle} />
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="p-3 text-left font-medium text-muted-foreground">Case ID</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Category</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Subject / Title</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Submitted By</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Assigned HR Specialist</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-right font-medium text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-accent/30">
                <td className="p-3 font-mono font-medium text-foreground">{c.id}</td>
                <td className="p-3"><Badge variant="outline" className="text-[10px]">{c.category}</Badge></td>
                <td className="p-3 font-medium text-foreground">{c.title}</td>
                <td className="p-3 text-muted-foreground">{c.submittedBy}</td>
                <td className="p-3 text-muted-foreground">{c.assignedTo}</td>
                <td className="p-3">
                  <Badge variant="outline" className={c.status === 'Resolved' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 border-amber-500/20'}>
                    {c.status}
                  </Badge>
                </td>
                <td className="p-3 text-right">
                  {c.status !== 'Resolved' && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600 hover:text-emerald-700" onClick={() => handleResolve(c.id)}>
                      Resolve Case
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit Internal HR Request</DialogTitle>
            <DialogDescription>Private, confidential case submission directly to the HR Management team.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Request Category">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Workplace Complaint">Workplace Complaint</SelectItem>
                  <SelectItem value="HR Question">HR Question</SelectItem>
                  <SelectItem value="Payroll Issue">Payroll & Benefits Issue</SelectItem>
                  <SelectItem value="Policy Clarification">Policy Clarification</SelectItem>
                  <SelectItem value="Suggestion">Workplace Suggestion</SelectItem>
                  <SelectItem value="Workplace Incident">Safety / Workplace Incident</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Subject / Brief Summary">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Question regarding Q3 PTO accrual" />
            </Field>
            <Field label="Detailed Explanation">
              <Textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Provide full context for HR review..." rows={4} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">Submit Case</Button>
            </DialogFooter>
          </form>
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
          <TabsTrigger value="attendance">
            <Clock className="size-4 mr-1.5 hidden sm:inline" />Attendance
          </TabsTrigger>
          <TabsTrigger value="cases">
            <ShieldCheck className="size-4 mr-1.5 hidden sm:inline" />HR Case Desk
          </TabsTrigger>
          <TabsTrigger value="onboarding">
            <UserPlus className="size-4 mr-1.5 hidden sm:inline" />Onboarding
          </TabsTrigger>
          <TabsTrigger value="payroll">
            <UserCog className="size-4 mr-1.5 hidden sm:inline" />Payroll
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
        {activeTab === 'attendance' && (
          <motion.div key="attendance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <AttendanceTab />
          </motion.div>
        )}
        {activeTab === 'cases' && (
          <motion.div key="cases" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <InternalHrCasesTab />
          </motion.div>
        )}
        {activeTab === 'onboarding' && (
          <motion.div key="onboarding" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <OnboardingTab />
          </motion.div>
        )}
        {activeTab === 'payroll' && (
          <motion.div key="payroll" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <PayrollTab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}