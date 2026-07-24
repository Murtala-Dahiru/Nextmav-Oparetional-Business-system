export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'crm', label: 'CRM', icon: 'Users' },
  { id: 'projects', label: 'Projects', icon: 'FolderKanban' },
  { id: 'workspace', label: 'Workspace', icon: 'BookOpen' },
  { id: 'communication', label: 'Communication', icon: 'MessageSquare' },
  { id: 'support', label: 'Support', icon: 'LifeBuoy' },
  { id: 'hr', label: 'HR', icon: 'UserCog' },
  { id: 'finance', label: 'Finance', icon: 'DollarSign' },
  { id: 'inventory', label: 'Inventory', icon: 'Package' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar' },
  { id: 'admin', label: 'Admin', icon: 'Settings' },
] as const;

export type ModuleId = (typeof MODULES)[number]['id'];

export const ROLES = [
  { id: 'owner', name: 'Company Owner', description: 'Full root control over all modules, billing, and system configuration.' },
  { id: 'administrator', name: 'Administrator', description: 'System-wide access to all business operations and user management.' },
  { id: 'manager', name: 'Department Manager', description: 'Manages team projects, approvals, and department resources.' },
  { id: 'employee', name: 'Employee', description: 'Standard workplace access to assigned tasks, DMs, leave requests, and HR case desk.' },
  { id: 'hr_staff', name: 'HR Staff', description: 'Manages employee profiles, leave approvals, payroll structures, and HR cases.' },
  { id: 'finance_staff', name: 'Finance Staff', description: 'Manages invoices, expense approvals, vendor billing, and cash flow reports.' },
  { id: 'sales_staff', name: 'Sales Staff', description: 'Access to CRM leads, deals pipeline, contacts, and customer sales activities.' },
  { id: 'support_staff', name: 'Support Staff', description: 'Customer support ticket management, SLA tracking, and KB articles.' },
  { id: 'client', name: 'Client Portal User', description: 'Restricted external view limited to client tickets and project deliverables.' },
] as const;

export type RoleId = (typeof ROLES)[number]['id'];

export const ROLE_PERMISSIONS: Record<RoleId, ModuleId[]> = {
  owner: ['dashboard', 'crm', 'projects', 'workspace', 'communication', 'support', 'hr', 'finance', 'inventory', 'calendar', 'admin'],
  administrator: ['dashboard', 'crm', 'projects', 'workspace', 'communication', 'support', 'hr', 'finance', 'inventory', 'calendar', 'admin'],
  manager: ['dashboard', 'crm', 'projects', 'workspace', 'communication', 'support', 'hr', 'finance', 'inventory', 'calendar'],
  employee: ['dashboard', 'projects', 'workspace', 'communication', 'hr', 'calendar'],
  hr_staff: ['dashboard', 'hr', 'workspace', 'communication', 'calendar'],
  finance_staff: ['dashboard', 'finance', 'workspace', 'communication', 'calendar'],
  sales_staff: ['dashboard', 'crm', 'workspace', 'communication', 'calendar'],
  support_staff: ['dashboard', 'support', 'workspace', 'communication', 'calendar'],
  client: ['dashboard', 'support', 'projects'],
};

/**
 * Status vocabularies.
 *
 * These MUST match the Postgres enums in supabase/migrations/0001_foundation.sql
 * exactly. They previously used hyphens ('in-progress', 'closed-won') from the
 * pre-Supabase schema, which meant every filter and counter silently matched
 * nothing — the list still rendered, so it looked like missing data rather
 * than a broken comparison. Underscores are the database's spelling and
 * therefore the only correct one.
 */
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const DEAL_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as const;
export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'blocked', 'done'] as const;
export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded'] as const;
export const EXPENSE_CATEGORIES = ['general', 'travel', 'office', 'software', 'marketing', 'equipment', 'training'] as const;

/**
 * Display labels for enum values.
 *
 * A raw `in_progress` in a table cell reads as a leaked database value. Rather
 * than a lookup per module — which drifts — `statusLabel()` title-cases
 * anything it does not have an explicit entry for, so a new enum value renders
 * acceptably the moment it is added.
 */
const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  partially_paid: 'Partially Paid',
  partially_received: 'Partially Received',
  half_day: 'Half Day',
  on_leave: 'On Leave',
  out_of_stock: 'Out of Stock',
  full_time: 'Full Time',
  part_time: 'Part Time',
  todo: 'To Do',
  kb: 'Knowledge Base',
};

export function statusLabel(value: string | null | undefined): string {
  if (!value) return '—';
  if (STATUS_LABELS[value]) return STATUS_LABELS[value];
  return value
    .split(/[_-]/)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export const PAGE_SIZE = 20;