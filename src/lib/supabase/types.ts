// Database types matching the Supabase schema
export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  industry: string | null
  website: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  country: string | null
  currency: string
  tax_rate: number
  invoice_prefix: string
  fiscal_year_start: string
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  id: string
  user_id: string
  organization_id: string
  role: UserRole
  is_active: boolean
  invited_by: string | null
  invited_at: string | null
  joined_at: string | null
  created_at: string
  updated_at: string
  organization?: Organization
  user?: UserProfile
}

export type UserRole =
  | 'super_admin'
  | 'owner'
  | 'admin'
  | 'manager'
  | 'sales'
  | 'hr'
  | 'finance'
  | 'marketing'
  | 'support'
  | 'employee'
  | 'client'
  | 'vendor'

export interface UserProfile {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  avatar_url: string | null
  job_title: string | null
  department: string | null
  is_active: boolean
  last_seen: string | null
  created_at: string
  updated_at: string
}

export interface Role {
  id: string
  organization_id: string
  name: string
  description: string | null
  is_system: boolean
  permissions: Record<string, string[]>
  created_at: string
  updated_at: string
}

export interface Setting {
  key: string
  value: string
  type: string
  group: string
  organization_id: string
  updated_at: string
  updated_by: string
}

// CRM types
export interface Lead {
  id: string
  organization_id: string
  owner_id: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  company: string | null
  source: string
  status: LeadStatus
  score: number
  value: number
  notes: string | null
  created_at: string
  updated_at: string
  owner?: UserProfile
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'

export interface Contact {
  id: string
  organization_id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  job_title: string | null
  company: string | null
  source: string
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Company {
  id: string
  organization_id: string
  name: string
  industry: string | null
  website: string | null
  email: string | null
  phone: string | null
  city: string | null
  country: string | null
  employee_count: number | null
  annual_revenue: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Deal {
  id: string
  organization_id: string
  owner_id: string | null
  name: string
  contact_name: string | null
  company_name: string | null
  stage: DealStage
  probability: number
  value: number
  close_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
  owner?: UserProfile
}

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'contract' | 'won' | 'lost'

// Projects
export interface Project {
  id: string
 organization_id: string
  owner_id: string | null
  name: string
  description: string | null
  status: ProjectStatus
  priority: Priority
  budget: number | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  owner?: UserProfile
  project_tasks?: { count: number }
}

export interface ProjectTask {
  id: string
  organization_id: string
  project_id: string
  assignee_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  due_date: string | null
 estimated_hours: number | null
 logged_hours: number
  sort_order: number
  created_at: string
  updated_at: string
  project?: Project
  assignee?: UserProfile
}

export type ProjectStatus = 'not_started' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

// Finance
export interface Invoice {
  id: string
  organization_id: string
  owner_id: string | null
  invoice_number: string
  contact_name: string | null
  company_name: string | null
  status: InvoiceStatus
  items: InvoiceItem[]
  subtotal: number
  tax: number
  total: number
  due_date: string
  paid_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  owner?: UserProfile
}

export interface InvoiceItem {
  description: string
  quantity: number
  unit_price: number
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'refunded'

export interface Expense {
  id: string
  organization_id: string
  owner_id: string | null
  title: string
  amount: number
  category: ExpenseCategory
  vendor: string | null
  date: string
  status: ExpenseStatus
  receipt_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  owner?: UserProfile
}

export type ExpenseCategory = 'travel' | 'meals' | 'office' | 'software' | 'marketing' | 'equipment' | 'training' | 'other'

// HR
export interface LeaveRequest {
  id: string
  organization_id: string
  requester_id: string
  type: LeaveType
  start_date: string
  end_date: string
  reason: string | null
  status: LeaveStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  requester?: UserProfile
}

export type LeaveType = 'vacation' | 'sick' | 'personal' | 'maternity' | 'paternity' | 'bereavement' | 'unpaid'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

// Inventory
export interface Product {
  id: string
  organization_id: string
  sku: string
  name: string
  description: string | null
  category: string
  price: number
  cost: number
  stock: number
  unit: string
  reorder_level: number
  warehouse_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Warehouse {
  id: string
  organization_id: string
  name: string
  location: string | null
  capacity: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// Communication
export interface Channel {
  id: string
  organization_id: string
  name: string
  type: 'public' | 'private' | 'direct'
  description: string | null
  creator_id: string
  is_active: boolean
  created_at: string
  updated_at: string
  _count?: { messages: number }
}

export interface Message {
  id: string
  organization_id: string
  channel_id: string
  sender_id: string
  content: string
  is_pinned: boolean
  created_at: string
  updated_at: string
  sender?: UserProfile
}

// Support
export interface SupportTicket {
  id: string
  organization_id: string
  ticket_number: string
  subject: string
  description: string | null
  priority: TicketPriority
  status: TicketStatus
  category: string
  contact_name: string
  contact_email: string | null
  assignee_id: string | null
  due_date: string | null
  resolution: string | null
  created_at: string
  updated_at: string
  assignee?: UserProfile
}

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'
export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed'

// Calendar
export interface CalendarEvent {
  id: string
  organization_id: string
  creator_id: string
  title: string
  description: string | null
  start_date: string
  end_date: string
  all_day: boolean
  location: string | null
  color: string
  created_at: string
  updated_at: string
  creator?: UserProfile
}

// Workspace
export interface WorkspacePage {
  id: string
  organization_id: string
  parent_id: string | null
  title: string
  content: string | null
  icon: string
  color: string | null
  is_folder: boolean
  is_starred: boolean
  last_edited_by: string | null
  created_at: string
  updated_at: string
  last_edited_by_user?: UserProfile
}

// System
export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: string
  link: string | null
  is_read: boolean
  created_at: string
}

export interface AuditLog {
  id: string
  organization_id: string
  user_id: string
  action: string
  module: string
  entity_id: string | null
  entity_name: string | null
  details: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
  user?: UserProfile
}

export interface ActivityLog {
  id: string
  organization_id: string
  user_id: string
  title: string
  description: string
  module: string
  entity_id: string | null
  link: string | null
  created_at: string
  user?: UserProfile
}

// Invitation
export interface Invitation {
  id: string
  organization_id: string
  email: string
  role: UserRole
  token: string
  invited_by: string
  accepted_at: string | null
  expires_at: string
  created_at: string
  inviter?: UserProfile
  organization?: Organization
}