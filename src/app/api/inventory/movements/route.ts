import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT =
  '*, product:products(id, name, sku, unit), member:organization_members!stock_movements_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name)), from_warehouse:warehouses!stock_movements_from_warehouse_id_fkey(id, name), to_warehouse:warehouses!stock_movements_to_warehouse_id_fkey(id, name)';

/**
 * The stock ledger.
 *
 * Append-only by policy: there is no UPDATE or DELETE on this table, so a
 * movement cannot be rewritten. Corrections are new compensating movements,
 * which is what makes an on-hand quantity explainable.
 */
export async function GET(req: Request) {
  const ctx = await authorize('inventory', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let query = ctx.supabase
    .from('stock_movements')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const productId = searchParams.get('product_id') ?? searchParams.get('productId');
  if (productId) query = query.eq('product_id', productId);
  const type = searchParams.get('type');
  if (type) query = query.eq('type', type);

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Record a movement.
 *
 * Delegates to record_stock_movement(), which locks the product row, refuses
 * to drive stock negative, and writes the ledger entry and the new balance
 * together. Doing those as separate statements here would let two concurrent
 * movements both validate against the same stale quantity.
 *
 * The client sends a positive amount and a type; the sign is derived, because
 * asking a user to send -5 to issue five units invites the wrong sign.
 */
export async function POST(req: Request) {
  const ctx = await authorize('inventory', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    if (!b.product_id) return error('product_id is required', 422, 'VALIDATION_ERROR');

    const type = b.type ?? 'adjustment';
    const amount = Number(b.quantity);
    if (!Number.isFinite(amount) || amount === 0) {
      return error('Quantity must be a non-zero number', 422, 'VALIDATION_ERROR');
    }

    // `issue`, `transfer` and `damage` remove stock; the rest add it. An
    // explicit negative is honoured so a correction can still be expressed.
    const outbound = ['issue', 'transfer', 'damage'].includes(type);
    const signed = amount < 0 ? amount : outbound ? -Math.abs(amount) : Math.abs(amount);

    const { data, error: e } = await ctx.supabase.rpc('record_stock_movement', {
      org: ctx.org.organizationId,
      product: b.product_id,
      qty: signed,
      movement_type: type,
      reason: b.reason ?? '',
      reference: b.reference ?? '',
    });

    // The function raises a written message when stock would go negative
    // ("only N on hand"), which is exactly what the user needs to see.
    if (e) return pgError(e);

    return success(Array.isArray(data) ? data[0] : data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Failed to record the movement', 500);
  }
}
