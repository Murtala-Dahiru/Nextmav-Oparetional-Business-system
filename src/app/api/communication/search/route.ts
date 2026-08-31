import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Find a message, anywhere.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this replaces ───────────────────────────────────────────────────
 *
 *  The module's search filtered the array of messages it had already loaded -
 *  the most recent hundred of the conversation currently open. Anything older,
 *  or in any other channel, could not be found at all. That is not a search;
 *  it is a highlight, and the difference only becomes apparent when somebody
 *  needs the thing they are looking for.
 *
 *  ── Why the ranking is done in Postgres ──────────────────────────────────
 *
 *  `message_search()` is a full-text query against a GIN index, deliberately
 *  SECURITY INVOKER so that `messages_select` - not this handler - decides
 *  what a caller is allowed to find. A search that re-implemented channel
 *  visibility would be a second copy of an access rule living in the one place
 *  it is most damaging to get wrong.
 *
 *  The trailing term is matched as a prefix, so results narrow while somebody
 *  is still typing.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? searchParams.get('search') ?? '').trim();

  /**
   * A single character is not a search.
   *
   * Prefix matching on one letter returns most of the organisation's messages,
   * ranked meaninglessly - a result set that is slow to produce and useless to
   * read. Returning nothing is the honest answer while somebody is still on
   * their first keystroke.
   */
  if (q.length < 2) {
    return success([], { total: 0, query: q, tooShort: true });
  }

  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 40));

  const { data, error: e } = await ctx.supabase.rpc('message_search', {
    org: ctx.org.organizationId,
    q,
    lim: limit,
  });

  if (e) return pgError(e);

  const rows = (data ?? []) as any[];

  // A channel filter is applied here rather than in the function: the index
  // scan is the expensive part, the filter is free, and keeping the function's
  // signature small means one definition of "search" rather than one per
  // caller that wants a different scope.
  const channelId = searchParams.get('channelId') ?? searchParams.get('channel_id');
  const filtered = channelId ? rows.filter(r => r.channel_id === channelId) : rows;

  return success(filtered, { total: filtered.length, query: q });
}

/** Search is a read. Anything else here would be a mistake worth refusing. */
export async function POST() {
  return error('Search is a GET. Pass the query as ?q=', 405, 'METHOD_NOT_ALLOWED');
}
