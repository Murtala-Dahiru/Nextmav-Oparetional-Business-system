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

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const DEAL_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won', 'closed-lost'] as const;
export const TASK_STATUSES = ['todo', 'in-progress', 'review', 'done'] as const;
export const PROJECT_STATUSES = ['planning', 'active', 'on-hold', 'completed', 'archived'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in-progress', 'pending', 'resolved', 'closed'] as const;
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'] as const;
export const EXPENSE_CATEGORIES = ['general', 'travel', 'office', 'software', 'marketing'] as const;

export const PAGE_SIZE = 20;