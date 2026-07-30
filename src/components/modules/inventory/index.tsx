'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  Package, Plus, Pencil, Trash2, MoreHorizontal, Warehouse, MapPin, BoxSelect,
  DollarSign, AlertTriangle, Loader2, Truck, ArrowDownUp, ClipboardList,
} from 'lucide-react';

import {
  SuppliersTab, MovementsTab, PurchaseOrdersTab, ReorderTab, type ReorderAlert,
} from './supply-tabs';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency } from '@/lib/format';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface Product {
  id: string; name: string; sku: string; category: string; price: number; cost: number;
  stock: number; unit: string; reorderLevel: number; isActive: boolean;
  warehouseId: string | null; supplierId: string | null;
  createdAt: string; updatedAt: string;
}

interface Warehouse {
  id: string; name: string; location: string; capacity: number;
  isActive: boolean; createdAt: string; updatedAt: string;
}

interface Stats {
  totalProducts: number; totalValue: number; lowStock: number;
}

// ═══════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════

const CATEGORIES = ['License', 'Support', 'Service'];

const CATEGORY_COLORS: Record<string, string> = {
  License: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  Support: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Service: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  general: 'bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
};

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
//  Product Form Dialog
// ═══════════════════════════════════════════════════════════════

interface ProductFormState {
  name: string; sku: string; category: string; price: string; cost: string;
  stock: string; unit: string; reorderLevel: string; isActive: boolean;
}

const defaultProductForm: ProductFormState = {
  name: '', sku: '', category: 'License', price: '0', cost: '0',
  stock: '0', unit: 'unit', reorderLevel: '10', isActive: true,
};

function ProductFormDialog({
  open, onOpenChange, editing, onSubmit, isLoading,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editing: Product | null; onSubmit: (data: ProductFormState) => void; isLoading: boolean;
}) {
  const getInitialForm = (): ProductFormState => editing ? {
    name: editing.name, sku: editing.sku, category: editing.category,
    price: String(editing.price), cost: String(editing.cost),
    stock: String(editing.stock), unit: editing.unit,
    reorderLevel: String(editing.reorderLevel), isActive: editing.isActive,
  } : defaultProductForm;

  const [form, setForm] = useState<ProductFormState>(getInitialForm);

  const update = (k: keyof ProductFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Product' : 'Add Product'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update product details below.' : 'Fill in the details for the new product.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Product name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-sku">SKU</Label>
            <Input id="p-sku" value={form.sku} onChange={(e) => update('sku', e.target.value)} placeholder="SKU-001" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-category">Category</Label>
            <Select value={form.category} onValueChange={(v) => update('category', v)}>
              <SelectTrigger id="p-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="p-price">Price</Label>
              <Input id="p-price" type="number" step="0.01" min="0" value={form.price} onChange={(e) => update('price', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-cost">Cost</Label>
              <Input id="p-cost" type="number" step="0.01" min="0" value={form.cost} onChange={(e) => update('cost', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="p-stock">Stock</Label>
              <Input id="p-stock" type="number" min="0" value={form.stock} onChange={(e) => update('stock', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-unit">Unit</Label>
              <Input id="p-unit" value={form.unit} onChange={(e) => update('unit', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-reorder">Reorder Level</Label>
              <Input id="p-reorder" type="number" min="0" value={form.reorderLevel} onChange={(e) => update('reorderLevel', e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="p-active">Active</Label>
            <Switch id="p-active" checked={form.isActive} onCheckedChange={(v) => update('isActive', v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={isLoading || !form.name || !form.sku} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {editing ? 'Save Changes' : 'Create Product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Warehouse Form Dialog
// ═══════════════════════════════════════════════════════════════

interface WarehouseFormState {
  name: string; location: string; capacity: string; isActive: boolean;
}

const defaultWarehouseForm: WarehouseFormState = { name: '', location: '', capacity: '0', isActive: true };

function WarehouseFormDialog({
  open, onOpenChange, editing, onSubmit, isLoading,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editing: Warehouse | null; onSubmit: (data: WarehouseFormState) => void; isLoading: boolean;
}) {
  const getInitialForm = (): WarehouseFormState => editing
    ? { name: editing.name, location: editing.location, capacity: String(editing.capacity), isActive: editing.isActive }
    : defaultWarehouseForm;

  const [form, setForm] = useState<WarehouseFormState>(getInitialForm);

  const update = (k: keyof WarehouseFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Warehouse' : 'Add Warehouse'}</DialogTitle>
          <DialogDescription>{editing ? 'Update warehouse details.' : 'Create a new warehouse.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="w-name">Name</Label>
            <Input id="w-name" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Warehouse name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="w-location">Location</Label>
            <Input id="w-location" value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="City, State" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="w-capacity">Capacity</Label>
            <Input id="w-capacity" type="number" min="0" value={form.capacity} onChange={(e) => update('capacity', e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="w-active">Active</Label>
            <Switch id="w-active" checked={form.isActive} onCheckedChange={(v) => update('isActive', v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={isLoading || !form.name} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {editing ? 'Save Changes' : 'Create Warehouse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Main Module
// ═══════════════════════════════════════════════════════════════

export default function InventoryModule() {
  // ── Products State ──
  const [products, setProducts] = useState<Product[]>([]);
  const [productMeta, setProductMeta] = useState<ApiMeta>({ total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [productLoading, setProductLoading] = useState(true);
  const [productPage, setProductPage] = useState(0);
  const [productPageSize, setProductPageSize] = useState(20);
  const [productSearch, setProductSearch] = useState('');
  const [productFilters, setProductFilters] = useState<ColumnFiltersState>([]);
  const [productSorting, setProductSorting] = useState<SortingState>([]);

  // ── Warehouses State ──
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseProductCounts, setWarehouseProductCounts] = useState<Record<string, number>>({});

  // ── Dialogs ──
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productSubmitting, setProductSubmitting] = useState(false);

  const [warehouseDialogOpen, setWarehouseDialogOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [warehouseSubmitting, setWarehouseSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'product' | 'warehouse'; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [stats, setStats] = useState<Stats>({ totalProducts: 0, totalValue: 0, lowStock: 0 });

  // ── Supply-chain tabs ──
  // The tab is controlled so "Reorder" on a low-stock alert can jump straight
  // into the purchase-order composer with the line item already filled in.
  const [activeTab, setActiveTab] = useState('products');
  const [reorderPrefill, setReorderPrefill] = useState<
    { productId: string; quantity: number; supplierId?: string } | null
  >(null);
  /** Bumped whenever stock changes, so dependent tabs refetch. */
  const [stockVersion, setStockVersion] = useState(0);
  /** Unpaginated lookup list backing the product selects in the new tabs. */
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const fetchAllProducts = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Product[] }>('/api/inventory/products?pageSize=100&isActive=true');
      setAllProducts(res.data);
    } catch { /* selects fall back to empty; the tables still work */ }
  }, []);

  useEffect(() => { fetchAllProducts(); }, [fetchAllProducts, stockVersion]);

  const handleStockChanged = useCallback(() => {
    setStockVersion(v => v + 1);
  }, []);

  const handleReorder = useCallback((alert: ReorderAlert) => {
    setReorderPrefill({
      productId: alert.id,
      quantity: alert.suggestedOrderQty || alert.shortfall || 1,
      supplierId: alert.supplier?.id,
    });
    setActiveTab('orders');
  }, []);

  // ── Fetch products ──
  const fetchProducts = useCallback(async () => {
    setProductLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(productPage + 1),
        pageSize: String(productPageSize),
        sort: productSorting[0]?.id || 'createdAt',
        sortDir: productSorting[0]?.desc ? 'desc' : 'asc',
      });
      if (productSearch) params.set('search', productSearch);
      productFilters.forEach((f) => { params.set(f.id, String(f.value)); });

      const res = await apiFetch<{ data: Product[]; meta: ApiMeta }>(`/api/inventory/products?${params}`);
      setProducts(res.data);
      setProductMeta(res.meta);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProductLoading(false);
    }
  }, [productPage, productPageSize, productSearch, productFilters, productSorting]);

  // ── Fetch stats ──
  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Product[]; meta: ApiMeta }>('/api/inventory/products?pageSize=9999');
      const all = res.data;
      const totalProducts = all.length;
      const totalValue = all.reduce((s, p) => s + p.price * p.stock, 0);
      const lowStock = all.filter((p) => p.stock < p.reorderLevel).length;
      setStats({ totalProducts, totalValue, lowStock });
    } catch { /* ignore */ }
  }, []);

  // ── Fetch warehouses ──
  const fetchWarehouses = useCallback(async () => {
    setWarehouseLoading(true);
    try {
      const res = await apiFetch<{ data: Warehouse[]; meta: ApiMeta }>('/api/inventory/warehouses?pageSize=100');
      setWarehouses(res.data);

      const allProducts = await apiFetch<{ data: Product[]; meta: ApiMeta }>('/api/inventory/products?pageSize=9999');
      const counts: Record<string, number> = {};
      allProducts.data.forEach((p) => {
        if (p.warehouseId) counts[p.warehouseId] = (counts[p.warehouseId] || 0) + 1;
      });
      setWarehouseProductCounts(counts);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setWarehouseLoading(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  /**
   * Stock is the strongest case in the product for a live table: the balance is
   * written by `record_stock_movement()` from anywhere — a receipt booked in
   * the warehouse, a purchase order received — and a stale figure on this
   * screen is what a reorder decision gets made against.
   */
  useModuleRealtime(
    'inventory',
    ['products', 'stock_movements', 'warehouses', 'suppliers'],
    () => { fetchProducts(); fetchStats(); },
  );

  // ── Product CRUD ──
  const handleProductSubmit = async (form: ProductFormState) => {
    setProductSubmitting(true);
    try {
      const payload = {
        name: form.name, sku: form.sku, category: form.category,
        price: Number(form.price) || 0, cost: Number(form.cost) || 0,
        stock: Number(form.stock) || 0, unit: form.unit,
        reorderLevel: Number(form.reorderLevel) || 0, isActive: form.isActive,
      };
      if (editingProduct) {
        await apiFetch(`/api/inventory/products/${editingProduct.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Product updated');
      } else {
        await apiFetch('/api/inventory/products', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Product created');
      }
      setProductDialogOpen(false);
      setEditingProduct(null);
      fetchProducts();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProductSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const endpoint = deleteTarget.type === 'product'
        ? `/api/inventory/products/${deleteTarget.id}`
        : `/api/inventory/warehouses/${deleteTarget.id}`;
      await apiFetch(endpoint, { method: 'DELETE' });
      toast.success(`${deleteTarget.type === 'product' ? 'Product' : 'Warehouse'} deleted`);
      setDeleteTarget(null);
      if (deleteTarget.type === 'product') { fetchProducts(); fetchStats(); } else { fetchWarehouses(); }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  // ── Warehouse CRUD ──
  const handleWarehouseSubmit = async (form: WarehouseFormState) => {
    setWarehouseSubmitting(true);
    try {
      const payload = {
        name: form.name, location: form.location,
        capacity: Number(form.capacity) || 0, isActive: form.isActive,
      };
      if (editingWarehouse) {
        await apiFetch(`/api/inventory/warehouses/${editingWarehouse.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Warehouse updated');
      } else {
        await apiFetch('/api/inventory/warehouses', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Warehouse created');
      }
      setWarehouseDialogOpen(false);
      setEditingWarehouse(null);
      fetchWarehouses();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setWarehouseSubmitting(false);
    }
  };

  // ── Product columns ──
  const productColumns: ColumnDef<Product>[] = [
    { accessorKey: 'sku', header: 'SKU', size: 100 },
    { accessorKey: 'name', header: 'Name', size: 180 },
    {
      accessorKey: 'category', header: 'Category', size: 110,
      cell: ({ row }) => {
        const v = row.original.category;
        return <Badge variant="secondary" className={CATEGORY_COLORS[v] || CATEGORY_COLORS.general}>{v}</Badge>;
      },
    },
    {
      accessorKey: 'price', header: 'Price', size: 100,
      cell: ({ row }) => <span>{formatCurrency(row.original.price)}</span>,
    },
    {
      accessorKey: 'cost', header: 'Cost', size: 100,
      cell: ({ row }) => <span>{formatCurrency(row.original.cost)}</span>,
    },
    {
      accessorKey: 'stock', header: 'Stock', size: 80,
      cell: ({ row }) => {
        const r = row.original;
        const isLow = r.stock < r.reorderLevel;
        return (
          <span className={isLow ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>
            {r.stock}
          </span>
        );
      },
    },
    { accessorKey: 'unit', header: 'Unit', size: 80 },
    { accessorKey: 'reorderLevel', header: 'Reorder', size: 80 },
    {
      accessorKey: 'isActive', header: 'Status', size: 100,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'} className={row.original.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : ''}>
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      id: 'actions', size: 60,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setEditingProduct(row.original); setProductDialogOpen(true); }}>
              <Pencil className="size-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget({ type: 'product', id: row.original.id, name: row.original.name })}>
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // ── Product filters ──
  const productFilterDefs: DataTableFilter[] = [
    {
      key: 'category', label: 'Category',
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
    },
    {
      key: 'isActive', label: 'Status',
      options: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-auto p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="products" className="gap-2"><Package className="size-4" /> Products</TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-2"><Warehouse className="size-4" /> Warehouses</TabsTrigger>
          <TabsTrigger value="suppliers" className="gap-2"><Truck className="size-4" /> Suppliers</TabsTrigger>
          <TabsTrigger value="movements" className="gap-2"><ArrowDownUp className="size-4" /> Movements</TabsTrigger>
          <TabsTrigger value="orders" className="gap-2"><ClipboardList className="size-4" /> Purchase Orders</TabsTrigger>
          <TabsTrigger value="reorder" className="gap-2">
            <AlertTriangle className="size-4" /> Reorder
            {stats.lowStock > 0 && (
              <Badge className="ml-1 bg-amber-100 px-1.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {stats.lowStock}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ═══════════ PRODUCTS TAB ═══════════ */}
        <TabsContent value="products" className="space-y-6">
          <PageHeader title="Inventory" description="Manage products, stock levels, and warehouses." icon={Package}>
            <Button onClick={() => { setEditingProduct(null); setProductDialogOpen(true); }}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="size-4 mr-2" /> Add Product
            </Button>
          </PageHeader>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total Products" value={stats.totalProducts} icon={BoxSelect} />
            <StatCard label="Total Value" value={formatCurrency(stats.totalValue)} icon={DollarSign} />
            <StatCard label="Low Stock" value={stats.lowStock} icon={AlertTriangle} />
          </div>

          <DataTable
            columns={productColumns}
            data={products}
            isLoading={productLoading}
            searchPlaceholder="Search products..."
            filters={productFilterDefs}
            total={productMeta.total}
            page={productPage}
            pageSize={productPageSize}
            onPageChange={setProductPage}
            onPageSizeChange={(s) => { setProductPageSize(s); setProductPage(0); }}
            onSearchChange={(v) => { setProductSearch(v); setProductPage(0); }}
            onFilterChange={(f) => { setProductFilters(f); setProductPage(0); }}
            onSortChange={(s) => { setProductSorting(s); setProductPage(0); }}
          />
        </TabsContent>

        {/* ═══════════ WAREHOUSES TAB ═══════════ */}
        <TabsContent value="warehouses" className="space-y-6">
          <PageHeader title="Warehouses" description="Manage warehouse locations and capacity." icon={Warehouse}>
            <Button onClick={() => { setEditingWarehouse(null); setWarehouseDialogOpen(true); }}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="size-4 mr-2" /> Add Warehouse
            </Button>
          </PageHeader>

          {warehouseLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}><CardContent className="p-6 space-y-3"><div className="h-5 w-2/3 bg-muted rounded" /><div className="h-4 w-1/2 bg-muted rounded" /><div className="h-4 w-1/3 bg-muted rounded" /></CardContent></Card>
              ))}
            </div>
          ) : warehouses.length === 0 ? (
            <EmptyState icon={Warehouse} title="No warehouses yet" description="Create your first warehouse to start organizing inventory."
              action={{ label: 'Add Warehouse', onClick: () => { setEditingWarehouse(null); setWarehouseDialogOpen(true); } }} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {warehouses.map((w) => (
                <Card key={w.id} className="group transition-shadow hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-emerald-500/10 text-emerald-600 flex size-10 items-center justify-center rounded-lg">
                          <Warehouse className="size-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">{w.name}</h3>
                          {w.location && (
                            <p className="text-muted-foreground text-xs flex items-center gap-1 mt-0.5">
                              <MapPin className="size-3" /> {w.location}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant={w.isActive ? 'default' : 'secondary'}
                          className={w.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : ''}>
                          {w.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreHorizontal className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setEditingWarehouse(w); setWarehouseDialogOpen(true); }}>
                              <Pencil className="size-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget({ type: 'warehouse', id: w.id, name: w.name })}>
                              <Trash2 className="size-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Capacity: <span className="text-foreground font-medium">{w.capacity.toLocaleString()}</span></span>
                      <span>Products: <span className="text-foreground font-medium">{warehouseProductCounts[w.id] || 0}</span></span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ═══════════ SUPPLIERS TAB ═══════════ */}
        <TabsContent value="suppliers" className="space-y-6">
          <SuppliersTab onChanged={handleStockChanged} />
        </TabsContent>

        {/* ═══════════ MOVEMENTS TAB ═══════════ */}
        <TabsContent value="movements" className="space-y-6">
          <MovementsTab
            products={allProducts}
            warehouses={warehouses}
            onChanged={() => { handleStockChanged(); fetchProducts(); fetchStats(); }}
          />
        </TabsContent>

        {/* ═══════════ PURCHASE ORDERS TAB ═══════════ */}
        <TabsContent value="orders" className="space-y-6">
          <PurchaseOrdersTab
            products={allProducts}
            warehouses={warehouses}
            prefill={reorderPrefill}
            onPrefillConsumed={() => setReorderPrefill(null)}
            onChanged={() => { handleStockChanged(); fetchProducts(); fetchStats(); }}
          />
        </TabsContent>

        {/* ═══════════ REORDER TAB ═══════════ */}
        <TabsContent value="reorder" className="space-y-6">
          <ReorderTab refreshKey={stockVersion} onReorder={handleReorder} />
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        key={editingProduct?.id ?? 'new-product'}
        open={productDialogOpen} onOpenChange={setProductDialogOpen}
        editing={editingProduct} onSubmit={handleProductSubmit} isLoading={productSubmitting}
      />

      <WarehouseFormDialog
        key={editingWarehouse?.id ?? 'new-warehouse'}
        open={warehouseDialogOpen} onOpenChange={setWarehouseDialogOpen}
        editing={editingWarehouse} onSubmit={handleWarehouseSubmit} isLoading={warehouseSubmitting}
      />

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.type === 'product' ? 'Product' : 'Warehouse'}`}
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete" variant="destructive" onConfirm={handleDelete} isLoading={deleting}
      />
    </div>
  );
}