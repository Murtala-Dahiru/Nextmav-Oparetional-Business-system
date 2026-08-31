import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';

/**
 * ===========================================================================
 *  What has been shared in conversation.
 * ===========================================================================
 *
 *  -- Why this route exists -------------------------------------------------
 *
 *  A file posted in a channel has been a real `files` row since 0023 -
 *  attributable, revocable, and governed by `files_select` - and the only way
 *  to reach one was to scroll back to the message it arrived on. So "the
 *  contract Ada sent last month" was findable by remembering the day it was
 *  sent, which is not findable.
 *
 *  -- Why it is not the workspace file list --------------------------------
 *
 *  Because the permission question is different. A workspace file is governed
 *  by the folder it is in; a conversation attachment is governed by the
 *  conversation it was posted in, and 0023 narrowed `files_select` so a row
 *  carrying a `channel_id` is exactly as private as that channel. Nothing here
 *  re-states that rule: the query asks for files with a channel, and the
 *  policy decides which of them come back.
 *
 *  -- What it deliberately does not do --------------------------------------
 *
 *  Serve bytes. A link is time-limited and is minted one at a time by
 *  `files/[id]`, so a list can be rendered without signing anything - which
 *  matters, because signing sixty URLs to draw a panel would mean sixty links
 *  in flight for a panel somebody glanced at.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId') ?? searchParams.get('channel_id');
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 60));

  let query = ctx.supabase
    .from('files')
    .select(
      'id, filename, mime_type, size_bytes, bucket, path, channel_id, message_id, created_at, '
      + 'uploader:organization_members!files_uploaded_by_fkey('
      + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))',
    )
    .eq('organization_id', ctx.org.organizationId)
    .is('deleted_at', null)
    // A file with no channel belongs to a page, a project or an expense claim,
    // each with its own endpoint and its own permission question.
    .not('channel_id', 'is', null);

  if (channelId) query = query.eq('channel_id', channelId);

  const { data, error: e } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (e) return pgError(e);

  const rows = (data ?? []) as any[];
  return success(rows, { total: rows.length });
}
