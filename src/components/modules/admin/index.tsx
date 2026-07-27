'use client';

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  Users, Plus, Pencil, Trash2, MoreHorizontal, Settings, Shield,
  ClipboardList, Loader2, Save, ShieldCheck, Briefcase, DollarSign, CalendarOff, Megaphone,
  Clock, FolderKanban,
} from 'lucide-react';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDateTime, formatRelativeTime, initialsOf } from '@/lib/format';
import { normalizeRole, roleLabel } from '@/lib/permissions';
import { CURRENCIES, COUNTRIES, NIGERIAN_STATES, DEFAULT_COUNTRY, DEFAULT_CURRENCY } from '@/lib/locale';
import { useAppStore } from '@/store/app-store';
import { HolidaysTab, AnnouncementsTab } from '@/components/modules/admin/workplace-tabs';
import {
  WorkplacePanel, LeavePanel, ProjectsPanel, NotificationsPanel,
  BrandingPanel, DepartmentsPanel, type SettingsBundle,
} from '@/components/modules/admin/settings-panels';

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
  /** Set only for the client role: the customer this login represents. */
  clientCompanyId: string | null;
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

// Currencies come from lib/locale, which is also what validates them on the
// server and maps each to a locale. A second list here would drift from it.

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

/**
 * What the member endpoints actually accept.
 *
 * `password` is gone. The form used to default it to the literal string
 * "changeme" and send it from the browser with every account it created; the
 * server now generates a secret nobody records and the new member sets their
 * own through password reset.
 *
 * `role` and `departmentId` replace `roleId` and a free-text `department`:
 * the membership row stores a role enum and a department foreign key, so the
 * previous names were silently discarded on save.
 */
interface UserFormState {
  firstName: string; lastName: string; email: string;
  role: string; departmentId: string;
  /**
   * For a Client Portal User: which customer this login represents.
   *
   * The other half of the portal link. `projects.client_company_id` says which
   * customer a project is for; this says which customer the account speaks
   * for, and the portal shows a project only when the two match. With this
   * unset, a client signs in successfully and sees nothing.
   */
  clientCompanyId: string;
}

const defaultUserForm: UserFormState = {
  firstName: '', lastName: '', email: '', role: 'employee', departmentId: '',
  clientCompanyId: '',
};

interface DepartmentOption { id: string; name: string }
interface CompanyOption { id: string; name: string }

/** Radix Select reads "" as "no value", so "unassigned" needs its own token. */
const NO_DEPARTMENT = '__none__';

function UserFormDialog({
  open, onOpenChange, editing, onSubmit, isLoading, roles, departments, companies,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editing: UserRecord | null; onSubmit: (data: UserFormState) => void;
  isLoading: boolean; roles: RoleRecord[]; departments: DepartmentOption[];
  companies: CompanyOption[];
}) {
  // The directory carries one `fullName`; the form edits the two halves the
  // profile stores, so split on the first space rather than inventing a field.
  const [editFirst = '', ...editRest] = (editing?.fullName ?? '').split(' ');

  const getInitialForm = (): UserFormState => editing ? {
    firstName: editFirst,
    lastName: editRest.join(' '),
    email: editing.email,
    role: editing.role,
    departmentId: editing.departmentId ?? '',
    clientCompanyId: editing.clientCompanyId ?? '',
  } : { ...defaultUserForm, role: roles[0]?.id || 'employee' };

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
          <div className="grid gap-2">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={form.email} disabled={!!editing}
              onChange={(e) => update('email', e.target.value)} />
            {!editing && (
              <p className="text-xs text-muted-foreground">
                No password is set here. They&apos;ll use &ldquo;Forgot password&rdquo; on the
                sign-in page to choose their own.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="u-dept">Department</Label>
              {/*
                Real department ids, gathered from the directory. The list used
                to be a hardcoded set of names ("Engineering", …) that matched
                no row in the departments table, so the selection had nowhere
                to be stored.
              */}
              <Select
                value={form.departmentId || NO_DEPARTMENT}
                onValueChange={(v) => update('departmentId', v === NO_DEPARTMENT ? '' : v)}
              >
                <SelectTrigger id="u-dept"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>Unassigned</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-role">Role</Label>
              <Select value={form.role} onValueChange={(v) => update('role', v)}>
                <SelectTrigger id="u-role"><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/*
            Shown only for the client role, because it means nothing for an
            employee — and the endpoint refuses it for one, so offering it
            everywhere would be a control that always errors.
          */}
          {form.role === 'client' && (
            <div className="grid gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
              <Label htmlFor="u-client-co">Client company *</Label>
              <Select
                value={form.clientCompanyId || NO_DEPARTMENT}
                onValueChange={(v) => update('clientCompanyId', v === NO_DEPARTMENT ? '' : v)}
              >
                <SelectTrigger id="u-client-co">
                  <SelectValue placeholder="Choose the customer they represent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPARTMENT}>Not linked yet</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {companies.length === 0
                  ? 'No companies in the CRM yet — add the customer there first.'
                  : 'They will see every project linked to this company: its roadmap, progress, shared files and invoices. Without a company set, their portal is empty.'}
              </p>
            </div>
          )}
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
  const currentMemberId = useAppStore((st) => st.user?.memberId ?? null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  /** Held only while the reveal dialog is open; never persisted anywhere. */
  const [issued, setIssued] = useState<{ email: string; temporaryPassword: string } | null>(null);

  /**
   * Departments, derived from the directory rather than fetched.
   *
   * There is no endpoint that lists them, and the assignment dropdown needs
   * real ids to store. Every department that has at least one member appears
   * here, which covers assignment; a department with nobody in it yet cannot
   * be offered until such an endpoint exists.
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

  /**
   * CRM companies, for linking a client login to the customer it represents.
   *
   * Fetched rather than derived from the member list, because the point is to
   * pick a company that has *no* portal user yet — deriving from existing
   * members could only ever offer companies already linked.
   */
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  useEffect(() => {
    apiFetch<{ data: CompanyOption[] }>('/api/crm/companies?pageSize=100')
      .then((r) => setCompanies(r.data ?? []))
      // An administrator without CRM access still manages users; they simply
      // cannot link a client, and the picker says so rather than hanging.
      .catch(() => setCompanies([]));
  }, []);
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
    city: '', state: '', country: DEFAULT_COUNTRY, timezone: 'Africa/Lagos',
  });
  const [financeForm, setFinanceForm] = useState({
    currency: DEFAULT_CURRENCY, taxRate: '0', invoicePrefix: 'INV-', fiscalYearStart: '01',
  });
  /** The whole settings response, for the policy panels. */
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);

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
  /**
   * Load the company settings.
   *
   * The response is `{ organization, settings, departments }` — it always has
   * been. This treated it as a flat array of settings rows and called
   * `.forEach` on the object, which throws, and the resulting TypeError was
   * caught by the module error boundary. That is what "Loading Admin
   * enterprise environment…" was: not a slow load, a crash.
   *
   * The organization columns are the source of truth for anything with a
   * column of its own — name, currency, country, timezone. Only the extras
   * that have no column live in the key/value settings.
   */
  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await apiFetch<{
        data: { organization: any; settings: Record<string, any>; departments: any[] };
      }>('/api/admin/settings');

      const org = res.data?.organization ?? {};
      const kv = res.data?.settings ?? {};

      // Held whole as well as split into forms: the policy panels below read
      // the organization row and the key/value documents together, and giving
      // each one its own fetch would mean six requests for one screen.
      setBundle({
        organization: org,
        settings: kv,
        departments: (res.data?.departments ?? []) as any,
      });

      setGeneralForm({
        companyName: org.name ?? '',
        industry: org.industry ?? '',
        website: org.website ?? '',
        email: String(kv.email ?? ''),
        phone: org.phone ?? '',
        address: org.addressLine ?? org.address_line ?? '',
        city: org.city ?? '',
        state: org.state ?? '',
        country: org.country ?? DEFAULT_COUNTRY,
        timezone: org.timezone ?? 'Africa/Lagos',
      });
      setFinanceForm({
        // From the organization column, not the key/value store. The currency
        // was previously written as a setting key, so the column it is read
        // from everywhere else never changed and the choice had no effect on
        // anything the user could see.
        currency: org.currency ?? DEFAULT_CURRENCY,
        taxRate: String(kv.taxRate ?? '0'),
        invoicePrefix: String(kv.invoicePrefix ?? 'INV-'),
        fiscalYearStart: String(kv.fiscalYearStart ?? '01'),
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
      // Creating takes the account details; editing only ever changes the
      // membership, because name and email belong to the person's profile and
      // are not an administrator's to rewrite from here.
      const payload: any = editingUser
        ? { role: form.role, departmentId: form.departmentId }
        : {
            email: form.email,
            firstName: form.firstName,
            lastName: form.lastName,
            role: form.role,
            departmentId: form.departmentId,
          };

      /**
       * The client link, sent only when the role is `client`.
       *
       * The endpoint rejects it for any other role, so sending it
       * unconditionally would make every ordinary edit fail. Sent as `null`
       * when cleared, which unlinks the account — that is a real action an
       * administrator needs when a contact leaves the customer.
       *
       * Only on edit: provisioning creates the membership and the company link
       * is a second decision, made once the account exists.
       */
      if (editingUser && form.role === 'client') {
        payload.clientCompanyId = form.clientCompanyId || null;
      }

      if (editingUser) {
        await apiFetch(`/api/admin/users/${editingUser.memberId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('User updated');
      } else {
        const res = await apiFetch<{ data: { temporaryPassword: string | null; nextStep: string } }>(
          '/api/admin/users', { method: 'POST', body: JSON.stringify(payload) },
        );
        if (res.data?.temporaryPassword) {
          // Must survive the dialog closing: this is the only time the value
          // exists, and no endpoint can return it again.
          setIssued({ email: form.email, temporaryPassword: res.data.temporaryPassword });
        } else {
          toast.success(res.data?.nextStep ?? 'User created');
        }
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
    if (deleteTarget?.isSystem) return;
    if (!deleteTarget) return;
    // Compared against the real membership id. This was `=== 'u1'`, a
    // placeholder that matches nothing, so the guard never fired and the
    // attempt went to the server — which refuses it, but only after the
    // confirm dialog had already promised it would happen.
    if (deleteTarget.type === 'user' && deleteTarget.id === currentMemberId) {
      toast.error('You cannot remove your own account from the organization.');
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
  /**
   * Save the company settings.
   *
   * Two destinations, deliberately. Anything with a column of its own goes to
   * the organization row, because that is what the rest of the application
   * reads — the currency especially, which every module formats money with.
   * Only the extras that have no column go to the key/value store.
   *
   * This previously sent everything as one array under `settings`. The handler
   * reads that with `Object.entries`, so an array arrived as keys "0", "1",
   * "2"… and the organization row was never touched at all. The form reported
   * success every time and changed nothing.
   */
  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          name: generalForm.companyName,
          industry: generalForm.industry,
          website: generalForm.website,
          phone: generalForm.phone,
          addressLine: generalForm.address,
          city: generalForm.city,
          state: generalForm.state,
          country: generalForm.country,
          timezone: generalForm.timezone,
          currency: financeForm.currency,
          settings: {
            email: generalForm.email,
            taxRate: financeForm.taxRate,
            invoicePrefix: financeForm.invoicePrefix,
            fiscalYearStart: financeForm.fiscalYearStart,
          },
        }),
      });
      toast.success('Settings saved');
      // Re-read the session so the new currency reaches the formatters — every
      // figure on every screen is rendered with it, and without this the
      // change only appears after a reload.
      await useAppStore.getState().fetchUser();
      fetchSettings();
    } catch (e: any) { toast.error(e.message); } finally { setSettingsSaving(false); }
  };

  // ════════════════════════════════════════════════════════════
  //  User columns
  // ════════════════════════════════════════════════════════════
  const userColumns: ColumnDef<UserRecord>[] = [
    {
      accessorKey: 'avatarUrl', header: '', size: 50,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <Avatar className="size-8">
            <AvatarImage src={u.avatarUrl ?? undefined} alt={u.fullName} />
            <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              {initialsOf(u.fullName)}
            </AvatarFallback>
          </Avatar>
        );
      },
    },
    {
      accessorKey: 'fullName', header: 'Name', size: 160,
      cell: ({ row }) => <span className="font-medium">{row.original.fullName || '—'}</span>,
    },
    { accessorKey: 'email', header: 'Email', size: 200 },
    {
      accessorKey: 'jobTitle', header: 'Job Title', size: 140,
      cell: ({ row }) => <span>{row.original.jobTitle || '—'}</span>,
    },
    {
      accessorKey: 'departmentName', header: 'Department', size: 120,
      cell: ({ row }) => <span>{row.original.departmentName || '—'}</span>,
    },
    {
      accessorKey: 'role', header: 'Role', size: 120,
      cell: ({ row }) => (
        <Badge variant="secondary" className="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          {roleLabel(normalizeRole(row.original.role))}
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
      accessorKey: 'lastSeenAt', header: 'Last Seen', size: 120,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.lastSeenAt ? formatRelativeTime(row.original.lastSeenAt) : 'Never'}
        </span>
      ),
    },
    {
      id: 'actions', size: 60,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setEditingUser(row.original); setUserDialogOpen(true); }}><Pencil className="size-4 mr-2" /> Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget({ type: 'user', id: row.original.memberId, name: row.original.fullName || row.original.email })}>
              <Trash2 className="size-4 mr-2" /> Deactivate
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
          {/*
            Split out of Settings rather than added to it. Working hours, leave
            rules and project vocabulary are each a policy somebody owns, and
            burying them under a single General form is how they went
            unimplemented for so long — the columns existed, the endpoint
            accepted them, and there was nowhere to type.
          */}
          <TabsTrigger value="workplace" className="gap-2"><Clock className="size-4" /> Workplace</TabsTrigger>
          <TabsTrigger value="delivery" className="gap-2"><FolderKanban className="size-4" /> Delivery</TabsTrigger>
          {/*
            Holidays and announcements are business rules rather than system
            configuration, so they sit alongside Settings rather than inside
            it: both change how the product behaves for everyone the moment
            they are saved.
          */}
          <TabsTrigger value="holidays" className="gap-2"><CalendarOff className="size-4" /> Holidays</TabsTrigger>
          <TabsTrigger value="announcements" className="gap-2"><Megaphone className="size-4" /> Announcements</TabsTrigger>
          <TabsTrigger value="audit" className="gap-2"><ClipboardList className="size-4" /> Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="holidays" className="space-y-6">
          <HolidaysTab />
        </TabsContent>

        <TabsContent value="announcements" className="space-y-6">
          <AnnouncementsTab />
        </TabsContent>

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
                <Input id="s-phone" value={generalForm.phone}
                  placeholder={generalForm.country === 'NG' ? '+234 801 234 5678' : ''}
                  onChange={(e) => setGeneralForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-address">Address</Label>
                <Input id="s-address" value={generalForm.address} onChange={(e) => setGeneralForm((f) => ({ ...f, address: e.target.value }))} /></div>
              <div className="grid gap-2"><Label htmlFor="s-city">City</Label>
                <Input id="s-city" value={generalForm.city} onChange={(e) => setGeneralForm((f) => ({ ...f, city: e.target.value }))} /></div>

              {/*
                A select for Nigeria, free text elsewhere. Nigeria has a fixed
                list of 36 states plus the FCT, and leaving it open produces
                "Lagos", "lagos state" and "LAG" in the same column.
              */}
              <div className="grid gap-2">
                <Label htmlFor="s-state">{generalForm.country === 'NG' ? 'State' : 'State / Region'}</Label>
                {generalForm.country === 'NG' ? (
                  <Select value={generalForm.state || undefined}
                    onValueChange={(v) => setGeneralForm((f) => ({ ...f, state: v }))}>
                    <SelectTrigger id="s-state"><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {NIGERIAN_STATES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input id="s-state" value={generalForm.state}
                    onChange={(e) => setGeneralForm((f) => ({ ...f, state: e.target.value }))} />
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="s-country">Country</Label>
                <Select value={generalForm.country}
                  onValueChange={(v) => setGeneralForm((f) => ({ ...f, country: v, state: '' }))}>
                  <SelectTrigger id="s-country"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Finance" icon={DollarSign}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="s-currency">Default Currency</Label>
                <Select value={financeForm.currency} onValueChange={(v) => setFinanceForm((f) => ({ ...f, currency: v }))}>
                  <SelectTrigger id="s-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</SelectItem>)}</SelectContent>
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

          {/*
            Branding and departments sit under General because both describe
            the company itself rather than a way of working. Each saves on its
            own — a settings screen with one button at the bottom for six
            unrelated policies is one where saving a colour also re-submits
            the leave rules.
          */}
          {bundle && <BrandingPanel bundle={bundle} onSaved={fetchSettings} />}
          {bundle && <DepartmentsPanel departments={bundle.departments} onChanged={fetchSettings} />}
        </TabsContent>

        {/* ════════════════════════════════════════════════════════
            WORKPLACE TAB — the rules attendance and leave run on
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="workplace" className="space-y-6">
          <PageHeader
            title="Workplace rules"
            description="Working hours, the working week, and how leave is requested. Every control here is read by the attendance and leave logic."
            icon={Clock}
          />
          {settingsLoading || !bundle ? (
            <Card><CardContent className="p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></CardContent></Card>
          ) : (
            <>
              <WorkplacePanel bundle={bundle} onSaved={fetchSettings} />
              <LeavePanel bundle={bundle} onSaved={fetchSettings} />
            </>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════════════════
            DELIVERY TAB — project vocabulary and notifications
        ════════════════════════════════════════════════════════ */}
        <TabsContent value="delivery" className="space-y-6">
          <PageHeader
            title="Projects and notifications"
            description="The vocabulary the project forms offer, and which events reach people's notification trays."
            icon={FolderKanban}
          />
          {settingsLoading || !bundle ? (
            <Card><CardContent className="p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></CardContent></Card>
          ) : (
            <>
              <ProjectsPanel bundle={bundle} onSaved={fetchSettings} />
              <NotificationsPanel bundle={bundle} onSaved={fetchSettings} />
            </>
          )}
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
      {/*
        The temporary password, shown once. Kept in its own dialog rather than
        inside the form so that closing the form does not take it with it —
        there is no way to retrieve it afterwards.
      */}
      <Dialog open={!!issued} onOpenChange={(v) => !v && setIssued(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{issued?.email}</span> can sign in with this.
              They will be asked to choose their own password immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={issued?.temporaryPassword ?? ''}
              onFocus={(e) => e.currentTarget.select()} className="font-mono text-base tracking-wide" />
            <Button variant="outline" onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued?.temporaryPassword ?? '');
                toast.success('Password copied');
              } catch { toast.error('Could not copy — select the text and copy it manually.'); }
            }}>Copy</Button>
          </div>
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            Shown once and never recoverable — not by you, and not by anyone else.
            If it is lost, reset the password to issue a new one.
          </p>
          <DialogFooter>
            <Button onClick={() => setIssued(null)} className="bg-emerald-600 text-white hover:bg-emerald-700">
              I have copied it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UserFormDialog key={editingUser?.memberId ?? 'new-user'}
        open={userDialogOpen} onOpenChange={setUserDialogOpen}
        editing={editingUser} onSubmit={handleUserSubmit} isLoading={userSubmitting}
        roles={roles} departments={departments} companies={companies} />

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
