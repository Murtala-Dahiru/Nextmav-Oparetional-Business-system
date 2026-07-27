import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Channels, groups and direct messages.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The list ─────────────────────────────────────────────────────────────
 *
 *  `channel_overview()` returns the sidebar in one query: every channel the
 *  caller may see, with its last message, its unread count, its participants
 *  count and — for a direct message — the other person's name and avatar.
 *
 *  The module previously fetched the channel list and then made one further
 *  request per channel to find its most recent message, so twenty channels
 *  meant twenty-one round trips on every load. The unread badge was hard-coded
 *  to zero, because there was no query behind it; `channel_members.last_read_at`
 *  has been the right source since 0003 and nothing had ever read it.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { data, error: e } = await ctx.supabase
    .rpc('channel_overview', { org: ctx.org.organizationId });

  if (e) return pgError(e);

  const rows = (data ?? []) as any[];
  const type = new URL(req.url).searchParams.get('type');
  const filtered = type && type !== 'all' ? rows.filter(r => r.type === type) : rows;

  return success(filtered, {
    total: filtered.length,
    // The bell and the sidebar both want this, and computing it twice from the
    // same list is how the two come to disagree.
    unreadTotal: filtered.reduce((sum, r) => sum + (r.unread_count ?? 0), 0),
  });
}

/**
 * Create a channel or a group.
 *
 * ── Two names, deliberately ──────────────────────────────────────────────
 *
 * `name` is slugged, so "#General" and "#general" cannot become two channels
 * that half the company is missing from. That is right for a channel and wrong
 * for a group: "Q3 Launch Team" came back as `q3-launch-team` and was
 * title-cased again on the way out, which is not the same string. `display_name`
 * keeps what was typed; `name` stays the stable identifier.
 *
 * The creator is always a member, and always an owner. A channel whose creator
 * is not in it is one nobody can administer.
 */
export async function POST(req: Request) {
  const ctx = await authorize('communication', 'create');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const rawName = String(b.display_name ?? b.name ?? '').trim();
  if (!rawName) return error('A channel needs a name.', 422, 'VALIDATION_ERROR');

  const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return error('A channel name must contain letters or numbers.', 422, 'VALIDATION_ERROR');

  const type = ['public', 'private', 'announcement'].includes(b.type) ? b.type : 'public';

  /**
   * An announcement channel is one only administrators may post to.
   *
   * Restricting who may post is an administrative act, so a member cannot
   * create one and appoint themselves its only voice. The check is here rather
   * than in RLS because the row is legitimate — it is the *combination* with
   * the creator's role that is not.
   */
  const isAdmin = ['owner', 'administrator'].includes(ctx.org.role);
  let postPolicy = ['everyone', 'members', 'admins'].includes(b.post_policy) ? b.post_policy : 'everyone';
  if (type === 'announcement') postPolicy = 'admins';
  if (postPolicy === 'admins' && !isAdmin) {
    return error(
      'Only an administrator can create a channel that restricts who may post.',
      403, 'FORBIDDEN_ACTION',
    );
  }

  const { data: channel, error: e } = await ctx.supabase
    .from('channels')
    .insert({
      organization_id: ctx.org.organizationId,
      name: slug,
      display_name: rawName,
      description: String(b.description ?? ''),
      topic: String(b.topic ?? ''),
      type,
      post_policy: postPolicy,
      join_policy: type === 'private' ? 'invite'
        : (['open', 'invite'].includes(b.join_policy) ? b.join_policy : 'open'),
      department_id: b.department_id || null,
      team_id: b.team_id || null,
      created_by: ctx.org.memberId,
    })
    .select('*')
    .single();

  if (e) {
    if (e.code === '23505') return error('A channel with that name already exists.', 409, 'DUPLICATE');
    return pgError(e);
  }

  /**
   * Memberships, in one insert.
   *
   * The creator first, so that even if the invited list is rejected the
   * channel is not left ownerless. Clients are filtered out here as well as by
   * `open_direct_channel` — a customer must never end up in an internal thread,
   * and the invite list comes from the browser.
   */
  const invited: string[] = Array.isArray(b.member_ids) ? b.member_ids.filter(Boolean) : [];

  let eligible: string[] = [];
  if (invited.length) {
    const { data: staff } = await ctx.supabase
      .from('organization_members').select('id')
      .eq('organization_id', ctx.org.organizationId)
      .eq('is_active', true).neq('role', 'client')
      .in('id', invited);
    eligible = (staff ?? []).map(m => m.id).filter(id => id !== ctx.org.memberId);
  }

  const { error: memberError } = await ctx.supabase.from('channel_members').insert([
    { channel_id: channel.id, member_id: ctx.org.memberId, role: 'owner' },
    ...eligible.map(id => ({ channel_id: channel.id, member_id: id, role: 'member' })),
  ]);
  if (memberError) return pgError(memberError);

  if (eligible.length) {
    await ctx.supabase.rpc('notify_members', {
      org: ctx.org.organizationId,
      recipients: eligible,
      ntype: 'channel',
      ntitle: `You were added to ${rawName}`,
      nbody: String(b.description ?? ''),
      etype: 'channel',
      eid: channel.id,
      nlink: '/dashboard?module=communication',
    });
  }

  return success(channel, undefined, 201);
}
