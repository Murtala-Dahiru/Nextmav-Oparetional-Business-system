import { can } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';

/**
 * ===========================================================================
 *  Workspace page links: the record types, and how to name one
 * ===========================================================================
 *
 *  Shared by the three routes that touch a link - the page's own list, the
 *  reverse lookup a business record uses to find its documents, and the page
 *  read that ships them with the document. A route file can only export HTTP
 *  handlers, and three copies of the resolver table is exactly how one of them
 *  comes to spell a column differently from the other two.
 */

export const ENTITY_TYPES = [
  'company', 'contact', 'deal', 'lead',
  'project', 'task', 'employee', 'invoice', 'ticket', 'department',
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

/** Which module a record belongs to, for the reader's own permission check. */
export const OWNING_MODULE: Record<EntityType, ModuleId | null> = {
  company: 'crm', contact: 'crm', deal: 'crm', lead: 'crm',
  project: 'projects', task: 'projects',
  employee: 'hr', invoice: 'finance', ticket: 'support',
  // Departments are organisation structure rather than one module's data;
  // every screen that shows a person's department already reads it.
  department: null,
};

/**
 * How to find a record's current name.
 *
 * `select` is the column list, `label` builds the display string. Kept as data
 * rather than ten branches so adding a linkable type is one line here and one
 * value in the CHECK constraint.
 */
export const RESOLVERS: Record<EntityType, {
  table: string;
  select: string;
  softDelete: boolean;
  label: (row: any) => string;
  detail: (row: any) => string;
}> = {
  company: {
    table: 'companies', select: 'id, name, industry', softDelete: true,
    label: r => r.name, detail: r => r.industry ?? '',
  },
  contact: {
    table: 'contacts', select: 'id, first_name, last_name, job_title', softDelete: true,
    label: r => [r.first_name, r.last_name].filter(Boolean).join(' '),
    detail: r => r.job_title ?? '',
  },
  deal: {
    table: 'deals', select: 'id, name, stage', softDelete: true,
    label: r => r.name, detail: r => r.stage ?? '',
  },
  lead: {
    table: 'leads', select: 'id, first_name, last_name, company_name, status', softDelete: true,
    label: r => [r.first_name, r.last_name].filter(Boolean).join(' ') || r.company_name || 'Lead',
    detail: r => r.company_name ?? r.status ?? '',
  },
  project: {
    table: 'projects', select: 'id, name, status', softDelete: true,
    label: r => r.name, detail: r => r.status ?? '',
  },
  task: {
    table: 'tasks', select: 'id, title, status', softDelete: true,
    label: r => r.title, detail: r => r.status ?? '',
  },
  employee: {
    table: 'v_assignable_members', select: 'member_id, full_name, job_title', softDelete: false,
    label: r => r.full_name, detail: r => r.job_title ?? '',
  },
  invoice: {
    table: 'invoices', select: 'id, invoice_number, status', softDelete: true,
    label: r => r.invoice_number, detail: r => r.status ?? '',
  },
  ticket: {
    table: 'support_tickets', select: 'id, ticket_number, subject, status', softDelete: true,
    label: r => r.subject, detail: r => r.ticket_number ?? '',
  },
  department: {
    table: 'departments', select: 'id, name', softDelete: false,
    label: r => r.name, detail: () => '',
  },
};

/**
 * Attach a current name to each stored link.
 *
 * One read per entity *type* rather than per link: a page linked to four
 * companies is one query, not four. Exported for the reverse endpoint and for
 * the page read, so the three places that render a link list agree about what
 * a link looks like.
 */
export async function decorateLinks(
  ctx: { supabase: any; org: { organizationId: string; role: any } },
  rows: any[],
) {
  if (!rows.length) return [];

  const byType = new Map<EntityType, string[]>();
  for (const row of rows) {
    const type = row.entity_type as EntityType;
    if (!RESOLVERS[type]) continue;
    byType.set(type, [...(byType.get(type) ?? []), row.entity_id]);
  }

  const resolved = new Map<string, { label: string; detail: string }>();

  await Promise.all([...byType.entries()].map(async ([type, ids]) => {
    const owner = OWNING_MODULE[type];
    // A reader without the module gets the stored label. Reading the live name
    // through their own client would return nothing anyway - RLS would hide
    // it - but asking at all is a request per page load for an answer that
    // cannot come back.
    if (owner && !can(ctx.org.role, owner, 'view')) return;

    const spec = RESOLVERS[type];
    const key = type === 'employee' ? 'member_id' : 'id';
    let q = ctx.supabase
      .from(spec.table).select(spec.select)
      .eq('organization_id', ctx.org.organizationId)
      .in(key, ids);
    if (spec.softDelete) q = q.is('deleted_at', null);

    const { data } = await q;
    for (const row of (data ?? []) as any[]) {
      resolved.set(`${type}:${row[key]}`, { label: spec.label(row), detail: spec.detail(row) });
    }
  }));

  return rows.map(row => {
    const live = resolved.get(`${row.entity_type}:${row.entity_id}`);
    return {
      id: row.id,
      pageId: row.page_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      /** The live name where it could be read, otherwise the one stored. */
      label: live?.label || row.label || 'Linked record',
      detail: live?.detail ?? '',
      /** False means: this exists, and this reader cannot open it. */
      readable: !!live,
      createdAt: row.created_at,
    };
  });
}

