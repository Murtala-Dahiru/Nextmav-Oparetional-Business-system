import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { communicationPolicy } from '@/lib/communication';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Meetings.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What a meeting is here ───────────────────────────────────────────────
 *
 *  A room with a host, a guest list and a record. The media — audio, video,
 *  a shared screen — is negotiated directly between browsers over Realtime
 *  broadcast and never touches this endpoint; see the note at the top of
 *  section 6 in migration 0023, and `hooks/use-meeting.ts`.
 *
 *  What this endpoint owns is everything that has to survive a reconnect and
 *  hold against a client that ignores it: who is invited, who has been
 *  admitted, whether the room is locked, when it ran, and what was agreed.
 *
 *  ── Why it is in Communication and not Calendar ──────────────────────────
 *
 *  Because a meeting is a conversation with a time attached, and it is the
 *  conversation it belongs to that makes it findable — a project's channel
 *  shows the project's meetings. It still appears on the calendar: a scheduled
 *  meeting writes a `calendar_events` row through a trigger, so it is in
 *  everybody's week without this module having to own a second calendar.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { data, error: e } = await ctx.supabase
    .rpc('meeting_overview', { org: ctx.org.organizationId });

  if (e) return pgError(e);

  const rows = (data ?? []) as any[];
  const { searchParams } = new URL(req.url);

  const channelId = searchParams.get('channelId') ?? searchParams.get('channel_id');
  const status = searchParams.get('status');

  let filtered = rows;
  if (channelId) filtered = filtered.filter(r => r.channel_id === channelId);
  if (status && status !== 'all') filtered = filtered.filter(r => r.status === status);

  return success(filtered, {
    total: filtered.length,
    // The one number every surface in the product wants from this list, computed
    // once here rather than three times in three components.
    live: rows.filter(r => r.status === 'live').length,
  });
}

/**
 * Call a meeting.
 *
 * Two shapes, one endpoint: with `scheduledAt` it goes on the calendar and
 * everybody is invited for a time; without one it starts immediately, which is
 * the "call this channel now" gesture. The difference is a single field
 * because it is a single act — the alternative is two endpoints that share
 * every line except the timestamp and drift apart within a month.
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

  const title = String(b.title ?? '').trim();
  if (!title) return error('A meeting needs a title.', 422, 'VALIDATION_ERROR');

  const duration = Math.min(1440, Math.max(5, Number(b.duration_minutes) || 30));
  const startNow = !b.scheduled_at;

  /**
   * A channel-bound meeting must be one the caller can actually see.
   *
   * Not merely a courtesy: `can_see_meeting()` admits everybody who can see
   * the channel, so attaching a meeting to a private channel the caller is not
   * in would publish its title and agenda to that channel's members. RLS on
   * `meetings` does not catch this, because the insert itself is legitimate —
   * it is the *combination* with a channel id that is not.
   */
  if (b.channel_id) {
    const { data: visible } = await ctx.supabase
      .rpc('can_see_channel', { chan: b.channel_id });
    if (visible !== true) {
      return error('That conversation is not one you can meet in.', 403, 'FORBIDDEN_ACTION');
    }
  }

  const { data: meeting, error: e } = await ctx.supabase
    .from('meetings')
    .insert({
      organization_id: ctx.org.organizationId,
      channel_id: b.channel_id || null,
      project_id: b.project_id || null,
      title,
      agenda: String(b.agenda ?? ''),
      host_id: ctx.org.memberId,
      status: startNow ? 'live' : 'scheduled',
      mode: b.mode === 'audio' ? 'audio' : 'video',
      scheduled_at: b.scheduled_at || null,
      duration_minutes: duration,
      started_at: startNow ? new Date().toISOString() : null,
      // A waiting room on an ad-hoc call between colleagues is friction for
      // nothing; on a scheduled meeting it is the thing that stops somebody
      // walking into a conversation that has not finished.
      waiting_room: b.waiting_room === undefined ? !startNow : !!b.waiting_room,
      allow_guests: !!b.allow_guests,
    })
    .select('*')
    .single();

  if (e) return pgError(e);

  /**
   * Who is invited.
   *
   * An explicit list wins. Failing that, a meeting attached to a channel
   * invites that channel — which is what makes "meet about this" a single
   * click rather than a guest list somebody has to rebuild every week.
   */
  let invitees: string[] = Array.isArray(b.member_ids) ? b.member_ids.filter(Boolean) : [];

  if (!invitees.length && b.channel_id) {
    const { data: members } = await ctx.supabase
      .from('channel_members').select('member_id').eq('channel_id', b.channel_id);
    invitees = (members ?? []).map((m: any) => m.member_id);
  }

  invitees = invitees.filter(id => id !== ctx.org.memberId);

  if (invitees.length) {
    const policy = await communicationPolicy(ctx);

    /**
     * Clients are filtered out unless the organisation has said otherwise, and
     * then only when this meeting was explicitly opened to them.
     *
     * Two gates rather than one because they answer different questions: the
     * policy is "may this company ever put a customer in a meeting", and
     * `allow_guests` is "did the host mean to, this time". A single flag would
     * make the second decision on the host's behalf.
     */
    const allowClients = policy.allowClientMeetings && meeting.allow_guests;

    let q = ctx.supabase
      .from('organization_members').select('id, role')
      .eq('organization_id', ctx.org.organizationId)
      .eq('is_active', true)
      .in('id', invitees);
    if (!allowClients) q = q.neq('role', 'client');

    const { data: eligible } = await q;

    const rows = (eligible ?? []).map((m: any) => ({
      meeting_id: meeting.id,
      member_id: m.id,
      role: 'attendee',
      state: 'invited',
    }));

    if (rows.length) {
      // The notification is the trigger's job, not this handler's — see
      // `notify_meeting_invite()`. Doing it here as well would double every
      // invitation.
      await ctx.supabase
        .from('meeting_participants')
        .upsert(rows, { onConflict: 'meeting_id,member_id', ignoreDuplicates: true });
    }
  }

  return success(meeting, undefined, 201);
}
