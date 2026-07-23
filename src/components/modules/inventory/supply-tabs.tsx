'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, MoreHorizontal, Loader2, Truck, ArrowDownUp, ClipboardList,
  AlertTriangle, PackageX, PackageCheck, ArrowDown, ArrowUp, X, Mail, Phone, Clock,
} from 'lucide-react';

import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/format';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ═══════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════

interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

export interface Supplier {
  id: string; name: string; contactName: string; email: string; phone: string;
  address: string; city: string; country: string; leadTimeDays: number;
  paymentTerms: string; notes: string; isActive: boolean;
  createdAt: string; updatedAt: string;
  _count?: { products: number; purchaseOrders: number };
}

export interface StockMovement {
  id: string; productId: string; type: string; quantity: number; balanceAfter: number;
  reason: string; reference: string; createdAt: string;
  product?: { id: string; name: string; sku: string; unit: string };
  user?: { id: string; firstName: string; lastName: string };
  fromWarehouse?: { id: string; name: string } | null;
  toWarehouse?: { id: string; name: string } | null;
}

export interface PurchaseOrderItem {
  id: string; productId: string; quantity: number; unitCost: number; receivedQuantity: number;
  product?: { id: string; name: string; sku: string; unit: string };
}

export interface PurchaseOrder {
  id: string; orderNumber: string; supplierId: string; warehouseId: string | null;
  status: string; orderDate: string; expectedDate: string | null; receivedAt: string | null;
  subtotal: number; tax: number; total: number; notes: string;
  supplier?: { id: string; name: string; leadTimeDays: number };
  warehouse?: { id: string; name: string } | null;
  createdBy?: { id: string; firstName: string; lastName: string };
  items: PurchaseOrderItem[];
}

export interface ReorderAlert {
  id: string; name: string; sku: string; category: string; unit: string;
  stock: number; reorderLevel: number; cost: number;
  warehouse?: { id: string; name: string } | null;
  supplier?: { id: string; name: string; leadTimeDays: number } | null;
  incoming: number; shortfall: number; suggestedOrderQty: number;
  estimatedCost: number; severity: 'out_of_stock' | 'low' | 'covered';
}

interface MinimalProduct { id: string; name: string; sku: string; unit: string; cost: number }
interface MinimalWarehouse { id: string; name: string }

// ═══════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════

const MOVEMENT_TYPES = ['receipt', 'issue', 'transfer', 'adjustment', 'return'] as const;

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: 'Receipt', issue: 'Issue', transfer: 'Transfer',
  adjustment: 'Adjustment', return: 'Return',
};

const MOVEMENT_COLORS: Record<string, string> = {
  receipt: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  issue: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  transfer: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  adjustment: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  return: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

const PO_STATUSES = ['draft', 'submitted', 'approved', 'received', 'cancelled'] as const;

const PO_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  approved: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  received: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

/** Mirrors the transitions the API enforces, so the UI never offers an illegal action. */
const PO_NEXT_STATUS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'draft', 'cancelled'],
  approved: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

const PAYMENT_TERMS = [
  { value: 'prepaid', label: 'Prepaid' },
  { value: 'net15', label: 'Net 15' },
  { value: 'net30', label: 'Net 30' },
  { value: 'net60', label: 'Net 60' },
];

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
  return json;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Suppliers Tab
// ═══════════════════════════════════════════════════════════════

interface SupplierFormState {
  name: string; contactName: string; email: string; phone: string;
  address: string; city: string; country: string; leadTimeDays: string;
  paymentTerms: string; notes: string; isActive: boolean;
}

const emptySupplierForm: SupplierFormState = {
  name: '', contactName: '', email: '', phone: '', address: '', city: '',
  country: '', leadTimeDays: '7', paymentTerms: 'net30', notes: '', isActive: true,
};

export function SuppliersTab({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormState>(emptySupplierForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) });
      if (search) p.set('search', search);
      const res = await apiFetch<{ data: Supplier[]; meta: ApiMeta }>(`/api/inventory/suppliers?${p}`);
      setRows(res.data); setMeta(res.meta);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, pageSize, search]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const openCreate = () => { setEditing(null); setForm(emptySupplierForm); setOpen(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name, contactName: s.contactName, email: s.email, phone: s.phone,
      address: s.address, city: s.city, country: s.country,
      leadTimeDays: String(s.leadTimeDays), paymentTerms: s.paymentTerms,
      notes: s.notes, isActive: s.isActive,
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Supplier name is required'); return; }
    setSubmitting(true);
    try {
      const payload = { ...form, leadTimeDays: Number(form.leadTimeDays) || 0 };
      if (editing) {
        await apiFetch(`/api/inventory/suppliers/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Supplier updated');
      } else {
        await apiFetch('/api/inventory/suppliers', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Supplier created');
      }
      setOpen(false); fetchRows(); onChanged?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch<{ data: { deactivated: boolean; message?: string } }>(
        `/api/inventory/suppliers/${deleteTarget.id}`, { method: 'DELETE' },
      );
      // The API deactivates rather than deletes when purchasing history exists.
      toast.success(res.data.deactivated ? res.data.message ?? 'Supplier deactivated' : 'Supplier deleted');
      setDeleteTarget(null); fetchRows(); onChanged?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setDeleting(false); }
  };

  const columns: ColumnDef<Supplier>[] = useMemo(() => [
    {
      accessorKey: 'name', header: 'Supplier',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <div className="bg-emerald-500/10 text-emerald-600 flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Truck className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{row.original.name}</div>
            {row.original.contactName && (
              <div className="text-muted-foreground text-xs truncate">{row.original.contactName}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'contact', header: 'Contact',
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5 text-xs">
          {row.original.email
            ? <span className="flex items-center gap-1"><Mail className="size-3" />{row.original.email}</span>
            : null}
          {row.original.phone
            ? <span className="flex items-center gap-1 text-muted-foreground"><Phone className="size-3" />{row.original.phone}</span>
            : null}
          {!row.original.email && !row.original.phone && <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      id: 'location', header: 'Location',
      cell: ({ row }) => {
        const parts = [row.original.city, row.original.country].filter(Boolean);
        return parts.length ? parts.join(', ') : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: 'leadTimeDays', header: 'Lead time',
      cell: ({ row }) => (
        <span className="flex items-center gap-1 text-sm">
          <Clock className="size-3.5 text-muted-foreground" />{row.original.leadTimeDays}d
        </span>
      ),
    },
    {
      id: 'usage', header: 'Linked',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {row.original._count?.products ?? 0} product(s) · {row.original._count?.purchaseOrders ?? 0} order(s)
        </span>
      ),
    },
    {
      accessorKey: 'isActive', header: 'Status',
      cell: ({ row }) => (
        <Badge className={row.original.isActive
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}>
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      id: 'actions', size: 60,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEdit(row.original)}>
              <Pencil className="size-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteTarget(row.original)}>
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], []);

  const activeCount = rows.filter(r => r.isActive).length;
  const avgLead = rows.length ? Math.round(rows.reduce((s, r) => s + r.leadTimeDays, 0) / rows.length) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers" description="Vendors you buy stock from, and how long they take to deliver." icon={Truck}>
        <Button onClick={openCreate} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> Add Supplier
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Suppliers" value={meta.total} icon={Truck} />
        <StatCard label="Active" value={activeCount} icon={PackageCheck} />
        <StatCard label="Avg lead time" value={`${avgLead} days`} icon={Clock} />
      </div>

      <DataTable
        columns={columns} data={rows} isLoading={loading}
        searchPlaceholder="Search suppliers..."
        total={meta.total} page={page} pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(0); }}
        onSearchChange={v => { setSearch(v); setPage(0); }}
        emptyMessage="No suppliers yet" emptyIcon={Truck}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Supplier' : 'New Supplier'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update this supplier’s details.' : 'Add a vendor you purchase stock from.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field label="Supplier name">
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Globex Components" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact person">
                <Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} placeholder="Rita Vale" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="orders@globex.com" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Phone">
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+1 234 567 8900" />
              </Field>
              <Field label="Lead time (days)" hint="Used to flag reorders that may arrive late.">
                <Input type="number" min={0} value={form.leadTimeDays}
                  onChange={e => setForm({ ...form, leadTimeDays: e.target.value })} />
              </Field>
            </div>
            <Field label="Address">
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="120 Industrial Way" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="City">
                <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Austin" />
              </Field>
              <Field label="Country">
                <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="United States" />
              </Field>
            </div>
            <Field label="Payment terms">
              <Select value={form.paymentTerms} onValueChange={v => setForm({ ...form, paymentTerms: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERMS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Preferred vendor for licences..." />
            </Field>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Active</Label>
                <p className="text-muted-foreground text-xs">Inactive suppliers are hidden from new orders.</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}
        title="Delete supplier"
        description={`Delete "${deleteTarget?.name}"? If this supplier is linked to products or purchase orders it will be deactivated instead, so purchasing history is preserved.`}
        confirmLabel="Delete" variant="destructive" onConfirm={confirmDelete} isLoading={deleting}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Stock Movements Tab
// ═══════════════════════════════════════════════════════════════

export function MovementsTab({
  products, warehouses, onChanged,
}: { products: MinimalProduct[]; warehouses: MinimalWarehouse[]; onChanged?: () => void }) {
  const [rows, setRows] = useState<StockMovement[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productId, setProductId] = useState('');
  const [type, setType] = useState<string>('receipt');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) });
      if (search) p.set('search', search);
      const res = await apiFetch<{ data: StockMovement[]; meta: ApiMeta }>(`/api/inventory/movements?${p}`);
      setRows(res.data); setMeta(res.meta);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, pageSize, search]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const selectedProduct = products.find(p => p.id === productId);

  // "Issue" and "transfer" remove stock, so the signed delta sent to the API is
  // negative. The form only ever asks the user for a positive amount.
  const isOutbound = type === 'issue' || type === 'transfer';
  const signedQuantity = (Number(amount) || 0) * (isOutbound ? -1 : 1);

  const resetForm = () => {
    setProductId(''); setType('receipt'); setAmount('1');
    setReason(''); setReference(''); setWarehouseId('');
  };

  const submit = async () => {
    if (!productId) { toast.error('Select a product'); return; }
    if (!Number(amount)) { toast.error('Enter a quantity'); return; }
    setSubmitting(true);
    try {
      await apiFetch('/api/inventory/movements', {
        method: 'POST',
        body: JSON.stringify({
          productId, type, quantity: signedQuantity, reason, reference,
          ...(isOutbound ? { fromWarehouseId: warehouseId || null } : { toWarehouseId: warehouseId || null }),
        }),
      });
      toast.success('Stock movement recorded');
      setOpen(false); resetForm(); fetchRows(); onChanged?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const columns: ColumnDef<StockMovement>[] = useMemo(() => [
    {
      accessorKey: 'createdAt', header: 'When',
      cell: ({ row }) => (
        <div className="text-sm">
          <div>{formatRelativeTime(row.original.createdAt)}</div>
          <div className="text-muted-foreground text-xs">{formatDate(row.original.createdAt)}</div>
        </div>
      ),
    },
    {
      id: 'product', header: 'Product',
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{row.original.product?.name ?? '—'}</div>
          <div className="text-muted-foreground text-xs">{row.original.product?.sku}</div>
        </div>
      ),
    },
    {
      accessorKey: 'type', header: 'Type',
      cell: ({ row }) => (
        <Badge className={MOVEMENT_COLORS[row.original.type] ?? MOVEMENT_COLORS.adjustment}>
          {MOVEMENT_LABELS[row.original.type] ?? row.original.type}
        </Badge>
      ),
    },
    {
      accessorKey: 'quantity', header: 'Change',
      cell: ({ row }) => {
        const q = row.original.quantity;
        const positive = q > 0;
        return (
          <span className={`flex items-center gap-1 font-medium tabular-nums ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
            {positive ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
            {positive ? '+' : ''}{q}
          </span>
        );
      },
    },
    {
      accessorKey: 'balanceAfter', header: 'Balance',
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">
          {row.original.balanceAfter}
          <span className="text-muted-foreground ml-1 text-xs font-normal">{row.original.product?.unit}</span>
        </span>
      ),
    },
    {
      id: 'context', header: 'Reason',
      cell: ({ row }) => (
        <div className="min-w-0 text-sm">
          <div className="truncate">{row.original.reason || <span className="text-muted-foreground">—</span>}</div>
          {row.original.reference && (
            <div className="text-muted-foreground text-xs truncate">Ref: {row.original.reference}</div>
          )}
        </div>
      ),
    },
    {
      id: 'user', header: 'By',
      cell: ({ row }) => row.original.user
        ? <span className="text-sm">{row.original.user.firstName} {row.original.user.lastName}</span>
        : <span className="text-muted-foreground">—</span>,
    },
  ], []);

  const received = rows.filter(r => r.quantity > 0).reduce((s, r) => s + r.quantity, 0);
  const issued = rows.filter(r => r.quantity < 0).reduce((s, r) => s + Math.abs(r.quantity), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Movements"
        description="Every change to on-hand quantity, and who made it."
        icon={ArrowDownUp}
      >
        <Button onClick={() => { resetForm(); setOpen(true); }} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> Record Movement
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Movements logged" value={meta.total} icon={ArrowDownUp} />
        <StatCard label="Units in (this page)" value={received} icon={ArrowUp} />
        <StatCard label="Units out (this page)" value={issued} icon={ArrowDown} />
      </div>

      <DataTable
        columns={columns} data={rows} isLoading={loading}
        searchPlaceholder="Search by product, reason or reference..."
        total={meta.total} page={page} pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(0); }}
        onSearchChange={v => { setSearch(v); setPage(0); }}
        emptyMessage="No stock movements recorded yet" emptyIcon={ArrowDownUp}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Stock Movement</DialogTitle>
            <DialogDescription>
              Adjust on-hand quantity. Every movement is written to the ledger and cannot be edited afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field label="Product">
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — {p.sku}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Movement type">
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOVEMENT_TYPES.map(t => <SelectItem key={t} value={t}>{MOVEMENT_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Quantity" hint={isOutbound ? 'Will be removed from stock.' : 'Will be added to stock.'}>
                <Input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} />
              </Field>
            </div>

            <Field label={isOutbound ? 'From warehouse' : 'To warehouse'}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Reason">
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Cycle count correction" />
            </Field>
            <Field label="Reference" hint="Optional external document number.">
              <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="GRN-4821" />
            </Field>

            {selectedProduct && Number(amount) > 0 && (
              <div className="bg-muted/50 flex items-center justify-between rounded-lg border p-3 text-sm">
                <span className="text-muted-foreground">Resulting change</span>
                <span className={`font-medium tabular-nums ${isOutbound ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {isOutbound ? '−' : '+'}{Math.abs(Number(amount))} {selectedProduct.unit}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Purchase Orders Tab
// ═══════════════════════════════════════════════════════════════

interface DraftLine { productId: string; quantity: string; unitCost: string }

export function PurchaseOrdersTab({
  products, warehouses, onChanged, prefill, onPrefillConsumed,
}: {
  products: MinimalProduct[];
  warehouses: MinimalWarehouse[];
  onChanged?: () => void;
  /** Set when the user clicks "Reorder" on a low-stock alert. */
  prefill?: { productId: string; quantity: number; supplierId?: string } | null;
  onPrefillConsumed?: () => void;
}) {
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', quantity: '1', unitCost: '0' }]);

  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) });
      if (search) p.set('search', search);
      const res = await apiFetch<{ data: PurchaseOrder[]; meta: ApiMeta }>(`/api/inventory/purchase-orders?${p}`);
      setRows(res.data); setMeta(res.meta);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, pageSize, search]);

  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Supplier[] }>('/api/inventory/suppliers?pageSize=100&isActive=true');
      setSuppliers(res.data);
    } catch { /* suppliers are optional context for the list view */ }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const resetForm = useCallback(() => {
    setSupplierId(''); setWarehouseId(''); setExpectedDate('');
    setTaxRate('0'); setNotes(''); setLines([{ productId: '', quantity: '1', unitCost: '0' }]);
  }, []);

  // Opening the composer pre-filled from a low-stock alert.
  useEffect(() => {
    if (!prefill) return;
    const product = products.find(p => p.id === prefill.productId);
    resetForm();
    setSupplierId(prefill.supplierId ?? '');
    setLines([{
      productId: prefill.productId,
      quantity: String(prefill.quantity || 1),
      unitCost: String(product?.cost ?? 0),
    }]);
    setOpen(true);
    onPrefillConsumed?.();
  }, [prefill, products, resetForm, onPrefillConsumed]);

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const tax = (subtotal * (Number(taxRate) || 0)) / 100;
  const total = subtotal + tax;

  const submit = async () => {
    const cleanLines = lines
      .filter(l => l.productId && Number(l.quantity) > 0)
      .map(l => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 }));

    if (!supplierId) { toast.error('Select a supplier'); return; }
    if (!cleanLines.length) { toast.error('Add at least one line item'); return; }

    setSubmitting(true);
    try {
      await apiFetch('/api/inventory/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          supplierId, warehouseId: warehouseId || null, notes,
          taxRate: Number(taxRate) || 0,
          expectedDate: expectedDate || null,
          items: cleanLines,
        }),
      });
      toast.success('Purchase order created');
      setOpen(false); resetForm(); fetchRows(); onChanged?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const changeStatus = async (order: PurchaseOrder, status: string) => {
    setStatusBusy(true);
    try {
      const res = await apiFetch<{ data: PurchaseOrder }>(`/api/inventory/purchase-orders/${order.id}`, {
        method: 'PUT', body: JSON.stringify({ status }),
      });
      toast.success(
        status === 'received'
          ? `${order.orderNumber} received — stock updated`
          : `${order.orderNumber} marked ${status}`,
      );
      setDetail(d => (d && d.id === order.id ? res.data : d));
      fetchRows(); onChanged?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setStatusBusy(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/inventory/purchase-orders/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('Purchase order deleted');
      setDeleteTarget(null); fetchRows(); onChanged?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setDeleting(false); }
  };

  const columns: ColumnDef<PurchaseOrder>[] = useMemo(() => [
    {
      accessorKey: 'orderNumber', header: 'Order',
      cell: ({ row }) => (
        <button
          onClick={() => setDetail(row.original)}
          className="flex items-center gap-2 text-left hover:underline"
        >
          <div className="bg-emerald-500/10 text-emerald-600 flex size-8 shrink-0 items-center justify-center rounded-lg">
            <ClipboardList className="size-4" />
          </div>
          <span className="font-medium">{row.original.orderNumber}</span>
        </button>
      ),
    },
    {
      id: 'supplier', header: 'Supplier',
      cell: ({ row }) => row.original.supplier?.name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'status', header: 'Status',
      cell: ({ row }) => (
        <Badge className={PO_STATUS_COLORS[row.original.status] ?? PO_STATUS_COLORS.draft}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'items', header: 'Items',
      cell: ({ row }) => <span className="text-muted-foreground text-sm">{row.original.items?.length ?? 0} line(s)</span>,
    },
    {
      accessorKey: 'total', header: 'Total',
      cell: ({ row }) => <span className="font-medium tabular-nums">{formatCurrency(row.original.total)}</span>,
    },
    {
      accessorKey: 'expectedDate', header: 'Expected',
      cell: ({ row }) => row.original.expectedDate
        ? formatDate(row.original.expectedDate)
        : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'actions', size: 60,
      cell: ({ row }) => {
        const next = PO_NEXT_STATUS[row.original.status] ?? [];
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(row.original)}>
                <ClipboardList className="size-4 mr-2" /> View details
              </DropdownMenuItem>
              {next.length > 0 && <DropdownMenuSeparator />}
              {next.map(s => (
                <DropdownMenuItem key={s} onClick={() => changeStatus(row.original, s)}>
                  {s === 'received'
                    ? <><PackageCheck className="size-4 mr-2" /> Mark received</>
                    : <>Move to {s}</>}
                </DropdownMenuItem>
              ))}
              {row.original.status !== 'received' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteTarget(row.original)}>
                    <Trash2 className="size-4 mr-2" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], []);

  const openValue = rows
    .filter(r => r.status === 'submitted' || r.status === 'approved')
    .reduce((s, r) => s + r.total, 0);
  const awaiting = rows.filter(r => r.status === 'submitted' || r.status === 'approved').length;

  return (
    <div className="space-y-6">
      <PageHeader title="Purchase Orders" description="Order stock from suppliers and receive it into a warehouse." icon={ClipboardList}>
        <Button onClick={() => { resetForm(); setOpen(true); }} className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="size-4 mr-2" /> New Order
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Orders" value={meta.total} icon={ClipboardList} />
        <StatCard label="Awaiting delivery" value={awaiting} icon={Truck} />
        <StatCard label="Open order value" value={formatCurrency(openValue)} icon={PackageCheck} />
      </div>

      <DataTable
        columns={columns} data={rows} isLoading={loading}
        searchPlaceholder="Search orders..."
        total={meta.total} page={page} pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(0); }}
        onSearchChange={v => { setSearch(v); setPage(0); }}
        emptyMessage="No purchase orders yet" emptyIcon={ClipboardList}
      />

      {/* ── Composer ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>Totals are calculated on the server when the order is saved.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Supplier">
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.length === 0 && <div className="text-muted-foreground p-2 text-sm">Add a supplier first</div>}
                    {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Deliver to warehouse">
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Expected delivery">
                <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
              </Field>
              <Field label="Tax rate (%)">
                <Input type="number" min={0} max={100} step="0.01" value={taxRate} onChange={e => setTaxRate(e.target.value)} />
              </Field>
            </div>

            {/* Line items */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Line items</Label>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setLines([...lines, { productId: '', quantity: '1', unitCost: '0' }])}>
                  <Plus className="size-3.5 mr-1" /> Add line
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 items-end gap-2">
                    <div className="col-span-6">
                      <Select
                        value={line.productId}
                        onValueChange={v => {
                          const product = products.find(p => p.id === v);
                          setLines(lines.map((l, idx) => idx === i
                            ? { ...l, productId: v, unitCost: l.unitCost === '0' ? String(product?.cost ?? 0) : l.unitCost }
                            : l));
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} — {p.sku}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Input type="number" min={1} placeholder="Qty" value={line.quantity}
                        onChange={e => setLines(lines.map((l, idx) => idx === i ? { ...l, quantity: e.target.value } : l))} />
                    </div>
                    <div className="col-span-3">
                      <Input type="number" min={0} step="0.01" placeholder="Unit cost" value={line.unitCost}
                        onChange={e => setLines(lines.map((l, idx) => idx === i ? { ...l, unitCost: e.target.value } : l))} />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" variant="ghost" size="icon" className="size-9"
                        disabled={lines.length === 1}
                        onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                        aria-label="Remove line">
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Field label="Notes">
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Delivery instructions..." />
            </Field>

            <div className="bg-muted/50 flex flex-col gap-1 rounded-lg border p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax ({Number(taxRate) || 0}%)</span><span className="tabular-nums">{formatCurrency(tax)}</span></div>
              <div className="flex justify-between border-t pt-1 font-medium"><span>Total</span><span className="tabular-nums">{formatCurrency(total)}</span></div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
              Create Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail ── */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  {detail.orderNumber}
                  <Badge className={PO_STATUS_COLORS[detail.status]}>{detail.status}</Badge>
                </DialogTitle>
                <DialogDescription>
                  {detail.supplier?.name}
                  {detail.warehouse ? ` → ${detail.warehouse.name}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><div className="text-muted-foreground text-xs">Ordered</div>{formatDate(detail.orderDate)}</div>
                  <div><div className="text-muted-foreground text-xs">Expected</div>{detail.expectedDate ? formatDate(detail.expectedDate) : '—'}</div>
                  <div><div className="text-muted-foreground text-xs">Received</div>{detail.receivedAt ? formatDate(detail.receivedAt) : '—'}</div>
                  <div><div className="text-muted-foreground text-xs">Lead time</div>{detail.supplier?.leadTimeDays ?? '—'} days</div>
                </div>

                <div className="rounded-lg border">
                  <div className="bg-muted/50 text-muted-foreground grid grid-cols-12 gap-2 border-b px-3 py-2 text-xs font-medium">
                    <div className="col-span-6">Product</div>
                    <div className="col-span-2 text-right">Qty</div>
                    <div className="col-span-2 text-right">Unit cost</div>
                    <div className="col-span-2 text-right">Line total</div>
                  </div>
                  {detail.items.map(item => (
                    <div key={item.id} className="grid grid-cols-12 gap-2 border-b px-3 py-2 text-sm last:border-b-0">
                      <div className="col-span-6 min-w-0">
                        <div className="truncate font-medium">{item.product?.name}</div>
                        <div className="text-muted-foreground text-xs">{item.product?.sku}</div>
                      </div>
                      <div className="col-span-2 text-right tabular-nums">
                        {item.quantity}
                        {item.receivedQuantity > 0 && item.receivedQuantity < item.quantity && (
                          <div className="text-muted-foreground text-xs">{item.receivedQuantity} received</div>
                        )}
                      </div>
                      <div className="col-span-2 text-right tabular-nums">{formatCurrency(item.unitCost)}</div>
                      <div className="col-span-2 text-right tabular-nums font-medium">{formatCurrency(item.quantity * item.unitCost)}</div>
                    </div>
                  ))}
                </div>

                <div className="bg-muted/50 flex flex-col gap-1 rounded-lg border p-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(detail.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{formatCurrency(detail.tax)}</span></div>
                  <div className="flex justify-between border-t pt-1 font-medium"><span>Total</span><span className="tabular-nums">{formatCurrency(detail.total)}</span></div>
                </div>

                {detail.notes && (
                  <div className="text-sm">
                    <div className="text-muted-foreground text-xs">Notes</div>
                    {detail.notes}
                  </div>
                )}

                {detail.status === 'received' && (
                  <p className="text-muted-foreground text-xs">
                    This order has been received and its stock movements are recorded in the ledger.
                  </p>
                )}
              </div>

              <DialogFooter className="gap-2">
                {(PO_NEXT_STATUS[detail.status] ?? []).map(s => (
                  <Button
                    key={s}
                    variant={s === 'cancelled' ? 'outline' : 'default'}
                    disabled={statusBusy}
                    onClick={() => changeStatus(detail, s)}
                    className={s === 'received' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : undefined}
                  >
                    {statusBusy && <Loader2 className="size-4 mr-2 animate-spin" />}
                    {s === 'received' ? 'Receive into stock' : `Move to ${s}`}
                  </Button>
                ))}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}
        title="Delete purchase order"
        description={`Delete ${deleteTarget?.orderNumber}? This cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={confirmDelete} isLoading={deleting}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Reorder / Low Stock Tab
// ═══════════════════════════════════════════════════════════════

interface AlertSummary {
  totalAlerts: number; outOfStock: number; low: number; covered: number;
  unassignedSupplier: number; estimatedReorderCost: number;
}

const SEVERITY_META: Record<ReorderAlert['severity'], { label: string; className: string }> = {
  out_of_stock: { label: 'Out of stock', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  low: { label: 'Below reorder point', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  covered: { label: 'Covered by inbound order', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
};

export function ReorderTab({
  refreshKey, onReorder,
}: {
  refreshKey?: number;
  onReorder: (alert: ReorderAlert) => void;
}) {
  const [alerts, setAlerts] = useState<ReorderAlert[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: ReorderAlert[]; meta: AlertSummary }>('/api/inventory/alerts');
      setAlerts(res.data); setSummary(res.meta);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts, refreshKey]);

  // Most urgent first: outages, then genuine shortfalls, then already-covered.
  const ordered = useMemo(() => {
    const rank = { out_of_stock: 0, low: 1, covered: 2 } as const;
    return [...alerts].sort((a, b) => rank[a.severity] - rank[b.severity] || a.stock - b.stock);
  }, [alerts]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reorder"
        description="Products at or below their reorder point, and what it would cost to restock them."
        icon={AlertTriangle}
      >
        <Button variant="outline" onClick={fetchAlerts} disabled={loading}>
          {loading && <Loader2 className="size-4 mr-2 animate-spin" />} Refresh
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Needs attention" value={summary?.totalAlerts ?? 0} icon={AlertTriangle} />
        <StatCard label="Out of stock" value={summary?.outOfStock ?? 0} icon={PackageX} />
        <StatCard label="Covered by inbound" value={summary?.covered ?? 0} icon={Truck} />
        <StatCard label="Est. reorder cost" value={formatCurrency(summary?.estimatedReorderCost ?? 0)} icon={ClipboardList} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Everything is well stocked"
          description="No product is at or below its reorder point. This list updates as stock moves."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.map(a => {
            const meta = SEVERITY_META[a.severity];
            return (
              <Card key={a.id}>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                      a.severity === 'out_of_stock'
                        ? 'bg-rose-500/10 text-rose-600'
                        : a.severity === 'low' ? 'bg-amber-500/10 text-amber-600' : 'bg-sky-500/10 text-sky-600'
                    }`}>
                      {a.severity === 'out_of_stock' ? <PackageX className="size-4" /> : <AlertTriangle className="size-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a.name}</span>
                        <Badge className={meta.className}>{meta.label}</Badge>
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {a.sku}
                        {a.warehouse ? ` · ${a.warehouse.name}` : ' · Unassigned warehouse'}
                        {a.supplier ? ` · ${a.supplier.name} (${a.supplier.leadTimeDays}d lead)` : ' · No supplier linked'}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span><span className="text-muted-foreground">On hand </span><span className="font-medium tabular-nums">{a.stock} {a.unit}</span></span>
                        <span><span className="text-muted-foreground">Reorder at </span><span className="font-medium tabular-nums">{a.reorderLevel}</span></span>
                        {a.incoming > 0 && (
                          <span><span className="text-muted-foreground">Inbound </span><span className="font-medium tabular-nums text-sky-600">{a.incoming}</span></span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    {a.suggestedOrderQty > 0 && (
                      <div className="text-right">
                        <div className="text-muted-foreground text-xs">Suggested order</div>
                        <div className="font-medium tabular-nums">{a.suggestedOrderQty} {a.unit}</div>
                        <div className="text-muted-foreground text-xs tabular-nums">{formatCurrency(a.estimatedCost)}</div>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant={a.severity === 'covered' ? 'outline' : 'default'}
                      className={a.severity === 'covered' ? undefined : 'bg-emerald-600 text-white hover:bg-emerald-700'}
                      onClick={() => onReorder(a)}
                    >
                      <ClipboardList className="size-4 mr-1.5" /> Reorder
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {summary && summary.unassignedSupplier > 0 && (
        <p className="text-muted-foreground text-xs">
          {summary.unassignedSupplier} of these products have no supplier linked. Assign one on the product to make reordering one click.
        </p>
      )}
    </div>
  );
}
