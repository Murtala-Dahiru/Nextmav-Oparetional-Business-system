import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Who has read this?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this is an endpoint and not a field on the message ───────────────
 *
 *  Because it is a question somebody asks, not a property a message wears.
 *
 *  The module used to render "Read by Ada, Grace and 4 others" underneath
 *  every message its author had sent, computed in the browser from the roster
 *  it happened to have loaded. Two things were wrong with that. It is noise:
 *  a line of grey text under every message you have ever sent, answering a
 *  question you asked once. And in a channel of forty people it is a standing
 *  reading log kept on everybody by default, which is not what an enterprise
 *  tool should do quietly.
 *
 *  So the receipt is now something the sender opens. Nothing appears under a
 *  message until they ask, and when they do they get names and times rather
 *  than a count.
 *
 *  ── Why the answer comes from Postgres ───────────────────────────────────
 *
 *  `message_receipts()` refuses anybody but the author, and it derives the
 *  answer from `channel_members.last_read_at` — the same marker the unread
 *  badge is computed from. Deriving it here instead would mean a second
 *  definition of "has read", and the browser only ever holds the members it
 *  has already fetched, so a large channel would quietly under-report.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase.rpc('message_receipts', { msg: id });

  if (e) {
    // The function raises `insufficient_privilege` for anybody who is not the
    // author. Translated rather than passed through, because "42501" is not an
    // explanation and this particular refusal has a reason worth stating.
    if (e.code === '42501') {
      return error(
        'Only the person who sent a message can see who has read it.',
        403, 'FORBIDDEN_ACTION',
      );
    }
    return pgError(e);
  }

  const rows = (data ?? []) as { has_read: boolean }[];

  return success(rows, {
    read: rows.filter(r => r.has_read).length,
    total: rows.length,
  });
}
