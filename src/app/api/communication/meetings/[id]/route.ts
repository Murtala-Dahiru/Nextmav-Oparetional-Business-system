import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { audit } from '@/lib/communication';

type Params = { params: Promise<{ id: string }> };

/** One meeting, with everyone in the room. */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: meeting, error: e } = await ctx.supabase
    .from('meetings').select('*')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();

  if (e) return pgError(e);
  // Filtered out by `meetings_select` rather than refused with a 403: a
  // meeting you cannot see should not be confirmed to exist.
  if (!meeting) return error('Not found', 404, 'NOT_FOUND');

  const { data: participants } = await ctx.supabase
    .from('v_meeting_participants').select('*')
    .eq('meeting_id', id).order('invited_at');

  return success({ ...meeting, participants: participants ?? [] });
}

/**
 * Run the meeting.
 *
 * Starting, ending, locking, opening or closing the waiting room, and the
 * notes. Restricted to the host and co-hosts by `meetings_update`; this
 * handler adds the transitions that are not expressible as a column write -
 * starting stamps `started_at`, ending stamps `ended_at` and turns everybody
 * still in the room to `left`, so a meeting that ends does not leave a list of
 * people apparently still sitting in it.
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

  const { data: existing } = await ctx.supabase
    .from('meetings').select('*')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();
  if (!existing) return error('Not found', 404, 'NOT_FOUND');

  const update: Record<string, any> = { updated_at: new Date().toISOString() };

  if (typeof b.title === 'string') {
    const title = b.title.trim();
    if (!title) return error('A meeting needs a title.', 422, 'VALIDATION_ERROR');
    update.title = title;
  }
  if (typeof b.agenda === 'string') update.agenda = b.agenda;
  if (typeof b.notes === 'string') update.notes = b.notes;
  if ('is_locked' in b) update.is_locked = !!b.is_locked;
  if ('waiting_room' in b) update.waiting_room = !!b.waiting_room;
  if ('allow_guests' in b) update.allow_guests = !!b.allow_guests;
  if ('scheduled_at' in b) update.scheduled_at = b.scheduled_at || null;
  if ('duration_minutes' in b) {
    update.duration_minutes = Math.min(1440, Math.max(5, Number(b.duration_minutes) || 30));
  }
  if ('project_id' in b) update.project_id = b.project_id || null;

  /**
   * Status is a transition, not a value.
   *
   * Accepting `status` as a free assignment would allow a meeting to go from
   * `ended` back to `live` with none of the stamps that make the record mean
   * anything. The three moves below are the only ones that exist.
   */
  if (b.status === 'live' && existing.status !== 'live') {
    if (existing.status === 'ended') {
      return error('A meeting that has ended cannot be restarted. Call a new one.', 409, 'RULE_VIOLATION');
    }
    update.status = 'live';
    update.started_at = new Date().toISOString();
    update.ended_at = null;
  } else if (b.status === 'ended' && existing.status !== 'ended') {
    update.status = 'ended';
    update.ended_at = new Date().toISOString();
  } else if (b.status === 'cancelled' && existing.status === 'scheduled') {
    update.status = 'cancelled';
  }

  if (Object.keys(update).length === 1) return error('Nothing to update', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('meetings').update(update)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .select('*').maybeSingle();

  if (e) return pgError(e);
  // `meetings_update` admits the host, co-hosts and organisation
  // administrators. An empty result means the caller is none of them.
  if (!data) return error('Only the host can change this meeting.', 403, 'RLS_DENIED');

  if (update.status === 'ended') {
    /**
     * Everybody still in the room is marked as having left.
     *
     * Without this, the participant list of a finished meeting reads as though
     * four people are still in it - for ever, since nothing else will ever
     * update those rows. `left_at` is the meeting's end, which is the truth.
     */
    await ctx.supabase
      .from('meeting_participants')
      .update({ state: 'left', left_at: update.ended_at })
      .eq('meeting_id', id)
      .in('state', ['joined', 'admitted', 'knocking']);

    await audit(ctx, 'meeting_ended', { channelId: existing.channel_id, reason: existing.title });
  }

  if (update.status === 'live') {
    await audit(ctx, 'meeting_started', { channelId: existing.channel_id, reason: existing.title });
  }

  return success(data);
}

export { PATCH as PUT };

/**
 * Cancel a meeting outright.
 *
 * Hard delete, and only for one that has not happened: `meeting_participants`
 * cascades, and there is nothing worth keeping about a room nobody entered.
 * A meeting that ran is a record of something and is kept - cancelling that
 * would be rewriting history rather than tidying a calendar.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: meeting } = await ctx.supabase
    .from('meetings').select('id, status, event_id, title, channel_id')
    .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();

  if (!meeting) return error('Not found', 404, 'NOT_FOUND');
  if (meeting.status === 'live') {
    return error('End the meeting before removing it.', 409, 'RULE_VIOLATION');
  }
  if (meeting.status === 'ended') {
    return error(
      'A meeting that has taken place is part of the record and cannot be deleted.',
      409, 'RULE_VIOLATION',
    );
  }

  const { error: e } = await ctx.supabase
    .from('meetings').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);

  // The calendar entry goes with it. Left behind, it would advertise a meeting
  // that no longer exists to everybody whose week view reads that table.
  if (meeting.event_id) {
    await ctx.supabase.from('calendar_events').delete().eq('id', meeting.event_id);
  }

  return success({ deleted: true });
}
