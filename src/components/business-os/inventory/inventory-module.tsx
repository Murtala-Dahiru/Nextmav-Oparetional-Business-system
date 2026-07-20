'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Package, Search, Warehouse, Truck, AlertTriangle, DollarSign,
  MapPin, User, MoreVertical, Plus, ArrowUpDown,
  Box, Layers, Tag, Eye, Edit, Trash2, Phone, Mail,
  Building2, Globe, ChevronRight,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { products } from '@/lib/mock-data';
import type { ProductItem } from '@/types';
import { toast } from 'sonner';

/* ---- helpers ---- */

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v);
}

const categoryStyles: Record<string, string> = {
  Software: 'bg-teal-100 text-teal-700 border border-teal-200',
  Services: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  Support: 'bg-cyan-100 text-cyan-700 border border-cyan-200',
};

/* ---- animation variants ---- */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

/* ---- warehouse mock data ---- */

const warehouses = [
  {
    id: 'wh1',
    name: 'Main Warehouse',
    location: 'San Francisco, CA',
    itemCount: 1250,
    capacity: 2000,
    manager: 'David Kim',
    address: '450 Tech Blvd, San Francisco, CA 94105',
    status: 'active',
  },
  {
    id: 'wh2',
    name: 'East Coast',
    location: 'New York, NY',
    itemCount: 890,
    capacity: 1500,
    manager: 'Robert Williams',
    address: '120 Business Ave, New York, NY 10001',
    status: 'active',
  },
  {
    id: 'wh3',
    name: 'Europe',
    location: 'London, UK',
    itemCount: 430,
    capacity: 1000,
    manager: 'Sarah Chen',
    address: '88 Commerce St, London EC2A 4NE, UK',
    status: 'active',
  },
];

/* ---- suppliers mock data ---- */

const suppliers = [
  {
    id: 's1',
    name: 'TechSupply Co',
    contactPerson: 'Mark Anderson',
    email: 'mark@techsupply.com',
    phone: '+1 555-3001',
    isActive: true,
    productsCount: 24,
  },
  {
    id: 's2',
    name: 'OfficeMax Pro',
    contactPerson: 'Rachel Green',
    email: 'rachel@officemaxpro.com',
    phone: '+1 555-3002',
    isActive: true,
    productsCount: 18,
  },
  {
    id: 's3',
    name: 'Cloud Hardware Inc',
    contactPerson: 'Tom Bradley',
    email: 'tom@cloudhw.com',
    phone: '+1 555-3003',
    isActive: true,
    productsCount: 12,
  },
  {
    id: 's4',
    name: 'SoftwareSource Ltd',
    contactPerson: 'Nina Patel',
    email: 'nina@softwaresource.com',
    phone: '+1 555-3004',
    isActive: false,
    productsCount: 8,
  },
];

/* ---- main component ---- */

export default function InventoryModule() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<ProductItem | null>(null);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category))];
    return ['all', ...cats];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, categoryFilter, searchQuery]);

  const totalValue = useMemo(() => {
    return products.reduce((sum, p) => sum + (p.price * p.stock), 0);
  }, [products]);

  const activeProducts = products.filter(p => p.isActive).length;
  const uniqueCategories = new Set(products.map(p => p.category)).size;

  return (
    <motion.div
      className="space-y-6 p-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Inventory Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Track products, warehouses, and suppliers</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => toast.success('New product form opened')}>
          <Plus className="mr-2 h-4 w-4" />
          Add Product
        </Button>
      </div>

      <Tabs defaultValue="products" className="space-y-6">
        <TabsList className="bg-background border border-border p-1">
          <TabsTrigger value="products" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Package className="mr-2 h-4 w-4" />
            Products
          </TabsTrigger>
          <TabsTrigger value="warehouses" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Warehouse className="mr-2 h-4 w-4" />
            Warehouses
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Truck className="mr-2 h-4 w-4" />
            Suppliers
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: PRODUCTS ===== */}
        <TabsContent value="products" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <motion.div variants={itemVariants}>
              <Card className="border border-border hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-teal-50">
                      <Box className="h-5 w-5 text-teal-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{products.length}</p>
                      <p className="text-xs text-muted-foreground">Total Products</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={itemVariants}>
              <Card className="border border-border hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50">
                      <Package className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{activeProducts}</p>
                      <p className="text-xs text-muted-foreground">Active</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={itemVariants}>
              <Card className="border border-border hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyan-50">
                      <Layers className="h-5 w-5 text-cyan-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{uniqueCategories}</p>
                      <p className="text-xs text-muted-foreground">Categories</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={itemVariants}>
              <Card className="border border-border hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-50">
                      <DollarSign className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">${(totalValue / 1_000_000).toFixed(1)}M</p>
                      <p className="text-xs text-muted-foreground">Total Value</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Filters */}
          <Card className="border border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or SKU..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]">
                    <Tag className="mr-2 h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>
                        {cat === 'all' ? 'All Categories' : cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Products Table */}
          <Card className="border border-border">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold text-muted-foreground">Product Name</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">SKU</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Category</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right">Price</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right">Cost</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right">Margin</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right">Stock</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Unit</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Status</TableHead>
                    <TableHead className="font-semibold text-muted-foreground w-[50px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map(product => {
                    const margin = ((product.price - product.cost) / product.price * 100);
                    const isLowStock = product.stock < 100;
                    return (
                      <TableRow key={product.id} className="hover:bg-emerald-50/30 transition-colors">
                        <TableCell className="font-medium text-foreground">{product.name}</TableCell>
                        <TableCell className="font-mono text-sm text-teal-700">{product.sku}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-xs font-medium', categoryStyles[product.category] || 'bg-gray-100 text-foreground border border-border')}>
                            {product.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatCurrency(product.price)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{formatCurrency(product.cost)}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            'text-sm font-semibold',
                            margin >= 80 ? 'text-emerald-600' : margin >= 50 ? 'text-teal-600' : 'text-amber-600',
                          )}>
                            {margin.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isLowStock && (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            )}
                            <span className={cn(
                              'text-sm font-medium',
                              isLowStock ? 'text-amber-600' : 'text-foreground',
                            )}>
                              {product.stock.toLocaleString()}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground capitalize">{product.unit}</TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              'text-xs font-medium',
                              product.isActive
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-gray-100 text-muted-foreground',
                            )}
                          >
                            {product.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="text-emerald-600" onClick={() => toast.info(`Viewing ${product.name}`)}>
                                <Eye className="mr-2 h-4 w-4" />View
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toast.info(`Editing ${product.name}`)}>
                                <Edit className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget(product)}>
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No products match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 2: WAREHOUSES ===== */}
        <TabsContent value="warehouses" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {warehouses.map((wh, i) => {
              const capacityPercent = (wh.itemCount / wh.capacity) * 100;
              return (
                <motion.div
                  key={wh.id}
                  variants={itemVariants}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: i * 0.08 }}
                >
                  <Card className="border border-border hover:shadow-lg hover:border-emerald-200 transition-all h-full">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600">
                          <Warehouse className="h-5 w-5" />
                        </div>
                        <Badge className="bg-emerald-100 text-emerald-700 text-xs font-medium">Active</Badge>
                      </div>
                      <CardTitle className="text-lg font-semibold text-foreground mt-3">
                        {wh.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {wh.location}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {wh.manager}
                      </div>
                      <Separator />
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-foreground">Capacity</span>
                          <span className="text-sm text-muted-foreground">
                            {wh.itemCount.toLocaleString()} / {wh.capacity.toLocaleString()} items
                          </span>
                        </div>
                        <Progress
                          value={capacityPercent}
                          className={cn(
                            'h-2.5',
                            capacityPercent > 80
                              ? '[&>div]:bg-amber-500'
                              : '[&>div]:bg-emerald-500',
                          )}
                        />
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {capacityPercent.toFixed(0)}% utilized
                        </p>
                      </div>
                      <Button variant="outline" className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-sm" onClick={() => toast.info(`Viewing ${wh.name} details`)}>
                        View Details
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </TabsContent>

        {/* ===== TAB 3: SUPPLIERS ===== */}
        <TabsContent value="suppliers" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{suppliers.length} suppliers on record</p>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => toast.success('New supplier form opened')}>
              <Plus className="mr-2 h-4 w-4" />
              Add Supplier
            </Button>
          </div>

          <Card className="border border-border">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold text-muted-foreground">Name</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Contact Person</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Email</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Phone</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Status</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right">Products</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map(supplier => (
                    <TableRow key={supplier.id} className="hover:bg-emerald-50/30 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-teal-50">
                            <Building2 className="h-4 w-4 text-teal-600" />
                          </div>
                          <span className="font-medium text-foreground">{supplier.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-foreground">{supplier.contactPerson}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          {supplier.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {supplier.phone}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn(
                          'text-xs font-medium',
                          supplier.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-muted-foreground',
                        )}>
                          {supplier.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        {supplier.productsCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteTarget?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                toast.success('Product deleted successfully');
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
