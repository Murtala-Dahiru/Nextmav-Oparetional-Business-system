import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';

/**
 * The reorder report.
 *
 * Reads `v_inventory_alerts`, which nets off quantities already on order so a
 * buyer is not told to reorder something in transit — the difference between a
 * report that gets used and one that gets ignored. The view is
 * `security_invoker`, so it is tenant-scoped by the same RLS as the tables.
 */
export async function GET(req: Request) {
  const ctx = await authorize('inventory', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));

  const { data, error: e } = await ctx.supabase
    .from('v_inventory_alerts')
    .select('*')
    .eq('organization_id', ctx.org.organizationId)
    // Outages first, then the deepest shortfalls.
    .order('stock', { ascending: true })
    .limit(limit);

  if (e) return pgError(e);

  const rows = data ?? [];
  const severityRank: Record<string, number> = { out_of_stock: 0, low: 1, covered: 2 };
  rows.sort(
    (a: any, b: any) =>
      (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) || a.stock - b.stock,
  );

  const summary = {
    totalAlerts: rows.length,
    outOfStock: rows.filter((r: any) => r.severity === 'out_of_stock').length,
    low: rows.filter((r: any) => r.severity === 'low').length,
    covered: rows.filter((r: any) => r.severity === 'covered').length,
    unassignedSupplier: rows.filter((r: any) => !r.supplier_name).length,
    estimatedReorderCost:
      Math.round(rows.reduce((sum: number, r: any) => sum + Number(r.estimated_cost ?? 0), 0) * 100) / 100,
  };

  return success(rows, summary as any);
}
