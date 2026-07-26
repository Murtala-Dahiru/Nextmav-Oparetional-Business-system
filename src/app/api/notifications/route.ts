import { authenticate, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * The signed-in user's notification tray.
 *
 * ── Why this is not under /api/admin ──────────────────────────────────────
 *
 * The identical handler already lives at `/api/admin/notifications`, which is
 * where it was first written. Nothing about it is administrative: the RLS
 * policy admits only rows whose recipient is the caller, so every role — down
 * to a client — reads exactly their own tray and nobody else's.
 *
 * The path mattered because it read as privileged. The header bell is rendered
 * for every user, and a bell that lives at an `/admin/` URL is one nobody
 * wires up for ordinary staff; in practice nothing ever called it at all, and
 * `notifications` in the store stayed an empty array for the life of the
 * application. The old path still works and is unchanged, so nothing that
 * calls it breaks.
 */
export async function GET(req: Request) {
  const ctx = await authenticate();
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let query = ctx.supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('recipient_id', ctx.org.memberId);

  if (searchParams.get('unread') === 'true') query = query.eq('is_read', false);

  const type = searchParams.get('type');
  if (type) query = query.eq('type', type);

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);

  /**
   * The unread total, counted separately from the page.
   *
   * The badge has to show how many are unread overall, not how many happen to
   * be unread within the twenty rows this page returned — otherwise it caps at
   * the page size and quietly under-reports.
   */
  const { count: unread } = await ctx.supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', ctx.org.memberId)
    .eq('is_read', false);

  return paginated(data ?? [], count ?? 0, page, pageSize, { unread: unread ?? 0 });
}

/**
 * Mark notifications read.
 *
 * Accepts a list of ids, or marks everything read when none are given — the
 * "clear all" affordance every tray needs. Scoped to the caller's own rows, so
 * one user can never dismiss another's.
 */
export async function PATCH(req: Request) {
  const ctx = await authenticate();
  if (ctx instanceof Response) return ctx;

  const body = acceptBody(await req.json().catch(() => ({})));
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

export { PATCH as PUT };

/**
 * Dismiss a notification for good.
 *
 * A tray with no way to clear it becomes a list people stop reading. Deleting
 * rather than flagging: a dismissed notification has no further use, the
 * underlying record is untouched, and the audit trail of what actually
 * happened lives in `activity_log`, not here.
 */
export async function DELETE(req: Request) {
  const ctx = await authenticate();
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const all = searchParams.get('all') === 'true';

  if (!id && !all) {
    return error('Pass ?id= to dismiss one, or ?all=true to clear read ones.', 422, 'VALIDATION_ERROR');
  }

  let query = ctx.supabase
    .from('notifications')
    .delete()
    .eq('recipient_id', ctx.org.memberId);

  // "Clear all" clears what has been read. Deleting unread notifications the
  // user has not seen would destroy the message before it was ever delivered.
  query = id ? query.eq('id', id) : query.eq('is_read', true);

  const { data, error: e } = await query.select('id');
  if (e) return pgError(e);
  return success({ deleted: (data ?? []).length });
}
