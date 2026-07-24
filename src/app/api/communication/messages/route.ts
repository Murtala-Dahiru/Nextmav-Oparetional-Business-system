import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';

const SELECT =
  '*, sender:organization_members!messages_sender_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), reactions:message_reactions(emoji, member_id)';

/**
 * Messages in a channel.
 *
 * Visibility is enforced by RLS: a message in a private channel is readable
 * only by members of that channel, so this handler does not re-check
 * membership and cannot drift from the policy.
 *
 * Ordered newest-first and paginated, which is how a chat scrollback loads.
 * The client reverses for display; fetching oldest-first would mean reading
 * the whole history to show the last twenty messages.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channel_id') ?? searchParams.get('channelId');
  if (!channelId) return error('channel_id is required', 422, 'VALIDATION_ERROR');

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));

  let query = ctx.supabase
    .from('messages')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId)
    .eq('channel_id', channelId)
    .is('deleted_at', null);

  // Thread replies are fetched explicitly; the main timeline shows roots only.
  const parentId = searchParams.get('parent_id');
  if (parentId) query = query.eq('parent_id', parentId);
  else query = query.is('parent_id', null);

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Post a message.
 *
 * The sender is taken from the session, never the body — accepting it would
 * let anyone post as a colleague. Mentions are stored as membership ids so the
 * notification trigger does not have to re-parse the text.
 */
export async function POST(req: Request) {
  const ctx = await authorize('communication', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = await req.json();
    if (!b.channel_id) return error('channel_id is required', 422, 'VALIDATION_ERROR');

    const body = String(b.body ?? '').trim();
    const attachments = Array.isArray(b.attachments) ? b.attachments : [];
    // A message with neither text nor a file is an accidental empty send.
    if (!body && !attachments.length) {
      return error('A message needs text or an attachment', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('messages')
      .insert({
        organization_id: ctx.org.organizationId,
        channel_id: b.channel_id,
        sender_id: ctx.org.memberId,
        body,
        parent_id: b.parent_id || null,
        mentions: Array.isArray(b.mentions) ? b.mentions : [],
        attachments,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);

    // Keep the sender's own unread marker current, so their message does not
    // come back to them as unread.
    await ctx.supabase
      .from('channel_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('channel_id', b.channel_id)
      .eq('member_id', ctx.org.memberId);

    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Failed to send the message', 500);
  }
}
