import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

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
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

/** Deactivate rather than delete: history must keep pointing at a real row. */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  if (id === ctx.org.memberId) {
    return error('You cannot deactivate your own membership.', 409, 'SELF_REMOVAL');
  }

  const { data, error: e } = await ctx.supabase
    .from('organization_members')
    .update({ is_active: false })
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deactivated: true });
}
