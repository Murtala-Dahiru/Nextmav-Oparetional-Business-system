'use client';

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { toast } from 'sonner';
import {
  Users, Building2, Handshake, Target, MoreHorizontal,
  Pencil, Trash2, Plus, TrendingUp, Sparkles, Loader2, Mail,
} from 'lucide-react';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { StatCard } from '@/components/shared/stat-card';
import {
  formatCurrency, formatDate, formatDateTime, formatRelativeTime, getInitials, formatNumber,
  activeCurrencyCode,
} from '@/lib/format';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { LEAD_STATUSES, DEAL_STAGES } from '@/lib/constants';
import {
  createLeadSchema, createContactSchema, createCompanySchema, createDealSchema,
} from '@/lib/validations';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { useFocusRequest } from '@/hooks/use-focus-request';
import { AddToMyWorkItem } from '@/components/shared/add-to-my-work';
import { CompanyDetail } from '@/components/modules/crm/company-detail';
import { ExportButton } from '@/components/shared/export-button';
import { z } from 'zod';

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

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

/**
 * A row of `/api/crm/leads`. These are the column names the endpoint returns;
 * `company`, `title` and `value` matched nothing, so those three columns
 * rendered blank in the table and were discarded on every save.
 */
interface Lead {
  id: string; firstName: string; lastName: string; email: string; phone: string;
  companyName: string; jobTitle: string; source: string; status: string; score: number;
  estimatedValue: number; notes: string; ownerId: string;
  convertedContactId: string | null; convertedAt: string | null;
  createdAt: string; updatedAt: string;
  owner?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } };
}

interface Contact {
  id: string; firstName: string; lastName: string; email: string; phone: string;
  jobTitle: string; companyId: string | null; source: string; isActive: boolean;
  notes: string; createdAt: string; updatedAt: string;
  company?: { id: string; name: string } | null;
}

interface Company {
  id: string; name: string; industry: string; website: string; phone: string;
  email: string; city: string; country: string; employeeCount: number;
  annualRevenue: number; notes: string; createdAt: string; updatedAt: string;
}

interface Deal {
  id: string; name: string; value: number; stage: string; probability: number;
  expectedClose: string | null; companyId: string | null; contactId: string | null;
  notes: string; ownerId: string; createdAt: string; updatedAt: string;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  owner?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } };
}

/**
 * A logged call, email, meeting or note.
 *
 * Polymorphic by design: an activity hangs off whichever of lead, contact,
 * company or deal it is about, and the database requires at least one.
 */
interface CrmActivity {
  id: string; activityType: string; subject: string; body: string;
  dueAt: string | null; completedAt: string | null; createdAt: string;
  member?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } } | null;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  lead?: { id: string; firstName: string; lastName: string } | null;
  deal?: { id: string; name: string } | null;
}

type LeadFormValues = z.infer<typeof createLeadSchema>;
type ContactFormValues = z.infer<typeof createContactSchema>;
type CompanyFormValues = z.infer<typeof createCompanySchema>;
type DealFormValues = z.infer<typeof createDealSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const LEAD_STATUS_COLORS: Record<string, string> = {
  new: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  qualified: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  proposal: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  negotiation: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  won: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  lost: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const DEAL_STAGE_COLORS: Record<string, string> = {
  prospecting: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  qualification: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  proposal: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  negotiation: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  'closed_won': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'closed_lost': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const DEAL_STAGE_CHART_COLORS: Record<string, string> = {
  prospecting: '#06b6d4', qualification: '#3b82f6', proposal: '#8b5cf6',
  negotiation: '#f97316', 'closed_won': '#10b981', 'closed_lost': '#ef4444',
};

const DEAL_STAGE_LABELS: Record<string, string> = {
  prospecting: 'Prospecting', qualification: 'Qualification', proposal: 'Proposal',
  negotiation: 'Negotiation', 'closed_won': 'Closed Won', 'closed_lost': 'Closed Lost',
};

const SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manual' }, { value: 'web', label: 'Website' },
  { value: 'referral', label: 'Referral' }, { value: 'social', label: 'Social Media' },
  { value: 'email', label: 'Email' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  API Helpers
// ═══════════════════════════════════════════════════════════════════════════

async function fetchList<T>(url: string): Promise<{ data: T[]; meta: ApiMeta }> {
  const res = await fetch(url);
  if (!res.ok) { const e = await res.json().catch(() => ({ message: 'Request failed' })); throw new Error((e as any).error?.message ?? `Error ${res.status}`); }
  return res.json();
}

/**
 * One record, by id.
 *
 * Used when a record is opened from outside this module — a search result, a
 * link from the customer panel. Fetched rather than looked up in the table's
 * current page: that page is twenty rows under whatever filter and sort the
 * user last chose, so the record they explicitly asked for is usually not in
 * it, and "not found" would be a lie.
 */
async function fetchOne<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? `Error ${res.status}`);
  return json.data as T;
}

/**
 * Open a record's edit dialog when another surface asks for it.
 *
 * Shared by the four record tabs, which differ only in the endpoint and in how
 * they populate their form — so the fetch, the failure message and the
 * acknowledgement live here once.
 */
function useFocusedRecord<T>(
  focusId: string | null | undefined,
  endpoint: string,
  open: (record: T) => void,
  onHandled?: () => void,
) {
  useEffect(() => {
    if (!focusId) return;
    let cancelled = false;
    (async () => {
      try {
        const record = await fetchOne<T>(`${endpoint}/${focusId}`);
        if (!cancelled && record) open(record);
      } catch (err: any) {
        toast.error(err.message || 'That record could no longer be opened');
      } finally {
        if (!cancelled) onHandled?.();
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the id: `open` is recreated on every render in these tabs, so
    // depending on it would refetch in a loop. The id is the request.
  }, [focusId, endpoint]);
}

async function createRecord<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) { const e = await res.json().catch(() => ({ message: 'Create failed' })); throw new Error((e as any).error?.message ?? 'Create failed'); }
  const json = await res.json();
  return json.data;
}

async function updateRecord<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) { const e = await res.json().catch(() => ({ message: 'Update failed' })); throw new Error((e as any).error?.message ?? 'Update failed'); }
  const json = await res.json();
  return json.data;
}

async function deleteRecord(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json().catch(() => ({ message: 'Delete failed' })); throw new Error((e as any).error?.message ?? 'Delete failed'); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Shared UI helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Radix Select treats "" as "no value", so an explicit "not linked" option
 * needs a token of its own.
 */
const NO_LINK = '__none__';

/**
 * The organization's companies and contacts, for the link pickers.
 *
 * Deals and contacts reference these by id. The forms previously took a typed
 * name, which matched no column and was discarded on save, so a deal could
 * never actually be attached to the company it belonged to.
 *
 * Loaded once per form rather than per keystroke; a failure leaves the picker
 * empty rather than blocking the form, since the link is optional.
 */
function useCrmLinks(enabled: boolean) {
  const [companyOptions, setCompanyOptions] = useState<{ id: string; name: string }[]>([]);
  const [contactOptions, setContactOptions] = useState<
    { id: string; firstName: string; lastName: string }[]
  >([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const [co, ct] = await Promise.all([
          fetch('/api/crm/companies?pageSize=100').then(r => r.json()),
          fetch('/api/crm/contacts?pageSize=100').then(r => r.json()),
        ]);
        if (cancelled) return;
        setCompanyOptions(co?.data ?? []);
        setContactOptions(ct?.data ?? []);
      } catch {
        // Optional links; an empty picker is better than a blocked form.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return { companyOptions, contactOptions };
}

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

const LEAD_DEFAULTS: LeadFormValues = {
  firstName: '', lastName: '', email: '', phone: '', companyName: '',
  jobTitle: '', source: 'manual', status: 'new', score: 0, estimatedValue: 0,
  notes: '', ownerId: undefined,
};

const CONTACT_DEFAULTS: ContactFormValues = {
  firstName: '', lastName: '', email: '', phone: '', jobTitle: '',
  companyId: null, source: 'manual', isActive: true, notes: '',
};

const COMPANY_DEFAULTS: CompanyFormValues = {
  name: '', industry: '', website: '', phone: '', email: '',
  city: '', country: '', employeeCount: 0, annualRevenue: 0, notes: '',
};

const DEAL_DEFAULTS: DealFormValues = {
  name: '', value: 0, stage: 'prospecting', probability: 20,
  expectedClose: new Date().toISOString().split('T')[0] || '',
  companyId: null, contactId: null, notes: '', ownerId: undefined,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Leads Tab
// ═══════════════════════════════════════════════════════════════════════════

function LeadsTab({ focusId, onFocusHandled }: { focusId?: string | null; onFocusHandled?: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState('');

  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<LeadFormValues>({ resolver: zodResolver(createLeadSchema) as any, defaultValues: LEAD_DEFAULTS });

  const openEdit = (l: Lead) => {
    setEditing(l);
    form.reset({
      firstName: l.firstName, lastName: l.lastName, email: l.email, phone: l.phone,
      companyName: l.companyName, jobTitle: l.jobTitle, source: l.source, status: l.status,
      score: l.score, estimatedValue: l.estimatedValue, notes: l.notes, ownerId: l.ownerId,
    });
    setOpen(true);
  };

  useFocusedRecord<Lead>(focusId, '/api/crm/leads', openEdit, onFocusHandled);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize), sort, sortDir });
      if (search) p.set('search', search);
      if (statusFilter) p.set('status', statusFilter);
      const res = await fetchList<Lead>(`/api/crm/leads?${p}`);
      setLeads(res.data); setMeta(res.meta);
    } catch (err: any) { toast.error(err.message || 'Failed to load leads'); }
    finally { setLoading(false); }
  }, [page, pageSize, search, sort, sortDir, statusFilter]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetchList<Lead>('/api/crm/leads?pageSize=100&sort=createdAt&sortDir=desc');
      setAllLeads(res.data);
    } catch { /* non-critical */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  /**
   * A lead created or converted by a colleague appears without a reload.
   *
   * 0006 left the CRM out of the publication on the grounds that two people
   * rarely edit the same lead. True, and beside the point: when it does happen
   * the person on the stale row overwrites the other's work, and "rare" is the
   * kind of defect that gets reported once a quarter and never reproduced.
   */
  useModuleRealtime('crm-leads', ['leads'], () => { fetchLeads(); fetchStats(); });

  const stats = useMemo(() => ({
    total: allLeads.length,
    new: allLeads.filter(l => l.status === 'new').length,
    qualified: allLeads.filter(l => l.status === 'qualified').length,
    won: allLeads.filter(l => l.status === 'won').length,
  }), [allLeads]);

  const statusFilterOption: DataTableFilter = useMemo(() => ({
    key: 'status', label: 'Status',
    options: LEAD_STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
  }), []);

  const columns: ColumnDef<Lead>[] = useMemo(() => [
    { accessorKey: 'firstName', header: 'Name', cell: ({ row }) => {
      const l = row.original;
      return (
        <div className="flex items-center gap-2">
          <div className="bg-emerald-500/10 text-emerald-600 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {getInitials(l.firstName, l.lastName)}
          </div>
          <span className="font-medium">{l.firstName} {l.lastName}</span>
        </div>
      );
    }},
    { accessorKey: 'email', header: 'Email', cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span> },
    { accessorKey: 'company', header: 'Company' },
    { accessorKey: 'source', header: 'Source', cell: ({ row }) => <Badge variant="outline">{row.original.source}</Badge> },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={LEAD_STATUS_COLORS} /> },
    { accessorKey: 'score', header: 'Score', cell: ({ row }) => {
      const s = row.original.score;
      return (
        <div className="flex items-center gap-2 min-w-[80px]">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${s > 60 ? 'bg-emerald-500' : s > 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${s}%` }} />
          </div>
          <span className="text-xs text-muted-foreground w-6 text-right">{s}</span>
        </div>
      );
    }},
    { accessorKey: 'estimatedValue', header: 'Value', cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.estimatedValue)}</span> },
    { accessorKey: 'createdAt', header: 'Created', cell: ({ row }) => <span className="text-muted-foreground text-sm">{formatRelativeTime(row.original.createdAt)}</span> },
    { id: 'actions', size: 50, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(row.original)}>
            <Pencil className="size-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setDeletingItem(row.original); setDeleteOpen(true); }} className="text-red-600 focus:text-red-600">
            <Trash2 className="size-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )},
  ], []);

  const onSubmit = async (values: LeadFormValues) => {
    setSubmitting(true);
    try {
      if (editing) { await updateRecord<Lead>(`/api/crm/leads/${editing.id}`, values); toast.success('Lead updated'); }
      else { await createRecord<Lead>('/api/crm/leads', values); toast.success('Lead created'); }
      setOpen(false); setEditing(null); fetchLeads(); fetchStats();
    } catch (err: any) { toast.error(err.message || 'Operation failed'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try { await deleteRecord(`/api/crm/leads/${deletingItem.id}`); toast.success('Lead deleted'); setDeleteOpen(false); setDeletingItem(null); fetchLeads(); fetchStats(); }
    catch (err: any) { toast.error(err.message || 'Delete failed'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Leads" description="Track and manage your sales leads">
        <Button onClick={() => { setEditing(null); form.reset(LEAD_DEFAULTS); setOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> New Lead
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Leads" value={stats.total} icon={Users} />
        <StatCard label="New" value={stats.new} icon={Sparkles} />
        <StatCard label="Qualified" value={stats.qualified} icon={Target} />
        <StatCard label="Won" value={stats.won} icon={TrendingUp} />
      </div>

      <DataTable
        columns={columns} data={leads} isLoading={loading}
        searchPlaceholder="Search leads..." filters={[statusFilterOption]}
        onSearchChange={v => { setSearch(v); setPage(0); }}
        onSortChange={s => { if (s.length) { setSort(s[0].id); setSortDir(s[0].desc ? 'desc' : 'asc'); } }}
        onFilterChange={f => { setStatusFilter((f.find(x => x.id === 'status')?.value as string) || ''); setPage(0); }}
        onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(0); }}
        page={page} pageSize={pageSize} total={meta.total}
        emptyMessage="No leads found" emptyIcon={Users}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Lead' : 'New Lead'}</DialogTitle>
            <DialogDescription>{editing ? 'Update lead information.' : 'Add a new lead to your pipeline.'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First Name" error={form.formState.errors.firstName?.message}>
                <Input {...form.register('firstName')} placeholder="John" />
              </Field>
              <Field label="Last Name" error={form.formState.errors.lastName?.message}>
                <Input {...form.register('lastName')} placeholder="Doe" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Email" error={form.formState.errors.email?.message}>
                <Input type="email" {...form.register('email')} placeholder="john@example.com" />
              </Field>
              <Field label="Phone" error={form.formState.errors.phone?.message}>
                <Input {...form.register('phone')} placeholder="+1 234 567 8900" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Company" error={form.formState.errors.companyName?.message}>
                <Input {...form.register('companyName')} placeholder="Acme Inc" />
              </Field>
              <Field label="Job Title" error={form.formState.errors.jobTitle?.message}>
                <Input {...form.register('jobTitle')} placeholder="CEO" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Source" error={form.formState.errors.source?.message}>
                <Controller control={form.control} name="source" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{SOURCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Score (0-100)" error={form.formState.errors.score?.message}>
                <Input type="number" min={0} max={100} {...form.register('score', { valueAsNumber: true })} />
              </Field>
              {/* Labelled with the organization's currency, not a dollar sign. */}
              <Field label={`Estimated value (${activeCurrencyCode()})`} error={form.formState.errors.estimatedValue?.message}>
                <Input type="number" min={0} {...form.register('estimatedValue', { valueAsNumber: true })} />
              </Field>
            </div>
            <Field label="Notes" error={form.formState.errors.notes?.message}>
              <Textarea {...form.register('notes')} rows={3} placeholder="Additional notes..." />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
                {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                {editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Lead"
        description={`Are you sure you want to delete ${deletingItem?.firstName} ${deletingItem?.lastName}? This action cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={handleDelete} isLoading={deleting} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Contacts Tab
// ═══════════════════════════════════════════════════════════════════════════

function ContactsTab({ focusId, onFocusHandled }: { focusId?: string | null; onFocusHandled?: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [open, setOpen] = useState(false);
  const { companyOptions, contactOptions } = useCrmLinks(open);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<ContactFormValues>({ resolver: zodResolver(createContactSchema) as any, defaultValues: CONTACT_DEFAULTS });

  const openEdit = (c: Contact) => {
    setEditing(c);
    form.reset({
      firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
      jobTitle: c.jobTitle, companyId: c.companyId, source: c.source,
      isActive: c.isActive, notes: c.notes,
    });
    setOpen(true);
  };

  useFocusedRecord<Contact>(focusId, '/api/crm/contacts', openEdit, onFocusHandled);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize), sort, sortDir });
      if (search) p.set('search', search);
      const res = await fetchList<Contact>(`/api/crm/contacts?${p}`);
      setContacts(res.data); setMeta(res.meta);
    } catch (err: any) { toast.error(err.message || 'Failed to load contacts'); }
    finally { setLoading(false); }
  }, [page, pageSize, search, sort, sortDir]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnDef<Contact>[] = useMemo(() => [
    { accessorKey: 'firstName', header: 'Name', cell: ({ row }) => {
      const c = row.original;
      return (
        <div className="flex items-center gap-2">
          <div className="bg-emerald-500/10 text-emerald-600 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {getInitials(c.firstName, c.lastName)}
          </div>
          <span className="font-medium">{c.firstName} {c.lastName}</span>
        </div>
      );
    }},
    { accessorKey: 'email', header: 'Email', cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span> },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'jobTitle', header: 'Job Title', cell: ({ row }) => row.original.jobTitle || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'company', header: 'Company', cell: ({ row }) => row.original.company || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'source', header: 'Source', cell: ({ row }) => <Badge variant="outline">{row.original.source}</Badge> },
    { accessorKey: 'isActive', header: 'Status', cell: ({ row }) => (
      <Badge variant="secondary" className={row.original.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}>
        {row.original.isActive ? 'Active' : 'Inactive'}
      </Badge>
    )},
    { accessorKey: 'createdAt', header: 'Created', cell: ({ row }) => <span className="text-muted-foreground text-sm">{formatRelativeTime(row.original.createdAt)}</span> },
    { id: 'actions', size: 50, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(row.original)}>
            <Pencil className="size-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setDeletingItem(row.original); setDeleteOpen(true); }} className="text-red-600 focus:text-red-600">
            <Trash2 className="size-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )},
  ], []);

  const onSubmit = async (values: ContactFormValues) => {
    setSubmitting(true);
    try {
      if (editing) { await updateRecord<Contact>(`/api/crm/contacts/${editing.id}`, values); toast.success('Contact updated'); }
      else { await createRecord<Contact>('/api/crm/contacts', values); toast.success('Contact created'); }
      setOpen(false); setEditing(null); fetchData();
    } catch (err: any) { toast.error(err.message || 'Operation failed'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try { await deleteRecord(`/api/crm/contacts/${deletingItem.id}`); toast.success('Contact deleted'); setDeleteOpen(false); setDeletingItem(null); fetchData(); }
    catch (err: any) { toast.error(err.message || 'Delete failed'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Contacts" description="Manage your business contacts">
        <Button onClick={() => { setEditing(null); form.reset(CONTACT_DEFAULTS); setOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> New Contact
        </Button>
      </PageHeader>

      <DataTable
        columns={columns} data={contacts} isLoading={loading}
        searchPlaceholder="Search contacts..."
        onSearchChange={v => { setSearch(v); setPage(0); }}
        onSortChange={s => { if (s.length) { setSort(s[0].id); setSortDir(s[0].desc ? 'desc' : 'asc'); } }}
        onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(0); }}
        page={page} pageSize={pageSize} total={meta.total}
        emptyMessage="No contacts found" emptyIcon={Users}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Contact' : 'New Contact'}</DialogTitle>
            <DialogDescription>{editing ? 'Update contact information.' : 'Add a new contact.'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First Name" error={form.formState.errors.firstName?.message}>
                <Input {...form.register('firstName')} placeholder="John" />
              </Field>
              <Field label="Last Name" error={form.formState.errors.lastName?.message}>
                <Input {...form.register('lastName')} placeholder="Doe" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Email" error={form.formState.errors.email?.message}>
                <Input type="email" {...form.register('email')} placeholder="john@example.com" />
              </Field>
              <Field label="Phone" error={form.formState.errors.phone?.message}>
                <Input {...form.register('phone')} placeholder="+1 234 567 8900" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Job Title" error={form.formState.errors.jobTitle?.message}>
                <Input {...form.register('jobTitle')} placeholder="CEO" />
              </Field>
              {/*
                A picker, not free text. Contacts link to a company by id, so a
                typed name had nowhere to be stored and was dropped on save.
              */}
              <Field label="Company" error={form.formState.errors.companyId?.message}>
                <Controller control={form.control} name="companyId" render={({ field }) => (
                  <Select
                    value={field.value ?? NO_LINK}
                    onValueChange={(v) => field.onChange(v === NO_LINK ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="No company" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>No company</SelectItem>
                      {companyOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Source" error={form.formState.errors.source?.message}>
                <Controller control={form.control} name="source" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{SOURCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Active">
                <div className="flex items-center gap-2 h-9">
                  <Controller control={form.control} name="isActive" render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )} />
                  <Label>{form.watch('isActive') ? 'Active' : 'Inactive'}</Label>
                </div>
              </Field>
            </div>
            <Field label="Notes" error={form.formState.errors.notes?.message}>
              <Textarea {...form.register('notes')} rows={3} placeholder="Notes..." />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
                {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                {editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Contact"
        description={`Are you sure you want to delete ${deletingItem?.firstName} ${deletingItem?.lastName}? This action cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={handleDelete} isLoading={deleting} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Companies Tab
// ═══════════════════════════════════════════════════════════════════════════

function CompaniesTab({ onOpenDetail }: { onOpenDetail: (companyId: string) => void }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<CompanyFormValues>({ resolver: zodResolver(createCompanySchema) as any, defaultValues: COMPANY_DEFAULTS });

  const openEdit = (c: Company) => {
    setEditing(c);
    form.reset({
      name: c.name, industry: c.industry, website: c.website, phone: c.phone,
      email: c.email, city: c.city, country: c.country,
      employeeCount: c.employeeCount, annualRevenue: c.annualRevenue, notes: c.notes,
    });
    setOpen(true);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize), sort, sortDir });
      if (search) p.set('search', search);
      const res = await fetchList<Company>(`/api/crm/companies?${p}`);
      setCompanies(res.data); setMeta(res.meta);
    } catch (err: any) { toast.error(err.message || 'Failed to load companies'); }
    finally { setLoading(false); }
  }, [page, pageSize, search, sort, sortDir]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnDef<Company>[] = useMemo(() => [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <div className="bg-emerald-500/10 text-emerald-600 flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Building2 className="size-4" />
        </div>
        <span className="font-medium">{row.original.name}</span>
      </div>
    )},
    { accessorKey: 'industry', header: 'Industry', cell: ({ row }) => row.original.industry || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'website', header: 'Website', cell: ({ row }) => row.original.website ? (
      <span className="text-emerald-600 hover:underline cursor-pointer truncate max-w-[150px] inline-block">{row.original.website}</span>
    ) : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'city', header: 'City', cell: ({ row }) => row.original.city || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'country', header: 'Country', cell: ({ row }) => row.original.country || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'employeeCount', header: 'Employees', cell: ({ row }) => <span>{formatNumber(row.original.employeeCount)}</span> },
    { accessorKey: 'annualRevenue', header: 'Revenue', cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.annualRevenue)}</span> },
    { id: 'actions', size: 50, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onOpenDetail(row.original.id)}>
            <Building2 className="size-4 mr-2" /> Open customer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openEdit(row.original)}>
            <Pencil className="size-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setDeletingItem(row.original); setDeleteOpen(true); }} className="text-red-600 focus:text-red-600">
            <Trash2 className="size-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )},
  ], []);

  const onSubmit = async (values: CompanyFormValues) => {
    setSubmitting(true);
    try {
      if (editing) { await updateRecord<Company>(`/api/crm/companies/${editing.id}`, values); toast.success('Company updated'); }
      else { await createRecord<Company>('/api/crm/companies', values); toast.success('Company created'); }
      setOpen(false); setEditing(null); fetchData();
    } catch (err: any) { toast.error(err.message || 'Operation failed'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try { await deleteRecord(`/api/crm/companies/${deletingItem.id}`); toast.success('Company deleted'); setDeleteOpen(false); setDeletingItem(null); fetchData(); }
    catch (err: any) { toast.error(err.message || 'Delete failed'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Companies" description="Open a customer to see their contacts, deals, projects, invoices and support history">
        <Button onClick={() => { setEditing(null); form.reset(COMPANY_DEFAULTS); setOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> New Company
        </Button>
      </PageHeader>

      <DataTable
        columns={columns} data={companies} isLoading={loading}
        searchPlaceholder="Search companies..."
        onSearchChange={v => { setSearch(v); setPage(0); }}
        onSortChange={s => { if (s.length) { setSort(s[0].id); setSortDir(s[0].desc ? 'desc' : 'asc'); } }}
        onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(0); }}
        page={page} pageSize={pageSize} total={meta.total}
        emptyMessage="No companies found" emptyIcon={Building2}
        // The row is the customer. Clicking it opens the relationship rather
        // than an edit form: reading is what people come here to do.
        onRowClick={(c) => onOpenDetail(c.id)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Company' : 'New Company'}</DialogTitle>
            <DialogDescription>{editing ? 'Update company information.' : 'Add a new company.'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <Field label="Company Name" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} placeholder="Acme Inc" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Industry" error={form.formState.errors.industry?.message}>
                <Input {...form.register('industry')} placeholder="Technology" />
              </Field>
              <Field label="Website" error={form.formState.errors.website?.message}>
                <Input {...form.register('website')} placeholder="https://acme.com" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Phone" error={form.formState.errors.phone?.message}>
                <Input {...form.register('phone')} placeholder="+1 234 567 8900" />
              </Field>
              <Field label="Email" error={form.formState.errors.email?.message}>
                <Input type="email" {...form.register('email')} placeholder="info@acme.com" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="City" error={form.formState.errors.city?.message}>
                <Input {...form.register('city')} placeholder="San Francisco" />
              </Field>
              <Field label="Country" error={form.formState.errors.country?.message}>
                <Input {...form.register('country')} placeholder="United States" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Employees" error={form.formState.errors.employeeCount?.message}>
                <Input type="number" min={0} {...form.register('employeeCount', { valueAsNumber: true })} />
              </Field>
              <Field label="Annual Revenue ($)" error={form.formState.errors.annualRevenue?.message}>
                <Input type="number" min={0} {...form.register('annualRevenue', { valueAsNumber: true })} />
              </Field>
            </div>
            <Field label="Notes" error={form.formState.errors.notes?.message}>
              <Textarea {...form.register('notes')} rows={3} placeholder="Notes..." />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
                {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                {editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Company"
        description={`Are you sure you want to delete "${deletingItem?.name}"? This action cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={handleDelete} isLoading={deleting} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Deals Tab
// ═══════════════════════════════════════════════════════════════════════════

function DealsTab({ focusId, onFocusHandled }: { focusId?: string | null; onFocusHandled?: () => void }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [stageFilter, setStageFilter] = useState('');

  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const { companyOptions, contactOptions } = useCrmLinks(open);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<Deal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<DealFormValues>({ resolver: zodResolver(createDealSchema) as any, defaultValues: DEAL_DEFAULTS });

  const openEdit = (d: Deal) => {
    setEditing(d);
    form.reset({
      name: d.name, value: d.value, stage: d.stage, probability: d.probability,
      expectedClose: d.expectedClose?.split('T')[0] || '',
      companyId: d.companyId, contactId: d.contactId, notes: d.notes, ownerId: d.ownerId,
    });
    setOpen(true);
  };

  useFocusedRecord<Deal>(focusId, '/api/crm/deals', openEdit, onFocusHandled);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize), sort, sortDir });
      if (search) p.set('search', search);
      if (stageFilter) p.set('stage', stageFilter);
      const res = await fetchList<Deal>(`/api/crm/deals?${p}`);
      setDeals(res.data); setMeta(res.meta);
    } catch (err: any) { toast.error(err.message || 'Failed to load deals'); }
    finally { setLoading(false); }
  }, [page, pageSize, search, sort, sortDir, stageFilter]);

  const fetchAllDeals = useCallback(async () => {
    setChartLoading(true);
    try {
      const res = await fetchList<Deal>('/api/crm/deals?pageSize=100&sort=createdAt&sortDir=desc');
      setAllDeals(res.data);
    } catch { /* non-critical */ }
    finally { setChartLoading(false); }
  }, []);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);
  useEffect(() => { fetchAllDeals(); }, [fetchAllDeals]);

  // The pipeline totals are derived from every deal, so both reads refresh.
  useModuleRealtime('crm-deals', ['deals'], () => { fetchDeals(); fetchAllDeals(); });

  const chartData = useMemo(() =>
    DEAL_STAGES.map(stage => ({
      name: DEAL_STAGE_LABELS[stage] || stage,
      value: allDeals.filter(d => d.stage === stage).reduce((sum, d) => sum + (d.value || 0), 0),
      stage,
    })),
  [allDeals]);

  const stageFilterOption: DataTableFilter = useMemo(() => ({
    key: 'stage', label: 'Stage',
    options: DEAL_STAGES.map(s => ({ value: s, label: DEAL_STAGE_LABELS[s] || s })),
  }), []);

  const columns: ColumnDef<Deal>[] = useMemo(() => [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'value', header: 'Value', cell: ({ row }) => <span className="font-medium text-emerald-600">{formatCurrency(row.original.value)}</span> },
    { accessorKey: 'stage', header: 'Stage', cell: ({ row }) => <StatusBadge status={row.original.stage} colorMap={DEAL_STAGE_COLORS} /> },
    { accessorKey: 'probability', header: 'Probability', cell: ({ row }) => (
      <div className="flex items-center gap-2 min-w-[70px]">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${row.original.probability}%` }} />
        </div>
        <span className="text-xs text-muted-foreground w-8 text-right">{row.original.probability}%</span>
      </div>
    )},
    { accessorKey: 'expectedClose', header: 'Close Date', cell: ({ row }) => <span className="text-sm">{row.original.expectedClose ? formatDate(row.original.expectedClose) : '—'}</span> },
    { id: 'contact', header: 'Contact', cell: ({ row }) => {
      const c = row.original.contact;
      return c ? `${c.firstName} ${c.lastName}`.trim() : <span className="text-muted-foreground">—</span>;
    } },
    { id: 'company', header: 'Company', cell: ({ row }) => row.original.company?.name || <span className="text-muted-foreground">—</span> },
    { id: 'actions', size: 50, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(row.original)}>
            <Pencil className="size-4 mr-2" /> Edit
          </DropdownMenuItem>
          {/*
            Intake. The deal stays in the pipeline; this is the private
            reminder that somebody has to chase it.
          */}
          <AddToMyWorkItem
            title={row.original.name}
            source={{
              module: 'crm',
              type: 'deal',
              id: row.original.id,
              label: row.original.company?.name ?? null,
            }}
          />
          <DropdownMenuItem onClick={() => { setDeletingItem(row.original); setDeleteOpen(true); }} className="text-red-600 focus:text-red-600">
            <Trash2 className="size-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )},
  ], []);

  const onSubmit = async (values: DealFormValues) => {
    setSubmitting(true);
    try {
      if (editing) { await updateRecord<Deal>(`/api/crm/deals/${editing.id}`, values); toast.success('Deal updated'); }
      else { await createRecord<Deal>('/api/crm/deals', values); toast.success('Deal created'); }
      setOpen(false); setEditing(null); fetchDeals(); fetchAllDeals();
    } catch (err: any) { toast.error(err.message || 'Operation failed'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    setDeleting(true);
    try { await deleteRecord(`/api/crm/deals/${deletingItem.id}`); toast.success('Deal deleted'); setDeleteOpen(false); setDeletingItem(null); fetchDeals(); fetchAllDeals(); }
    catch (err: any) { toast.error(err.message || 'Delete failed'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Deals" description="Track deals through your pipeline">
        <Button onClick={() => { setEditing(null); form.reset(DEAL_DEFAULTS); setOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> New Deal
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          {chartLoading ? (
            <div className="h-[200px] flex items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                <XAxis type="number" tickFormatter={(v: number) => formatCurrency(v)} fontSize={12} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                  {chartData.map((entry, i) => <Cell key={i} fill={DEAL_STAGE_CHART_COLORS[entry.stage] || '#10b981'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns} data={deals} isLoading={loading}
        searchPlaceholder="Search deals..." filters={[stageFilterOption]}
        onSearchChange={v => { setSearch(v); setPage(0); }}
        onSortChange={s => { if (s.length) { setSort(s[0].id); setSortDir(s[0].desc ? 'desc' : 'asc'); } }}
        onFilterChange={f => { setStageFilter((f.find(x => x.id === 'stage')?.value as string) || ''); setPage(0); }}
        onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(0); }}
        page={page} pageSize={pageSize} total={meta.total}
        emptyMessage="No deals found" emptyIcon={Handshake}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Deal' : 'New Deal'}</DialogTitle>
            <DialogDescription>{editing ? 'Update deal information.' : 'Create a new deal.'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <Field label="Deal Name" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} placeholder="Enterprise Deal" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Labelled with the organization's currency, not a dollar sign. */}
              <Field label={`Deal value (${activeCurrencyCode()})`} error={form.formState.errors.value?.message}>
                <Input type="number" min={0} {...form.register('value', { valueAsNumber: true })} />
              </Field>
              <Field label="Stage" error={form.formState.errors.stage?.message}>
                <Controller control={form.control} name="stage" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                    <SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s} value={s}>{DEAL_STAGE_LABELS[s] || s}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Probability (%)" error={form.formState.errors.probability?.message}>
                <Input type="number" min={0} max={100} {...form.register('probability', { valueAsNumber: true })} />
              </Field>
              <Field label="Close Date" error={form.formState.errors.expectedClose?.message}>
                <Input type="date" {...form.register('expectedClose')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/*
                Pickers rather than typed names: a deal references a company and
                a contact by id, so the text fields that used to be here had
                nowhere to be stored and were dropped on every save.
              */}
              <Field label="Contact" error={form.formState.errors.contactId?.message}>
                <Controller control={form.control} name="contactId" render={({ field }) => (
                  <Select
                    value={field.value ?? NO_LINK}
                    onValueChange={(v) => field.onChange(v === NO_LINK ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="No contact" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>No contact</SelectItem>
                      {contactOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {`${c.firstName} ${c.lastName}`.trim() || 'Unnamed contact'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Company" error={form.formState.errors.companyId?.message}>
                <Controller control={form.control} name="companyId" render={({ field }) => (
                  <Select
                    value={field.value ?? NO_LINK}
                    onValueChange={(v) => field.onChange(v === NO_LINK ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="No company" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>No company</SelectItem>
                      {companyOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
            </div>
            <Field label="Notes" error={form.formState.errors.notes?.message}>
              <Textarea {...form.register('notes')} rows={3} placeholder="Deal notes..." />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
                {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                {editing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Deal"
        description={`Are you sure you want to delete "${deletingItem?.name}"? This action cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={handleDelete} isLoading={deleting} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pipeline Tab (Kanban)
// ═══════════════════════════════════════════════════════════════════════════

function PipelineTab() {
  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const { companyOptions, contactOptions } = useCrmLinks(open);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<DealFormValues>({ resolver: zodResolver(createDealSchema) as any, defaultValues: DEAL_DEFAULTS });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchList<Deal>('/api/crm/deals?pageSize=100&sort=createdAt&sortDir=desc');
      setAllDeals(res.data);
    } catch (err: any) { toast.error(err.message || 'Failed to load pipeline'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onSubmit = async (values: DealFormValues) => {
    if (!editing) return;
    setSubmitting(true);
    try {
      await updateRecord<Deal>(`/api/crm/deals/${editing.id}`, values);
      toast.success('Deal updated');
      setOpen(false); setEditing(null); fetchAll();
    } catch (err: any) { toast.error(err.message || 'Update failed'); }
    finally { setSubmitting(false); }
  };

  const openEdit = (deal: Deal) => {
    setEditing(deal);
    form.reset({
      name: deal.name, value: deal.value, stage: deal.stage, probability: deal.probability,
      expectedClose: deal.expectedClose?.split('T')[0] || '', contactId: deal.contactId,
      companyId: deal.companyId, notes: deal.notes, ownerId: deal.ownerId,
    });
    setOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Pipeline" description="Kanban view of your deals pipeline" />

      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max pb-4">
          {DEAL_STAGES.map(stage => {
            const stageDeals = allDeals.filter(d => d.stage === stage);
            const totalValue = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);
            const label = DEAL_STAGE_LABELS[stage] || stage;

            return (
              <div key={stage} className="min-w-[280px] w-[280px] flex flex-col gap-3">
                {/* Column header */}
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <StatusBadge status={stage} colorMap={DEAL_STAGE_COLORS} />
                    <span className="text-muted-foreground text-sm">{stageDeals.length}</span>
                  </div>
                  <p className="text-foreground font-medium text-sm">{formatCurrency(totalValue)}</p>
                </div>

                {/* Deal cards */}
                <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
                  {stageDeals.length === 0 && (
                    <div className="bg-card rounded-lg border border-dashed p-4 text-center">
                      <p className="text-muted-foreground text-xs">No deals</p>
                    </div>
                  )}
                  {stageDeals.map(deal => (
                    <div
                      key={deal.id}
                      onClick={() => openEdit(deal)}
                      className="bg-card rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow"
                    >
                      <p className="font-medium text-sm text-foreground">{deal.name}</p>
                      <p className="text-emerald-600 font-semibold text-sm mt-1">{formatCurrency(deal.value)}</p>
                      {deal.contact && (
                        <p className="text-muted-foreground text-xs mt-1 flex items-center gap-1">
                          <Users className="size-3" /> {`${deal.contact.firstName} ${deal.contact.lastName}`.trim()}
                        </p>
                      )}
                      {deal.company?.name && (
                        <p className="text-muted-foreground text-xs flex items-center gap-1">
                          <Building2 className="size-3" /> {deal.company.name}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${deal.probability}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{deal.probability}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Deal Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Deal</DialogTitle>
            <DialogDescription>Update deal information.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <Field label="Deal Name" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Labelled with the organization's currency, not a dollar sign. */}
              <Field label={`Deal value (${activeCurrencyCode()})`} error={form.formState.errors.value?.message}>
                <Input type="number" min={0} {...form.register('value', { valueAsNumber: true })} />
              </Field>
              <Field label="Stage" error={form.formState.errors.stage?.message}>
                <Controller control={form.control} name="stage" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s} value={s}>{DEAL_STAGE_LABELS[s] || s}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Probability (%)" error={form.formState.errors.probability?.message}>
                <Input type="number" min={0} max={100} {...form.register('probability', { valueAsNumber: true })} />
              </Field>
              <Field label="Close Date" error={form.formState.errors.expectedClose?.message}>
                <Input type="date" {...form.register('expectedClose')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact" error={form.formState.errors.contactId?.message}>
                <Controller control={form.control} name="contactId" render={({ field }) => (
                  <Select
                    value={field.value ?? NO_LINK}
                    onValueChange={(v) => field.onChange(v === NO_LINK ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="No contact" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>No contact</SelectItem>
                      {contactOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {`${c.firstName} ${c.lastName}`.trim() || 'Unnamed contact'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Company" error={form.formState.errors.companyId?.message}>
                <Controller control={form.control} name="companyId" render={({ field }) => (
                  <Select
                    value={field.value ?? NO_LINK}
                    onValueChange={(v) => field.onChange(v === NO_LINK ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="No company" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>No company</SelectItem>
                      {companyOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
            </div>
            <Field label="Notes" error={form.formState.errors.notes?.message}>
              <Textarea {...form.register('notes')} rows={3} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
                {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                Update
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Activities & Customer Timeline Tab
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── What this tab used to be ──────────────────────────────────────────────
 *
 * Three hard-coded rows in `useState` — "Discovery Call with Sarah Jenkins",
 * the same three for every tenant — and a "Log Activity" button whose handler
 * appended to that array and raised "Activity logged successfully". Nothing
 * was ever sent anywhere. A salesperson who logged a call saw it confirmed,
 * saw it in the list, and lost it on the next refresh.
 *
 * `crm_activities` had been in the schema since 0003, purpose-built for this,
 * with no endpoint on it. The endpoint now exists and this reads and writes it.
 */
function ActivitiesTab() {
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');

  const [open, setOpen] = useState(false);
  const { companyOptions, contactOptions } = useCrmLinks(open);
  const [actType, setActType] = useState('call');
  const [title, setTitle] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ pageSize: '60', sort: 'created_at', sortDir: 'desc' });
      if (typeFilter) p.set('activityType', typeFilter);
      const res = await fetchList<CrmActivity>(`/api/crm/activities?${p}`);
      setActivities(res.data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('A subject is required'); return; }
    if (!linkTo) { toast.error('Choose the customer or contact this is about'); return; }

    // The picker offers both kinds in one list, so the value carries which.
    const [kind, id] = linkTo.split(':');
    setSaving(true);
    try {
      await createRecord('/api/crm/activities', {
        activityType: actType,
        subject: title.trim(),
        body: outcome.trim(),
        ...(kind === 'company' ? { companyId: id } : { contactId: id }),
      });
      toast.success('Activity logged');
      setOpen(false);
      setTitle(''); setLinkTo(''); setOutcome('');
      fetchActivities();
    } catch (err: any) {
      toast.error(err.message || 'Could not log this activity');
    } finally {
      setSaving(false);
    }
  };

  const subjectOf = (a: CrmActivity) => {
    if (a.company?.name) return a.company.name;
    if (a.contact) return `${a.contact.firstName} ${a.contact.lastName}`.trim();
    if (a.lead) return `${a.lead.firstName} ${a.lead.lastName}`.trim();
    if (a.deal?.name) return a.deal.name;
    return 'Unattached';
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sales Activities & Timeline" description="Log calls, meetings, emails, and notes across all customer touchpoints">
        <div className="flex items-center gap-2">
          <Select value={typeFilter || 'all'} onValueChange={v => setTypeFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="call">Calls</SelectItem>
              <SelectItem value="meeting">Meetings</SelectItem>
              <SelectItem value="email">Emails</SelectItem>
              <SelectItem value="note">Notes</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="size-4 mr-2" /> Log Activity
          </Button>
        </div>
      </PageHeader>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No activities logged yet"
          description="Record a call, meeting, email or note against a customer and it will appear here — and on that customer's own timeline."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activities.map((act) => (
            <Card key={act.id} className="border border-border hover:border-emerald-500/50 transition-all">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="capitalize text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    {act.activityType}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDateTime(act.createdAt)}</span>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{act.subject}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{subjectOf(act)}</p>
                </div>
                {act.body && (
                  <div className="text-xs bg-muted/40 p-2.5 rounded-md border text-foreground/90">
                    <span className="font-medium">Outcome: </span>{act.body}
                  </div>
                )}
                <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1">
                  <span>Logged by {act.member?.profiles?.fullName ?? 'someone'}</span>
                  <span>{formatRelativeTime(act.createdAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log Sales Activity</DialogTitle>
            <DialogDescription>Record a call, meeting, or email touchpoint with a prospect.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Activity Type">
              <Select value={actType} onValueChange={setActType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Phone Call</SelectItem>
                  <SelectItem value="meeting">Meeting / Demo</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="note">Internal Note</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Title / Subject">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Discovery Call with Acme Corp" />
            </Field>
            {/*
              A picker, not a free-text box. It used to be an Input, so what a
              salesperson typed was a string attached to nothing — which is why
              the activity could never appear on the customer it was about.
            */}
            <Field label="About">
              <Select value={linkTo} onValueChange={setLinkTo}>
                <SelectTrigger><SelectValue placeholder="Choose a customer or contact" /></SelectTrigger>
                <SelectContent>
                  {companyOptions.map(c => (
                    <SelectItem key={`company:${c.id}`} value={`company:${c.id}`}>{c.name}</SelectItem>
                  ))}
                  {contactOptions.map(c => (
                    <SelectItem key={`contact:${c.id}`} value={`contact:${c.id}`}>
                      {`${c.firstName} ${c.lastName}`.trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Outcome / Notes">
              <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Key takeaways and next steps..." rows={3} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                {saving && <Loader2 className="size-4 animate-spin mr-1.5" />}
                Save Activity
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main CRM Module
// ═══════════════════════════════════════════════════════════════════════════

export default function CrmModule() {
  const [activeTab, setActiveTab] = useState('leads');

  /**
   * A record another surface asked this module to open.
   *
   * Held at the root because the tabs render exclusively: a request for a deal
   * arriving while Leads is showing has to survive being handed to a tab that
   * is not mounted. The tab switches first, then the id goes down as a prop.
   */
  const [focusCompanyId, setFocusCompanyId] = useState<string | null>(null);
  const [focusLeadId, setFocusLeadId] = useState<string | null>(null);
  const [focusContactId, setFocusContactId] = useState<string | null>(null);
  const [focusDealId, setFocusDealId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useFocusRequest('crm', ({ type, id }) => {
    switch (type) {
      case 'company':
        setActiveTab('companies');
        setFocusCompanyId(id);
        setDetailOpen(true);
        break;
      case 'lead': setActiveTab('leads'); setFocusLeadId(id); break;
      case 'contact': setActiveTab('contacts'); setFocusContactId(id); break;
      case 'deal': setActiveTab('deals'); setFocusDealId(id); break;
    }
  });

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 md:p-6 overflow-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="overflow-x-auto w-full sm:w-auto">
            <TabsTrigger value="leads"><Users className="size-4 mr-1.5 hidden sm:inline" />Leads</TabsTrigger>
            <TabsTrigger value="contacts"><Mail className="size-4 mr-1.5 hidden sm:inline" />Contacts</TabsTrigger>
            <TabsTrigger value="companies"><Building2 className="size-4 mr-1.5 hidden sm:inline" />Companies</TabsTrigger>
            <TabsTrigger value="deals"><Handshake className="size-4 mr-1.5 hidden sm:inline" />Deals</TabsTrigger>
            <TabsTrigger value="pipeline"><Target className="size-4 mr-1.5 hidden sm:inline" />Pipeline</TabsTrigger>
            <TabsTrigger value="activities"><Sparkles className="size-4 mr-1.5 hidden sm:inline" />Activities</TabsTrigger>
          </TabsList>
        </Tabs>

        <ExportButton
          module="crm"
          datasets={[
            { key: 'leads', label: 'Leads' },
            { key: 'deals', label: 'Deals' },
          ]}
        />
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'leads' && (
          <motion.div key="leads" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <LeadsTab focusId={focusLeadId} onFocusHandled={() => setFocusLeadId(null)} />
          </motion.div>
        )}
        {activeTab === 'contacts' && (
          <motion.div key="contacts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <ContactsTab focusId={focusContactId} onFocusHandled={() => setFocusContactId(null)} />
          </motion.div>
        )}
        {activeTab === 'companies' && (
          <motion.div key="companies" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <CompaniesTab
              onOpenDetail={(id) => { setFocusCompanyId(id); setDetailOpen(true); }}
            />
          </motion.div>
        )}
        {activeTab === 'deals' && (
          <motion.div key="deals" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <DealsTab focusId={focusDealId} onFocusHandled={() => setFocusDealId(null)} />
          </motion.div>
        )}
        {activeTab === 'pipeline' && (
          <motion.div key="pipeline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <PipelineTab />
          </motion.div>
        )}
        {activeTab === 'activities' && (
          <motion.div key="activities" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <ActivitiesTab />
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        The customer, whole — mounted at the module root rather than inside the
        Companies tab, so a search result can open it directly without the tab
        having rendered first.
      */}
      <CompanyDetail
        companyId={focusCompanyId}
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setFocusCompanyId(null); }}
      />
    </div>
  );
}