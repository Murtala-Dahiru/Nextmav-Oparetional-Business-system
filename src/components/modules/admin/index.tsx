'use client';

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  Users, Plus, Pencil, Trash2, MoreHorizontal, Settings, Shield,
  ClipboardList, Loader2, Save, ShieldCheck, Mail, Phone, Briefcase, DollarSign,
} from 'lucide-react';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDateTime, formatRelativeTime, getInitials } from '@/lib/format';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ═══════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════

interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

interface UserRecord {
  id: string; email: string; firstName: string; lastName: string; avatar: string;
  jobTitle: string; phone: string; department: string; roleId: string;
  isActive: boolean; lastSeen: string; createdAt: string; updatedAt: string;
  role?: { id: string; name: string };
}

interface RoleRecord {
  id: string; name: string; description: string; isSystem: boolean; permissions: string;
  createdAt: string;
  _count?: { users: number };
}

interface AuditLogRecord {
  id: string; userId: string; action: string; module: string; entity: string;
  entityId: string; details: string; ipAddress: string; createdAt: string;
  user?: { id: string; firstName: string; lastName: string; email: string; avatar: string };
}

interface SettingRecord {
  id: string; key: string; value: string; type: string; group: string; updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════

const DEPARTMENTS = ['Engineering', 'Marketing', 'Sales', 'Support', 'HR', 'Finance', 'Operations', 'Design'];

const MODULE_OPTIONS = ['crm', 'projects', 'hr', 'finance', 'inventory', 'calendar', 'admin', 'support', 'communication', 'workspace'];
const ACTION_OPTIONS = ['create', 'update', 'delete', 'login', 'export', 'import'];

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  update: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  login: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  export: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  import: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

const MODULE_COLORS: Record<string, string> = {
  crm: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  projects: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  hr: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  finance: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  inventory: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  calendar: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  admin: 'bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
  support: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  communication: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  workspace: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

const PERMISSION_MODULES = ['crm', 'projects', 'hr', 'finance', 'inventory', 'calendar', 'admin', 'support'];
const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete'];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR'];

// ═══════════════════════════════════════════════════════════════
//  Helper: API wrapper
// ═══════════════════════════════════════════════════════════════

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
  return json;
}

// ═══════════════════════════════════════════════════════════════
//  Section wrapper
// ═══════════════════════════════════════════════════════════════

function SectionCard({ title, children, icon: Icon }: { title: string; children: ReactNode; icon?: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base flex items-center gap-2">
          {Icon && <Icon className="size-4 text-emerald-600" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
//  User Form Dialog
// ═══════════════════════════════════════════════════════════════

interface UserFormState {
  firstName: string; lastName: string; email: string; phone: string;
  jobTitle: string; department: string; roleId: string; password: string;
}

const defaultUserForm: UserFormState = {
  firstName: '', lastName: '', email: '', phone: '',
  jobTitle: '', department: 'Engineering', roleId: '', password: 'changeme',
};

function UserFormDialog({
  open, onOpenChange, editing, onSubmit, isLoading, roles,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editing: UserRecord | null; onSubmit: (data: UserFormState) => void;
  isLoading: boolean; roles: RoleRecord[];
}) {
  const getInitialForm = (): UserFormState => editing ? {
    firstName: editing.firstName, lastName: editing.lastName, email: editing.email,
    phone: editing.phone, jobTitle: editing.jobTitle, department: editing.department,
    roleId: editing.roleId, password: '',
  } : { ...defaultUserForm, roleId: roles[0]?.id || '' };

  const [form, setForm] = useState<UserFormState>(getInitialForm);

  const update = (k: keyof UserFormState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit User' : 'Add User'}</DialogTitle>
          <DialogDescription>{editing ? 'Update user details.' : 'Create a new user account.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label htmlFor="u-first">First Name</Label><Input id="u-first" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="u-last">Last Name</Label><Input id="u-last" value={form.lastName} onChange={(e) => update('lastName', e.target.value)} /></div>
          </div>
          <div className="grid gap-2"><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></div>
          {!editing && (
            <div className="grid gap-2"><Label htmlFor="u-pass">Password</Label><Input id="u-pass" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} /></div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label htmlFor="u-phone">Phone</Label><Input id="u-phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="u-job">Job Title</Label><Input id="u-job" value={form.jobTitle} onChange={(e) => update('jobTitle', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="u-dept">Department</Label>
              <Select value={form.department} onValueChange={(v) => update('department', v)}>
                <SelectTrigger id="u-dept"><SelectValue /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-role">Role</Label>
              <Select value={form.roleId} onValueChange={(v) => update('roleId', v)}>
                <SelectTrigger id="u-role"><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={isLoading || !form.firstName || !form.lastName || !form.email}
            className="bg-emerald-600 text-white hover:bg-emerald-700">
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {editing ? 'Save Changes' : 'Create User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Role Form Dialog
// ═══════════════════════════════════════════════════════════════

interface RoleFormState {
  name: string; description: string; isSystem: boolean; permissions: string;
}

const defaultRoleForm: RoleFormState = { name: '', description: '', isSystem: false, permissions: '{}' };

function RoleFormDialog({
  open, onOpenChange, editing, onSubmit, isLoading,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editing: RoleRecord | null; onSubmit: (data: RoleFormState) => void; isLoading: boolean;
}) {
  const getInitialForm = (): RoleFormState => editing
    ? { name: editing.name, description: editing.description, isSystem: editing.isSystem, permissions: editing.permissions }
    : defaultRoleForm;

  const [form, setForm] = useState<RoleFormState>(getInitialForm);

  const update = (k: keyof RoleFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Role' : 'Create Role'}</DialogTitle>
          <DialogDescription>{editing ? 'Update role details.' : 'Define a new role with permissions.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label htmlFor="r-name">Name</Label><Input id="r-name" value={form.name} onChange={(e) => update('name', e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="r-desc">Description</Label><Textarea id="r-desc" value={form.description} onChange={(e) => update('description', e.target.value)} rows={2} /></div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="r-system">System Role</Label>
            <Switch id="r-system" checked={form.isSystem} onCheckedChange={(v) => update('isSystem', v)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="r-perms">Permissions (JSON)</Label>
            <Textarea id="r-perms" value={form.permissions} onChange={(e) => update('permissions', e.target.value)}
              rows={8} className="font-mono text-xs" placeholder='{"crm": {"view": true, "create": true}}' />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={isLoading || !form.name} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {editing ? 'Save Changes' : 'Create Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Main Module
// ═══════════════════════════════════════════════════════════════

export default function AdminModule() {
  // ── Users State ──
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userMeta, setUserMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [userLoading, setUserLoading] = useState(true);
  const [userPage, setUserPage] = useState(0);
  const [userPageSize, setUserPageSize] = useState(20);
  const [userSearch, setUserSearch] = useState('');
  const [userFilters, setUserFilters] = useState<ColumnFiltersState>([]);
  const [userSorting, setUserSorting] = useState<SortingState>([]);

  // ── Roles State ──
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  // ── Audit State ──
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [auditMeta, setAuditMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(0);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [auditFilters, setAuditFilters] = useState<ColumnFiltersState>([]);
  const [auditSorting, setAuditSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);

  // ── Settings State ──
  const [settings, setSettings] = useState<SettingRecord[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [generalForm, setGeneralForm] = useState({
    companyName: '', industry: '', website: '', email: '', phone: '', address: '',
  });
  const [financeForm, setFinanceForm] = useState({
    currency: 'USD', taxRate: '0', invoicePrefix: 'INV-', fiscalYearStart: '01',
  });

  // ── Dialogs ──
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [userSubmitting, setUserSubmitting] = useState(false);

  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'user' | 'role'; id: string; name: string; isSystem?: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ════════════════════════════════════════════════════════════
  //  Fetch: Users
  // ════════════════════════════════════════════════════════════
  const fetchUsers = useCallback(async () => {
    setUserLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(userPage + 1), pageSize: String(userPageSize),
        sort: userSorting[0]?.id || 'createdAt',
        sortDir: userSorting[0]?.desc ? 'desc' : 'asc',
      });
      if (userSearch) params.set('search', userSearch);
      userFilters.forEach((f) => { params.set(f.id, String(f.value)); });
      const res = await apiFetch<{ data: UserRecord[]; meta: ApiMeta }>(`/api/admin/users?${params}`);
      setUsers(res.data); setUserMeta(res.meta);
    } catch (e: any) { toast.error(e.message); } finally { setUserLoading(false); }
  }, [userPage, userPageSize, userSearch, userFilters, userSorting]);

  // ════════════════════════════════════════════════════════════
  //  Fetch: Roles
  // ════════════════════════════════════════════════════════════
  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await apiFetch<{ data: RoleRecord[]; meta: ApiMeta }>('/api/admin/roles?pageSize=100');
      setRoles(res.data);
    } catch (e: any) { toast.error(e.message); } finally { setRolesLoading(false); }
  }, []);

  // ════════════════════════════════════════════════════════════
  //  Fetch: Audit Log
  // ════════════════════════════════════════════════════════════
  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(auditPage + 1), pageSize: String(auditPageSize),
        sort: auditSorting[0]?.id || 'createdAt',
        sortDir: auditSorting[0]?.desc ? 'desc' : 'asc',
      });
      auditFilters.forEach((f) => { params.set(f.id, String(f.value)); });
      const res = await apiFetch<{ data: AuditLogRecord[]; meta: ApiMeta }>(`/api/admin/audit-log?${params}`);
      setAuditLogs(res.data); setAuditMeta(res.meta);
    } catch (e: any) { toast.error(e.message); } finally { setAuditLoading(false); }
  }, [auditPage, auditPageSize, auditFilters, auditSorting]);

  // ════════════════════════════════════════════════════════════
  //  Fetch: Settings
  // ════════════════════════════════════════════════════════════
  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await apiFetch<{ data: SettingRecord[] }>('/api/admin/settings');
      setSettings(res.data);
      const map: Record<string, string> = {};
      res.data.forEach((s) => { map[s.key] = s.value; });
      setGeneralForm({
        companyName: map['companyName'] || '', industry: map['industry'] || '',
        website: map['website'] || '', email: map['email'] || '',
        phone: map['phone'] || '', address: map['address'] || '',
      });
      setFinanceForm({
        currency: map['currency'] || 'USD', taxRate: map['taxRate'] || '0',
        invoicePrefix: map['invoicePrefix'] || 'INV-', fiscalYearStart: map['fiscalYearStart'] || '01',
      });
    } catch (e: any) { toast.error(e.message); } finally { setSettingsLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchRoles(); }, [fetchRoles]);
  useEffect(() => { fetchAuditLogs(); }, [fetchAuditLogs]);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // ════════════════════════════════════════════════════════════
  //  CRUD: Users
  // ════════════════════════════════════════════════════════════
  const handleUserSubmit = async (form: UserFormState) => {
    setUserSubmitting(true);
    try {
      const payload: any = {
        firstName: form.firstName, lastName: form.lastName, email: form.email,
        phone: form.phone, jobTitle: form.jobTitle, department: form.department,
        roleId: form.roleId,
      };
      if (!editingUser) payload.password = form.password;
      else payload.isActive = true;

      if (editingUser) {
        await apiFetch(`/api/admin/users/${editingUser.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('User updated');
      } else {
        await apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('User created');
      }
      setUserDialogOpen(false); setEditingUser(null); fetchUsers(); fetchRoles();
    } catch (e: any) { toast.error(e.message); } finally { setUserSubmitting(false); }
  };

  // ════════════════════════════════════════════════════════════
  //  CRUD: Roles
  // ════════════════════════════════════════════════════════════
  const handleRoleSubmit = async (form: RoleFormState) => {
    setRoleSubmitting(true);
    try {
      const payload = { name: form.name, description: form.description, isSystem: form.isSystem, permissions: form.permissions };
      if (editingRole) {
        await apiFetch(`/api/admin/roles/${editingRole.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Role updated');
      } else {
        await apiFetch('/api/admin/roles', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Role created');
      }
      setRoleDialogOpen(false); setEditingRole(null); fetchRoles();
    } catch (e: any) { toast.error(e.message); } finally { setRoleSubmitting(false); }
  };

  // ════════════════════════════════════════════════════════════
  //  Delete
  // ════════════════════════════════════════════════════════════
  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'user' && deleteTarget.id === 'u1') {
      toast.error('You cannot delete your own account');
      setDeleteTarget(null); return;
    }
    setDeleting(true);
    try {
      const endpoint = deleteTarget.type === 'user'
        ? `/api/admin/users/${deleteTarget.id}` : `/api/admin/roles/${deleteTarget.id}`;
      await apiFetch(endpoint, { method: 'DELETE' });
      toast.success(`${deleteTarget.type === 'user' ? 'User' : 'Role'} deleted`);
      setDeleteTarget(null);
      if (deleteTarget.type === 'user') fetchUsers(); else fetchRoles();
    } catch (e: any) { toast.error(e.message); } finally { setDeleting(false); }
  };

  // ════════════════════════════════════════════════════════════
  //  Save Settings
  // ════════════════════════════════════════════════════════════
  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    try {
      const items = [
        { key: 'companyName', value: generalForm.companyName, type: 'string', group: 'general' },
        { key: 'industry', value: generalForm.industry, type: 'string', group: 'general' },
        { key: 'website', value: generalForm.website, type: 'string', group: 'general' },
        { key: 'email', value: generalForm.email, type: 'string', group: 'general' },
        { key: 'phone', value: generalForm.phone, type: 'string', group: 'general' },
        { key: 'address', value: generalForm.address, type: 'string', group: 'general' },
        { key: 'currency', value: financeForm.currency, type: 'string', group: 'finance' },
        { key: 'taxRate', value: financeForm.taxRate, type: 'number', group: 'finance' },
        { key: 'invoicePrefix', value: financeForm.invoicePrefix, type: 'string', group: 'finance' },
        { key: 'fiscalYearStart', value: financeForm.fiscalYearStart, type: 'string', group: 'finance' },
      ];
      await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ settings: items }) });
      toast.success('Settings saved');
    } catch (e: any) { toast.error(e.message); } finally { setSettingsSaving(false); }
  };

  // ════════════════════════════════════════════════════════════
  //  User columns
  // ════════════════════════════════════════════════════════════
  const userColumns: ColumnDef<UserRecord>[] = [
    {
      accessorKey: 'avatar', header: '', size: 50,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <Avatar className="size-8">
            <AvatarImage src={u.avatar} alt={u.firstName} />
            <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              {getInitials(u.firstName, u.lastName)}
            </AvatarFallback>
          </Avatar>
        );
      },
    },
    {
      accessorKey: 'firstName', header: 'Name', size: 160,
      cell: ({ row }) => <span className="font-medium">{row.original.firstName} {row.original.lastName}</span>,
    },
    { accessorKey: 'email', header: 'Email', size: 200 },
    { accessorKey: 'jobTitle', header: 'Job Title', size: 140 },
    { accessorKey: 'department', header: 'Department', size: 120 },
    {
      accessorKey: 'role', header: 'Role', size: 120,
      cell: ({ row }) => (
        <Badge variant="secondary" className="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          {row.original.role?.name || '—'}
        </Badge>
      ),
    },
    {
      accessorKey: 'isActive', header: 'Status', size: 90,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}
          className={row.original.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : ''}>
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      accessorKey: 'lastSeen', header: 'Last Seen', size: 120,
      cell: ({ row }) => <span className="text-muted-foreground text-sm">{formatRelativeTime(row.original.lastSeen)}</span>,
    },
    {
      id: 'actions', size: 60,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setEditingUser(row.original); setUserDialogOpen(true); }}><Pencil className="size-4 mr-2" /> Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget({ type: 'user', id: row.original.id, name: `${row.original.firstName} ${row.original.lastName}` })}>
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // ── User filters ──
  const userFilterDefs: DataTableFilter[] = [
    { key: 'department', label: 'Department', options: DEPARTMENTS.map((d) => ({ value: d, label: d })) },
    { key: 'isActive', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
    { key: 'roleId', label: 'Role', options: roles.map((r) => ({ value: r.id, label: r.name })) },
  ];

  // ════════════════════════════════════════════════════════════
  //  Audit Log columns
  // ════════════════════════════════════════════════════════════
  const auditColumns: ColumnDef<AuditLogRecord>[] = [
    {
      accessorKey: 'createdAt', header: 'Timestamp', size: 160,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
    },
    {
      accessorKey: 'user', header: 'User', size: 150,
      cell: ({ row }) => {
        const u = row.original.user;
        return u ? <span className="font-medium text-sm">{u.firstName} {u.lastName}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: 'action', header: 'Action', size: 100,
      cell: ({ row }) => {
        const v = row.original.action;
        return <Badge variant="secondary" className={ACTION_COLORS[v] || ''}>{v}</Badge>;
      },
    },
    {
      accessorKey: 'module', header: 'Module', size: 110,
      cell: ({ row }) => {
        const v = row.original.module;
        return <Badge variant="secondary" className={MODULE_COLORS[v] || ''}>{v}</Badge>;
      },
    },
    { accessorKey: 'entity', header: 'Entity', size: 100 },
    {
      accessorKey: 'details', header: 'Details', size: 200,
      cell: ({ row }) => {
        const d = row.original.details;
        if (!d) return <span className="text-muted-foreground">—</span>;
        try {
          const parsed = JSON.parse(d);
          return <span className="text-xs text-muted-foreground font-mono max-w-[200px] truncate block">{JSON.stringify(parsed).slice(0, 60)}...</span>;
        } catch { return <span className="text-xs text-muted-foreground">{d.slice(0, 60)}</span>; }
      },
    },
  ];

  // ── Audit filters ──
  const auditFilterDefs: DataTableFilter[] = [
    { key: 'module', label: 'Module', options: MODULE_OPTIONS.map((m) => ({ value: m, label: m })) },
    { key: 'action', label: 'Action', options: ACTION_OPTIONS.map((a) => ({ value: a, label: a })) },
  ];

  // ════════════════════════════════════════════════════════════
  //  Render: Permission matrix for role cards
  // ════════════════════════════════════════════════════════════
  const renderPermMatrix = (permissions: string) => {
    let perms: Record<string, any> = {};
    try { perms = JSON.parse(permissions); } catch { /* empty */ }
    return (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left py-1 pr-2 text-muted-foreground font-medium">Module</th>
              {PERMISSION_ACTIONS.map((a) => (
                <th key={a} className="py-1 px-1 text-center text-muted-foreground font-medium capitalize">{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((mod) => {
              const modPerms = perms[mod] || {};
              return (
                <tr key={mod} className="border-t border-border/50">
                  <td className="py-1.5 pr-2 capitalize font-medium text-foreground/80">{mod}</td>
                  {PERMISSION_ACTIONS.map((a) => (
                    <td key={a} className="py-1.5 px-1 text-center">
                      <span className={`inline-block size-3.5 rounded-sm ${modPerms[a] ? 'bg-emerald-500' : 'bg-muted'}`} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <Tabs defaultValue="users" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="users" className="gap-2"><Users className="size-4" /> Users</TabsTrigger>
          <TabsTrigger value="roles" className="gap-2"><Shield className="size-4" /> Roles</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2"><Settings className="size-4" /> Settings</TabsTrigger>
          <TabsTrigger value="audit" className="gap-2"><ClipboardList className="size-4" /> Audit Log</TabsTrigger>
        </TabsList>

        {/* ════════════════════════════════════════════════════════
            USERS TAB
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="users" className="space-y-6">
          <PageHeader title="User Management" description="Manage user accounts and access." icon={Users}>
            <Button onClick={() => { setEditingUser(null); setUserDialogOpen(true); }}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="size-4 mr-2" /> Add User
            </Button>
          </PageHeader>
          <DataTable
            columns={userColumns} data={users} isLoading={userLoading}
            searchPlaceholder="Search users..." filters={userFilterDefs}
            total={userMeta.total} page={userPage} pageSize={userPageSize}
            onPageChange={setUserPage}
            onPageSizeChange={(s) => { setUserPageSize(s); setUserPage(0); }}
            onSearchChange={(v) => { setUserSearch(v); setUserPage(0); }}
            onFilterChange={(f) => { setUserFilters(f); setUserPage(0); }}
            onSortChange={(s) => { setUserSorting(s); setUserPage(0); }}
          />
        </TabsContent>

        {/* ════════════════════════════════════════════════════════
            ROLES TAB
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="roles" className="space-y-6">
          <PageHeader title="Roles & Permissions" description="Manage roles and their permission sets." icon={Shield}>
            <Button onClick={() => { setEditingRole(null); setRoleDialogOpen(true); }}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="size-4 mr-2" /> Create Role
            </Button>
          </PageHeader>

          {rolesLoading ? (
            <div className="grid gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <Card key={i}><CardContent className="p-6 space-y-3"><div className="h-5 w-1/3 bg-muted rounded" /><div className="h-4 w-2/3 bg-muted rounded" /></CardContent></Card>
              ))}
            </div>
          ) : roles.length === 0 ? (
            <EmptyState icon={Shield} title="No roles yet" description="Create your first role to manage permissions."
              action={{ label: 'Create Role', onClick: () => { setEditingRole(null); setRoleDialogOpen(true); } }} />
          ) : (
            <div className="grid gap-4">
              {roles.map((role) => (
                <Card key={role.id} className="group transition-shadow hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-emerald-500/10 text-emerald-600 flex size-10 items-center justify-center rounded-lg">
                          <ShieldCheck className="size-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm">{role.name}</h3>
                            {role.isSystem && (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">System</Badge>
                            )}
                          </div>
                          {role.description && <p className="text-muted-foreground text-xs mt-0.5">{role.description}</p>}
                          <p className="text-muted-foreground text-xs mt-1">{role._count?.users || 0} users</p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setEditingRole(role); setRoleDialogOpen(true); }}><Pencil className="size-4 mr-2" /> Edit</DropdownMenuItem>
                          {!role.isSystem && (
                            <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget({ type: 'role', id: role.id, name: role.name, isSystem: role.isSystem })}>
                              <Trash2 className="size-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {renderPermMatrix(role.permissions)}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════════════════
            SETTINGS TAB
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="settings" className="space-y-6">
          <PageHeader title="Settings" description="Configure your organization settings." icon={Settings} />

          <SectionCard title="General" icon={Briefcase}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2"><Label htmlFor="s-company">Company Name</Label>
                <Input id="s-company" value={generalForm.companyName} onChange={(e) => setGeneralForm((f) => ({ ...f, companyName: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-industry">Industry</Label>
                <Input id="s-industry" value={generalForm.industry} onChange={(e) => setGeneralForm((f) => ({ ...f, industry: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-website">Website</Label>
                <Input id="s-website" value={generalForm.website} onChange={(e) => setGeneralForm((f) => ({ ...f, website: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-email">Email</Label>
                <Input id="s-email" type="email" value={generalForm.email} onChange={(e) => setGeneralForm((f) => ({ ...f, email: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-phone">Phone</Label>
                <Input id="s-phone" value={generalForm.phone} onChange={(e) => setGeneralForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-address">Address</Label>
                <Input id="s-address" value={generalForm.address} onChange={(e) => setGeneralForm((f) => ({ ...f, address: e.target.value }))} /></div>
            </div>
          </SectionCard>

          <SectionCard title="Finance" icon={DollarSign}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="s-currency">Default Currency</Label>
                <Select value={financeForm.currency} onValueChange={(v) => setFinanceForm((f) => ({ ...f, currency: v }))}>
                  <SelectTrigger id="s-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label htmlFor="s-tax">Tax Rate (%)</Label>
                <Input id="s-tax" type="number" step="0.01" value={financeForm.taxRate} onChange={(e) => setFinanceForm((f) => ({ ...f, taxRate: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-prefix">Invoice Prefix</Label>
                <Input id="s-prefix" value={financeForm.invoicePrefix} onChange={(e) => setFinanceForm((f) => ({ ...f, invoicePrefix: e.target.value }))} /></div>
              <div className="grid gap-2">
                <Label htmlFor="s-fiscal">Fiscal Year Start (Month)</Label>
                <Select value={financeForm.fiscalYearStart} onValueChange={(v) => setFinanceForm((f) => ({ ...f, fiscalYearStart: v }))}>
                  <SelectTrigger id="s-fiscal"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => (
                      <SelectItem key={m} value={m}>{new Date(2024, Number(m) - 1).toLocaleString('en-US', { month: 'long' })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </SectionCard>

          <div className="flex justify-end">
            <Button onClick={handleSaveSettings} disabled={settingsSaving}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              {settingsSaving && <Loader2 className="size-4 animate-spin" />}
              <Save className="size-4 mr-2" /> Save Settings
            </Button>
          </div>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════
            AUDIT LOG TAB
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="audit" className="space-y-6">
          <PageHeader title="Audit Log" description="Track all actions performed across the system." icon={ClipboardList} />
          <DataTable
            columns={auditColumns} data={auditLogs} isLoading={auditLoading}
            searchPlaceholder="Search audit logs..." filters={auditFilterDefs}
            total={auditMeta.total} page={auditPage} pageSize={auditPageSize}
            onPageChange={setAuditPage}
            onPageSizeChange={(s) => { setAuditPageSize(s); setAuditPage(0); }}
            onFilterChange={(f) => { setAuditFilters(f); setAuditPage(0); }}
            onSortChange={(s) => { setAuditSorting(s); setAuditPage(0); }}
          />
        </TabsContent>
      </Tabs>

      {/* ═══════════ DIALOGS ═══════════ */}
      <UserFormDialog key={editingUser?.id ?? 'new-user'}
        open={userDialogOpen} onOpenChange={setUserDialogOpen}
        editing={editingUser} onSubmit={handleUserSubmit} isLoading={userSubmitting} roles={roles} />

      <RoleFormDialog key={editingRole?.id ?? 'new-role'}
        open={roleDialogOpen} onOpenChange={setRoleDialogOpen}
        editing={editingRole} onSubmit={handleRoleSubmit} isLoading={roleSubmitting} />

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.type === 'user' ? 'User' : 'Role'}`}
        description={deleteTarget?.type === 'role' && deleteTarget.isSystem
          ? 'This is a system role and cannot be deleted.'
          : `Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={handleDelete} isLoading={deleting}
      />
    </div>
  );
}
