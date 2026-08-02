import { authorize, pgError } from '@/lib/auth-context';
import { error } from '@/lib/api-response';
import { can } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';

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
}

const DATASETS: Record<string, Dataset> = {
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
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('dataset') ?? searchParams.get('type') ?? '';
  const spec = DATASETS[name];

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
  const limit = Math.min(10_000, Math.max(1, Number(searchParams.get('limit')) || 5_000));

  const { data, error: e } = await ctx.supabase
    .from(spec.table)
    .select(spec.select)
    .eq('organization_id', ctx.org.organizationId)
    .order(spec.order ?? 'created_at', { ascending: false })
    .limit(limit);

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
  if (e) return pgError(e);

  // The select string is dynamic, so supabase-js cannot infer a row shape.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const csv = [
    spec.columns.map(c => csvCell(c.label)).join(','),
    ...rows.map(r => spec.columns.map(c => csvCell(r[c.key])).join(',')),
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
