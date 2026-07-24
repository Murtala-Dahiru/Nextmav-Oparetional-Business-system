import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT =
  '*, supplier:suppliers(id, name, lead_time_days), warehouse:warehouses(id, name), items:purchase_order_items(*, product:products(id, name, sku, unit))';

export async function GET(req: Request) {
  const ctx = await authorize('inventory', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let query = ctx.supabase
    .from('purchase_orders')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const status = searchParams.get('status');
  if (status) query = query.eq('status', status);
  const supplierId = searchParams.get('supplier_id');
  if (supplierId) query = query.eq('supplier_id', supplierId);

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) query = query.or(`order_number.ilike.%${safe}%,notes.ilike.%${safe}%`);
  }

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('order_date', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Raise a purchase order.
 *
 * Totals are computed here from the line items rather than accepted from the
 * request: they determine what the business commits to paying. The order
 * number comes from a per-organization counter assigned by trigger.
 */
export async function POST(req: Request) {
  const ctx = await authorize('inventory', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    if (!b.supplier_id) return error('supplier_id is required', 422, 'VALIDATION_ERROR');

    const items = Array.isArray(b.items) ? b.items : [];
    const clean = items
      .filter((i: any) => i.product_id && Number(i.quantity) > 0)
      .map((i: any) => ({
        product_id: i.product_id,
        quantity: Math.floor(Number(i.quantity)),
        unit_cost: Math.max(0, Number(i.unit_cost) || 0),
      }));

    if (!clean.length) return error('Add at least one line item', 422, 'VALIDATION_ERROR');

    const taxRate = Math.min(100, Math.max(0, Number(b.tax_rate) || 0));
    const subtotal = clean.reduce((s: number, i: any) => s + i.quantity * i.unit_cost, 0);
    const tax = Math.round(((subtotal * taxRate) / 100) * 100) / 100;

    const { data: order, error: e1 } = await ctx.supabase
      .from('purchase_orders')
      .insert({
        organization_id: ctx.org.organizationId,
        supplier_id: b.supplier_id,
        warehouse_id: b.warehouse_id || null,
        status: b.status ?? 'draft',
        expected_date: b.expected_date || null,
        subtotal,
        tax_rate: taxRate,
        tax_amount: tax,
        total: Math.round((subtotal + tax) * 100) / 100,
        notes: b.notes ?? '',
        created_by: ctx.org.memberId,
      })
      .select('id')
      .single();

    if (e1) return pgError(e1);

    const { error: e2 } = await ctx.supabase
      .from('purchase_order_items')
      .insert(clean.map((i: any) => ({ ...i, order_id: order.id })));

    if (e2) {
      // A header with no lines has a total that cannot be justified by
      // anything; remove it rather than leave a misleading order.
      await ctx.supabase.from('purchase_orders').delete().eq('id', order.id);
      return pgError(e2);
    }

    const { data } = await ctx.supabase
      .from('purchase_orders').select(SELECT).eq('id', order.id).single();

    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Failed to create the purchase order', 500);
  }
}
