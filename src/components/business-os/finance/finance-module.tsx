'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, CreditCard,
  Search, Eye, Download, FileText, Receipt, Wallet, PiggyBank,
  ArrowUpRight, ArrowDownRight, Building2, User,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

import { invoices, expenses } from '@/lib/mock-data';
import type { InvoiceItem, ExpenseItem } from '@/types';

/* ---- helpers ---- */

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/* ---- mock chart data ---- */

const monthlyRevenue = [
  { month: 'Jan', revenue: 32000 },
  { month: 'Feb', revenue: 38000 },
  { month: 'Mar', revenue: 42000 },
  { month: 'Apr', revenue: 36000 },
  { month: 'May', revenue: 52000 },
  { month: 'Jun', revenue: 61000 },
  { month: 'Jul', revenue: 75000 },
  { month: 'Aug', revenue: 48000 },
  { month: 'Sep', revenue: 29000 },
  { month: 'Oct', revenue: 15000 },
  { month: 'Nov', revenue: 8500 },
  { month: 'Dec', revenue: 8500 },
];

/* ---- budget data ---- */

const budgetData = [
  { department: 'Engineering', spent: 125000, budget: 150000, icon: Building2 },
  { department: 'Marketing', spent: 35000, budget: 40000, icon: TrendingUp },
  { department: 'Operations', spent: 28000, budget: 50000, icon: Wallet },
  { department: 'HR', spent: 18000, budget: 25000, icon: User },
];

/* ---- status helpers ---- */

const invoiceStatusStyles: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 border border-gray-200',
  sent: 'bg-teal-50 text-teal-700 border border-teal-200',
  paid: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  overdue: 'bg-red-50 text-red-700 border border-red-200',
  cancelled: 'bg-gray-50 text-gray-500 border border-gray-200',
};

const expenseStatusStyles: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
};

function budgetBarColor(pct: number) {
  if (pct > 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

/* ---- animation ---- */

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3 },
};

/* ================================================================
   OVERVIEW TAB
   ================================================================ */

function OverviewTab() {
  const kpis = [
    { label: 'Total Revenue', value: '$445,000', change: 12.5, icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Outstanding', value: '$206,000', change: -3.2, icon: CreditCard, color: 'text-teal-600 bg-teal-50' },
    { label: 'Overdue', value: '$96,000', change: 8.1, icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'Expenses', value: '$46,400', change: -5.4, icon: Receipt, color: 'text-amber-600 bg-amber-50' },
  ];

  const expenseByCategory = (() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return Object.entries(map).map(([category, amount]) => ({ category, amount }));
  })();

  const topInvoices = [...invoices].sort((a, b) => b.total - a.total).slice(0, 4);
  const recentExpenses = [...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 4);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} {...fadeUp} transition={{ duration: 0.3, delay: i * 0.05 }}>
            <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">{kpi.label}</span>
                  <div className={cn('p-2 rounded-lg', kpi.color)}>
                    <kpi.icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold tracking-tight">{kpi.value}</div>
                <div className="flex items-center gap-1 mt-1.5">
                  {kpi.change >= 0 ? (
                    <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span className={cn('text-xs font-medium', kpi.change >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {Math.abs(kpi.change)}%
                  </span>
                  <span className="text-xs text-muted-foreground">vs last month</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Revenue Chart */}
        <motion.div {...fadeUp} transition={{ duration: 0.35, delay: 0.1 }} className="lg:col-span-2">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground">Revenue Trend</h3>
                <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50 text-xs">Monthly</Badge>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyRevenue} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                      formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fill="url(#emeraldGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Expense Breakdown */}
        <motion.div {...fadeUp} transition={{ duration: 0.35, delay: 0.15 }}>
          <Card className="border-0 shadow-sm h-full">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Expense Breakdown</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expenseByCategory} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                    <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                      formatter={(value: number) => [formatCurrency(value), 'Amount']}
                    />
                    <Bar dataKey="amount" fill="#14b8a6" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Quick Summary Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Invoices */}
        <motion.div {...fadeUp} transition={{ duration: 0.35, delay: 0.2 }}>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Top Invoices</h3>
              <div className="space-y-3">
                {topInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{inv.companyName}</p>
                        <p className="text-xs text-muted-foreground">{inv.invoiceNumber}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-semibold">{formatCurrency(inv.total)}</p>
                      <Badge className={cn('text-[10px] px-1.5 py-0', invoiceStatusStyles[inv.status])}>{inv.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Expenses */}
        <motion.div {...fadeUp} transition={{ duration: 0.35, delay: 0.25 }}>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Recent Expenses</h3>
              <div className="space-y-3">
                {recentExpenses.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                        <Receipt className="h-4 w-4 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{exp.title}</p>
                        <p className="text-xs text-muted-foreground">{exp.vendor} · {exp.category}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-semibold">{formatCurrency(exp.amount)}</p>
                      <Badge className={cn('text-[10px] px-1.5 py-0', expenseStatusStyles[exp.status])}>{exp.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

/* ================================================================
   INVOICES TAB
   ================================================================ */

function InvoicesTab() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const summary = useMemo(() => {
    const total = invoices.reduce((s, i) => s + i.total, 0);
    const paid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total, 0);
    const pending = invoices.filter((i) => i.status === 'sent').reduce((s, i) => s + i.total, 0);
    const overdue = invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.total, 0);
    const draft = invoices.filter((i) => i.status === 'draft').reduce((s, i) => s + i.total, 0);
    return { total, paid, pending, overdue, draft };
  }, []);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
      const q = search.toLowerCase();
      const matchesSearch = !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.contactName.toLowerCase().includes(q) ||
        inv.companyName.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [statusFilter, search]);

  const summaryCards = [
    { label: 'Total Invoices', value: formatCurrency(summary.total), color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Paid', value: formatCurrency(summary.paid), color: 'text-green-600 bg-green-50' },
    { label: 'Pending', value: formatCurrency(summary.pending), color: 'text-cyan-600 bg-cyan-50' },
    { label: 'Overdue', value: formatCurrency(summary.overdue), color: 'text-red-600 bg-red-50' },
    { label: 'Draft', value: formatCurrency(summary.draft), color: 'text-gray-600 bg-gray-50' },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {summaryCards.map((card, i) => (
          <motion.div key={card.label} {...fadeUp} transition={{ duration: 0.25, delay: i * 0.04 }}>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium">{card.label}</p>
                <p className="text-lg font-bold mt-1">{card.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search invoices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs font-semibold">Invoice #</TableHead>
                <TableHead className="text-xs font-semibold">Client</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="text-xs font-semibold text-right">Total</TableHead>
                <TableHead className="text-xs font-semibold">Due Date</TableHead>
                <TableHead className="text-xs font-semibold">Paid Date</TableHead>
                <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((inv) => (
                <TableRow key={inv.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium text-sm">{inv.invoiceNumber}</TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{inv.contactName}</p>
                      <p className="text-xs text-muted-foreground">{inv.companyName}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('text-xs capitalize', invoiceStatusStyles[inv.status])}>{inv.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-sm">{formatCurrency(inv.total)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(inv.dueDate)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{inv.paidAt ? formatDate(inv.paidAt) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => toast.info('Viewing invoice')}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => toast.success('Invoice downloaded')}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">No invoices found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================
   EXPENSES TAB
   ================================================================ */

function ExpensesTab() {
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');

  const categories = useMemo(() => {
    const cats = new Set(expenses.map((e) => e.category));
    return Array.from(cats).sort();
  }, []);

  const summary = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const thisMonth = expenses.filter((e) => e.date.startsWith('2026-07')).reduce((s, e) => s + e.amount, 0);
    const pending = expenses.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
    const approved = expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + e.amount, 0);
    return { total, thisMonth, pending, approved };
  }, []);

  const filtered = useMemo(() => {
    return expenses.filter((exp) => {
      const matchesCat = categoryFilter === 'all' || exp.category === categoryFilter;
      const q = search.toLowerCase();
      const matchesSearch = !q ||
        exp.title.toLowerCase().includes(q) ||
        exp.vendor.toLowerCase().includes(q) ||
        exp.category.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [categoryFilter, search]);

  const summaryCards = [
    { label: 'Total Expenses', value: formatCurrency(summary.total), color: 'text-emerald-600 bg-emerald-50' },
    { label: 'This Month', value: formatCurrency(summary.thisMonth), color: 'text-teal-600 bg-teal-50' },
    { label: 'Pending Approval', value: formatCurrency(summary.pending), color: 'text-amber-600 bg-amber-50' },
    { label: 'Approved', value: formatCurrency(summary.approved), color: 'text-green-600 bg-green-50' },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryCards.map((card, i) => (
          <motion.div key={card.label} {...fadeUp} transition={{ duration: 0.25, delay: i * 0.04 }}>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium">{card.label}</p>
                <p className="text-lg font-bold mt-1">{card.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search expenses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="Filter category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs font-semibold">Title</TableHead>
                <TableHead className="text-xs font-semibold">Category</TableHead>
                <TableHead className="text-xs font-semibold">Vendor</TableHead>
                <TableHead className="text-xs font-semibold text-right">Amount</TableHead>
                <TableHead className="text-xs font-semibold">Date</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((exp) => (
                <TableRow key={exp.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium text-sm">{exp.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs bg-teal-50 text-teal-700 border-teal-200">{exp.category}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{exp.vendor}</TableCell>
                  <TableCell className="text-right font-semibold text-sm">{formatCurrency(exp.amount)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(exp.date)}</TableCell>
                  <TableCell>
                    <Badge className={cn('text-xs capitalize', expenseStatusStyles[exp.status])}>{exp.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">No expenses found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================
   BUDGETS TAB
   ================================================================ */

function BudgetsTab() {
  const totalSpent = budgetData.reduce((s, b) => s + b.spent, 0);
  const totalBudget = budgetData.reduce((s, b) => s + b.budget, 0);
  const totalPct = Math.round((totalSpent / totalBudget) * 100);

  return (
    <div className="space-y-6">
      {/* Total Budget Overview */}
      <motion.div {...fadeUp}>
        <Card className="border-0 shadow-sm bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <PiggyBank className="h-5 w-5" />
              <h3 className="text-sm font-semibold opacity-90">Total Budget Overview</h3>
            </div>
            <div className="flex items-end gap-3 mb-3">
              <span className="text-3xl font-bold">{formatCurrency(totalSpent)}</span>
              <span className="text-lg opacity-70 mb-0.5">/ {formatCurrency(totalBudget)}</span>
            </div>
            <div className="w-full h-3 rounded-full bg-white/20 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-white"
                initial={{ width: 0 }}
                animate={{ width: `${totalPct}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <p className="text-xs opacity-75 mt-2">{totalPct}% utilized across all departments</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Budget Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {budgetData.map((b, i) => {
          const pct = Math.round((b.spent / b.budget) * 100);
          const remaining = b.budget - b.spent;
          const barColor = budgetBarColor(pct);
          return (
            <motion.div key={b.department} {...fadeUp} transition={{ duration: 0.3, delay: 0.1 + i * 0.06 }}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <b.icon className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">{b.department}</h4>
                        <p className="text-xs text-muted-foreground">{formatCurrency(remaining)} remaining</p>
                      </div>
                    </div>
                    <span className={cn(
                      'text-sm font-bold',
                      pct > 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-emerald-600',
                    )}>
                      {pct}%
                    </span>
                  </div>

                  <div className="space-y-1.5 mb-3">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Spent</span>
                      <span className="font-medium text-foreground">{formatCurrency(b.spent)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Budget</span>
                      <span className="font-medium text-foreground">{formatCurrency(b.budget)}</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className={cn('h-full rounded-full', barColor)}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, ease: 'easeOut', delay: 0.2 + i * 0.06 }}
                    />
                  </div>

                  {pct > 90 && (
                    <div className="flex items-center gap-1.5 mt-3 text-red-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Approaching budget limit</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
   MAIN MODULE
   ================================================================ */

export default function FinanceModule() {
  return (
    <div className="space-y-6">
      {/* Module Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Finance</h1>
          <p className="text-sm text-muted-foreground">Manage invoices, expenses, and budgets</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm" onClick={() => toast.success('New invoice created')}>
          <DollarSign className="h-4 w-4 mr-2" />
          New Invoice
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Expenses
          </TabsTrigger>
          <TabsTrigger value="budgets" className="gap-1.5">
            <PiggyBank className="h-3.5 w-3.5" />
            Budgets
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="invoices"><InvoicesTab /></TabsContent>
        <TabsContent value="expenses"><ExpensesTab /></TabsContent>
        <TabsContent value="budgets"><BudgetsTab /></TabsContent>
      </Tabs>
    </div>
  );
}