import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { endMemberSessions } from '@/lib/account-state';

type Params = { params: Promise<{ id: string }> };

/**
 * One employee, with the HR context that makes the profile page useful:
 * recent attendance, leave, and their balances.
 *
 * Each query is scoped by RLS through `auth_visible_member_ids()`, so an
 * employee opening this route for a colleague gets the directory entry but no
 * attendance or leave detail — the personal data stays personal without this
 * handler having to decide that itself.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: person, error: e } = await ctx.supabase
    .from('v_org_directory')
    .select('*')
    .eq('organization_id', ctx.org.organizationId)
    .eq('member_id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!person) return error('Not found', 404, 'NOT_FOUND');

  const [attendance, leave, balances] = await Promise.all([
    ctx.supabase.from('attendance_records')
      .select('work_date, status, checked_in_at, checked_out_at, worked_minutes, late_minutes')
      .eq('member_id', id).order('work_date', { ascending: false }).limit(30),
    ctx.supabase.from('leave_requests')
      .select('id, type, status, start_date, end_date, days_requested, reason')
      .eq('member_id', id).order('start_date', { ascending: false }).limit(10),
    ctx.supabase.from('leave_balances')
      .select('type, year, entitled_days, used_days, carried_days')
      .eq('member_id', id).eq('year', new Date().getFullYear()),
  ]);

  return success({
    ...person,
    attendance: attendance.data ?? [],
    leave: leave.data ?? [],
    leaveBalances: balances.data ?? [],
  });
}

/**
 * Update employment details.
 *
 * Requires `manage`: changing someone's role, department or reporting line is
 * an administrative act. Personal fields (name, avatar, phone) belong to the
 * person and are edited through their own profile, not here.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};
    for (const k of [
      'role', 'department_id', 'manager_id', 'employee_number',
      'employment_type', 'hired_on', 'is_active',
    ]) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    // Someone cannot be their own manager; the reporting chain would loop and
    // approval routing would never terminate.
    if (update.manager_id && update.manager_id === id) {
      return error('A person cannot report to themselves.', 422, 'INVALID_MANAGER');
    }

    // A permanently deleted account has no auth identity left; editing its
    // employment details produces a directory entry nobody can sign in as.
    const { data: before } = await ctx.supabase
      .from('organization_members').select('deleted_at, is_active')
      .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();
    if (before?.deleted_at) {
      return error(
        'This account was permanently deleted and cannot be changed.',
        409, 'ACCOUNT_DELETED',
      );
    }

    const { data, error: e } = await ctx.supabase
      .from('organization_members')
      .update(update)
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    // The last-owner trigger surfaces here as a check violation with a written
    // message, which pgError passes through unchanged.
    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');

    // Deactivating through this form is the same act as terminating through
    // the button, and has to end their sessions for the same reason.
    let sessionsRevoked = false;
    if (before?.is_active && data.is_active === false) {
      sessionsRevoked = (await endMemberSessions(ctx.supabase, ctx.org.organizationId, id)).revoked;
    }

    return success({ ...data, sessionsRevoked });
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

/**
 * End someone's access. Deactivate rather than delete: history must keep
 * pointing at a real row, and sixteen NOT NULL columns cascade from this one.
 *
 * `?mode=terminate` records that employment ended rather than that access was
 * paused — the same access decision, a different fact, and reporting needs to
 * tell them apart. HR is where a termination is normally entered, so this is
 * the route that most needs the distinction.
 *
 * Without a mode it writes `is_active` alone, exactly as before. 0012's trigger
 * only downgrades to suspended *from active*, so calling this on someone
 * already terminated leaves their departure recorded as a departure; sending
 * `status: 'suspended'` outright would rewrite it.
 *
 * Permanent deletion of the account itself is an administrative act, not an HR
 * one, and lives at `DELETE /api/admin/users/[id]/account`.
 */
export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  if (id === ctx.org.memberId) {
    return error('You cannot deactivate your own membership.', 409, 'SELF_REMOVAL');
  }

  const terminating = new URL(req.url).searchParams.get('mode') === 'terminate';

  const { data, error: e } = await ctx.supabase
    .from('organization_members')
    .update(terminating ? { status: 'terminated' } : { is_active: false })
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id, status')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');

  /**
   * The half that was missing.
   *
   * Setting `is_active = false` stopped the next request resolving an
   * organization; it left the refresh token in their browser alive, and
   * Supabase renews those indefinitely. Terminating someone in HR has to
   * actually sign them out.
   */
  const sessions = await endMemberSessions(ctx.supabase, ctx.org.organizationId, id);

  return success({
    deactivated: true,
    status: data.status,
    sessionsRevoked: sessions.revoked,
    warning: sessions.warning,
  });
}
