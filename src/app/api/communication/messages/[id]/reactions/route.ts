import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

/**
 * Toggle a reaction.
 *
 * One endpoint rather than a POST and a DELETE, because the gesture is a
 * toggle: clicking 👍 when you have already reacted removes it. Two endpoints
 * would mean the client has to know its own current state before it can act,
 * and would get it wrong the moment two tabs are open.
 *
 * The unique key on (message, member, emoji) is what makes this safe to call
 * twice in a row.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'create');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const emoji = String(b.emoji ?? '').trim();
  // Long enough for a flag or a skin-tone modifier, short enough that the
  // column cannot be used as free text storage.
  if (!emoji || emoji.length > 16) return error('emoji is required', 422, 'VALIDATION_ERROR');

  // The message must be one the caller can read; `messages_select` decides
  // that, and a private channel they are not in returns nothing here.
  const { data: message } = await ctx.supabase
    .from('messages').select('id')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null).maybeSingle();
  if (!message) return error('Not found', 404, 'NOT_FOUND');

  const { data: existing } = await ctx.supabase
    .from('message_reactions').select('id')
    .eq('message_id', id).eq('member_id', ctx.org.memberId).eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error: e } = await ctx.supabase
      .from('message_reactions').delete().eq('id', existing.id);
    if (e) return pgError(e);
  } else {
    const { error: e } = await ctx.supabase
      .from('message_reactions')
      .insert({ message_id: id, member_id: ctx.org.memberId, emoji });
    if (e) return pgError(e);
  }

  const { data: reactions } = await ctx.supabase
    .from('message_reactions').select('emoji, member_id').eq('message_id', id);

  return success({ messageId: id, reactions: reactions ?? [] });
}
