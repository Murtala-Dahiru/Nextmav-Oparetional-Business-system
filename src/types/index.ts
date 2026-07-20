export type ModuleId =
  | 'dashboard'
  | 'crm'
  | 'workspace'
  | 'projects'
  | 'hr'
  | 'finance'
  | 'communication'
  | 'calendar'
  | 'files'
  | 'automation'
  | 'support'
  | 'inventory'
  | 'reports'
  | 'admin';

export interface NavItem {
  id: ModuleId;
  label: string;
  icon: string;
  badge?: number;
  children?: NavItem[];
}

export interface KPIData {
  label: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: string;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  value2?: number;
}

export interface LeadItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  title: string;
  source: string;
  status: 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  score: number;
  value: number;
  createdAt: string;
}

export interface ContactItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  company: string;
  source: string;
  isActive: boolean;
  createdAt: string;
}

export interface CrmCompanyItem {
  id: string;
  name: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  city: string;
  country: string;
  employeeCount: number;
  annualRevenue: number;
  createdAt: string;
}

export interface OpportunityItem {
  id: string;
  name: string;
  value: number;
  stage: string;
  stageId: string;
  probability: number;
  closeDate: string;
  contactName: string;
  companyName: string;
  ownerName: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'completed' | 'on-hold' | 'planning';
  priority: 'low' | 'medium' | 'high' | 'critical';
  progress: number;
  startDate: string;
  endDate: string;
  budget: number;
  ownerName: string;
  memberCount: number;
  taskCount: number;
  completedTaskCount: number;
}

export interface ProjectTaskItem {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assigneeName: string;
  projectName: string;
  dueDate: string;
  loggedHours: number;
  estimatedHours: number;
  tags: string[];
}

export interface EmployeeItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  status: string;
  hireDate: string;
  salary: number;
  avatar: string;
}

export interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  contactName: string;
  companyName: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  total: number;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
}

export interface ExpenseItem {
  id: string;
  title: string;
  amount: number;
  category: string;
  vendor: string;
  date: string;
  status: string;
}

export interface ChannelItem {
  id: string;
  name: string;
  type: 'public' | 'private' | 'direct';
  description: string;
  memberCount: number;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export interface MessageItem {
  id: string;
  content: string;
  senderName: string;
  senderAvatar: string;
  channelId: string;
  createdAt: string;
  isPinned: boolean;
  type: string;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location: string;
  color: string;
  creatorName: string;
}

export interface TicketItem {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in-progress' | 'pending' | 'resolved' | 'closed';
  category: string;
  contactName: string;
  assigneeName: string;
  createdAt: string;
  dueDate: string;
}

export interface ProductItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  unit: string;
  isActive: boolean;
}

export interface FileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  category: string;
  folder: string;
  uploadedBy: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  userName: string;
  userAvatar: string;
  createdAt: string;
  module: string;
}

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  isActive: boolean;
  executionCount: number;
  lastRun: string;
  createdAt: string;
}

export interface RoleItem {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  userCount: number;
  permissions: Record<string, string[]>;
}

export interface UserItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  roleName: string;
  isActive: boolean;
  lastSeen: string;
  avatar: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  color: string;
  opportunityCount: number;
  totalValue: number;
}

export interface PipelineItem {
  id: string;
  name: string;
  stageCount: number;
  totalValue: number;
  isDefault: boolean;
  stages: PipelineStage[];
}