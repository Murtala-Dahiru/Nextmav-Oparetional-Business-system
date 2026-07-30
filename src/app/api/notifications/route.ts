import { authenticate, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { unreadByModule, typesForModule } from '@/lib/notification-modules';

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

  /**
   * ── Per-module counts, for the badges in the sidebar ─────────────────────
   *
   * Counted here rather than derived in the browser from `data`, for the same
   * reason `unread` is: this endpoint returns one page, so a badge computed
   * from it would cap at the page size. Somebody with thirty unread tickets
   * would see Support (20), and the number would change when they paged.
   *
   * Only the `type` column is read, and only for unread rows. That is a small,
   * indexed scan — unread notifications are by nature a working set, not a
   * history — and the cap makes the worst case bounded rather than trusting
   * that to stay true.
   */
  const { data: unreadTypes } = await ctx.supabase
    .from('notifications')
    .select('type')
    .eq('recipient_id', ctx.org.memberId)
    .eq('is_read', false)
    .limit(500);

  const byModule = unreadByModule(
    (unreadTypes ?? []).map((r: any) => ({ type: r.type, isRead: false })),
  );

  /**
   * Unread *messages*, which notifications do not represent.
   *
   * A notification is only written for a mention — posting in a channel does
   * not notify everybody in it, and should not. So a Communication badge driven
   * by the tray would show 0 while eleven unread messages sat in three
   * channels, which is not what anybody means by the badge on a chat module.
   *
   * `channel_overview()` already computes the per-channel unread count from
   * each member's own `last_read_at`, and the communication module already
   * calls it on load — this is the same number, not a second definition.
   *
   * Best-effort: a client account has no communication grant at all, and the
   * RPC returning nothing for them is correct rather than an error worth
   * failing the whole tray over.
   */
  let unreadMessages = 0;
  try {
    const { data: channels } = await ctx.supabase
      .rpc('channel_overview', { org: ctx.org.organizationId });
    unreadMessages = (channels ?? []).reduce(
      (sum: number, c: any) => sum + Number(c.unread_count ?? 0), 0,
    );
  } catch {
    // No communication access, or no channels. Zero is the right answer.
  }

  if (unreadMessages > 0) {
    byModule.communication = (byModule.communication ?? 0) + unreadMessages;
  }

  return paginated(data ?? [], count ?? 0, page, pageSize, {
    unread: unread ?? 0,
    byModule,
    unreadMessages,
  });
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
  // `moduleId`, not `module`: the latter shadows the CommonJS global and Next
  // rejects it outright.
  const moduleId = typeof body?.module === 'string' ? body.module : null;

  let query = ctx.supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('recipient_id', ctx.org.memberId)
    .eq('is_read', false);

  if (ids.length) query = query.in('id', ids);

  /**
   * Marking a whole module read, which is what opening it means.
   *
   * ── Why the types are resolved here rather than filtered in SQL ──────────
   *
   * `notifications` has no `module` column, deliberately: adding one would mean
   * every fan-out trigger in 0016 restating something its `type` already
   * implies, and the two drifting the first time a trigger was edited without
   * its module being updated.
   *
   * So the same map the badge counts with is used to expand a module into the
   * set of types that belong to it. One definition, used by the count and by
   * the clear — which is the only way a badge can be guaranteed to disappear
   * when the thing it counted is read.
   */
  if (moduleId) {
    const types = typesForModule(moduleId);
    if (!types.length) {
      return error(`"${moduleId}" is not a module notifications are raised for.`, 422, 'UNKNOWN_MODULE');
    }
    query = query.in('type', types);
  }

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
