import { after } from 'next/server';
import type { RequestContext } from '@/lib/auth-context';
import type { ModuleId } from '@/lib/constants';
import { allowedModules } from '@/lib/permissions';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The team activity feed — the writing half.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `activity_log` has existed since migration 0004 with an index, RLS policies
 *  on both directions, a place in the realtime publication, a GET/POST route,
 *  and a dashboard panel titled "Team activity · Across every module" that
 *  reads it. Nothing had ever written a row. The panel has shown "No recent
 *  activity" to every user of every tenant since the table was created.
 *
 *  ── Why it is recorded here rather than in each route ────────────────────
 *
 *  Twenty-seven routes are built from the shared handlers in
 *  `supabase/crud.ts`. Recording activity in each one guarantees the same
 *  drift the shared handlers exist to prevent: one forgets deletes, another
 *  writes a different title format, a third names the module inconsistently
 *  and its entries can never be filtered. Hooking the three write handlers
 *  covers every module through one implementation.
 *
 *  ── Why it costs nothing ─────────────────────────────────────────────────
 *
 *  `after()` runs the insert once the response has been flushed, so the user
 *  waits for their own write and not for the bookkeeping. A failure here is
 *  swallowed deliberately: an activity feed is a convenience, and a tenant
 *  whose feed insert fails must still get their invoice saved.
 *
 *  ── The part that is not a convenience ───────────────────────────────────
 *
 *  Rows are readable by every member of the tenant — `activity_select` checks
 *  the organization and nothing else, because the database has no notion of
 *  which modules a role may open. So this file is only half the feature: the
 *  *reading* side must filter to the caller's visible modules, or a support
 *  agent's dashboard starts narrating Finance and HR. `visibleModuleFilter()`
 *  below is that filter, and both readers use it.
 */

/**
 * The tables whose writes are narrated, what to call each record, and which
 * module the entry belongs to.
 *
 * ── Why an allow-list, and why the module is not the route's ─────────────
 *
 * An `activity_log` row copies a record's title into a table every member of
 * the tenant can read. So a table may only appear here if its own rows are
 * organisation-visible. Anything narrower — a row RLS shows only to the person
 * it belongs to — would have its title republished to everyone by the very act
 * of recording it, which is a disclosure the feed has no way to take back.
 *
 * `expenses` is the case that proved the point, and the reason the module is
 * taken from this map rather than from the route. `/api/finance/expenses`
 * declares `module: 'hr'` deliberately: every employee may submit and track
 * their own claim, and RLS admits a row only if you submitted it *or* you have
 * finance access. Labelling its activity with the route's gate wrote
 * "Created expense: Executive bonus — Q4" into the feed as an *HR* entry,
 * where every member of staff could read it — past the module filter, which
 * was looking for Finance, and past RLS, which never saw the expense row at
 * all. The verification harness caught it; nothing else would have.
 *
 * So expenses, leave requests, attendance, personal to-dos and messages are
 * absent by design, and a table that is not listed here is simply not
 * recorded.
 *
 * An explicit name per table rather than stripping a trailing 's': "companies"
 * would become "companie", and `calendar_events` reads better as "event" in a
 * sentence that already names the module.
 */
const ACTIVITY_TABLES: Record<string, { entity: string; module: ModuleId }> = {
  companies: { entity: 'company', module: 'crm' },
  contacts: { entity: 'contact', module: 'crm' },
  leads: { entity: 'lead', module: 'crm' },
  deals: { entity: 'deal', module: 'crm' },
  projects: { entity: 'project', module: 'projects' },
  tasks: { entity: 'task', module: 'projects' },
  milestones: { entity: 'milestone', module: 'projects' },
  calendar_events: { entity: 'event', module: 'calendar' },
  support_tickets: { entity: 'ticket', module: 'support' },
  invoices: { entity: 'invoice', module: 'finance' },
  products: { entity: 'product', module: 'inventory' },
  suppliers: { entity: 'supplier', module: 'inventory' },
  warehouses: { entity: 'warehouse', module: 'inventory' },
};

/** Columns that carry a human-readable name, best first. */
const LABEL_COLUMNS = [
  'name', 'title', 'subject', 'invoice_number', 'po_number', 'ticket_number', 'sku', 'email',
];

function labelOf(row: Record<string, any> | null | undefined): string {
  if (!row) return '';
  for (const c of LABEL_COLUMNS) {
    const v = row[c];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // People are stored as separate name columns rather than one label column.
  const person = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  if (person) return person;
  return '';
}

const VERBS: Record<ActivityAction, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
};

export type ActivityAction = 'create' | 'update' | 'delete';

export interface ActivityInput {
  action: ActivityAction;
  table: string;
  /** The row as written, used for the label and the id. */
  row: Record<string, any> | null | undefined;
}

/**
 * Record one activity, after the response has gone out.
 *
 * Silently does nothing for a table that is not in `ACTIVITY_TABLES`, for rows
 * with no readable label, and on any database failure.
 */
export function recordActivity(ctx: RequestContext, input: ActivityInput): void {
  const { action, table, row } = input;

  const spec = ACTIVITY_TABLES[table];
  if (!spec) return;

  const label = labelOf(row);
  if (!label) return;

  const { entity, module } = spec;
  const title = `${VERBS[action]} ${entity}: ${label}`;
  const entityId = typeof row?.id === 'string' ? row.id : null;

  after(async () => {
    try {
      await ctx.supabase.from('activity_log').insert({
        organization_id: ctx.org.organizationId,
        member_id: ctx.org.memberId,
        module,
        action,
        title,
        description: '',
        entity_type: entity,
        entity_id: entityId,
        metadata: {},
      });
    } catch {
      // A feed entry is never worth failing a request that already succeeded.
    }
  });
}

/**
 * The modules whose activity a caller may read.
 *
 * The database cannot answer this — `activity_select` scopes to the tenant,
 * because roles and their module grants live in `lib/permissions.ts` and not
 * in Postgres. Applying it here is the same decision `/api/search` makes, for
 * the same reason: RLS keeps a tenant's rows inside the tenant, and the module
 * boundary is a separate rule that has to be enforced where it is defined.
 *
 * Without this, the dashboard's activity panel is an oblique read of every
 * module: an employee with no Finance access would watch "Created expense:
 * Executive bonus — Q4" scroll past on their home screen.
 */
export function visibleModuleFilter(ctx: RequestContext): ModuleId[] {
  return allowedModules(ctx.org.role);
}
