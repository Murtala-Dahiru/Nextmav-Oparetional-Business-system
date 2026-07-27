import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

/** One channel, with its participants. */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: channel, error: e } = await ctx.supabase
    .from('channels').select('*')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();

  if (e) return pgError(e);
  // A private channel the caller is not in is filtered out by `channels_select`
  // rather than answered with a 403 — confirming it exists would disclose the
  // conversation's existence, which is the thing being kept private.
  if (!channel) return error('Not found', 404, 'NOT_FOUND');

  const { data: members } = await ctx.supabase
    .from('v_channel_members').select('*')
    .eq('channel_id', id).order('joined_at');

  return success({ ...channel, members: members ?? [] });
}

/**
 * Change a channel's settings.
 *
 * Restricted to channel administrators by `channels_update`. The one rule that
 * cannot live in RLS is below: closing a channel to everyone but administrators
 * is an organisation-level act, not something a channel owner may do to a room
 * the whole company is in.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const update: Record<string, any> = { updated_at: new Date().toISOString() };

  if (typeof b.display_name === 'string') {
    const name = b.display_name.trim();
    if (!name) return error('A channel needs a name.', 422, 'VALIDATION_ERROR');
    update.display_name = name;
  }
  if (typeof b.description === 'string') update.description = b.description;
  if (typeof b.topic === 'string') update.topic = b.topic;
  if ('is_archived' in b) update.is_archived = !!b.is_archived;
  if ('department_id' in b) update.department_id = b.department_id || null;

  if ('post_policy' in b) {
    if (!['everyone', 'members', 'admins'].includes(b.post_policy)) {
      return error('Posting must be open to everyone, to members, or to admins.', 422, 'VALIDATION_ERROR');
    }
    if (b.post_policy === 'admins' && !['owner', 'administrator'].includes(ctx.org.role)) {
      return error(
        'Only an administrator can restrict a channel to announcements.',
        403, 'FORBIDDEN_ACTION',
      );
    }
    update.post_policy = b.post_policy;
  }

  if ('join_policy' in b) {
    if (!['open', 'invite'].includes(b.join_policy)) {
      return error('Joining must be open or by invitation.', 422, 'VALIDATION_ERROR');
    }
    update.join_policy = b.join_policy;
  }

  if (Object.keys(update).length === 1) return error('Nothing to update', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('channels').update(update)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .select('*').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('You do not administer this channel.', 403, 'RLS_DENIED');
  return success(data);
}

export { PATCH as PUT };

/**
 * Delete a channel, with its messages.
 *
 * Hard, unlike most deletes here: `messages` cascades from `channels`, and a
 * soft-deleted channel would keep its conversation reachable to anyone who
 * queried messages by channel id. Restricted to channel administrators by
 * `channels_delete`.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: channel } = await ctx.supabase
    .from('channels').select('id, type, name')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();

  if (!channel) return error('Not found', 404, 'NOT_FOUND');
  if (channel.type === 'direct') {
    return error(
      'A direct conversation cannot be deleted — it belongs to both people.',
      409, 'RULE_VIOLATION',
    );
  }

  const { error: e } = await ctx.supabase
    .from('channels').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
