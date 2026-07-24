import { authorize, pgError } from '@/lib/auth-context';
import { success, paginated } from '@/lib/api-response';

/**
 * The signed-in user's notifications.
 *
 * Strictly personal: the RLS policy admits only rows whose recipient is the
 * caller, so there is no organization-wide feed here to leak.
 */
export async function GET(req: Request) {
  const ctx = await authorize('dashboard', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let query = ctx.supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('recipient_id', ctx.org.memberId);

  if (searchParams.get('unread') === 'true') query = query.eq('is_read', false);

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Mark notifications read.
 *
 * Accepts a list of ids, or marks everything read when none are given — the
 * "clear all" affordance every notification tray needs. Scoped to the caller's
 * own rows, so one user can never dismiss another's.
 */
export async function PATCH(req: Request) {
  const ctx = await authorize('dashboard', 'view');
  if (ctx instanceof Response) return ctx;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

  let query = ctx.supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('recipient_id', ctx.org.memberId)
    .eq('is_read', false);

  if (ids.length) query = query.in('id', ids);

  const { data, error: e } = await query.select('id');
  if (e) return pgError(e);
  return success({ updated: (data ?? []).length });
}
