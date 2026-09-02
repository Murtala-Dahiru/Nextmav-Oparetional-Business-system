import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

/**
 * ===========================================================================
 *  Free and busy
 * ===========================================================================
 *
 *  -- What this answers, and what it refuses to invent ----------------------
 *
 *  "Is this person already committed between these two times." Nothing else.
 *  `member_availability()` (0038) returns intervals and a flag saying whether
 *  the commitment was accepted or merely invited; it returns no title, no
 *  location and no other attendees, which is what makes free/busy safe to
 *  disclose across an organisation when a calendar entry itself is not.
 *
 *  -- Where the data comes from --------------------------------------------
 *
 *  `calendar_events` and `event_attendees`. A scheduled meeting writes both -
 *  the event through `sync_meeting_event()`, the attendees through
 *  `sync_meeting_attendee()`, added in 0038 because until then a meeting put an
 *  event on the calendar with nobody attached to it and the calendar therefore
 *  could not say who was busy.
 *
 *  An ad-hoc call has no calendar entry and is not counted, which is correct:
 *  it has no future to plan around.
 *
 *  -- The suggestion is computed here, not in Postgres ---------------------
 *
 *  Because it is a presentation decision - the slot length, the working day,
 *  how many suggestions are worth offering - and none of those belong in a
 *  function three other things call. What the database returns is the fact;
 *  what this returns is the fact plus one reading of it.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  const memberIds = (searchParams.get('memberIds') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (!memberIds.length) {
    return success([], { busy: [], suggestions: [], memberIds: [] });
  }

  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) {
    return error('from and to are required', 422, 'VALIDATION_ERROR');
  }

  const fromAt = new Date(from);
  const toAt = new Date(to);
  if (Number.isNaN(fromAt.getTime()) || Number.isNaN(toAt.getTime()) || toAt <= fromAt) {
    return error('from and to must be a valid range', 422, 'VALIDATION_ERROR');
  }

  /**
   * A fortnight, at most.
   *
   * The window is what bounds the scan, and an unbounded one over a calendar
   * with a few years in it is a slow query somebody can ask for by editing a
   * query string.
   */
  const span = toAt.getTime() - fromAt.getTime();
  if (span > 14 * 86_400_000) {
    return error('Ask about a fortnight at a time.', 422, 'RANGE_TOO_WIDE');
  }

  const { data, error: e } = await ctx.supabase.rpc('member_availability', {
    org: ctx.org.organizationId,
    member_ids: memberIds,
    from_at: fromAt.toISOString(),
    to_at: toAt.toISOString(),
  });

  if (e) return pgError(e);

  const busy = (data ?? []) as {
    member_id: string; busy_from: string; busy_to: string; confirmed: boolean;
  }[];

  const durationMinutes = Math.min(
    480, Math.max(15, Number(searchParams.get('duration')) || 30));

  return success(busy, {
    memberIds,
    from: fromAt.toISOString(),
    to: toAt.toISOString(),
    durationMinutes,
    suggestions: suggest(busy, memberIds, fromAt, toAt, durationMinutes),
  });
}

/**
 * The first few slots in which nobody named is committed.
 *
 * -- The rules, stated because they are choices ---------------------------
 *
 * · Half-hour boundaries, because that is how people write times down.
 * · Inside 09:00-17:30 on a weekday, in the *server's* reckoning of the
 *   instant. Timezone is the one thing this cannot get right for a
 *   distributed team from here, so the client renders every suggestion in the
 *   reader's own zone and the reader is the one who judges it.
 * · A slot is offered only if every person asked about is free for the whole
 *   of it. "Most of you are free" is not an answer to "when can we meet".
 * · Three suggestions. A list of twenty is a second scheduling problem.
 *
 * Returns an empty list rather than a bad slot when nothing fits, and the
 * interface says so rather than showing a time that will not work.
 */
function suggest(
  busy: { member_id: string; busy_from: string; busy_to: string }[],
  memberIds: string[],
  from: Date,
  to: Date,
  durationMinutes: number,
): { startsAt: string; endsAt: string }[] {
  const windows = busy.map(b => ({
    member: b.member_id,
    from: new Date(b.busy_from).getTime(),
    to: new Date(b.busy_to).getTime(),
  }));

  const slotMs = durationMinutes * 60_000;
  const found: { startsAt: string; endsAt: string }[] = [];

  // Start at the next half hour that has not already gone.
  const cursor = new Date(Math.max(from.getTime(), Date.now()));
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() > 30 ? 60 : 30, 0, 0);

  const limit = to.getTime();
  while (cursor.getTime() + slotMs <= limit && found.length < 3) {
    const start = cursor.getTime();
    const end = start + slotMs;
    const day = cursor.getDay();
    const hour = cursor.getHours() + cursor.getMinutes() / 60;

    const workable = day !== 0 && day !== 6 && hour >= 9 && hour + durationMinutes / 60 <= 17.5;
    const clashes = workable && windows.some(w => w.from < end && w.to > start);

    if (workable && !clashes) {
      found.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
      });
      // Do not offer three slots back to back; spread them so the choice is
      // a real one.
      cursor.setMinutes(cursor.getMinutes() + Math.max(60, durationMinutes));
      continue;
    }

    cursor.setMinutes(cursor.getMinutes() + 30);
  }

  // `memberIds` is unused in the arithmetic above and kept in the signature
  // because the caller's intent is "these people": if a future version ranks
  // partial availability, it needs to know how many were asked about.
  void memberIds;

  return found;
}
