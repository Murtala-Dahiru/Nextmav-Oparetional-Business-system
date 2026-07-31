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
  /**
   * The customer this project is for.
   *
   * `projects.client_company_id` has existed since 0003 and the endpoint has
   * always read it, but this schema never listed it — so `zodResolver` stripped
   * the field before the request was built, and a project could not be attached
   * to a client through the UI at all.
   *
   * That single missing line is what made the client portal look broken. Every
   * portal read resolves through `client_company_id`, so with nothing ever set,
   * a client who signed in correctly saw an empty portal.
   *
   * `optionalFk()` rather than a plain string: clearing the selection has to
   * reach the database as NULL, and a bare `.default('')` writes an empty
   * string that becomes a dangling foreign key.
   */
  clientCompanyId: optionalFk(),
  departmentId: optionalFk(),
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
  colour: z.string().optional().default('#10b981'),
  parentId: z.string().optional().default(''),
  isFolder: z.boolean().optional().default(false),
  isStarred: z.boolean().optional().default(false),
  lastEditedBy: z.string().optional().default(''),
});

export const updatePageSchema = toUpdateSchema(createPageSchema);

// ═══════════════════════════════════════════════════════════════
//  Communication Validations
// ═══════════════════════════════════════════════════════════════

/**
 * A channel.
 *
 * `creatorId` is gone: the column is `created_by` and the route takes it from
 * the session. `displayName`, `topic` and the two policy columns were added in
 * 0017 and belong on the editable surface — renaming a channel and changing who
 * may post in it are exactly what the settings dialog does.
 */
export const createChannelSchema = z.object({
  name: z.string().min(1, 'Channel name is required'),
  type: z.string().optional().default('public'),
  description: z.string().optional().default(''),
  displayName: z.string().optional(),
  topic: z.string().optional(),
  postPolicy: z.string().optional(),
  joinPolicy: z.string().optional(),
  departmentId: optionalFk(),
  teamId: optionalFk(),
  isArchived: z.boolean().optional().default(false),
});

export const updateChannelSchema = toUpdateSchema(createChannelSchema);

/**
 * A message.
 *
 * The column is `body`, not `content`. `senderId` is gone for the reason the
 * route already states in a comment: "the sender is taken from the session,
 * never the body — accepting it would" let anyone post as anyone.
 */
export const createMessageSchema = z.object({
  body: z.string().optional().default(''),
  channelId: z.string().min(1, 'Channel ID is required'),
  parentId: optionalFk(),
  mentions: z.array(z.string()).optional(),
  attachments: z.array(z.unknown()).optional(),
  isPinned: z.boolean().optional().default(false),
});

export const updateMessageSchema = z.object({
  body: z.string().optional(),
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
  // A ticket links to a CRM contact by id; there is no name column, so a
  // typed name was discarded on save and the Contact column stayed blank.
  contactId: optionalFk(),
  contactEmail: z.string().email('Invalid email').optional().default(''),
  assigneeId: z.string().nullable().optional(),
  // due_at is the SLA deadline, assigned by trigger from the priority.
  // Accepting it here implied the client could set it; nothing ever did.
  resolution: z.string().optional().default(''),
});

export const updateTicketSchema = toUpdateSchema(createTicketSchema);

/**
 * A logged call, email, meeting or note against a customer.
 *
 * `crm_activities` is polymorphic — an activity hangs off a lead, a contact, a
 * company or a deal — and the database enforces that it hangs off at least one
 * of them (`crm_activity_has_subject`). The same rule is stated here so the
 * failure is a sentence rather than a constraint-violation code, and so the
 * client can be told which field is missing before the round trip.
 */
export const createCrmActivitySchema = z
  .object({
    activityType: z.string().min(1, 'An activity type is required').default('note'),
    subject: z.string().min(1, 'A subject is required'),
    body: z.string().optional().default(''),
    leadId: optionalFk(),
    contactId: optionalFk(),
    companyId: optionalFk(),
    dealId: optionalFk(),
    dueAt: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
    completedAt: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  })
  .refine(
    v => Boolean(v.leadId || v.contactId || v.companyId || v.dealId),
    {
      message: 'Attach the activity to a lead, contact, company or deal',
      path: ['companyId'],
    },
  );

/**
 * `.omit()` before `toUpdateSchema`, because the create schema is a
 * `ZodEffects` once `.refine()` is applied and `toUpdateSchema` reads `.shape`.
 * The subject rule belongs to creation anyway: an edit that does not mention
 * the links must not be read as detaching the activity from all of them.
 */
export const updateCrmActivitySchema = toUpdateSchema(
  z.object({
    activityType: z.string().min(1).default('note'),
    subject: z.string().min(1, 'A subject is required'),
    body: z.string().optional().default(''),
    dueAt: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
    completedAt: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  }),
);

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

/**
 * A leave request.
 *
 * `requesterId` and `approverId` named nothing: the columns are `member_id` and
 * `approved_by`. Neither is a client input in practice — the requester is the
 * session's member and the approver is stamped by the route when a decision is
 * made — so they are not part of the editable surface at all.
 *
 * `status` is likewise absent. `hr/leave/[id]` treats a status change as a
 * decision rather than an edit: it requires the `approve` capability, records
 * `approved_by` and `decided_at` with it, and refuses self-approval. That
 * separation is the whole point of the route being hand-written, and a generic
 * status field here would go around it.
 */
export const createLeaveSchema = z.object({
  type: z.string().optional().default('vacation'),
  startDate: z.string().datetime({ offset: true }).or(z.string()),
  endDate: z.string().datetime({ offset: true }).or(z.string()),
  isHalfDay: z.boolean().optional().default(false),
  reason: z.string().optional().default(''),
});

export const updateLeaveSchema = toUpdateSchema(createLeaveSchema);

// ═══════════════════════════════════════════════════════════════
//  Finance Validations
// ═══════════════════════════════════════════════════════════════

/**
 * An invoice.
 *
 * ── Field names corrected to the columns ───────────────────────────────────
 *
 * Three of these named nothing: `companyName` (the column is `company_id`),
 * `items` (line items are rows in `invoice_line_items`, not a JSON string on
 * the invoice) and `tax` (the columns are `tax_rate` and `tax_amount`).
 */
export const createInvoiceSchema = z.object({
  companyId: optionalFk(),
  contactId: optionalFk(),
  projectId: optionalFk(),
  status: z.string().optional().default('draft'),
  issueDate: z.string().datetime({ offset: true }).or(z.string()).optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.string()),
  taxRate: z.number().min(0).max(100).optional().default(0),
  discount: z.number().min(0).optional().default(0),
  notes: z.string().optional().default(''),
  lineItems: z.array(z.object({
    description: z.string().min(1, 'A line item needs a description'),
    quantity: z.number().min(0),
    unitPrice: z.number().min(0),
  })).optional(),
});

/**
 * What an edit to an invoice may change — written out rather than derived.
 *
 * An invoice's money is not client input. `invoice_number` comes from a
 * per-tenant sequence, and `subtotal`, `tax_amount`, `total` and `amount_paid`
 * are computed by the server from the line items it stores; the figures on the
 * form are a preview of that calculation, not a value to send. Deriving this
 * from the create schema would be close enough to work and still leave `total`
 * writable, so a caller holding `finance.edit` could set a paid invoice's total
 * to zero without touching a single line item, and the ledger would agree with
 * them.
 *
 * `lineItems` is absent for the same reason: replacing them has to recompute the
 * totals, which is the create route's job and not something a generic column
 * update can do correctly.
 *
 * Same shape of reasoning as `updatePurchaseOrderSchema` below, which is also
 * written out for its own reasons.
 */
export const updateInvoiceSchema = z.object({
  companyId: optionalFk(),
  contactId: optionalFk(),
  projectId: optionalFk(),
  status: z.string().optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * An expense claim.
 *
 * ── Field names corrected to the columns ───────────────────────────────────
 *
 * `date` → `expenseDate` and `receipt` → `receiptPath`: the columns are
 * `expense_date` and `receipt_path`, and neither `date` nor `receipt` exists on
 * the table. The expense form still sends `date`, which is why the date a user
 * picks has never been stored — the create route reads `b.expense_date`, finds
 * nothing, and defaults to today — and why editing an expense failed outright.
 * The form is corrected alongside this.
 *
 * `ownerId` is dropped: the column is `submitted_by` and it is the session's
 * member, never a client's choice. `status` is dropped too — approving a claim
 * is a decision, not an edit, and it is handled by the route so that
 * `approved_by` and `decided_at` are recorded with it. Accepting `status` here
 * would let a claimant approve their own expense: the database trigger that
 * blocks self-approval only fires when `approved_by` is set, so a bare status
 * change slipped straight past it.
 */
export const createExpenseSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  amount: z.number().min(0),
  category: z.string().optional().default('general'),
  vendor: z.string().optional().default(''),
  expenseDate: z.string().datetime({ offset: true }).or(z.string()).optional(),
  receiptPath: z.string().optional().default(''),
  projectId: optionalFk(),
  departmentId: optionalFk(),
  notes: z.string().optional().default(''),
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
  /**
   * `contact_name`, not `contact_id`.
   *
   * A supplier's contact is free text on the supplier row — unlike a ticket or
   * an invoice, which reference a CRM contact by id. This field was
   * `contactId: optionalFk()`, copied from those, and `suppliers` has no
   * `contact_id` column at all. The form has always sent `contactName`
   * correctly, so nothing was broken while no route read this schema; wiring it
   * to the update route unchanged would have stripped the field on every edit
   * and quietly emptied the contact name of every supplier that was touched.
   */
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
  // The column is `member_id`, and the route passes the session's member to
  // `record_stock_movement()`. A client-nominated mover would make the ledger
  // unattributable, which is the one thing a stock ledger must not be.
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

/**
 * A calendar event.
 *
 * ── Field names corrected to the columns ───────────────────────────────────
 *
 * This schema said `startDate`, `endDate` and `color`. The table has
 * `starts_at`, `ends_at` and `colour` — the British spelling — and there are no
 * `start_date`/`end_date`/`color` columns on it. The component was fixed to
 * send the right three some time ago (there is a note in the calendar module
 * saying every event used to be rejected as "Start and end times are required")
 * but this schema was never part of that fix, because no route read it.
 *
 * `creatorId` is gone rather than renamed. `created_by` is taken from the
 * session — a client that could nominate the creator of a record could forge
 * authorship, and the create route has always ignored it.
 */
export const createEventSchema = z.object({
  title: z.string().min(1, 'Event title is required'),
  description: z.string().optional().default(''),
  startsAt: z.string().datetime({ offset: true }).or(z.string()),
  endsAt: z.string().datetime({ offset: true }).or(z.string()),
  allDay: z.boolean().optional().default(false),
  location: z.string().optional().default(''),
  colour: z.string().optional().default('#10b981'),
  visibility: z.string().optional().default('organization'),
  departmentId: optionalFk(),
  projectId: optionalFk(),
});

export const updateEventSchema = toUpdateSchema(createEventSchema);

// ═══════════════════════════════════════════════════════════════
//  Admin Validations
// ═══════════════════════════════════════════════════════════════

export const createUserSchema = createEmployeeSchema;

export const updateUserSchema = updateEmployeeSchema;

/**
 * ── Removed: createRoleSchema / updateRoleSchema ───────────────────────────
 *
 * They described a `roles` table with `permissions` as a JSON string. No such
 * table exists — it was the pre-migration ORM's `Role` model, one of the three
 * unreconciled role vocabularies the permission work consolidated. A role is
 * now a canonical id on `organization_members.role`, and what it may do is
 * defined by `ROLE_GRANTS` in `lib/permissions.ts` and nowhere else.
 *
 * Kept as a note rather than deleted silently, because a schema for storing
 * per-role permissions in the database is exactly the shape of thing someone
 * would reasonably re-add — and doing so would reintroduce a second source of
 * truth for access control. `/api/admin/roles` reads `organization_members`.
 */

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