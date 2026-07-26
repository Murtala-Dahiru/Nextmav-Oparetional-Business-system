export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  /**
   * A person's own to-do list.
   *
   * Sits immediately after the dashboard because it is the screen most people
   * open first and return to all day. Deliberately separate from `projects`:
   * that module is where the organization plans and assigns work, this is
   * where an individual organises their own.
   */
  { id: 'mywork', label: 'My Work', icon: 'CheckSquare' },
  { id: 'crm', label: 'CRM', icon: 'Users' },
  { id: 'projects', label: 'Projects', icon: 'FolderKanban' },
  { id: 'workspace', label: 'Workspace', icon: 'BookOpen' },
  { id: 'communication', label: 'Communication', icon: 'MessageSquare' },
  { id: 'support', label: 'Support', icon: 'LifeBuoy' },
  { id: 'hr', label: 'HR', icon: 'UserCog' },
  { id: 'finance', label: 'Finance', icon: 'DollarSign' },
  { id: 'inventory', label: 'Inventory', icon: 'Package' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar' },
  /**
   * The client portal. For a client this is the entire product; for staff it
   * is a preview of what a given customer sees.
   */
  { id: 'portal', label: 'Client Portal', icon: 'Building2' },
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

/**
 * Legacy module map, kept for anything still importing it.
 *
 * `lib/permissions.ts` is the source of truth for access; this duplicates a
 * subset of it and is not consulted by `authorize()`. Left in place so an
 * older import does not break, and kept in step so the two never disagree
 * visibly.
 */
export const ROLE_PERMISSIONS: Record<RoleId, ModuleId[]> = {
  owner: ['dashboard', 'mywork', 'crm', 'projects', 'workspace', 'communication', 'support', 'hr', 'finance', 'inventory', 'calendar', 'portal', 'admin'],
  administrator: ['dashboard', 'mywork', 'crm', 'projects', 'workspace', 'communication', 'support', 'hr', 'finance', 'inventory', 'calendar', 'portal', 'admin'],
  manager: ['dashboard', 'mywork', 'crm', 'projects', 'workspace', 'communication', 'support', 'hr', 'finance', 'inventory', 'calendar', 'portal'],
  employee: ['dashboard', 'mywork', 'projects', 'workspace', 'communication', 'hr', 'calendar'],
  hr_staff: ['dashboard', 'mywork', 'hr', 'workspace', 'communication', 'calendar'],
  finance_staff: ['dashboard', 'mywork', 'finance', 'workspace', 'communication', 'calendar'],
  sales_staff: ['dashboard', 'mywork', 'crm', 'workspace', 'communication', 'calendar', 'portal'],
  support_staff: ['dashboard', 'mywork', 'support', 'workspace', 'communication', 'calendar'],
  client: ['portal', 'support'],
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
 * Delivery phases, in the order work moves through them.
 *
 * Must match the `milestones_stage_valid` CHECK constraint in
 * supabase/migrations/0016. The database is what guarantees the set; this is
 * so the roadmap columns and the endpoint's validation cannot disagree with
 * each other about the order or the spelling.
 */
export const ROADMAP_STAGES = [
  'planning', 'development', 'testing', 'review', 'deployment', 'completed',
] as const;

export type RoadmapStage = (typeof ROADMAP_STAGES)[number];

/** Roles a person holds *on a project*, distinct from their organisation role. */
export const PROJECT_ROLES = ['manager', 'lead', 'contributor', 'reviewer', 'observer'] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

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