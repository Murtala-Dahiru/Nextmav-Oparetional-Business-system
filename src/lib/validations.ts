import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
//  CRM Validations
// ═══════════════════════════════════════════════════════════════

export const createLeadSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().default(''),
  phone: z.string().optional().default(''),
  company: z.string().optional().default(''),
  title: z.string().optional().default(''),
  source: z.string().optional().default('manual'),
  status: z.string().optional().default('new'),
  score: z.number().int().min(0).optional().default(0),
  value: z.number().min(0).optional().default(0),
  notes: z.string().optional().default(''),
  ownerId: z.string().optional().default('u1'),
});

export const updateLeadSchema = createLeadSchema.partial();

export const createContactSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().default(''),
  phone: z.string().optional().default(''),
  jobTitle: z.string().optional().default(''),
  company: z.string().optional().default(''),
  source: z.string().optional().default('manual'),
  isActive: z.boolean().optional().default(true),
  notes: z.string().optional().default(''),
});

export const updateContactSchema = createContactSchema.partial();

export const createCompanySchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  industry: z.string().optional().default(''),
  website: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  email: z.string().email('Invalid email').optional().default(''),
  city: z.string().optional().default(''),
  country: z.string().optional().default(''),
  employeeCount: z.number().int().min(0).optional().default(0),
  annualRevenue: z.number().min(0).optional().default(0),
  notes: z.string().optional().default(''),
});

export const updateCompanySchema = createCompanySchema.partial();

export const createDealSchema = z.object({
  name: z.string().min(1, 'Deal name is required'),
  value: z.number().min(0).optional().default(0),
  stage: z.string().optional().default('prospecting'),
  probability: z.number().int().min(0).max(100).optional().default(20),
  closeDate: z.string().datetime({ offset: true }).or(z.string()).optional().default(new Date().toISOString()),
  contactName: z.string().optional().default(''),
  companyName: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  ownerId: z.string().optional().default('u1'),
});

export const updateDealSchema = createDealSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  Projects Validations
// ═══════════════════════════════════════════════════════════════

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional().default(''),
  status: z.string().optional().default('planning'),
  priority: z.string().optional().default('medium'),
  startDate: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  budget: z.number().min(0).optional().default(0),
  ownerId: z.string().optional().default('u1'),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional().default(''),
  status: z.string().optional().default('todo'),
  priority: z.string().optional().default('medium'),
  assigneeId: z.string().optional().default('u1'),
  projectId: z.string().min(1, 'Project ID is required'),
  dueDate: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  estimatedHours: z.number().min(0).optional().default(0),
  loggedHours: z.number().min(0).optional().default(0),
  sortOrder: z.number().int().optional().default(0),
});

export const updateTaskSchema = createTaskSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  Workspace Validations
// ═══════════════════════════════════════════════════════════════

export const createPageSchema = z.object({
  title: z.string().min(1, 'Page title is required'),
  content: z.string().optional().default(''),
  icon: z.string().optional().default('file-text'),
  color: z.string().optional().default('#10b981'),
  parentId: z.string().optional().default(''),
  isFolder: z.boolean().optional().default(false),
  isStarred: z.boolean().optional().default(false),
  lastEditedBy: z.string().optional().default(''),
});

export const updatePageSchema = createPageSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  Communication Validations
// ═══════════════════════════════════════════════════════════════

export const createChannelSchema = z.object({
  name: z.string().min(1, 'Channel name is required'),
  type: z.string().optional().default('public'),
  description: z.string().optional().default(''),
  creatorId: z.string().optional().default('u1'),
  isArchived: z.boolean().optional().default(false),
});

export const updateChannelSchema = createChannelSchema.partial();

export const createMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  senderId: z.string().optional().default('u1'),
  channelId: z.string().min(1, 'Channel ID is required'),
  isPinned: z.boolean().optional().default(false),
});

export const updateMessageSchema = z.object({
  content: z.string().optional(),
  isPinned: z.boolean().optional(),
});

// ═══════════════════════════════════════════════════════════════
//  Support Validations
// ═══════════════════════════════════════════════════════════════

export const createTicketSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  description: z.string().optional().default(''),
  priority: z.string().optional().default('medium'),
  status: z.string().optional().default('open'),
  category: z.string().optional().default('general'),
  contactName: z.string().optional().default(''),
  contactEmail: z.string().email('Invalid email').optional().default(''),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  resolution: z.string().optional().default(''),
});

export const updateTicketSchema = createTicketSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  HR Validations
// ═══════════════════════════════════════════════════════════════

export const createEmployeeSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  avatar: z.string().optional().default(''),
  jobTitle: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  department: z.string().optional().default(''),
  roleId: z.string().optional().default('role-user'),
  isActive: z.boolean().optional().default(true),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().omit({ password: true });

export const createLeaveSchema = z.object({
  requesterId: z.string().min(1, 'Requester ID is required'),
  type: z.string().optional().default('vacation'),
  startDate: z.string().datetime({ offset: true }).or(z.string()),
  endDate: z.string().datetime({ offset: true }).or(z.string()),
  status: z.string().optional().default('pending'),
  reason: z.string().optional().default(''),
  approverId: z.string().optional().default(''),
});

export const updateLeaveSchema = createLeaveSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  Finance Validations
// ═══════════════════════════════════════════════════════════════

export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, 'Invoice number is required'),
  contactName: z.string().optional().default(''),
  companyName: z.string().optional().default(''),
  status: z.string().optional().default('draft'),
  items: z.string().optional().default('[]'),
  subtotal: z.number().min(0).optional().default(0),
  tax: z.number().min(0).optional().default(0),
  total: z.number().min(0).optional().default(0),
  dueDate: z.string().datetime({ offset: true }).or(z.string()),
  paidAt: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  notes: z.string().optional().default(''),
  ownerId: z.string().optional().default('u1'),
});

export const updateInvoiceSchema = createInvoiceSchema.partial();

export const createExpenseSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  amount: z.number().min(0),
  category: z.string().optional().default('general'),
  vendor: z.string().optional().default(''),
  date: z.string().datetime({ offset: true }).or(z.string()).optional().default(new Date().toISOString()),
  status: z.string().optional().default('pending'),
  receipt: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  ownerId: z.string().optional().default('u1'),
});

export const updateExpenseSchema = createExpenseSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  Inventory Validations
// ═══════════════════════════════════════════════════════════════

export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  category: z.string().optional().default('general'),
  price: z.number().min(0).optional().default(0),
  cost: z.number().min(0).optional().default(0),
  stock: z.number().int().min(0).optional().default(0),
  unit: z.string().optional().default('unit'),
  reorderLevel: z.number().int().min(0).optional().default(10),
  isActive: z.boolean().optional().default(true),
  warehouseId: z.string().optional().default(''),
});

export const updateProductSchema = createProductSchema.partial();

export const createWarehouseSchema = z.object({
  name: z.string().min(1, 'Warehouse name is required'),
  location: z.string().optional().default(''),
  capacity: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateWarehouseSchema = createWarehouseSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  Calendar Validations
// ═══════════════════════════════════════════════════════════════

export const createEventSchema = z.object({
  title: z.string().min(1, 'Event title is required'),
  description: z.string().optional().default(''),
  startDate: z.string().datetime({ offset: true }).or(z.string()),
  endDate: z.string().datetime({ offset: true }).or(z.string()),
  allDay: z.boolean().optional().default(false),
  location: z.string().optional().default(''),
  color: z.string().optional().default('#10b981'),
  creatorId: z.string().optional().default('u1'),
});

export const updateEventSchema = createEventSchema.partial();

// ═══════════════════════════════════════════════════════════════
//  Admin Validations
// ═══════════════════════════════════════════════════════════════

export const createUserSchema = createEmployeeSchema;

export const updateUserSchema = updateEmployeeSchema;

export const createRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  description: z.string().optional().default(''),
  isSystem: z.boolean().optional().default(false),
  permissions: z.string().optional().default('{}'),
});

export const updateRoleSchema = createRoleSchema.partial();

export const updateSettingsSchema = z.object({
  settings: z.array(z.object({
    key: z.string().min(1),
    value: z.string(),
    type: z.string().optional().default('string'),
    group: z.string().optional().default('general'),
  })),
});

export const updateNotificationSchema = z.object({
  isRead: z.boolean().optional(),
});

export const bulkMarkReadSchema = z.object({
  ids: z.array(z.string()).optional(),
  markAll: z.boolean().optional(),
});

// ═══════════════════════════════════════════════════════════════
//  Export Validations
// ═══════════════════════════════════════════════════════════════

export const exportSchema = z.object({
  module: z.string().min(1, 'Module is required'),
  format: z.enum(['csv']).optional().default('csv'),
});