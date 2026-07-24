import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT =
  '*, company:companies(id, name), contact:contacts(id, first_name, last_name), line_items:invoice_line_items(*)';

export async function GET(req: Request) {
  const ctx = await authorize('finance', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let q = ctx.supabase
    .from('invoices')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId)
    .is('deleted_at', null);

  const status = searchParams.get('status');
  if (status) q = q.eq('status', status);
  const companyId = searchParams.get('company_id');
  if (companyId) q = q.eq('company_id', companyId);

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) q = q.or(`invoice_number.ilike.%${safe}%,notes.ilike.%${safe}%`);
  }

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('issue_date', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Create an invoice with its line items.
 *
 * Totals are never taken from the request: they determine what the business
 * believes it is owed. The line items are inserted and a trigger recalculates
 * subtotal, tax and total from them, so the header can never disagree with the
 * rows that justify it.
 *
 * The invoice number is assigned by trigger from a per-organization counter —
 * a global sequence would let one customer infer another's invoice volume from
 * the gaps in their own numbering.
 */
export async function POST(req: Request) {
  const ctx = await authorize('finance', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    const items = Array.isArray(b.line_items) ? b.line_items : [];

    if (!items.length) {
      return error('An invoice needs at least one line item', 422, 'VALIDATION_ERROR');
    }
    for (const it of items) {
      if (!it.description?.trim()) {
        return error('Every line item needs a description', 422, 'VALIDATION_ERROR');
      }
      if (Number(it.quantity) <= 0) {
        return error('Line item quantity must be greater than zero', 422, 'VALIDATION_ERROR');
      }
    }

    const { data: invoice, error: e1 } = await ctx.supabase
      .from('invoices')
      .insert({
        organization_id: ctx.org.organizationId,
        company_id: b.company_id || null,
        contact_id: b.contact_id || null,
        project_id: b.project_id || null,
        status: b.status ?? 'draft',
        issue_date: b.issue_date ?? new Date().toISOString().slice(0, 10),
        due_date:
          b.due_date ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        tax_rate: Math.min(100, Math.max(0, Number(b.tax_rate) || 0)),
        discount: Math.max(0, Number(b.discount) || 0),
        currency: b.currency ?? 'USD',
        notes: b.notes ?? '',
        owner_id: ctx.org.memberId,
      })
      .select('id')
      .single();

    if (e1) return pgError(e1);

    const { error: e2 } = await ctx.supabase.from('invoice_line_items').insert(
      items.map((it: any, i: number) => ({
        invoice_id: invoice.id,
        description: String(it.description).trim(),
        quantity: Number(it.quantity) || 1,
        unit_price: Math.max(0, Number(it.unit_price) || 0),
        sort_order: i,
      })),
    );

    if (e2) {
      // The header exists but has no lines, so its total would read zero.
      // Remove it rather than leave a misleading invoice behind.
      await ctx.supabase.from('invoices').delete().eq('id', invoice.id);
      return pgError(e2);
    }

    // Re-read so the caller receives the trigger-computed totals.
    const { data } = await ctx.supabase
      .from('invoices').select(SELECT).eq('id', invoice.id).single();

    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Failed to create invoice', 500);
  }
}
