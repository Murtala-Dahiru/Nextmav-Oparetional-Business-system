import { authorize, pgError } from '@/lib/auth-context';
import { paginated } from '@/lib/api-response';

/**
 * The audit trail.
 *
 * Read-only by construction: rows arrive through a SECURITY DEFINER trigger and
 * there is no INSERT, UPDATE or DELETE policy on the table, so the log cannot
 * be forged or rewritten from the application. Visible to administrators only.
 */
export async function GET(req: Request) {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 25));

  let query = ctx.supabase
    .from('audit_log')
    .select('*, actor:profiles(id, full_name, avatar_url)', { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  // `module` is the historical query name; the column is table_name.
  const table = searchParams.get('table') ?? searchParams.get('module');
  if (table) query = query.eq('table_name', table);
  const action = searchParams.get('action');
  if (action) query = query.eq('action', action);
  const actor = searchParams.get('actor_id') ?? searchParams.get('userId');
  if (actor) query = query.eq('actor_id', actor);

  const from = searchParams.get('from');
  if (from) query = query.gte('created_at', from);
  const to = searchParams.get('to');
  if (to) query = query.lte('created_at', to);

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}
