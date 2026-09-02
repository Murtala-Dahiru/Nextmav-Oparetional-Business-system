import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { audit, communicationPolicy } from '@/lib/communication';

type Params = { params: Promise<{ id: string }> };

/** Who is in the room, who is waiting, and who was invited and never came. */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('v_meeting_participants').select('*')
    .eq('meeting_id', id).order('invited_at');

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Invite people, or arrive at the door.
 *
 * ── The waiting room, and why the state is here rather than in the browser ──
 *
 * "You have not been admitted yet" has to be a fact the server holds. If it
 * were a message broadcast to a client, a participant who simply ignored it
 * would still receive everybody's media - the peer connections are established
 * between browsers, so a client that is not told to stay out is already in.
 * The row is what the other participants consult before offering a connection.
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

  const { data: meeting } = await ctx.supabase
    .from('meetings').select('*')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();
  if (!meeting) return error('Not found', 404, 'NOT_FOUND');
  if (meeting.status === 'ended' || meeting.status === 'cancelled') {
    return error('That meeting is over.', 409, 'RULE_VIOLATION');
  }

  // No list means "let me in" - the join button.
  const requested: string[] = Array.isArray(b.member_ids) && b.member_ids.length
    ? b.member_ids.filter(Boolean)
    : [ctx.org.memberId];

  const joiningSelf = requested.length === 1 && requested[0] === ctx.org.memberId;

  if (joiningSelf) {
    const { data: mine } = await ctx.supabase
      .from('meeting_participants').select('*')
      .eq('meeting_id', id).eq('member_id', ctx.org.memberId).maybeSingle();

    /**
     * Somebody the host has removed does not get back in by pressing Join
     * again. This is the one state that is not a way-station.
     */
    if (mine?.state === 'removed') {
      return error('You were removed from this meeting.', 403, 'FORBIDDEN_ACTION');
    }

    const isHost = meeting.host_id === ctx.org.memberId
      || ['host', 'cohost'].includes(mine?.role ?? '');

    if (meeting.is_locked && !isHost && mine?.state !== 'admitted') {
      return error('This meeting is locked.', 403, 'MEETING_LOCKED');
    }

    /**
     * Where a knock lands.
     *
     * A host walks straight in - a waiting room the host waits in is a room
     * nobody can be let out of.
     *
     * ── Coming back is not arriving ──────────────────────────────────────
     *
     * The other three cases are all one person: somebody who is already in
     * this meeting and whose browser has asked again. `admitted` is the
     * moment between the host saying yes and the seat being taken.
     * `admitted_at` is that same yes, remembered - so leaving to take a call
     * and coming back does not put you at the door the host already opened.
     * `joined` means the row still says they are here, which is what a tab
     * that crashed or a laptop that slept looks like.
     *
     * Without these, refreshing the page during a meeting sent you back to
     * the waiting room and the host had to admit you a second time - which
     * is the same interruption twice, for the crime of pressing reload. A
     * host who does not want somebody back has `removed`, and that is checked
     * above and is the one state that is not a way-station.
     */
    const returning = mine?.state === 'admitted'
      || mine?.state === 'joined'
      || !!mine?.admitted_at;

    const state = isHost || returning
      ? 'joined'
      : meeting.waiting_room ? 'knocking' : 'joined';

    const now = new Date().toISOString();
    const { data, error: e } = await ctx.supabase
      .from('meeting_participants')
      .upsert(
        {
          meeting_id: id,
          member_id: ctx.org.memberId,
          role: isHost ? (mine?.role ?? 'host') : (mine?.role ?? 'attendee'),
          state,
          knocked_at: state === 'knocking' ? now : (mine?.knocked_at ?? null),
          joined_at: state === 'joined' ? now : (mine?.joined_at ?? null),
          left_at: null,
        },
        { onConflict: 'meeting_id,member_id' },
      )
      .select('*')
      .maybeSingle();

    if (e) return pgError(e);
    return success(data, { waiting: state === 'knocking' }, 201);
  }

  // ── Inviting other people ──

  const { data: canHost } = await ctx.supabase.rpc('is_meeting_host', { m: id });
  if (canHost !== true) {
    return error('Only the host can invite people to a meeting.', 403, 'FORBIDDEN_ACTION');
  }

  const policy = await communicationPolicy(ctx);
  const allowClients = policy.allowClientMeetings && meeting.allow_guests;

  let q = ctx.supabase
    .from('organization_members').select('id, role')
    .eq('organization_id', ctx.org.organizationId)
    .eq('is_active', true)
    .in('id', requested);
  if (!allowClients) q = q.neq('role', 'client');

  const { data: eligible } = await q;
  const rows = (eligible ?? []).map((m: any) => ({
    meeting_id: id,
    member_id: m.id,
    role: 'attendee',
    state: 'invited',
  }));

  if (!rows.length) {
    return error(
      allowClients
        ? 'None of those people can be invited.'
        : 'None of those people can be invited. Client accounts need this meeting to allow guests, '
          + 'and the organisation to allow clients in meetings.',
      422, 'VALIDATION_ERROR',
    );
  }

  const { data, error: e } = await ctx.supabase
    .from('meeting_participants')
    .upsert(rows, { onConflict: 'meeting_id,member_id', ignoreDuplicates: true })
    .select('*');

  if (e) return pgError(e);
  return success(data ?? [], undefined, 201);
}

/**
 * Host controls, and your own hand.
 *
 * One handler for both because they write the same row, and which of them a
 * caller is permitted is decided by `meeting_participants_update` rather than
 * by a branch here - an employee may change their own row and may not change
 * anybody's role, which is expressed once, in the policy, where it also holds
 * for anything that writes this table by another path.
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
  const isSelf = target === ctx.org.memberId;
  const update: Record<string, any> = {};
  const now = new Date().toISOString();

  // ── Your own state ──
  if ('hand_raised' in b) update.hand_raised_at = b.hand_raised ? now : null;
  if ('camera_on' in b) update.camera_on = !!b.camera_on;
  if ('is_sharing' in b) update.is_sharing = !!b.is_sharing;
  if (b.state === 'left') { update.state = 'left'; update.left_at = now; }
  /**
   * Answering the invitation.
   *
   * -- Why all three are one field ---------------------------------------
   *
   * `meeting_participants.state` already carried `declined` and had no
   * opposite, so everybody who meant to come sat in `invited` - the same
   * value as somebody who had not looked. 0038 added `accepted` and
   * `tentative` beside it rather than a second column, because a person who
   * has joined the room has self-evidently accepted and two columns would
   * let those two facts disagree.
   *
   * Only about yourself. A host may remove somebody from a meeting; they
   * may not answer on their behalf.
   */
  if (['accepted', 'declined', 'tentative'].includes(String(b.state)) && isSelf) {
    update.state = String(b.state);
  }

  // ── Host controls ──
  if ('is_muted' in b) update.is_muted = !!b.is_muted;
  if (b.state === 'admitted') { update.state = 'admitted'; update.admitted_at = now; }
  if (b.state === 'removed') { update.state = 'removed'; update.left_at = now; }
  if (b.role && ['host', 'cohost', 'attendee'].includes(b.role)) update.role = b.role;

  if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

  /**
   * Muting somebody else, admitting, removing and promoting are host acts and
   * are refused here with an explanation.
   *
   * The RLS policy already refuses them - but it refuses by matching no rows,
   * which reaches the caller as "that person is not in this meeting". True,
   * unhelpful, and indistinguishable from a genuine 404.
   */
  const hostOnly = ['is_muted', 'role'].some(k => k in update)
    || ['admitted', 'removed'].includes(String(update.state));

  if (hostOnly || !isSelf) {
    const { data: canHost } = await ctx.supabase.rpc('is_meeting_host', { m: id });
    if (canHost !== true) {
      return error('Only the host can do that.', 403, 'FORBIDDEN_ACTION');
    }
  }

  const { data, error: e } = await ctx.supabase
    .from('meeting_participants').update(update)
    .eq('meeting_id', id).eq('member_id', target)
    .select('*').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('That person is not in this meeting.', 404, 'NOT_FOUND');

  if (update.state === 'removed') {
    const { data: meeting } = await ctx.supabase
      .from('meetings').select('channel_id').eq('id', id).maybeSingle();
    await audit(ctx, 'participant_removed', {
      channelId: meeting?.channel_id ?? null,
      targetMemberId: target,
    });
  }

  return success(data);
}

/**
 * Leave, or be shown out.
 *
 * A row is not deleted for either: who was in a meeting is part of what the
 * meeting was, and a participant list that shrinks as people go answers no
 * question anybody has afterwards. Leaving is a state, and this is the same
 * write PATCH makes - kept because "DELETE me from this meeting" is the verb
 * the browser reaches for when a tab is closing.
 */
export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const target = new URL(req.url).searchParams.get('memberId') || ctx.org.memberId;
  const leaving = target === ctx.org.memberId;

  if (!leaving) {
    const { data: canHost } = await ctx.supabase.rpc('is_meeting_host', { m: id });
    if (canHost !== true) {
      return error('Only the host can remove somebody from a meeting.', 403, 'FORBIDDEN_ACTION');
    }
  }

  const { data, error: e } = await ctx.supabase
    .from('meeting_participants')
    .update({
      state: leaving ? 'left' : 'removed',
      left_at: new Date().toISOString(),
      is_sharing: false,
      hand_raised_at: null,
    })
    .eq('meeting_id', id).eq('member_id', target)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('That person is not in this meeting.', 404, 'NOT_FOUND');

  if (!leaving) {
    const { data: meeting } = await ctx.supabase
      .from('meetings').select('channel_id').eq('id', id).maybeSingle();
    await audit(ctx, 'participant_removed', {
      channelId: meeting?.channel_id ?? null,
      targetMemberId: target,
    });
  }

  return success({ left: leaving, removed: !leaving, memberId: target });
}
