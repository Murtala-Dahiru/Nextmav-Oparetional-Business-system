'use client';

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  DollarSign, Plus, FileText, Receipt, TrendingUp, TrendingDown, Wallet,
  Pencil, Trash2, MoreHorizontal, Loader2, ArrowUpRight,
  CircleDollarSign, PieChart as PieChartIcon,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { StatCard } from '@/components/shared/stat-card';
import { formatCurrency, formatDate } from '@/lib/format';
import { INVOICE_STATUSES, EXPENSE_CATEGORIES } from '@/lib/constants';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Separator } from '@/components/ui/separator';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

/**
 * These mirror what `/api/finance/*` actually returns.
 *
 * They previously described the pre-migration ORM's shape — `items` as a JSON
 * string, a flat `tax`, free-text `contactName`/`companyName`, `date` on an
 * expense. None of those exist on the Supabase schema, so the amounts rendered
 * as "$NaN" and the customer column was permanently blank. The invoice totals
 * are derived by the server from the line items, so they are read-only here.
 */
interface InvoiceRecord {
  id: string; invoiceNumber: string; status: string;
  companyId: string | null; contactId: string | null;
  subtotal: number; taxRate: number; taxAmount: number; discount: number;
  total: number; amountPaid: number; currency: string;
  issueDate: string; dueDate: string; paidAt: string | null; notes: string;
  createdAt: string; updatedAt: string;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  lineItems?: { id: string; description: string; quantity: number; unitPrice: number; lineTotal: number }[];
}

interface ExpenseRecord {
  id: string; title: string; amount: number; category: string; vendor: string;
  expenseDate: string; status: string; receiptPath: string | null; notes: string;
  currency: string; createdAt: string; updatedAt: string;
  submittedBy?: string;
}

interface CustomerOption { id: string; name: string }
interface ContactOption { id: string; firstName: string; lastName: string; email: string | null }

/**
 * Radix Select treats "" as "no value" and renders the placeholder, so an
 * explicit "None" item needs a non-empty sentinel of its own.
 */
const NO_CUSTOMER = '__none__';

/** "Acme Inc." / "Jane Doe" / "—", from whichever relation the invoice carries. */
function invoiceCustomer(inv: InvoiceRecord): string {
  if (inv.company?.name) return inv.company.name;
  if (inv.contact) return `${inv.contact.firstName} ${inv.contact.lastName}`.trim();
  return '—';
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground',
};

const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  general: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  travel: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  office: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  software: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  marketing: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
};

const EXPENSE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const INVOICE_STATUS_FILTERS: DataTableFilter[] = [
  {
    key: 'status',
    label: 'Status',
    options: INVOICE_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
  },
];

const EXPENSE_FILTERS: DataTableFilter[] = [
  {
    key: 'category',
    label: 'Category',
    options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
  },
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'approved', label: 'Approved' },
      { value: 'rejected', label: 'Rejected' },
    ],
  },
];

const PIE_COLORS: Record<string, string> = {
  general: '#64748b',
  travel: '#3b82f6',
  office: '#f59e0b',
  software: '#8b5cf6',
  marketing: '#ec4899',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// Invoice numbers are issued by the database from a per-organization sequence
// (INV-000001, INV-000002, …). A timestamp-derived number generated here used
// to be sent with every create and silently discarded; worse, two invoices
// raised in the same second would have carried the same one.

// ═══════════════════════════════════════════════════════════════════════════
//  Overview Tab
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab({ onSwitchTab }: { onSwitchTab: (tab: string) => void }) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [invRes, expRes] = await Promise.all([
          fetchList<InvoiceRecord>('/api/finance/invoices?pageSize=1000'),
          fetchList<ExpenseRecord>('/api/finance/expenses?pageSize=1000'),
        ]);
        setInvoices(invRes.data);
        setExpenses(expRes.data);
      } catch (e: any) {
        toast.error(e.message || 'Failed to load finance data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Computed stats
  const totalRevenue = useMemo(() => invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total, 0), [invoices]);
  const outstanding = useMemo(() => invoices.filter((i) => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + i.total, 0), [invoices]);
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const netIncome = totalRevenue - totalExpenses;

  // Revenue by month (AreaChart data)
  const revenueByMonth = useMemo(() => {
    const monthMap: Record<string, number> = {};
    invoices.forEach((inv) => {
      if (inv.status !== 'paid') return;
      const d = new Date(inv.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = (monthMap[key] || 0) + inv.total;
    });
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, revenue]) => {
        const [y, m] = key.split('-');
        return { month: `${MONTH_NAMES[parseInt(m) - 1]} ${y}`, revenue };
      });
  }, [invoices]);

  // Expense by category (PieChart data)
  const expenseByCategory = useMemo(() => {
    const catMap: Record<string, number> = {};
    expenses.forEach((exp) => {
      catMap[exp.category] = (catMap[exp.category] || 0) + exp.amount;
    });
    return Object.entries(catMap).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  // Recent invoices (top 5 by date)
  const recentInvoices = useMemo(
    () => [...invoices].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5),
    [invoices],
  );

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}><CardContent className="p-4"><div className="h-20 animate-pulse bg-muted rounded" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Finance" icon={DollarSign} />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Revenue" value={formatCurrency(totalRevenue)} icon={TrendingUp} />
        <StatCard label="Outstanding" value={formatCurrency(outstanding)} icon={Wallet} />
        <StatCard label="Total Expenses" value={formatCurrency(totalExpenses)} icon={Receipt} />
        <StatCard label="Net Income" value={formatCurrency(netIncome)} icon={netIncome >= 0 ? TrendingUp : TrendingDown} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by month */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Revenue by Month</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByMonth.length === 0 ? (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                No paid invoices to display
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={revenueByMonth}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => [formatCurrency(value), 'Revenue']} />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#revenueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Expense breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseByCategory.length === 0 ? (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                No expenses to display
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={250}>
                  <PieChart>
                    <Pie
                      data={expenseByCategory}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {expenseByCategory.map((entry) => (
                        <Cell key={entry.name} fill={PIE_COLORS[entry.name] || '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [formatCurrency(value), 'Amount']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2.5 flex-1">
                  {expenseByCategory.map((item) => (
                    <div key={item.name} className="flex items-center gap-2 text-sm">
                      <div className="size-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[item.name] || '#94a3b8' }} />
                      <span className="text-muted-foreground capitalize flex-1">{item.name}</span>
                      <span className="font-medium">{formatCurrency(item.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Recent Invoices</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => onSwitchTab('invoices')} className="text-emerald-600">
            View all <ArrowUpRight className="size-3.5 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No invoices yet</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left font-medium px-4 py-2.5">Invoice #</th>
                    <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">Customer</th>
                    <th className="text-right font-medium px-4 py-2.5">Amount</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                    <th className="text-left font-medium px-4 py-2.5 hidden lg:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium">{inv.invoiceNumber}</td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">{invoiceCustomer(inv)}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(inv.total)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={inv.status} colorMap={INVOICE_STATUS_COLORS} /></td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden lg:table-cell">{formatDate(inv.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onSwitchTab('invoices')}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-emerald-500/10 text-emerald-600 flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FileText className="size-5" />
            </div>
            <div>
              <p className="font-medium text-sm">New Invoice</p>
              <p className="text-muted-foreground text-xs">Create and send invoices</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onSwitchTab('expenses')}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-emerald-500/10 text-emerald-600 flex size-10 shrink-0 items-center justify-center rounded-lg">
              <Receipt className="size-5" />
            </div>
            <div>
              <p className="font-medium text-sm">New Expense</p>
              <p className="text-muted-foreground text-xs">Track business expenses</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Invoices Tab
// ═══════════════════════════════════════════════════════════════════════════

interface InvoiceFormData {
  /** A real CRM company or contact — the schema stores a foreign key, not a name. */
  companyId: string;
  contactId: string;
  status: string;
  items: LineItem[];
  taxRate: number;
  dueDate: string;
  notes: string;
}

const EMPTY_LINE_ITEM: LineItem = { description: '', quantity: 1, unitPrice: 0 };

const INVOICE_FORM_DEFAULTS: InvoiceFormData = {
  companyId: '', contactId: '', status: 'draft',
  items: [{ ...EMPTY_LINE_ITEM }], taxRate: 10, dueDate: '', notes: '',
};

function InvoicesTab() {
  // Table state
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 10, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<InvoiceRecord | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form, setForm] = useState<InvoiceFormData>(INVOICE_FORM_DEFAULTS);

  // Edit form (simpler: status + notes)
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Customers to bill, from CRM.
  const [companies, setCompanies] = useState<CustomerOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
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
      const res = await fetchList<InvoiceRecord>(`/api/finance/invoices?${params}`);
      setInvoices(res.data);
      setMeta(res.meta);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, sorting, columnFilters]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // "Invoice created — Finance updates instantly." Line items too: the totals
  // on every row are derived from them by the server.
  useModuleRealtime('invoices', ['invoices'], () => fetchInvoices());

  /**
   * Loaded once the dialog opens rather than on mount: most visits to this tab
   * only read the register, and the list is only needed to fill the pickers.
   * A failure here is not fatal — the invoice can still be raised without a
   * customer — so it warns instead of blocking the form.
   */
  useEffect(() => {
    if (!createOpen || companies.length || contacts.length) return;
    let cancelled = false;
    setCustomersLoading(true);
    (async () => {
      try {
        const [co, ct] = await Promise.all([
          fetchList<CustomerOption>('/api/crm/companies?pageSize=100'),
          fetchList<ContactOption>('/api/crm/contacts?pageSize=100'),
        ]);
        if (cancelled) return;
        setCompanies(co.data);
        setContacts(ct.data);
      } catch (e: any) {
        if (!cancelled) toast.error(e.message || 'Could not load customers');
      } finally {
        if (!cancelled) setCustomersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [createOpen, companies.length, contacts.length]);

  // Computed values from form items
  const computedSubtotal = useMemo(() => form.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), [form.items]);
  const computedTax = useMemo(() => computedSubtotal * form.taxRate / 100, [computedSubtotal, form.taxRate]);
  const computedTotal = useMemo(() => computedSubtotal + computedTax, [computedSubtotal, computedTax]);

  // Column definitions
  const columns: ColumnDef<InvoiceRecord>[] = useMemo(() => [
    {
      accessorKey: 'invoiceNumber',
      header: 'Invoice #',
      cell: ({ row }) => <span className="font-medium">{row.original.invoiceNumber}</span>,
    },
    { accessorKey: 'contactName', header: 'Contact' },
    { accessorKey: 'companyName', header: 'Company' },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={INVOICE_STATUS_COLORS} />,
    },
    {
      accessorKey: 'subtotal',
      header: 'Subtotal',
      cell: ({ row }) => <span className="text-right block">{formatCurrency(row.original.subtotal)}</span>,
    },
    {
      accessorKey: 'taxAmount',
      header: 'Tax',
      cell: ({ row }) => <span className="text-right block">{formatCurrency(row.original.taxAmount)}</span>,
    },
    {
      accessorKey: 'total',
      header: 'Total',
      cell: ({ row }) => <span className="text-right block font-medium">{formatCurrency(row.original.total)}</span>,
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.dueDate)}</span>,
    },
    {
      accessorKey: 'paidAt',
      header: 'Paid At',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {row.original.paidAt ? formatDate(row.original.paidAt) : '—'}
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
            <DropdownMenuItem onClick={() => {
              setSelected(row.original);
              setEditStatus(row.original.status);
              setEditNotes(row.original.notes);
              setEditOpen(true);
            }}>
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

  // Item management helpers
  const updateItem = (index: number, field: keyof LineItem, value: string | number) => {
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
  };

  const addItem = () => setForm((prev) => ({ ...prev, items: [...prev.items, { ...EMPTY_LINE_ITEM }] }));
  const removeItem = (index: number) => {
    if (form.items.length <= 1) return;
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  // Create handler
  const handleCreate = async () => {
    if (!form.companyId && !form.contactId) {
      toast.error('Choose the customer this invoice is for');
      return;
    }
    if (!form.dueDate) {
      toast.error('Due date is required');
      return;
    }
    const validItems = form.items.filter((i) => i.description && i.quantity > 0 && i.unitPrice > 0);
    if (validItems.length === 0) {
      toast.error('At least one valid line item is required');
      return;
    }
    setFormLoading(true);
    try {
      /**
       * The invoice number, subtotal, tax and total are deliberately absent.
       *
       * All four are assigned by the server — the number from a per-tenant
       * sequence, the money from the line items it stores — so sending the
       * values computed above would be a second, unauthoritative copy that
       * silently disagrees the moment a rounding rule changes. The figures on
       * screen are a preview of what the server will calculate, not an input.
       */
      const payload = {
        companyId: form.companyId || null,
        contactId: form.contactId || null,
        status: form.status,
        lineItems: validItems,
        taxRate: form.taxRate,
        dueDate: form.dueDate,
        notes: form.notes,
      };
      await createRecord('/api/finance/invoices', payload);
      toast.success('Invoice created successfully');
      setCreateOpen(false);
      setForm(INVOICE_FORM_DEFAULTS);
      fetchInvoices();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create invoice');
    } finally {
      setFormLoading(false);
    }
  };

  // Edit handler
  const handleEdit = async () => {
    if (!selected) return;
    setFormLoading(true);
    try {
      await updateRecord(`/api/finance/invoices/${selected.id}`, { status: editStatus, notes: editNotes });
      toast.success('Invoice updated successfully');
      setEditOpen(false);
      setSelected(null);
      fetchInvoices();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update invoice');
    } finally {
      setFormLoading(false);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!selected) return;
    setFormLoading(true);
    try {
      await deleteRecord(`/api/finance/invoices/${selected.id}`);
      toast.success('Invoice deleted successfully');
      setDeleteOpen(false);
      setSelected(null);
      fetchInvoices();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete invoice');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" icon={FileText}>
        <Button onClick={() => { setForm(INVOICE_FORM_DEFAULTS); setCreateOpen(true); }} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="size-4 mr-2" />New Invoice
        </Button>
      </PageHeader>

      <DataTable
        columns={columns}
        data={invoices}
        isLoading={loading}
        searchPlaceholder="Search invoices..."
        filters={INVOICE_STATUS_FILTERS}
        total={meta.total}
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
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
            <DialogDescription>Create a new invoice with line items.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/*
                Pickers rather than free text: an invoice is stored against a
                CRM company or contact by id. Typed-in names had nowhere to go
                and were dropped on save.
              */}
              <Field label="Company">
                <Select
                  value={form.companyId || NO_CUSTOMER}
                  onValueChange={(v) => setForm((p) => ({ ...p, companyId: v === NO_CUSTOMER ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={customersLoading ? 'Loading…' : 'Select a company'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CUSTOMER}>None</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Contact">
                <Select
                  value={form.contactId || NO_CUSTOMER}
                  onValueChange={(v) => setForm((p) => ({ ...p, contactId: v === NO_CUSTOMER ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={customersLoading ? 'Loading…' : 'Select a contact'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CUSTOMER}>None</SelectItem>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {`${c.firstName} ${c.lastName}`.trim() || c.email || 'Unnamed contact'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVOICE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Due Date *">
                <Input type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} />
              </Field>
            </div>

            <Separator />

            {/* Line Items */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Line Items</Label>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_80px_100px_32px] gap-2 items-end">
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Description</Label>}
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(idx, 'description', e.target.value)}
                        placeholder="Item description"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Qty</Label>}
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value) || 0)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Unit Price</Label>}
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.unitPrice}
                        onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value) || 0)}
                        className="h-9"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-muted-foreground hover:text-red-500"
                      onClick={() => removeItem(idx)}
                      disabled={form.items.length <= 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addItem} className="w-full">
                <Plus className="size-4 mr-1.5" />Add Line Item
              </Button>
            </div>

            <Separator />

            {/* Totals */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tax Rate (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.taxRate}
                  onChange={(e) => setForm((p) => ({ ...p, taxRate: Number(e.target.value) || 0 }))}
                />
              </Field>
              <div className="flex flex-col justify-end gap-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span>{formatCurrency(computedSubtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tax:</span><span>{formatCurrency(computedTax)}</span></div>
                <div className="flex justify-between font-semibold text-base border-t pt-1 mt-1">
                  <span>Total:</span><span>{formatCurrency(computedTotal)}</span>
                </div>
              </div>
            </div>

            <Field label="Notes">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Additional notes..."
                rows={2}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={formLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {formLoading && <Loader2 className="size-4 mr-2 animate-spin" />}Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
            <DialogDescription>Update invoice status and notes.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {selected && (
              <div className="text-sm text-muted-foreground">
                Invoice <span className="font-medium text-foreground">{selected.invoiceNumber}</span> — {formatCurrency(selected.total)}
              </div>
            )}
            <Field label="Status">
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVOICE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes..."
                rows={3}
              />
            </Field>
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
        title="Delete Invoice"
        description={`Are you sure you want to delete invoice ${selected?.invoiceNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={formLoading}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Expenses Tab
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The expense form.
 *
 * `expenseDate`, not `date`. The column is `expense_date`, and the create route
 * reads `b.expense_date` — so a form sending `date` had its value discarded and
 * the route substituted today, every time. Nobody noticed because the default
 * *is* today: the field only visibly failed when someone claimed for a receipt
 * from last week, and then it silently filed it as though it were today's.
 *
 * The same name is what broke editing an expense outright: `date` is not a
 * column, so the update was refused rather than ignored.
 */
interface ExpenseFormData {
  title: string;
  amount: number;
  category: string;
  vendor: string;
  expenseDate: string;
  notes: string;
}

const EXPENSE_DEFAULTS: ExpenseFormData = {
  title: '', amount: 0, category: 'general', vendor: '',
  expenseDate: new Date().toISOString().split('T')[0], notes: '',
};

function ExpensesTab() {
  // Table state
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 10, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<ExpenseRecord | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form, setForm] = useState<ExpenseFormData>(EXPENSE_DEFAULTS);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
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
      const res = await fetchList<ExpenseRecord>(`/api/finance/expenses?${params}`);
      setExpenses(res.data);
      setMeta(res.meta);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, sorting, columnFilters]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  // A claim submitted or decided moves both the table and the category chart.
  useModuleRealtime('expenses', ['expenses'], () => fetchExpenses());

  // Column definitions
  const columns: ColumnDef<ExpenseRecord>[] = useMemo(() => [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.amount)}</span>,
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => <StatusBadge status={row.original.category} colorMap={EXPENSE_CATEGORY_COLORS} />,
    },
    { accessorKey: 'vendor', header: 'Vendor' },
    {
      accessorKey: 'expenseDate',
      header: 'Date',
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.expenseDate)}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={EXPENSE_STATUS_COLORS} />,
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
            <DropdownMenuItem onClick={() => {
              const exp = row.original;
              setSelected(exp);
              setForm({
                title: exp.title,
                amount: exp.amount,
                category: exp.category,
                vendor: exp.vendor,
                expenseDate: exp.expenseDate.split('T')[0],
                notes: exp.notes,
              });
              setEditOpen(true);
            }}>
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
    if (!form.title) { toast.error('Title is required'); return; }
    if (form.amount <= 0) { toast.error('Amount must be greater than 0'); return; }
    if (!form.expenseDate) { toast.error('Date is required'); return; }
    setFormLoading(true);
    try {
      await createRecord('/api/finance/expenses', form);
      toast.success('Expense created successfully');
      setCreateOpen(false);
      setForm(EXPENSE_DEFAULTS);
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create expense');
    } finally {
      setFormLoading(false);
    }
  };

  // Edit handler
  const handleEdit = async () => {
    if (!selected) return;
    setFormLoading(true);
    try {
      await updateRecord(`/api/finance/expenses/${selected.id}`, form);
      toast.success('Expense updated successfully');
      setEditOpen(false);
      setSelected(null);
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update expense');
    } finally {
      setFormLoading(false);
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!selected) return;
    setFormLoading(true);
    try {
      await deleteRecord(`/api/finance/expenses/${selected.id}`);
      toast.success('Expense deleted successfully');
      setDeleteOpen(false);
      setSelected(null);
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete expense');
    } finally {
      setFormLoading(false);
    }
  };

  const ExpenseFormFields = ({ formData, onChange }: { formData: ExpenseFormData; onChange: (f: ExpenseFormData) => void }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
      <div className="sm:col-span-2">
        <Field label="Title *">
          <Input value={formData.title} onChange={(e) => onChange({ ...formData, title: e.target.value })} placeholder="Expense title" />
        </Field>
      </div>
      <Field label="Amount *">
        <Input type="number" min={0} step={0.01} value={formData.amount} onChange={(e) => onChange({ ...formData, amount: Number(e.target.value) || 0 })} placeholder="0.00" />
      </Field>
      <Field label="Category">
        <Select value={formData.category} onValueChange={(v) => onChange({ ...formData, category: v })}>
          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Vendor">
        <Input value={formData.vendor} onChange={(e) => onChange({ ...formData, vendor: e.target.value })} placeholder="Vendor name" />
      </Field>
      <Field label="Date *">
        <Input type="date" value={formData.expenseDate} onChange={(e) => onChange({ ...formData, expenseDate: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes">
          <Textarea value={formData.notes} onChange={(e) => onChange({ ...formData, notes: e.target.value })} placeholder="Additional notes..." rows={2} />
        </Field>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Expenses" icon={Receipt}>
        <Button onClick={() => { setForm(EXPENSE_DEFAULTS); setCreateOpen(true); }} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="size-4 mr-2" />New Expense
        </Button>
      </PageHeader>

      <DataTable
        columns={columns}
        data={expenses}
        isLoading={loading}
        searchPlaceholder="Search expenses..."
        filters={EXPENSE_FILTERS}
        total={meta.total}
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
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>New Expense</DialogTitle>
            <DialogDescription>Record a new business expense.</DialogDescription>
          </DialogHeader>
          <ExpenseFormFields formData={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={formLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {formLoading && <Loader2 className="size-4 mr-2 animate-spin" />}Create Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
            <DialogDescription>Update expense details.</DialogDescription>
          </DialogHeader>
          <ExpenseFormFields formData={form} onChange={setForm} />
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
        title="Delete Expense"
        description={`Are you sure you want to delete "${selected?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={formLoading}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Purchase Requests & Approvals Tab
// ═══════════════════════════════════════════════════════════════════════════

function PurchaseRequestsTab() {
  const [requests, setRequests] = useState([
    { id: 'PR-101', item: '4x Apple MacBook Pro M3 (Engineering)', department: 'Engineering', requestedBy: 'Jordan Lee', amount: 11600, status: 'pending', date: '2026-07-22' },
    { id: 'PR-102', item: 'Salesforce Enterprise Annual Renewal', department: 'Sales', requestedBy: 'Sarah Jenkins', amount: 48000, status: 'approved', date: '2026-07-20' },
    { id: 'PR-103', item: 'AWS Cloud Reserved Instances', department: 'DevOps', requestedBy: 'Alex Morgan', amount: 24000, status: 'approved', date: '2026-07-18' },
  ]);

  const handleApprove = (id: string) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
    toast.success(`Purchase Request ${id} approved`);
  };

  const handleReject = (id: string) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r));
    toast.info(`Purchase Request ${id} rejected`);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Purchase Requests & Approval Workflows" description="Submit and review company expenditure requests requiring manager approval">
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> New Purchase Request
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending Approvals" value={requests.filter(r => r.status === 'pending').length} icon={Receipt} />
        <StatCard label="Approved (This Month)" value={formatCurrency(requests.filter(r => r.status === 'approved').reduce((sum, r) => sum + r.amount, 0))} icon={TrendingUp} />
        <StatCard label="Active Purchase Orders" value="12" icon={FileText} />
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="p-3 text-left font-medium text-muted-foreground">Request ID</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Item / Service</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Department</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Requested By</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Amount</th>
              <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-accent/30">
                <td className="p-3 font-mono font-medium text-foreground">{r.id}</td>
                <td className="p-3 font-medium text-foreground">{r.item}</td>
                <td className="p-3 text-muted-foreground">{r.department}</td>
                <td className="p-3 text-muted-foreground">{r.requestedBy}</td>
                <td className="p-3 font-semibold text-foreground">{formatCurrency(r.amount)}</td>
                <td className="p-3">
                  <Badge variant="outline" className={r.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : r.status === 'pending' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-red-500/10 text-red-600 border-red-500/20'}>
                    {r.status}
                  </Badge>
                </td>
                <td className="p-3 text-right space-x-1">
                  {r.status === 'pending' && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600 hover:text-emerald-700" onClick={() => handleApprove(r.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700" onClick={() => handleReject(r.id)}>
                        Reject
                      </Button>
                    </>
                  )}
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
//  Main Finance Module
// ═══════════════════════════════════════════════════════════════════════════

export default function FinanceModule() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 md:p-6 overflow-auto">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="overflow-x-auto w-full sm:w-auto">
          <TabsTrigger value="overview">
            <CircleDollarSign className="size-4 mr-1.5 hidden sm:inline" />Overview
          </TabsTrigger>
          <TabsTrigger value="invoices">
            <FileText className="size-4 mr-1.5 hidden sm:inline" />Invoices
          </TabsTrigger>
          <TabsTrigger value="expenses">
            <Receipt className="size-4 mr-1.5 hidden sm:inline" />Expenses
          </TabsTrigger>
          <TabsTrigger value="approvals">
            <TrendingUp className="size-4 mr-1.5 hidden sm:inline" />Purchase Approvals
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <OverviewTab onSwitchTab={setActiveTab} />
          </motion.div>
        )}
        {activeTab === 'invoices' && (
          <motion.div key="invoices" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <InvoicesTab />
          </motion.div>
        )}
        {activeTab === 'expenses' && (
          <motion.div key="expenses" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <ExpensesTab />
          </motion.div>
        )}
        {activeTab === 'approvals' && (
          <motion.div key="approvals" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <PurchaseRequestsTab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}