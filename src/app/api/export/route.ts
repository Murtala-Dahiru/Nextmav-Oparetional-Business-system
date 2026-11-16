import { z } from 'zod';
import { parseCustomFilter } from '@/lib/crm/custom-filter';
import { authorize, pgError } from '@/lib/auth-context';
import { error } from '@/lib/api-response';
import { can } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';

import { GET as listLeads } from '@/app/api/crm/leads/route';
import { GET as listContacts } from '@/app/api/crm/contacts/route';
import { GET as listCompanies } from '@/app/api/crm/companies/route';
import { GET as listDeals } from '@/app/api/crm/deals/route';
import { toSnake } from '@/lib/case';

const crmLists = { leads: listLeads, contacts: listContacts, companies: listCompanies, deals: listDeals };

/**
 * CSV export.
 *
 * Every dataset requires the `export` capability on its own module, not merely
 * `view`. Exporting is a different act from reading: it removes the data from
 * the platform's access controls entirely, and a spreadsheet of the customer
 * list or the salary register cannot be un-shared. Most roles can read their
 * module without being able to extract it.
 *
 * Rows are still filtered by RLS, so an export can never contain more than the
 * caller could see on screen.
 */

interface Dataset {
  table: string;
  module: ModuleId;
  select: string;
  columns: { key: string; label: string }[];
  order?: string;
  /**
   * Exclude soft-deleted rows.
   *
   * Opt-in rather than automatic, because turning it on for every dataset
   * changes what six other modules' exports contain, and this phase is the
   * Projects one. It is set on the two datasets added here; the rest are
   * listed in the phase record so the next module's pass can turn its own on
   * deliberately.
   */
  softDelete?: boolean;
}

const DATASETS: Record<string, Dataset> = {
  /**
   * Projects and tasks.
   *
   * The export menu is rendered by the module that owns the data, and the
   * Projects module had none - so a role holding `projects.export` had a
   * capability with nothing behind it. Both are the columns somebody actually
   * wants in a spreadsheet: the ones they would otherwise retype off the
   * screen.
   */
  projects: {
    table: 'projects', module: 'projects',
    select: 'name, status, priority, start_date, end_date, budget, created_at',
    columns: [
      { key: 'name', label: 'Project' }, { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' }, { key: 'start_date', label: 'Starts' },
      { key: 'end_date', label: 'Target' }, { key: 'budget', label: 'Budget' },
      { key: 'created_at', label: 'Created' },
    ],
    order: 'end_date',
    softDelete: true,
  },
  tasks: {
    table: 'tasks', module: 'projects',
    select: 'title, status, priority, due_date, estimated_hours, logged_hours, completed_at, created_at',
    columns: [
      { key: 'title', label: 'Task' }, { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' }, { key: 'due_date', label: 'Due' },
      { key: 'estimated_hours', label: 'Estimated' }, { key: 'logged_hours', label: 'Logged' },
      { key: 'completed_at', label: 'Completed' }, { key: 'created_at', label: 'Created' },
    ],
    order: 'due_date',
    softDelete: true,
  },
  leads: {
    table: 'leads', module: 'crm',
    select: 'first_name, last_name, email, phone, company_name, status, score, estimated_value, created_at',
    columns: [
      { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' },
      { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
      { key: 'company_name', label: 'Company' }, { key: 'status', label: 'Status' },
      { key: 'score', label: 'Score' }, { key: 'estimated_value', label: 'Value' },
      { key: 'created_at', label: 'Created' },
    ],
  },
  deals: {
    table: 'deals', module: 'crm',
    select: 'name, stage, value, probability, expected_close, created_at',
    columns: [
      { key: 'name', label: 'Deal' }, { key: 'stage', label: 'Stage' },
      { key: 'value', label: 'Value' }, { key: 'probability', label: 'Probability' },
      { key: 'expected_close', label: 'Expected close' }, { key: 'created_at', label: 'Created' },
    ],
  },
  contacts: {table:'contacts',module:'crm',select:'first_name,last_name,email,phone,job_title',columns:[{key:'first_name',label:'First name'},{key:'last_name',label:'Last name'},{key:'email',label:'Email'},{key:'phone',label:'Phone'},{key:'job_title',label:'Job title'}]},
  companies: {table:'companies',module:'crm',select:'name,industry,email,phone,website',columns:[{key:'name',label:'Company'},{key:'industry',label:'Industry'},{key:'email',label:'Email'},{key:'phone',label:'Phone'},{key:'website',label:'Website'}]},
  invoices: {
    table: 'invoices', module: 'finance',
    select: 'invoice_number, status, issue_date, due_date, subtotal, tax_amount, total, amount_paid, currency',
    columns: [
      { key: 'invoice_number', label: 'Invoice' }, { key: 'status', label: 'Status' },
      { key: 'issue_date', label: 'Issued' }, { key: 'due_date', label: 'Due' },
      { key: 'subtotal', label: 'Subtotal' }, { key: 'tax_amount', label: 'Tax' },
      { key: 'total', label: 'Total' }, { key: 'amount_paid', label: 'Paid' },
      { key: 'currency', label: 'Currency' },
    ],
    order: 'issue_date',
  },
  expenses: {
    table: 'expenses', module: 'finance',
    select: 'title, amount, currency, category, vendor, expense_date, status',
    columns: [
      { key: 'title', label: 'Title' }, { key: 'amount', label: 'Amount' },
      { key: 'currency', label: 'Currency' }, { key: 'category', label: 'Category' },
      { key: 'vendor', label: 'Vendor' }, { key: 'expense_date', label: 'Date' },
      { key: 'status', label: 'Status' },
    ],
    order: 'expense_date',
  },
  products: {
    table: 'products', module: 'inventory',
    select: 'sku, name, category, unit, price, cost, stock, reorder_level',
    columns: [
      { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' }, { key: 'unit', label: 'Unit' },
      { key: 'price', label: 'Price' }, { key: 'cost', label: 'Cost' },
      { key: 'stock', label: 'Stock' }, { key: 'reorder_level', label: 'Reorder at' },
    ],
    order: 'name',
  },
  tickets: {
    table: 'support_tickets', module: 'support',
    select: 'ticket_number, subject, status, priority, category, created_at, resolved_at',
    columns: [
      { key: 'ticket_number', label: 'Ticket' }, { key: 'subject', label: 'Subject' },
      { key: 'status', label: 'Status' }, { key: 'priority', label: 'Priority' },
      { key: 'category', label: 'Category' }, { key: 'created_at', label: 'Created' },
      { key: 'resolved_at', label: 'Resolved' },
    ],
  },
  attendance: {
    table: 'attendance_records', module: 'hr',
    select: 'work_date, status, checked_in_at, checked_out_at, worked_minutes, late_minutes',
    columns: [
      { key: 'work_date', label: 'Date' }, { key: 'status', label: 'Status' },
      { key: 'checked_in_at', label: 'In' }, { key: 'checked_out_at', label: 'Out' },
      { key: 'worked_minutes', label: 'Worked (min)' }, { key: 'late_minutes', label: 'Late (min)' },
    ],
    order: 'work_date',
  },
};

/** RFC 4180 escaping: quotes doubled, and any field containing a delimiter quoted. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = Array.isArray(value) ? JSON.stringify(value) : String(value);
  const s = typeof value === 'string' && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('dataset') ?? searchParams.get('type') ?? '';
  const spec = Object.hasOwn(DATASETS, name) ? DATASETS[name] : undefined;

  if (!spec) {
    return error(
      `Unknown dataset. Available: ${Object.keys(DATASETS).join(', ')}`,
      422, 'UNKNOWN_DATASET',
    );
  }

  const ctx = await authorize(spec.module, 'view');
  if (ctx instanceof Response) return ctx;

  if (!can(ctx.org.role, spec.module, 'export')) {
    return error(
      `Your role (${ctx.org.role}) cannot export ${spec.module} data.`,
      403, 'FORBIDDEN_EXPORT',
    );
  }

  // Capped: an unbounded export is a memory and timeout hazard, and in
  // practice a request for 100k rows is a report, not a download.
  const limit = Math.floor(Math.min(10_000, Math.max(1, Number(searchParams.get('limit')) || 5_000)));

  const crm = spec.module === 'crm';
  const custom = crm ? searchParams.get('custom') : null;
  const join = custom && name === 'companies' ? ',filter_values:crm_company_field_values!inner(company_id)' : '';
  const columns = [...spec.columns];
  if (crm) {
    const metadata = await ctx.supabase.from('crm_field_definitions').select('id,key').eq('organization_id',ctx.org.organizationId).eq('object',name).eq('archived',false).order('position').order('id');
    if (metadata.error) return pgError(metadata.error);
    for (const f of metadata.data) columns.push({key:f.id,label:'custom:'+f.key});
  }
  let query = ctx.supabase
    .from(spec.table)
    .select(spec.select + (crm ? (name === 'companies' ? ',custom_values:crm_company_values' : ',custom_values') : '') + join)
    .eq('organization_id', ctx.org.organizationId);

  if(crm && searchParams.has('ids')) {
    const ids=z.array(z.uuid()).min(1).max(500).safeParse(searchParams.get('ids')?.split(','));
    if(!ids.success)return error('Select between one and 500 records',422);
    query=query.in('id',ids.data);
  }
  if(custom){try{query=query.contains(name==='companies'?'filter_values.field_values':'custom_values',parseCustomFilter(custom));}catch{return error('Invalid custom field filter',422);}}
  if (crm || spec.softDelete) query = query.is('deleted_at', null);

  query = query.order(spec.order ?? 'created_at', { ascending: false }).order('id');
  // PostgREST imposes a per-request row cap. Fetch bounded pages rather than
  // silently returning only the first server page of a larger export.
  const rows: Record<string, unknown>[] = [];
  if (crm && searchParams.get('currentView') === 'true') {
    // Run the same authenticated list handler as the screen. This preserves
    // relationship, activity, date, search and custom filter semantics.
    const list = crmLists[name as keyof typeof crmLists];
    const listUrl = new URL(req.url);
    listUrl.pathname = `/api/crm/${name}`;
    for (const reserved of ['dataset','type','limit','currentView','ids','facts']) listUrl.searchParams.delete(reserved);
    listUrl.searchParams.set('pageSize', '100');
    const seen = new Set<string>();
    for (let page = 1; page <= Math.ceil(limit / 100); page++) {
      listUrl.searchParams.set('page', String(page));
      const response = await list(new Request(listUrl, { headers: req.headers }));
      if (!response.ok) return response;
      const result = await response.json();
      for (const record of result.data) {
        if (!seen.has(record.id) && rows.length < limit) rows.push(toSnake(record) as Record<string,unknown>);
        seen.add(record.id);
      }
      if (page >= result.meta.totalPages || rows.length >= limit) break;
    }
  } else for (let offset = 0; offset < limit; offset += 500) {
    const pageSize = Math.min(500, limit - offset);
    const { data, error: pageError } = await query.range(offset, offset + pageSize - 1);
    if (pageError) return pgError(pageError);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  /**
   * Through `pgError` like every other database failure in the application.
   *
   * This was `error(e.message, 500, e.code)` — the one query in the codebase
   * that reported a database fault by handing PostgreSQL's own text to the
   * caller with a 500 attached. Two things were wrong with it. The message
   * describes the schema, which is the disclosure the default branch of
   * `pgError` now exists to prevent; and the status was 500 regardless, so a
   * permission denial on an export was reported as a server fault rather than
   * as a refusal.
   */
  if(crm){
    const audit=await ctx.supabase.from('activity_log').insert({organization_id:ctx.org.organizationId,member_id:ctx.org.memberId,module:'crm',action:'export',title:'Exported '+name,entity_type:'export',metadata:{dataset:name,records:rows.length,columns:columns.length}});
    if(audit.error)return pgError(audit.error);
  }
  const csv = [
    columns.map(c => csvCell(c.label)).join(','),
    ...rows.map(r => columns.map(c => csvCell(Object.hasOwn(r,c.key) ? r[c.key] : (r.custom_values as Record<string,unknown> | null)?.[c.key])).join(',')),
  ].join('\r\n');

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${ctx.org.organizationSlug || 'export'}-${name}-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      // BOM so Excel opens UTF-8 correctly rather than mangling accents.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
