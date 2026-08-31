import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

/**
 * ===========================================================================
 *  What needs me.
 * ===========================================================================
 *
 *  Three facts, one question. `communication_inbox()` (0036) returns the
 *  messages that named the caller, the replies to things the caller said, and
 *  the direct messages written to them, in one ordered list with the kind as a
 *  label and `is_unread` as the only status.
 *
 *  -- Why the counts are computed here and not in the function --------------
 *
 *  The function is a list. A count is a property of that list, and deriving it
 *  from the rows the caller actually received is the only version that cannot
 *  disagree with what they are looking at. A second aggregate query would be a
 *  second definition of "outstanding", which is exactly the fault 0024 spent a
 *  migration removing from the unread badge.
 *
 *  -- Why the window is a parameter -----------------------------------------
 *
 *  The inbox shows thirty days by default. A person coming back from leave
 *  wants more; a busy channel makes thirty days too much. The function clamps
 *  it between one and a hundred and eighty, so the widest possible request is
 *  still a bounded scan of an indexed column.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 40));
  const days = Math.min(180, Math.max(1, Number(searchParams.get('days')) || 30));

  const { data, error: e } = await ctx.supabase.rpc('communication_inbox', {
    org: ctx.org.organizationId,
    lim: limit,
    since_days: days,
  });

  if (e) return pgError(e);

  const rows = (data ?? []) as any[];

  /**
   * A filter applied after the read, as `/api/communication/search` does with
   * its channel filter and for the same reason: the scan is the expensive
   * part, the filter is free, and the function keeps one definition of "what
   * needs me" rather than one per caller that wants a narrower view.
   */
  const kind = searchParams.get('kind');
  const filtered = kind && kind !== 'all'
    ? rows.filter(r => r.kind === kind)
    : rows;

  return success(filtered, {
    total: filtered.length,
    unread: filtered.filter(r => r.is_unread).length,
    mentions: rows.filter(r => r.kind === 'mention' && r.is_unread).length,
    replies: rows.filter(r => r.kind === 'reply' && r.is_unread).length,
    direct: rows.filter(r => r.kind === 'direct' && r.is_unread).length,
    days,
  });
}

/** The inbox is a read. */
export async function POST() {
  return error('The inbox is a GET.', 405, 'METHOD_NOT_ALLOWED');
}
