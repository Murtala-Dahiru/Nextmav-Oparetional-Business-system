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

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const DEAL_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won', 'closed-lost'] as const;
export const TASK_STATUSES = ['todo', 'in-progress', 'review', 'done'] as const;
export const PROJECT_STATUSES = ['planning', 'active', 'on-hold', 'completed', 'archived'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in-progress', 'pending', 'resolved', 'closed'] as const;
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'] as const;
export const EXPENSE_CATEGORIES = ['general', 'travel', 'office', 'software', 'marketing'] as const;

export const PAGE_SIZE = 20;