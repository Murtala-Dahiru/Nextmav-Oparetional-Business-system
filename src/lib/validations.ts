import { z } from 'zod';

/**
 * Ownership fields carry no default.
 *
 * They used to default to the literal string 'u1', left over from before
 * authentication existed. Every one of these columns is a uuid foreign key, so
 * whenever a form submitted without an explicit owner the database answered
 *
 *     invalid input syntax for type uuid: "u1"
 *
 * and the create failed. Worse, the placeholder is truthy, so it overrode the
 * server-side default the route already applies — the API resolves an absent
 * owner to the caller's own membership, which is the correct answer and the
 * only one that can be trusted anyway.
 *
 * Leaving these optional and unset lets that server default do its job. A
 * supplied value must be a real uuid, so a stale client is refused by the form
 * rather than by Postgres.
 */
const memberRef = () => z.string().uuid('Must be a valid member').optional();

// ═══════════════════════════════════════════════════════════════
//  Schema helpers
// ═══════════════════════════════════════════════════════════════

/** Unwrap `.default()` / `.prefault()` wrappers to reach the underlying type. */
function stripDefaults(schema: any): any {
  let current = schema;
  while (current?.def?.type === 'default' || current?.def?.type === 'prefault') {
    current = current.def.innerType;
  }
  return current;
}

/**
 * Build an update (PATCH-style) schema from a create schema.
 *
 * `createSchema.partial()` is NOT safe for this: `.partial()` only marks fields
 * optional, it does not remove `.default()`. Any field the client omits is
 * therefore filled in with its default and written to the database, silently
 * resetting columns the user never touched. This strips defaults first, so an
 * omitted field stays absent and is left untouched by the update.
 */
export function toUpdateSchema<T extends z.ZodObject<any>>(createSchema: T) {
  const shape = createSchema.shape as Record<string, any>;
  const next: Record<string, any> = {};
  for (const key in shape) {
    next[key] = stripDefaults(shape[key]).optional();
  }
  // The shape is rebuilt dynamically, so restate the resulting type for
  // callers: every field of the source schema, made optional. Returning a
  // ZodObject (rather than a bare ZodType) keeps `.omit()`/`.extend()` usable.
  return z.object(next) as unknown as z.ZodObject<{
    [K in keyof T['shape']]: z.ZodOptional<T['shape'][K]>;
  }>;
}

/**
 * An optional foreign key.
 *
 * Distinguishes "not provided" (leave the existing value alone) from an
 * explicit null or empty string (clear the link). Empty strings must never
 * reach the database, since they would be stored as dangling references.
 */
export const optionalFk = () =>
  z
    .string()
    .trim()
    .nullish()
    .transform(v => (v === undefined ? undefined : v || null));

// ═══════════════════════════════════════════════════════════════
//  CRM Validations
// ═══════════════════════════════════════════════════════════════

export const createLeadSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().default(''),
  phone: z.string().optional().default(''),
  // These are the column names. As `company`, `title` and `value` they
  // matched nothing on the leads table, so the API stored null, null and 0 —
  // and still answered 201. Every lead saved lost its company, job title and
  // estimated value, silently, behind a success message.
  companyName: z.string().optional().default(''),
  jobTitle: z.string().optional().default(''),
  source: z.string().optional().default('manual'),
  status: z.string().optional().default('new'),
  score: z.number().int().min(0).optional().default(0),
  estimatedValue: z.number().min(0).optional().default(0),
  notes: z.string().optional().default(''),
  ownerId: memberRef(),
});

export const updateLeadSchema = toUpdateSchema(createLeadSchema);

export const createContactSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().default(''),
  phone: z.string().optional().default(''),
  jobTitle: z.string().optional().default(''),
  // A contact belongs to a company by id. Free text had nowhere to be stored.
  companyId: optionalFk(),
  source: z.string().optional().default('manual'),
  isActive: z.boolean().optional().default(true),
  notes: z.string().optional().default(''),
});

export const updateContactSchema = toUpdateSchema(createContactSchema);

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

export const updateCompanySchema = toUpdateSchema(createCompanySchema);

export const createDealSchema = z.object({
  name: z.string().min(1, 'Deal name is required'),
  value: z.number().min(0).optional().default(0),
  stage: z.string().optional().default('prospecting'),
  probability: z.number().int().min(0).max(100).optional().default(20),
  // The column is `expected_close`; `closeDate` matched nothing, so every
  // deal was saved with no close date and the pipeline forecast had no dates
  // to work from.
  expectedClose: z.string().optional().default(''),
  // Deals link to a company and contact by id, like invoices do.
  companyId: optionalFk(),
  contactId: optionalFk(),
  notes: z.string().optional().default(''),
  ownerId: memberRef(),
});

export const updateDealSchema = toUpdateSchema(createDealSchema);

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
  ownerId: memberRef(),
});

export const updateProjectSchema = toUpdateSchema(createProjectSchema);

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional().default(''),
  status: z.string().optional().default('todo'),
  priority: z.string().optional().default('medium'),
  assigneeId: memberRef(),
  projectId: z.string().min(1, 'Project ID is required'),
  dueDate: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  estimatedHours: z.number().min(0).optional().default(0),
  loggedHours: z.number().min(0).optional().default(0),
  sortOrder: z.number().int().optional().default(0),
});

export const updateTaskSchema = toUpdateSchema(createTaskSchema);

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

export const updatePageSchema = toUpdateSchema(createPageSchema);

// ═══════════════════════════════════════════════════════════════
//  Communication Validations
// ═══════════════════════════════════════════════════════════════

export const createChannelSchema = z.object({
  name: z.string().min(1, 'Channel name is required'),
  type: z.string().optional().default('public'),
  description: z.string().optional().default(''),
  creatorId: memberRef(),
  isArchived: z.boolean().optional().default(false),
});

export const updateChannelSchema = toUpdateSchema(createChannelSchema);

export const createMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  senderId: memberRef(),
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

export const updateTicketSchema = toUpdateSchema(createTicketSchema);

// ═══════════════════════════════════════════════════════════════
//  HR Validations
// ═══════════════════════════════════════════════════════════════

export const createEmployeeSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  avatar: z.string().optional().default(''),
  jobTitle: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  department: z.string().optional().default(''),
  roleId: z.string().optional().default('role-user'),
  isActive: z.boolean().optional().default(true),
});

export const updateEmployeeSchema = toUpdateSchema(createEmployeeSchema).omit({ password: true });

export const createLeaveSchema = z.object({
  requesterId: z.string().min(1, 'Requester ID is required'),
  type: z.string().optional().default('vacation'),
  startDate: z.string().datetime({ offset: true }).or(z.string()),
  endDate: z.string().datetime({ offset: true }).or(z.string()),
  status: z.string().optional().default('pending'),
  reason: z.string().optional().default(''),
  approverId: z.string().optional().default(''),
});

export const updateLeaveSchema = toUpdateSchema(createLeaveSchema);

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
  ownerId: memberRef(),
});

export const updateInvoiceSchema = toUpdateSchema(createInvoiceSchema);

export const createExpenseSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  amount: z.number().min(0),
  category: z.string().optional().default('general'),
  vendor: z.string().optional().default(''),
  date: z.string().datetime({ offset: true }).or(z.string()).optional().default(new Date().toISOString()),
  status: z.string().optional().default('pending'),
  receipt: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  ownerId: memberRef(),
});

export const updateExpenseSchema = toUpdateSchema(createExpenseSchema);

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
  // Empty string would be stored as a dangling foreign key, so normalise the
  // "unassigned" case to null.
  warehouseId: optionalFk(),
  supplierId: optionalFk(),
});

export const updateProductSchema = toUpdateSchema(createProductSchema);

export const createWarehouseSchema = z.object({
  name: z.string().min(1, 'Warehouse name is required'),
  location: z.string().optional().default(''),
  capacity: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateWarehouseSchema = toUpdateSchema(createWarehouseSchema);

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Supplier name is required'),
  contactName: z.string().optional().default(''),
  email: z.string().email('Invalid email').or(z.literal('')).optional().default(''),
  phone: z.string().optional().default(''),
  address: z.string().optional().default(''),
  city: z.string().optional().default(''),
  country: z.string().optional().default(''),
  leadTimeDays: z.number().int().min(0).max(365).optional().default(7),
  paymentTerms: z.string().optional().default('net30'),
  notes: z.string().optional().default(''),
  isActive: z.boolean().optional().default(true),
});

export const updateSupplierSchema = toUpdateSchema(createSupplierSchema);

export const STOCK_MOVEMENT_TYPES = ['receipt', 'issue', 'transfer', 'adjustment', 'return'] as const;

/**
 * A movement records a signed delta against a product. `quantity` may not be
 * zero — a movement that changes nothing is always a mistake, and silently
 * accepting it would pollute the ledger.
 */
export const createStockMovementSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional().default('adjustment'),
  quantity: z.number().int().refine(v => v !== 0, 'Quantity cannot be zero'),
  reason: z.string().optional().default(''),
  reference: z.string().optional().default(''),
  fromWarehouseId: optionalFk(),
  toWarehouseId: optionalFk(),
  userId: memberRef(),
});

export const PURCHASE_ORDER_STATUSES = ['draft', 'submitted', 'approved', 'received', 'cancelled'] as const;

export const purchaseOrderItemSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  unitCost: z.number().min(0).optional().default(0),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  warehouseId: optionalFk(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional().default('draft'),
  expectedDate: z.string().nullish(),
  taxRate: z.number().min(0).max(100).optional().default(0),
  notes: z.string().optional().default(''),
  createdById: memberRef(),
  items: z.array(purchaseOrderItemSchema).min(1, 'Add at least one line item'),
});

export const updatePurchaseOrderSchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  warehouseId: optionalFk(),
  expectedDate: z.string().nullish(),
  notes: z.string().optional(),
});

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
  creatorId: memberRef(),
});

export const updateEventSchema = toUpdateSchema(createEventSchema);

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

export const updateRoleSchema = toUpdateSchema(createRoleSchema);

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