'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  Plus, Pencil, Trash2, Loader2, LifeBuoy, BookOpen, User,
  Receipt, Code, Zap, AlertCircle, Clock, CheckCircle2,
  CircleDot, MoreHorizontal, ExternalLink,
} from 'lucide-react';

import { DataTable, type DataTableFilter } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { TICKET_PRIORITIES, TICKET_STATUSES, PAGE_SIZE } from '@/lib/constants';
import { createTicketSchema, updateTicketSchema } from '@/lib/validations';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Someone a ticket can be assigned to, as `/api/directory` returns them.
 *
 * Was `{ id, firstName, lastName }` read from `/api/admin/users`, which is
 * both admin-only — so a support agent got a 403 and an empty picker — and
 * shaped differently: that endpoint returns `memberId` and `fullName`, so
 * every option rendered "undefined undefined" with no value even for an owner.
 *
 * `memberId` is the right identifier: `support_tickets.assignee_id` references
 * `organization_members`, not the user account.
 */
interface Assignee {
  memberId: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  category: string;
  /**
   * A ticket records the requester's address and, optionally, a link to a
   * CRM contact. There is no `contactName` column — the name comes off the
   * relation — so the Contact column rendered blank on every row.
   */
  contactId: string | null;
  contactEmail: string;
  contact?: { id: string; firstName: string; lastName: string } | null;
  assigneeId: string | null;
  /**
   * The SLA deadline, assigned by trigger from the priority. Named `dueAt`;
   * as `dueDate` it never displayed, and sending it on create was ignored.
   */
  dueAt: string | null;
  resolution: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The embedded relation, which is *not* the same shape as `Assignee`.
   *
   * The tickets endpoint selects
   * `assignee:organization_members(id, profiles(full_name, avatar_url))`, so
   * the name arrives nested under `profiles`. This field was typed as
   * `Assignee` and the table rendered `${a.firstName} ${a.lastName}` — neither
   * of which exists on it — so the Assignee column showed "undefined
   * undefined" on every row that had one.
   */
  assignee: TicketAssignee | null;
}

interface TicketAssignee {
  id: string;
  profiles?: { fullName: string; avatarUrl: string | null };
}

interface TicketStats {
  open: number;
  inProgress: number;
  pending: number;
  resolved: number;
}

// ─── Knowledge Base Articles ─────────────────────────────────────────

const KB_ARTICLES = [
  {
    id: 1,
    title: 'Getting Started Guide',
    category: 'General',
    icon: 'book-open',
    preview: 'Learn the basics of NexusCorp Business OS and get up and running in minutes.',
    content: `## Getting Started with NexusCorp Business OS

Welcome to NexusCorp Business OS! This guide will help you get started with the platform and its core features.

### 1. Setting Up Your Account
After logging in for the first time, navigate to **Admin > Settings** to configure your profile, company details, and preferences. Make sure to:
- Update your display name and avatar
- Set your time zone and date format
- Configure notification preferences

### 2. Navigating the Dashboard
The dashboard gives you a quick overview of your key metrics, recent activity, and upcoming tasks. You can customize the layout by dragging and dropping widgets.

### 3. Creating Your First Project
Go to **Projects** and click "New Project". Fill in the project name, description, and set a priority. You can then create tasks, assign team members, and track progress.

### 4. Managing Your Team
Use the **HR** module to manage team members, approve leave requests, and track employee information. The **Admin** module lets you manage roles and permissions.

### 5. Next Steps
- Explore the CRM module for lead and contact management
- Set up your Finance module with invoices and expense tracking
- Configure the Support Desk to handle customer requests`,
  },
  {
    id: 2,
    title: 'Managing Your Account',
    category: 'Account',
    icon: 'user',
    preview: 'Update your profile, manage notifications, and configure account settings.',
    content: `## Managing Your Account

### Profile Settings
Navigate to **Admin > Users** to view and edit your profile. You can update:
- Display name and job title
- Email address and phone number
- Department and role assignment
- Profile avatar

### Notification Preferences
Click the bell icon in the top-right corner to access notifications. You can:
- View all recent notifications
- Mark individual notifications as read
- Bulk mark all as read

### Role Management
Your role determines which modules and features you have access to:
- **Admin**: Full system access
- **Manager**: Module management access
- **User**: Standard user access

Contact your administrator if you need additional permissions.`,
  },
  {
    id: 3,
    title: 'Creating and Managing Tickets',
    category: 'Support',
    icon: 'life-buoy',
    preview: 'Learn how to create, assign, and track support tickets through their lifecycle.',
    content: `## Creating and Managing Tickets

### Creating a Ticket
1. Navigate to the **Support** module
2. Click "New Ticket"
3. Fill in the subject, description, and select a priority
4. Choose a category and optionally assign the ticket
5. Click "Create" to submit

### Ticket Lifecycle
Tickets follow this workflow:
**Open** → **In Progress** → **Pending** → **Resolved** → **Closed**

### Priority Levels
- **Low**: Nice-to-have fixes, minor UI issues
- **Medium**: Standard bugs, feature improvements
- **High**: Significant bugs affecting multiple users
- **Urgent**: Critical issues, system outages

### Best Practices
- Always provide a clear subject and detailed description
- Include reproduction steps for bugs
- Attach screenshots when possible
- Set realistic due dates
- Update the ticket status regularly`,
  },
  {
    id: 4,
    title: 'Invoice & Billing Help',
    category: 'Billing',
    icon: 'receipt',
    preview: 'Understand invoices, manage billing, and track payment statuses.',
    content: `## Invoice & Billing Help

### Understanding Invoice Statuses
- **Draft**: Invoice is being prepared
- **Sent**: Invoice has been sent to the customer
- **Paid**: Payment has been received
- **Overdue**: Payment was not received by the due date
- **Cancelled**: Invoice has been voided

### Creating an Invoice
1. Go to **Finance** module
2. Click "New Invoice"
3. Add line items with descriptions and quantities
4. The system auto-calculates subtotal, tax, and total
5. Set a due date and send to the customer

### Tax Configuration
The default tax rate can be configured in **Admin > Settings** under the Finance group. The current default is 10%.

### Exporting Financial Data
Use the export feature in the Finance module to download invoice and expense data as CSV files for accounting purposes.`,
  },
  {
    id: 5,
    title: 'API Documentation',
    category: 'Technical',
    icon: 'code',
    preview: 'Technical documentation for developers working with NexusCorp APIs.',
    content: `## API Documentation

### Base URL
All API requests use relative paths from the current domain. The API supports standard REST methods: GET, POST, PUT, DELETE.

### Authentication
API endpoints require session authentication. Include your session cookie with each request.

### Response Format
All responses follow this structure:
\`\`\`json
{
  "data": { ... },
  "meta": { "total": 100, "page": 1, "pageSize": 20 },
  "error": { "message": "Error description" }
}
\`\`\`

### Pagination
Use \`page\` and \`pageSize\` query parameters:
- \`page\`: Page number (1-based)
- \`pageSize\`: Items per page (max 100)

### Filtering
Most list endpoints support filtering via query parameters:
- \`search\`: Full-text search
- \`status\`, \`priority\`, \`category\`: Filter by field value
- \`sort\`: Sort field name
- \`sortDir\`: \`asc\` or \`desc\``,
  },
  {
    id: 6,
    title: 'Keyboard Shortcuts',
    category: 'Productivity',
    icon: 'zap',
    preview: 'Boost your productivity with these essential keyboard shortcuts.',
    content: `## Keyboard Shortcuts

### Global Shortcuts
| Shortcut | Action |
|----------|--------|
| \`Cmd/Ctrl + K\` | Quick search |
| \`Cmd/Ctrl + N\` | New item (context-dependent) |
| \`Cmd/Ctrl + /\` | Show keyboard shortcuts |

### Navigation
| Shortcut | Action |
|----------|--------|
| \`Cmd/Ctrl + 1-9\` | Switch to module 1-9 |
| \`Cmd/Ctrl + [\` | Go back |
| \`Cmd/Ctrl + ]\` | Go forward |

### Data Tables
| Shortcut | Action |
|----------|--------|
| \`↑/↓\` | Navigate rows |
| \`Enter\` | Open/Select row |
| \`Shift + ↑/↓\` | Multi-select rows |
| \`Delete\` | Delete selected |

### Forms
| Shortcut | Action |
|----------|--------|
| \`Tab\` | Next field |
| \`Shift + Tab\` | Previous field |
| \`Enter\` | Submit form |
| \`Esc\` | Cancel / Close dialog |`,
  },
];

// ─── Badge color maps ────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  'in_progress': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  pending: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  closed: 'bg-muted text-muted-foreground border-muted',
};

const CATEGORY_STYLES: Record<string, string> = {
  general: '',
  billing: 'bg-amber-50 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  technical: 'bg-violet-50 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800',
  'feature-request': 'bg-emerald-50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
};

const KB_ICON_MAP: Record<string, React.ElementType> = {
  'book-open': BookOpen,
  'user': User,
  'life-buoy': LifeBuoy,
  'receipt': Receipt,
  'code': Code,
  'zap': Zap,
};

function KbArticleIcon({ iconName, className }: { iconName: string; className?: string }) {
  switch (iconName) {
    case 'user': return <User className={className} />;
    case 'life-buoy': return <LifeBuoy className={className} />;
    case 'receipt': return <Receipt className={className} />;
    case 'code': return <Code className={className} />;
    case 'zap': return <Zap className={className} />;
    default: return <BookOpen className={className} />;
  }
}

// ─── Status workflow ─────────────────────────────────────────────────

const STATUS_WORKFLOW: Record<string, string[]> = {
  open: ['in_progress', 'closed'],
  'in_progress': ['pending', 'resolved'],
  pending: ['in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],
  closed: ['open'],
};

// ─── Component ───────────────────────────────────────────────────────

export default function SupportModule() {
  // ── Data state ──
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<Assignee[]>([]);
  const [stats, setStats] = useState<TicketStats>({ open: 0, inProgress: 0, pending: 0, resolved: 0 });

  // ── Table state ──
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // ── Dialog state ──
  const [createOpen, setCreateOpen] = useState(false);
  const [editTicket, setEditTicket] = useState<Ticket | null>(null);
  const [deleteTicket, setDeleteTicket] = useState<Ticket | null>(null);
  const [kbArticle, setKbArticle] = useState<(typeof KB_ARTICLES)[number] | null>(null);

  // ── Loading states ──
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ─── Fetch users ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        // The company directory, not the admin user table: a support agent has no
        // admin rights, so the old endpoint returned 403 and left the assignee
        // picker permanently empty.
        const res = await fetch('/api/directory');
        const json = await res.json();
        if (json.data) setUsers(json.data);
      } catch { /* silent */ }
    })();
  }, []);

  // ─── Fetch tickets ────────────────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page + 1));
      params.set('pageSize', String(pageSize));
      if (search) params.set('search', search);
      if (sorting.length > 0) {
        params.set('sort', sorting[0].id);
        params.set('sortDir', sorting[0].desc ? 'desc' : 'asc');
      }
      columnFilters.forEach((f) => {
        params.set(f.id, String(f.value));
      });

      const res = await fetch(`/api/support/tickets?${params}`);
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }

      setTickets(json.data ?? []);
      setTotal(json.meta?.total ?? 0);

      // Fetch stats
      const statsRes = await fetch('/api/support/tickets?pageSize=1000');
      const statsJson = await statsRes.json();
      const allTickets: Ticket[] = statsJson.data ?? [];
      setStats({
        open: allTickets.filter((t) => t.status === 'open').length,
        inProgress: allTickets.filter((t) => t.status === 'in_progress').length,
        pending: allTickets.filter((t) => t.status === 'pending').length,
        resolved: allTickets.filter((t) => t.status === 'resolved').length,
      });
    } catch {
      toast.error('Failed to load tickets');
    } finally {
      setTicketsLoading(false);
    }
  }, [page, pageSize, search, sorting, columnFilters]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // ─── Create ticket ────────────────────────────────────────────────
  const createForm = useForm({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      subject: '',
      description: '',
      priority: 'medium',
      status: 'open',
      category: 'general',
      contactId: null as string | null,
      contactEmail: '',
      assigneeId: null as string | null,

      resolution: '',
    },
  });

  const handleCreate = useCallback(async (values: z.infer<typeof createTicketSchema>) => {
    setCreating(true);
    try {
      const ticketNumber = `TKT-${String(total + 1).padStart(3, '0')}`;
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, ticketNumber }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }
      toast.success('Ticket created');
      setCreateOpen(false);
      createForm.reset();
      fetchTickets();
    } catch {
      toast.error('Failed to create ticket');
    } finally {
      setCreating(false);
    }
  }, [total, createForm, fetchTickets]);

  // ─── Edit ticket ──────────────────────────────────────────────────
  const editForm = useForm({
    resolver: zodResolver(updateTicketSchema),
  });

  useEffect(() => {
    if (editTicket) {
      editForm.reset({
        subject: editTicket.subject,
        description: editTicket.description,
        priority: editTicket.priority,
        status: editTicket.status,
        category: editTicket.category,
        contactId: editTicket.contactId,
        contactEmail: editTicket.contactEmail,
        assigneeId: editTicket.assigneeId,

        resolution: editTicket.resolution,
      });
    }
  }, [editTicket, editForm]);

  const handleUpdate = useCallback(async (values: z.infer<typeof updateTicketSchema>) => {
    if (!editTicket) return;
    setUpdating(true);
    try {
      const data: Record<string, unknown> = { ...values };
      // due_at is assigned by trigger from the priority, so the client does
      // not send it — anything sent was discarded anyway.
      const res = await fetch(`/api/support/tickets/${editTicket.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }
      toast.success('Ticket updated');
      setEditTicket(null);
      editForm.reset();
      fetchTickets();
    } catch {
      toast.error('Failed to update ticket');
    } finally {
      setUpdating(false);
    }
  }, [editTicket, editForm, fetchTickets]);

  // ─── Delete ticket ────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteTicket) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/support/tickets/${deleteTicket.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }
      toast.success('Ticket deleted');
      setDeleteTicket(null);
      fetchTickets();
    } catch {
      toast.error('Failed to delete ticket');
    } finally {
      setDeleting(false);
    }
  }, [deleteTicket, fetchTickets]);

  // ─── Status change (quick) ────────────────────────────────────────
  const handleQuickStatus = useCallback(async (ticket: Ticket, newStatus: string) => {
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }
      toast.success(`Status changed to ${newStatus}`);
      fetchTickets();
    } catch {
      toast.error('Failed to update status');
    }
  }, [fetchTickets]);

  // ─── Table filters ────────────────────────────────────────────────
  const filters: DataTableFilter[] = useMemo(
    () => [
      {
        key: 'status',
        label: 'Status',
        options: TICKET_STATUSES.map((s) => ({
          value: s,
          label: s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        })),
      },
      {
        key: 'priority',
        label: 'Priority',
        options: TICKET_PRIORITIES.map((p) => ({
          value: p,
          label: p.charAt(0).toUpperCase() + p.slice(1),
        })),
      },
      {
        key: 'category',
        label: 'Category',
        options: [
          { value: 'general', label: 'General' },
          { value: 'billing', label: 'Billing' },
          { value: 'technical', label: 'Technical' },
          { value: 'feature-request', label: 'Feature Request' },
        ],
      },
    ],
    [],
  );

  // ─── Columns ──────────────────────────────────────────────────────
  const columns: ColumnDef<Ticket>[] = useMemo(
    () => [
      {
        accessorKey: 'ticketNumber',
        header: 'Ticket #',
        size: 100,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.ticketNumber}</span>
        ),
      },
      {
        accessorKey: 'subject',
        header: 'Subject',
        size: 220,
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.subject}</span>
        ),
      },
      {
        accessorKey: 'priority',
        header: 'Priority',
        size: 100,
        cell: ({ row }) => {
          const p = row.original.priority;
          return (
            <Badge variant="outline" className={cn('text-xs font-medium', PRIORITY_STYLES[p])}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 120,
        cell: ({ row }) => {
          const s = row.original.status;
          return (
            <Badge variant="outline" className={cn('text-xs font-medium', STATUS_STYLES[s])}>
              {s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'category',
        header: 'Category',
        size: 120,
        cell: ({ row }) => {
          const c = row.original.category;
          return (
            <Badge variant="outline" className={cn('text-xs', CATEGORY_STYLES[c] || '')}>
              {c === 'feature-request' ? 'Feature' : c.charAt(0).toUpperCase() + c.slice(1)}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'contactEmail',
        header: 'Contact',
        size: 150,
        cell: ({ row }) => (
          <div className="text-sm">
            <p className="font-medium">
              {row.original.contact
                ? `${row.original.contact.firstName} ${row.original.contact.lastName}`.trim()
                : row.original.contactEmail || '—'}
            </p>
            <p className="text-xs text-muted-foreground">{row.original.contactEmail}</p>
          </div>
        ),
      },
      {
        id: 'assignee',
        header: 'Assignee',
        size: 140,
        cell: ({ row }) => {
          const a = row.original.assignee;
          return (
            <span className="text-sm text-muted-foreground">
              {a?.profiles?.fullName || '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'dueDate',
        header: 'Due Date',
        size: 110,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.dueAt ? formatDate(row.original.dueAt) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        size: 110,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatRelativeTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 50,
        cell: ({ row }) => {
          const ticket = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setEditTicket(ticket)}>
                  <Pencil className="mr-2 size-4" /> Edit
                </DropdownMenuItem>
                {STATUS_WORKFLOW[ticket.status]?.map((s) => (
                  <DropdownMenuItem key={s} onClick={() => handleQuickStatus(ticket, s)}>
                    <CheckCircle2 className="mr-2 size-4" />
                    Mark as {s.replace(/-/g, ' ')}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteTicket(ticket)}
                >
                  <Trash2 className="mr-2 size-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [handleQuickStatus],
  );

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Tabs defaultValue="tickets">
        <TabsList>
          <TabsTrigger value="tickets">
            <LifeBuoy className="mr-2 size-4" />
            Tickets
          </TabsTrigger>
          <TabsTrigger value="knowledge-base">
            <BookOpen className="mr-2 size-4" />
            Knowledge Base
          </TabsTrigger>
        </TabsList>

        {/* ═══ TICKETS TAB ═══ */}
        <TabsContent value="tickets" className="mt-6 space-y-6">
          <PageHeader title="Support Desk" description="Manage customer support tickets">
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="mr-2 size-4" />
              New Ticket
            </Button>
          </PageHeader>

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Open"
              value={stats.open}
              icon={AlertCircle}
              className="border-l-4 border-l-blue-500"
            />
            <StatCard
              label="In Progress"
              value={stats.inProgress}
              icon={Clock}
              className="border-l-4 border-l-amber-500"
            />
            <StatCard
              label="Pending"
              value={stats.pending}
              icon={CircleDot}
              className="border-l-4 border-l-violet-500"
            />
            <StatCard
              label="Resolved"
              value={stats.resolved}
              icon={CheckCircle2}
              className="border-l-4 border-l-emerald-500"
            />
          </div>

          {/* Data table */}
          <DataTable
            columns={columns}
            data={tickets}
            isLoading={ticketsLoading}
            emptyMessage="No support tickets found"
            emptyIcon={LifeBuoy}
            searchPlaceholder="Search tickets..."
            filters={filters}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            onSearchChange={setSearch}
            onSortChange={setSorting}
            onFilterChange={setColumnFilters}
          />
        </TabsContent>

        {/* ═══ KNOWLEDGE BASE TAB ═══ */}
        <TabsContent value="knowledge-base" className="mt-6 space-y-6">
          <PageHeader
            title="Knowledge Base"
            description="Help articles and documentation for NexusCorp Business OS"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {KB_ARTICLES.map((article) => {
              return (
                <Card
                  key={article.id}
                  className="cursor-pointer transition-shadow hover:shadow-md group"
                  onClick={() => setKbArticle(article)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="bg-emerald-500/10 text-emerald-600 flex size-10 items-center justify-center rounded-lg">
                        <KbArticleIcon iconName={article.icon} className="size-5" />
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {article.category}
                      </Badge>
                    </div>
                    <CardTitle className="text-base mt-3 group-hover:text-emerald-600 transition-colors">
                      {article.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {article.preview}
                    </p>
                    <Button
                      variant="link"
                      className="mt-3 h-auto p-0 text-emerald-600 hover:text-emerald-700"
                    >
                      Read more <ExternalLink className="ml-1 size-3" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* ═══ CREATE TICKET DIALOG ═══ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Ticket</DialogTitle>
            <DialogDescription>Fill in the details for the new support ticket.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input {...createForm.register('subject')} placeholder="Brief summary of the issue" />
              {createForm.formState.errors.subject && (
                <p className="text-xs text-destructive">{createForm.formState.errors.subject.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                {...createForm.register('description')}
                placeholder="Detailed description of the issue..."
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Controller
                  control={createForm.control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TICKET_PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Controller
                  control={createForm.control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="billing">Billing</SelectItem>
                        <SelectItem value="technical">Technical</SelectItem>
                        <SelectItem value="feature-request">Feature Request</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Contact email</Label>
                <Input {...createForm.register('contactEmail')} type="email" placeholder="requester@company.com" />
              </div>
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input {...createForm.register('contactEmail')} type="email" placeholder="email@example.com" />
                {createForm.formState.errors.contactEmail && (
                  <p className="text-xs text-destructive">{createForm.formState.errors.contactEmail.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Assignee</Label>
              <Controller
                control={createForm.control}
                name="assigneeId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? '_none'}
                    onValueChange={(v) => field.onChange(v === '_none' ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.memberId} value={u.memberId}>
                          {u.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/*
              No due-date input: due_at is the SLA deadline and is set by
              trigger from the priority. The field accepted a date and threw it
              away, which read as the system ignoring the agent.
            */}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={creating}
              >
                {creating && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create Ticket
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ EDIT TICKET DIALOG ═══ */}
      <Dialog open={!!editTicket} onOpenChange={(open) => !open && setEditTicket(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Ticket</DialogTitle>
            <DialogDescription>
              Update ticket #{editTicket?.ticketNumber}
            </DialogDescription>
          </DialogHeader>
          {editTicket && (
            <form onSubmit={editForm.handleSubmit(handleUpdate)} className="space-y-4">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input {...editForm.register('subject')} />
                {editForm.formState.errors.subject && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.subject.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea {...editForm.register('description')} rows={4} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Controller
                    control={editForm.control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TICKET_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Controller
                    control={editForm.control}
                    name="priority"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TICKET_PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Controller
                    control={editForm.control}
                    name="category"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">General</SelectItem>
                          <SelectItem value="billing">Billing</SelectItem>
                          <SelectItem value="technical">Technical</SelectItem>
                          <SelectItem value="feature-request">Feature Request</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Assignee</Label>
                  <Controller
                    control={editForm.control}
                    name="assigneeId"
                    render={({ field }) => (
                      <Select
                        value={field.value ?? '_none'}
                        onValueChange={(v) => field.onChange(v === '_none' ? null : v)}
                      >
                        <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Unassigned</SelectItem>
                          {users.map((u) => (
                            <SelectItem key={u.memberId} value={u.memberId}>
                              {u.fullName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              {/* Set by trigger from the priority — see the create form. */}

              <div className="space-y-2">
                <Label>Resolution</Label>
                <Textarea
                  {...editForm.register('resolution')}
                  placeholder="How was this ticket resolved?"
                  rows={3}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditTicket(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={updating}
                >
                  {updating && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ DELETE CONFIRM DIALOG ═══ */}
      <ConfirmDialog
        open={!!deleteTicket}
        onOpenChange={(open) => !open && setDeleteTicket(null)}
        title="Delete Ticket"
        description={`Are you sure you want to delete ticket "${deleteTicket?.ticketNumber}: ${deleteTicket?.subject}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={deleting}
      />

      {/* ═══ KB ARTICLE DIALOG ═══ */}
      <Dialog open={!!kbArticle} onOpenChange={(open) => !open && setKbArticle(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {kbArticle && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-emerald-500/10 text-emerald-600 flex size-10 items-center justify-center rounded-lg">
                    <KbArticleIcon iconName={kbArticle.icon} className="size-5" />
                  </div>
                  <div>
                    <DialogTitle>{kbArticle.title}</DialogTitle>
                    <DialogDescription>{kbArticle.category}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="prose prose-sm dark:prose-invert max-w-none mt-4 whitespace-pre-wrap">
                {kbArticle.content}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}