import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ===========================================================================
 *  Saved messages - one person's shelf.
 * ===========================================================================
 *
 *  -- Why this is not pinning ----------------------------------------------
 *
 *  Pinning is a channel-wide act: it changes what everybody sees, it is
 *  restricted, and it says "this is the standing information in this room".
 *  Saving says "I need this on Thursday" and has an audience of one. Two
 *  sentences, two tables; conflating them gives a pinned list that is either
 *  everybody's clutter or nobody's reminder.
 *
 *  -- What governs it ------------------------------------------------------
 *
 *  `message_saves_own` (0036). Your own rows, and only while you can still see
 *  the channel the message is in - so a save taken out of a private channel
 *  stops being readable at the moment you are removed from it. Nothing in this
 *  handler re-checks that, deliberately: the policy is the rule, and a second
 *  copy of it here is a second thing to keep in step.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 100));

  const { data, error: e } = await ctx.supabase.rpc('saved_messages', {
    org: ctx.org.organizationId,
    lim: limit,
  });

  if (e) return pgError(e);

  const rows = (data ?? []) as any[];
  return success(rows, { total: rows.length });
}

/**
 * Save a message, or update the note on one already saved.
 *
 * -- Saving twice --------------------------------------------------------
 *
 * People will: from the message, and again a week later having forgotten. The
 * unique index refuses the second row, and the honest answer is "this is
 * already saved" with the existing row returned, not an error and not a
 * duplicate. The same shape My Work's intake settled on for the same reason.
 */
export async function POST(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const messageId = String(b.message_id ?? '');
  if (!messageId) return error('message_id is required', 422, 'VALIDATION_ERROR');

  const note = String(b.note ?? '').slice(0, 500);

  const { data: existing } = await ctx.supabase
    .from('message_saves')
    .select('id, note, created_at')
    .eq('member_id', ctx.org.memberId)
    .eq('message_id', messageId)
    .maybeSingle();

  if (existing) {
    // A repeat save with a note is somebody correcting the note, not somebody
    // saving again; a repeat with no note leaves what is there alone.
    if (note && note !== existing.note) {
      const { data, error: e } = await ctx.supabase
        .from('message_saves').update({ note })
        .eq('id', existing.id).select('*').single();
      if (e) return pgError(e);
      return success(data, { alreadySaved: true, noteUpdated: true });
    }
    return success(existing, { alreadySaved: true });
  }

  const { data, error: e } = await ctx.supabase
    .from('message_saves')
    .insert({
      organization_id: ctx.org.organizationId,
      member_id: ctx.org.memberId,
      message_id: messageId,
      note,
    })
    .select('*')
    .single();

  if (e) {
    /**
     * The policy refuses a message the caller cannot see, and PostgREST
     * reports that as a row-level-security violation rather than a 404. Said
     * plainly, because "new row violates row-level security policy" in front
     * of somebody who pressed Save is not an explanation.
     */
    if (e.code === '42501') {
      return error('That message is not one you can save.', 403, 'FORBIDDEN_ACTION');
    }
    if (e.code === '23503') return error('That message no longer exists.', 404, 'NOT_FOUND');
    return pgError(e);
  }

  return success(data, { alreadySaved: false }, 201);
}

/**
 * Unsave.
 *
 * Addressed by message rather than by save id, because the control that calls
 * this is a toggle on a message and the caller should not have to know the
 * shelf row's identifier to take something off the shelf.
 */
export async function DELETE(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const messageId = searchParams.get('messageId') ?? searchParams.get('message_id');
  const saveId = searchParams.get('id');

  if (!messageId && !saveId) {
    return error('Pass ?messageId= or ?id=', 422, 'VALIDATION_ERROR');
  }

  let query = ctx.supabase.from('message_saves').delete().eq('member_id', ctx.org.memberId);
  query = saveId ? query.eq('id', saveId) : query.eq('message_id', messageId!);

  const { error: e } = await query;
  if (e) return pgError(e);

  // Idempotent: removing something that is already gone is what the caller
  // wanted, and reporting it as an error makes a double click into a red toast.
  return success({ removed: true, messageId: messageId ?? null });
}
