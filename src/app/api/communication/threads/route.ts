import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

/**
 * ===========================================================================
 *  Every thread in a conversation, in one read.
 * ===========================================================================
 *
 *  -- The fault this exists to fix ------------------------------------------
 *
 *  The timeline could only show a reply count for threads it had already
 *  fetched, and it fetched a thread only when somebody clicked into it. So a
 *  message with eleven answers under it was drawn exactly like a message
 *  nobody had responded to, and the discussion that had moved into a thread
 *  was invisible to everybody who had not been there when it moved.
 *
 *  -- Why per channel and not per message ----------------------------------
 *
 *  Forty bubbles must not be forty requests. `channel_threads()` (0036)
 *  answers "how many replies, who is in it, when was the last one, and did I
 *  take part" for a whole channel in a single grouped query, and the client
 *  keys it by root message id.
 *
 *  SECURITY INVOKER, so `messages_select` governs the reply rows exactly as it
 *  governs the timeline they hang from.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId') ?? searchParams.get('channel_id');
  if (!channelId) return error('channelId is required', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase.rpc('channel_threads', { chan: channelId });
  if (e) return pgError(e);

  const rows = (data ?? []) as any[];
  return success(rows, { total: rows.length });
}
