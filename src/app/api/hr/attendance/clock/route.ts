import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * The personal clock.
 *
 * Both actions delegate to `clock_in()` / `clock_out()` in the database. That
 * is deliberate: the timestamp is `now()` evaluated by Postgres, so a device
 * clock — which the user controls — can never become the record. The same
 * functions also refuse to clock in on approved leave and reject double
 * check-in or check-out, so those rules hold no matter which client calls them.
 */

export async function GET() {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const today = new Date().toISOString().slice(0, 10);

  const [{ data: record }, { data: leave }] = await Promise.all([
    ctx.supabase
      .from('attendance_records')
      .select('*')
      .eq('member_id', ctx.org.memberId)
      .eq('work_date', today)
      .maybeSingle(),
    // Approved leave covering today: someone on authorised absence should not
    // be prompted to clock in, and must not later be reported as absent.
    ctx.supabase
      .from('leave_requests')
      .select('id, type, start_date, end_date')
      .eq('member_id', ctx.org.memberId)
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
      .maybeSingle(),
  ]);

  return success({
    date: today,
    record: record ?? null,
    onLeave: leave ?? null,
    // Returned rather than derived on the client, so the button offered always
    // matches what the server will accept.
    canCheckIn: !record?.checked_in_at && !leave,
    canCheckOut: !!record?.checked_in_at && !record?.checked_out_at,
  });
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;

  const body = acceptBody(await req.json().catch(() => ({})));
  const action = body?.action;

  if (action !== 'in' && action !== 'out') {
    return error('action must be "in" or "out"', 422, 'VALIDATION_ERROR');
  }

  const { data, error: e } =
    action === 'in'
      ? await ctx.supabase.rpc('clock_in', {
          org: ctx.org.organizationId,
          remote: body?.remote === true,
        })
      : await ctx.supabase.rpc('clock_out', { org: ctx.org.organizationId });

  if (e) {
    // The functions raise check_violation with a written explanation
    // ("already checked in today", "on approved leave"). Surface it rather
    // than replacing it with a generic failure.
    return pgError(e);
  }

  return success(Array.isArray(data) ? data[0] : data, undefined, action === 'in' ? 201 : 200);
}
