/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Schema drift: what a validation schema names vs what the table has.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     npm run schema:check
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `contract:check` compares a *screen* with its endpoint. Nothing compared a
 * *validation schema* with the table it validates, and it turned out nothing
 * had ever needed to: the eighteen `update*Schema` exports in `lib/validations`
 * were imported by no route, so their field names had never once been used
 * against the database.
 *
 * Five of the twelve had drifted, and each would have failed differently once
 * wired to a route:
 *
 *   · calendar events — `startDate`/`endDate`/`color` for columns named
 *     `starts_at`/`ends_at`/`colour`. Every field rejected; edit impossible.
 *   · expenses — `date` for `expense_date`, `receipt` for `receipt_path`,
 *     `ownerId` for `submitted_by`.
 *   · invoices — `companyName` for `company_id`, `items` for a whole separate
 *     table, `tax` for `tax_rate`/`tax_amount`.
 *   · suppliers — `contactId`, where the column is free-text `contact_name`.
 *     This is the dangerous shape: the request succeeds and the field is
 *     silently dropped, so every edit would have quietly emptied the contact
 *     name rather than failing visibly.
 *   · leave requests — `requesterId` for `member_id`, `approverId` for
 *     `approved_by`.
 *
 * A schema field that names no column is either a hard failure (PGRST204) or,
 * worse, a silent omission. Both are caught here, before a route can ship with
 * one.
 *
 * The check is one-directional on purpose: a table may hold columns no client
 * should ever set — `organization_id`, `deleted_at`, `invoice_number`,
 * `balance_after` — so a column absent from a schema is not drift. Only a
 * schema field absent from the table is.
 */
import { connect, readEnv } from './db-connect.mjs';
import * as V from '../src/lib/validations';
import { toSnake } from '../src/lib/case';

const toSnakeKey = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * Every schema that describes a table, and the table it describes.
 *
 * Schemas whose subject is not a single table are listed with `table: null` and
 * skipped with a note, so adding one to `validations.ts` and forgetting to map
 * it here is visible rather than silently unchecked.
 */
const MAP: Array<{ schema: string; table: string | null; why?: string }> = [
  { schema: 'createLeadSchema', table: 'leads' },
  { schema: 'updateLeadSchema', table: 'leads' },
  { schema: 'createContactSchema', table: 'contacts' },
  { schema: 'updateContactSchema', table: 'contacts' },
  { schema: 'createCompanySchema', table: 'companies' },
  { schema: 'updateCompanySchema', table: 'companies' },
  { schema: 'createDealSchema', table: 'deals' },
  { schema: 'updateDealSchema', table: 'deals' },
  { schema: 'createProjectSchema', table: 'projects' },
  { schema: 'updateProjectSchema', table: 'projects' },
  { schema: 'createTaskSchema', table: 'tasks' },
  { schema: 'updateTaskSchema', table: 'tasks' },
  { schema: 'createTicketSchema', table: 'support_tickets' },
  { schema: 'updateTicketSchema', table: 'support_tickets' },
  { schema: 'createCrmActivitySchema', table: 'crm_activities' },
  { schema: 'updateCrmActivitySchema', table: 'crm_activities' },
  { schema: 'createExpenseSchema', table: 'expenses' },
  { schema: 'updateExpenseSchema', table: 'expenses' },
  { schema: 'createProductSchema', table: 'products' },
  { schema: 'updateProductSchema', table: 'products' },
  { schema: 'createWarehouseSchema', table: 'warehouses' },
  { schema: 'updateWarehouseSchema', table: 'warehouses' },
  { schema: 'createSupplierSchema', table: 'suppliers' },
  { schema: 'updateSupplierSchema', table: 'suppliers' },
  { schema: 'createEventSchema', table: 'calendar_events' },
  { schema: 'updateEventSchema', table: 'calendar_events' },
  { schema: 'createLeaveSchema', table: 'leave_requests' },
  { schema: 'updateLeaveSchema', table: 'leave_requests' },
  { schema: 'createChannelSchema', table: 'channels' },
  { schema: 'updateChannelSchema', table: 'channels' },
  { schema: 'createPageSchema', table: 'workspace_pages' },
  { schema: 'updatePageSchema', table: 'workspace_pages' },

  // Subjects that are not one table.
  {
    schema: 'createInvoiceSchema', table: null,
    why: 'carries lineItems, which are rows in invoice_line_items',
  },
  {
    schema: 'updateInvoiceSchema', table: 'invoices',
  },
  {
    schema: 'createMessageSchema', table: 'messages',
  },
  {
    schema: 'updateMessageSchema', table: 'messages',
  },
  {
    schema: 'createEmployeeSchema', table: null,
    why: 'spans auth.users, profiles and organization_members',
  },
  {
    schema: 'updateEmployeeSchema', table: null,
    why: 'spans profiles and organization_members',
  },
  {
    schema: 'createStockMovementSchema', table: 'stock_movements',
  },
  {
    schema: 'createPurchaseOrderSchema', table: null,
    why: 'carries items, which are rows in purchase_order_items',
  },
  {
    schema: 'updatePurchaseOrderSchema', table: 'purchase_orders',
  },
  {
    schema: 'createUserSchema', table: null, why: 'alias of createEmployeeSchema',
  },
  {
    schema: 'updateUserSchema', table: null, why: 'alias of updateEmployeeSchema',
  },
  { schema: 'updateSettingsSchema', table: null, why: 'a list of key/value rows' },
  { schema: 'updateNotificationSchema', table: 'notifications' },
  { schema: 'bulkMarkReadSchema', table: null, why: 'an action, not a record' },
  { schema: 'exportSchema', table: null, why: 'an action, not a record' },
  { schema: 'purchaseOrderItemSchema', table: 'purchase_order_items' },
];

/**
 * Columns a schema may name that the route always overrides from the session.
 *
 * `memberRef()` fields are accepted by the schema so a *form* can offer an
 * owner picker, and resolved server-side when absent. They are real columns, so
 * they pass anyway — this list is only for names that are legitimately not
 * columns.
 */
const ALLOWED_NON_COLUMNS = new Set<string>([
  // createEmployeeSchema-adjacent fields live on profiles/auth, checked above
  // by exclusion rather than here.
]);

let fail = 0;
const findings: string[] = [];

const { client, note } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'));
if (note) console.log(`  note: ${note}\n`);

const { rows } = await client.query(
  `SELECT table_name, column_name
     FROM information_schema.columns
    WHERE table_schema = 'public'`,
);
const columns = new Map<string, Set<string>>();
for (const r of rows) {
  if (!columns.has(r.table_name)) columns.set(r.table_name, new Set());
  columns.get(r.table_name)!.add(r.column_name);
}

console.log('  Validation schemas vs table columns');
console.log('  ───────────────────────────────────');

/**
 * `toUpdateSchema` also ends in "Schema" and is a function, not one. Filtered
 * by shape rather than by name so a helper added later is excluded too.
 */
const exported = new Set(
  Object.keys(V).filter(k => /Schema$/.test(k) && typeof (V as any)[k]?.safeParse === 'function'),
);
const mapped = new Set(MAP.map(m => m.schema));

for (const name of exported) {
  if (!mapped.has(name)) {
    fail++;
    findings.push(
      `${name} is exported from lib/validations but not listed in this check. ` +
      `Add it with its table, or with table: null and a reason.`,
    );
  }
}

for (const { schema, table, why } of MAP) {
  const s: any = (V as any)[schema];
  if (!s) {
    fail++;
    findings.push(`${schema} is listed here but not exported from lib/validations.`);
    continue;
  }
  if (!table) {
    console.log(`    SKIP  ${schema}  — ${why}`);
    continue;
  }

  const cols = columns.get(table);
  if (!cols) {
    fail++;
    findings.push(`${schema}: table "${table}" does not exist.`);
    continue;
  }

  const shape = s.shape ?? {};
  const bad: string[] = [];
  for (const key of Object.keys(shape)) {
    const col = toSnakeKey(key);
    if (!cols.has(col) && !ALLOWED_NON_COLUMNS.has(col)) bad.push(`${key} → ${col}`);
  }

  if (bad.length) {
    fail++;
    console.log(`    FAIL  ${schema} (${table})`);
    findings.push(
      `${schema}: ${table} has no column ${bad.map(b => `"${b}"`).join(', ')}`,
    );
  } else {
    console.log(`    PASS  ${schema} (${table}) — ${Object.keys(shape).length} fields`);
  }
}

/**
 * The round trip must be stable, or `acceptBody` cannot be trusted.
 *
 * A body is snake-cased on the way in and camel-cased on the way out. If any
 * field name is not a fixed point of that pair, the two ends disagree about
 * what the field is called and the value goes missing in one direction. Worth
 * asserting directly: this is the mechanism the whole boundary rests on.
 */
console.log('\n  Key-case round trip');
console.log('  ───────────────────');
const roundTripFailures: string[] = [];
for (const { schema, table } of MAP) {
  if (!table) continue;
  const s: any = (V as any)[schema];
  if (!s?.shape) continue;
  for (const key of Object.keys(s.shape)) {
    const there = toSnakeKey(key);
    const back = there.replace(/_([a-z0-9])/g, (_: string, c: string) => c.toUpperCase());
    if (back !== key) roundTripFailures.push(`${schema}.${key} → ${there} → ${back}`);
  }
}
if (roundTripFailures.length) {
  fail++;
  console.log(`    FAIL  ${roundTripFailures.length} field(s) are not stable under snake→camel`);
  findings.push(...roundTripFailures.map(r => `unstable key case: ${r}`));
} else {
  console.log('    PASS  every schema field survives snake→camel unchanged');
}

/**
 * `acceptBody` must not emit two spellings of one field.
 *
 * This is the defect that made editing a project fail: the body carried both
 * `client_company_id` and `clientCompanyId`, and the second is not a column.
 * Asserted against every real schema field rather than a hand-picked example.
 */
console.log('\n  acceptBody emits one spelling per field');
console.log('  ──────────────────────────────────────');
const { acceptBody } = await import('../src/lib/case');
const aliasFailures: string[] = [];
for (const { schema, table } of MAP) {
  if (!table) continue;
  const s: any = (V as any)[schema];
  if (!s?.shape) continue;
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(s.shape)) body[key] = 'x';
  const out = acceptBody(body);
  for (const key of Object.keys(body)) {
    const col = toSnakeKey(key);
    if (col !== key && key in out) aliasFailures.push(`${schema}: ${key} survived alongside ${col}`);
  }
}
if (aliasFailures.length) {
  fail++;
  console.log(`    FAIL  ${aliasFailures.length} camelCase alias(es) leaked`);
  findings.push(...aliasFailures);
} else {
  console.log('    PASS  no camelCase aliases leak into the database payload');
}

await client.end();

console.log('');
if (findings.length) {
  console.log('  Findings');
  console.log('  ────────');
  for (const f of findings) console.log(`    · ${f}`);
  console.log('');
}
console.log(fail ? `  ${fail} check(s) failed` : '  all schema contracts hold');
process.exit(fail ? 1 : 0);

// `toSnake` is imported to keep the dependency explicit for readers comparing
// this with the runtime path; the local `toSnakeKey` mirrors its key function.
void toSnake;
