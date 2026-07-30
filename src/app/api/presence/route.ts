import { authenticate, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Presence
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Nothing. `profiles.last_seen_at` defaults to `now()` when the row is created
 * and no code has ever updated it, so it has always held the moment the account
 * was made. The Admin and HR tables' "Last Seen" column showed the signup date
 * for every employee for ever, and the communication header's online count —
 * which filters on `last_seen_at > now() - 5 minutes` — was true only in the
 * five minutes after somebody signed up.
 *
 * ── Why `authenticate` and not `authorize` ────────────────────────────────
 *
 * Presence is about the person, not a module — the same reasoning that already
 * puts notifications and the personal to-do list behind `authenticate()`.
 * Forcing it through a module grant would give the wrong answer in both
 * directions: a client account has no `communication` grant and still needs to
 * appear online to the people serving them.
 *
 * The one exception is deliberate: an account still holding an administrator's
 * temporary password is refused, because `authenticate()` refuses it. Somebody
 * who has not chosen a password yet should not be showing as at their desk.
 */

/** How the browser reports itself. Anything else is treated as `online`. */
const STATUSES = ['online', 'away', 'offline'] as const;

/**
 * Record a heartbeat.
 *
 * Called on an interval by `hooks/use-presence.ts`, and once more with
 * `status: 'offline'` on page hide — via `sendBeacon`, which is why this
 * tolerates a body that is not JSON.
 */
export async function POST(req: Request) {
  const ctx = await authenticate();
  if (ctx instanceof Response) return ctx;

  /**
   * A malformed body is a heartbeat, not a failure.
   *
   * `navigator.sendBeacon` sends a Blob and gives the caller no way to observe
   * the response or retry, and a tab being closed is exactly when the payload
   * is most likely to be truncated. Refusing it would drop the one beat that
   * matters most — the one that says somebody left.
   */
  let body: Record<string, any> = {};
  try {
    body = acceptBody(await req.json());
  } catch {
    // Defaults below apply.
  }

  const requested = String(body.status ?? 'online');
  const status = (STATUSES as readonly string[]).includes(requested) ? requested : 'online';

  /**
   * Whether this beat represents a real interaction.
   *
   * Defaults to true so a caller that sends nothing is treated as active, but
   * the hook is explicit: an idle tab keeps beating with `active: false`, which
   * is what lets "away" be measured from something other than the heartbeat
   * itself.
   */
  const active = body.active !== false && status === 'online';

  const { error: e } = await ctx.supabase.rpc('record_presence', {
    p_status: status,
    p_active: active,
  });

  if (e) return pgError(e);
  return success({ status, active });
}

/**
 * Who is around.
 *
 * Reads `v_presence`, which is the only place the online/away/offline verdict
 * is defined — so the dot in the chat sidebar, the one on a project's team
 * panel and the one in the employee directory cannot disagree.
 *
 * `?memberIds=a,b,c` narrows it for a screen that already knows which people it
 * is rendering; without it, the whole organization comes back. Both are small:
 * the row is a name, an avatar and three timestamps.
 */
export async function GET(req: Request) {
  const ctx = await authenticate();
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('v_presence')
    .select('member_id, user_id, full_name, avatar_url, presence, last_seen_at, last_active_at')
    .eq('organization_id', ctx.org.organizationId);

  const ids = (searchParams.get('memberIds') ?? searchParams.get('member_ids') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (ids.length) {
    // Bounded: a query string is not a place to put a thousand uuids, and a
    // screen rendering more than this is not rendering presence dots anyway.
    if (ids.length > 200) {
      return error('Too many members requested at once.', 422, 'TOO_MANY_IDS');
    }
    q = q.in('member_id', ids);
  }

  const { data, error: e } = await q;
  if (e) return pgError(e);

  /**
   * A count of who is actually online, so the chat header does not have to
   * derive it from a cutoff of its own — which is how it came to be wrong in
   * the first place.
   */
  const rows = data ?? [];
  return success(rows, {
    online: rows.filter((r: any) => r.presence === 'online').length,
    away: rows.filter((r: any) => r.presence === 'away').length,
    total: rows.length,
  });
}

/**
 * Sign off explicitly.
 *
 * Distinguished from a dropped connection because it is knowable. Waiting two
 * minutes for the heartbeat to go stale before greying out somebody who
 * deliberately signed out looks like the product has not noticed.
 */
export async function DELETE() {
  const ctx = await authenticate();
  if (ctx instanceof Response) return ctx;

  const { error: e } = await ctx.supabase.rpc('clear_presence');
  if (e) return pgError(e);
  return success({ status: 'offline' });
}
