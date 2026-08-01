import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { audit } from '@/lib/communication';

type Params = { params: Promise<{ id: string }> };

/**
 * Who is in a channel.
 *
 * Readable by anyone who can see the channel: a private channel is filtered
 * out of `channels_select` for non-members, so this cannot be used to
 * enumerate the membership of a room you are not in.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: channel } = await ctx.supabase
    .from('channels').select('id')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();
  if (!channel) return error('Not found', 404, 'NOT_FOUND');

  const { data, error: e } = await ctx.supabase
    .from('v_channel_members').select('*')
    .eq('channel_id', id).order('joined_at');

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Add people, or join.
 *
 * Both are the same insert, and which of them a caller is permitted is decided
 * by `channel_members_insert`: a channel administrator may add anybody, an
 * employee may add only themselves and only to an open, non-private channel.
 * Expressing it in the policy rather than here means it also holds for anything
 * that writes the table by another route.
 *
 * Clients are excluded before the insert. A customer must never be pulled into
 * an internal conversation, and the member list comes from the browser.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const { data: channel } = await ctx.supabase
    .from('channels').select('id, display_name, name, type, join_policy')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();
  if (!channel) return error('Not found', 404, 'NOT_FOUND');
  if (channel.type === 'direct') {
    return error('A direct conversation is between two people and cannot take more.',
      409, 'RULE_VIOLATION');
  }

  // No member list means "add me" — the join button.
  const requested: string[] = Array.isArray(b.member_ids) && b.member_ids.length
    ? b.member_ids.filter(Boolean)
    : [ctx.org.memberId];

  const { data: staff } = await ctx.supabase
    .from('organization_members').select('id')
    .eq('organization_id', ctx.org.organizationId)
    .eq('is_active', true).neq('role', 'client')
    .in('id', requested);

  const eligible = (staff ?? []).map(m => m.id);
  if (!eligible.length) {
    return error('None of those people can be added to a channel.', 422, 'VALIDATION_ERROR');
  }

  const { data, error: e } = await ctx.supabase
    .from('channel_members')
    .upsert(
      eligible.map(memberId => ({ channel_id: id, member_id: memberId, role: 'member' })),
      // Adding somebody who is already in is not an error worth showing.
      { onConflict: 'channel_id,member_id', ignoreDuplicates: true },
    )
    .select('*');

  if (e) return pgError(e);

  const added = eligible.filter(m => m !== ctx.org.memberId);
  if (added.length) {
    await ctx.supabase.rpc('notify_members', {
      org: ctx.org.organizationId,
      recipients: added,
      ntype: 'channel',
      ntitle: `You were added to ${channel.display_name || '#' + channel.name}`,
      nbody: '',
      etype: 'channel',
      eid: id,
      nlink: '/dashboard?module=communication',
    });

    // One entry per person, not one per request: "who put Ada in the
    // leadership channel" is the question this table is asked, and a row
    // saying "three people were added" cannot answer it.
    for (const memberId of added) {
      await audit(ctx, 'member_added', { channelId: id, targetMemberId: memberId });
    }
  }

  return success(data ?? [], undefined, 201);
}

/**
 * Change somebody's role in the channel, or mark it read.
 *
 * `lastReadAt` is what clears the unread badge, and every member may set their
 * own; only channel administrators may change a role. `channel_members_update`
 * enforces both.
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

  const target = b.member_id || ctx.org.memberId;
  const update: Record<string, any> = {};

  if (b.mark_read) update.last_read_at = new Date().toISOString();
  if ('is_muted' in b) update.is_muted = !!b.is_muted;
  if (b.role) {
    if (!['owner', 'admin', 'member'].includes(b.role)) {
      return error('A channel role is owner, admin or member.', 422, 'VALIDATION_ERROR');
    }
    update.role = b.role;
  }

  if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('channel_members').update(update)
    .eq('channel_id', id).eq('member_id', target)
    .select('*').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('That person is not in this channel.', 404, 'NOT_FOUND');

  // Marking a channel read and muting it are personal, constant and nobody
  // else's business; a trail of them would bury the acts that matter.
  if (update.role) {
    await audit(ctx, 'member_role_changed', {
      channelId: id, targetMemberId: target, reason: `now ${update.role}`,
    });
  }

  return success(data);
}

/**
 * Leave, or remove somebody.
 *
 * `channel_members_delete` admits the member themselves and channel
 * administrators. The one thing checked here is that the last administrator
 * cannot walk out of a channel they leave behind: a room nobody can administer
 * cannot be renamed, archived, or have anyone added to it again.
 */
export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const target = new URL(req.url).searchParams.get('memberId') || ctx.org.memberId;

  const { data: members } = await ctx.supabase
    .from('channel_members').select('member_id, role').eq('channel_id', id);

  const rows = members ?? [];
  const leaving = rows.find(m => m.member_id === target);
  if (!leaving) return error('That person is not in this channel.', 404, 'NOT_FOUND');

  const admins = rows.filter(m => m.role === 'owner' || m.role === 'admin');
  if (admins.length === 1 && admins[0].member_id === target && rows.length > 1) {
    return error(
      'You are the only administrator of this channel. Promote someone else first.',
      409, 'RULE_VIOLATION',
    );
  }

  const { error: e } = await ctx.supabase
    .from('channel_members').delete()
    .eq('channel_id', id).eq('member_id', target);

  if (e) return pgError(e);

  // Leaving is your own business; being removed by somebody else is the act
  // worth a record.
  if (target !== ctx.org.memberId) {
    await audit(ctx, 'member_removed', { channelId: id, targetMemberId: target });
  }

  return success({ removed: true, memberId: target });
}
