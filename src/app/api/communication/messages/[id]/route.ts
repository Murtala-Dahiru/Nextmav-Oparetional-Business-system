import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { audit, communicationPolicy, editRefusal, isOrgAdmin } from '@/lib/communication';

type Params = { params: Promise<{ id: string }> };

/**
 * Edit a message.
 *
 * Only the sender may change the text - enforced by RLS, which restricts
 * UPDATE to rows whose sender is the caller. `edited_at` is stamped so the UI
 * can mark it, since a silently altered message is a small integrity problem
 * in a shared channel.
 *
 * ── What 0023 adds ───────────────────────────────────────────────────────
 *
 * The organisation's communication policy can switch editing off entirely or
 * put a window on it. Checked here rather than in RLS because the rule is a
 * policy document rather than a property of the row, and because a refusal
 * needs to explain itself - a policy that silently returns "not found" is one
 * nobody can act on.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    const { data: existing } = await ctx.supabase
      .from('messages')
      .select('id, channel_id, sender_id, created_at, is_pinned')
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!existing) return error('Not found', 404, 'NOT_FOUND');

    if (typeof b.body === 'string') {
      const text = b.body.trim();
      if (!text) return error('A message cannot be emptied; delete it instead', 422, 'VALIDATION_ERROR');

      const policy = await communicationPolicy(ctx);
      const refusal = editRefusal(policy, existing.created_at);
      if (refusal) return error(refusal, 403, 'POLICY_FORBIDS');

      update.body = text;
      update.edited_at = new Date().toISOString();
    }
    // Pinning is a channel action rather than an edit, but shares the row.
    if ('is_pinned' in b) update.is_pinned = !!b.is_pinned;

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase
      .from('messages')
      .update(update)
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');

    /**
     * What goes into the trail, and what deliberately does not.
     *
     * The act and its subject - never a word of what was written. See the note
     * on `audit()`; an administrator reading this table must not be able to
     * reconstruct a private channel from it.
     */
    if ('body' in update) {
      await audit(ctx, 'message_edited', { channelId: existing.channel_id, messageId: id });
    }
    if ('is_pinned' in update && update.is_pinned !== existing.is_pinned) {
      await audit(ctx, update.is_pinned ? 'message_pinned' : 'message_unpinned', {
        channelId: existing.channel_id, messageId: id,
      });
    }

    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

/**
 * Delete a message.
 *
 * Soft delete: a thread with holes in it is confusing, and replies reference
 * the parent. The row stays so the conversation structure survives, and the
 * client renders it as removed.
 *
 * ── Who may, and why the two cases are separated ─────────────────────────
 *
 * The author, subject to the organisation's policy - a company may decide that
 * what was said stays said. And a moderator: a channel administrator or an
 * organisation administrator, always, regardless of that policy. The second is
 * not a setting, because an organisation that could switch it off would have
 * no way to deal with something posted in error, and moderation is the one
 * power that has to survive its own configuration.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: existing } = await ctx.supabase
    .from('messages')
    .select('id, channel_id, sender_id')
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');

  const isAuthor = existing.sender_id === ctx.org.memberId;

  // `is_channel_admin()` is the same function `channels_update` consults, so
  // "may moderate here" cannot mean one thing to this route and another to the
  // policy underneath it.
  const { data: channelAdmin } = await ctx.supabase
    .rpc('is_channel_admin', { chan: existing.channel_id });
  const canModerate = channelAdmin === true || isOrgAdmin(ctx);

  if (isAuthor && !canModerate) {
    const policy = await communicationPolicy(ctx);
    if (!policy.allowMessageDelete) {
      return error(
        'This organisation does not allow messages to be deleted once sent. '
        + 'A channel administrator can remove one if it needs to go.',
        403, 'POLICY_FORBIDS',
      );
    }
  } else if (!isAuthor && !canModerate) {
    return error('Only the author or a channel administrator can remove a message.', 403, 'FORBIDDEN_ACTION');
  }

  const { data, error: e } = await ctx.supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString(), body: '' })
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');

  /**
   * Attachments go with the message.
   *
   * Soft, like the message, and for the same reason: the storage object is
   * still there, so an administrator investigating an incident has something
   * to investigate, while nothing in the product will serve it again - the
   * signed-URL endpoint refuses a deleted row.
   */
  await ctx.supabase
    .from('files')
    .update({ deleted_at: new Date().toISOString() })
    .eq('message_id', id)
    .is('deleted_at', null);

  await audit(ctx, 'message_deleted', {
    channelId: existing.channel_id,
    messageId: id,
    targetMemberId: existing.sender_id,
    reason: isAuthor ? 'removed by the author' : 'removed by a moderator',
  });

  return success({ deleted: true });
}

// The message composer sends PUT when saving an edit.
export { PATCH as PUT };
