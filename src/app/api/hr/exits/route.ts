import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import { EXIT_TYPES } from '@/lib/hr';

const SELECT =
  '*, member:organization_members!employee_exits_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url), ' +
  'department:departments(id, name)), ' +
  'checklist:employee_checklists(id, status, name, anchor_date), ' +
  'recorder:organization_members!employee_exits_recorded_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name))';

/**
 * Exits.
 *
 * HR and administrators only, at every command - unlike a checklist, this
 * carries the company's account of why somebody left and whether it would take
 * them back, which is not a record its subject reads in a self-service screen
 * and not a manager's either.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('employee_exits').select(SELECT)
    .eq('organization_id', ctx.org.organizationId);

  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);

  const from = searchParams.get('from');
  if (from) q = q.gte('last_working_day', from);

  const { data, error: e } = await q
    .order('last_working_day', { ascending: false }).limit(200);

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Record an exit, and stage the offboarding.
 *
 * Two things happen by trigger the moment this row lands: the person moves to
 * `notice_period` (or `offboarding` if the last day has passed) and an
 * `offboarded` employment event is written. What does **not** happen is the
 * account closing - see the note on the response's `accountAction`.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    if (!b.member_id) return error('An employee is required', 422, 'VALIDATION_ERROR');
    if (!b.last_working_day) {
      return error('A last working day is required', 422, 'VALIDATION_ERROR');
    }

    const exitType = String(b.exit_type ?? 'resignation');
    if (!(EXIT_TYPES as readonly string[]).includes(exitType)) {
      return error(`Exit type must be one of: ${EXIT_TYPES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    if (b.member_id === ctx.org.memberId) {
      return error(
        'Somebody else has to record your leaving. Ask a colleague in HR.',
        422, 'SELF_EXIT',
      );
    }

    const { data: existing } = await ctx.supabase
      .from('employee_exits').select('id')
      .eq('organization_id', ctx.org.organizationId).eq('member_id', b.member_id)
      .maybeSingle();

    if (existing) {
      return error(
        'This employment already has an exit recorded. Edit it rather than adding a second.',
        409, 'ALREADY_EXITING',
      );
    }

    const { data, error: e } = await ctx.supabase
      .from('employee_exits')
      .insert({
        organization_id: ctx.org.organizationId,
        member_id: b.member_id,
        exit_type: exitType,
        notified_on: b.notified_on || undefined,
        last_working_day: b.last_working_day,
        reason: b.reason ?? '',
        is_rehirable: typeof b.is_rehirable === 'boolean' ? b.is_rehirable : null,
        exit_interview: b.exit_interview ?? '',
        recorded_by: ctx.org.memberId,
      })
      .select('id')
      .single();

    if (e) return pgError(e);

    /* An offboarding checklist, when a template was named - anchored on the
       last working day, so "return equipment, day 0" means their last day. */
    let checklist = null;
    if (b.template_id) {
      const { data: list, error: le } = await ctx.supabase.rpc('start_employee_checklist', {
        p_member: b.member_id,
        p_kind: 'offboarding',
        p_template: b.template_id,
        p_anchor: b.last_working_day,
        p_name: null,
      });
      if (!le && list) {
        checklist = list;
        await ctx.supabase.from('employee_exits')
          .update({ checklist_id: (list as any).id }).eq('id', data.id);
      }
    }

    const { data: full } = await ctx.supabase
      .from('employee_exits').select(SELECT).eq('id', data.id).maybeSingle();

    return success(
      {
        exit: full ?? data,
        checklist,
        /**
         * What this endpoint deliberately did not do.
         *
         * Suspension, termination and session revocation are the identity
         * lifecycle's, and it stays the only door to them - an HR checklist
         * that could close an account as a side effect of a row being written
         * would be a second way into the most consequential action in the
         * product. The screen renders this as the next step, with a link to
         * the account controls, so the absence is visible rather than assumed.
         */
        accountAction: {
          required: true,
          message:
            'Their access is still open. An administrator closes the account from ' +
            'the employee record when the time comes - this record does not do it.',
        },
      },
      undefined,
      201,
    );
  } catch (e: any) {
    return serverError(e, 'Could not record the exit');
  }
}
