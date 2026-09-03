import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { EXIT_TYPES } from '@/lib/hr';

const SELECT =
  '*, member:organization_members!employee_exits_member_id_fkey(id, status, is_active, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'checklist:employee_checklists(id, status, name, anchor_date, ' +
  'items:employee_checklist_items(id, title, is_done, due_on, category))';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('employee_exits').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of ['notified_on', 'last_working_day', 'reason', 'exit_interview', 'checklist_id']) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    for (const k of ['reason', 'exit_interview']) {
      if (k in update && update[k] === null) update[k] = '';
    }
    if ('last_working_day' in update && !update.last_working_day) {
      return error('A last working day is required', 422, 'VALIDATION_ERROR');
    }

    if ('exit_type' in b) {
      if (!(EXIT_TYPES as readonly string[]).includes(String(b.exit_type))) {
        return error(`Exit type must be one of: ${EXIT_TYPES.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.exit_type = b.exit_type;
    }

    if ('is_rehirable' in b) {
      update.is_rehirable = typeof b.is_rehirable === 'boolean' ? b.is_rehirable : null;
    }

    /**
     * `account_closed_at` is HR's note that an administrator has since closed
     * the account, so the offboarding screen can stop saying "access is still
     * open". It records a fact about the identity lifecycle; it does not
     * perform one, and writing it here changes nobody's access.
     */
    if ('account_closed' in b) {
      update.account_closed_at = b.account_closed === true ? new Date().toISOString() : null;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('employee_exits').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

/**
 * Withdraw an exit.
 *
 * People do change their minds, and a resignation retracted in week one should
 * not leave the person permanently marked as leaving. Removing the row puts
 * them back to `active`; the `offboarded` employment event stays, because it
 * happened.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: existing } = await ctx.supabase
    .from('employee_exits').select('member_id')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');

  const { error: e } = await ctx.supabase
    .from('employee_exits').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);

  const { error: re } = await ctx.supabase.rpc('apply_employment_change', {
    p_member: existing.member_id,
    p_kind: 'stage_change',
    p_effective: null,
    p_job_title: null,
    p_department: null,
    p_manager: null,
    p_employment_type: null,
    p_stage: 'active',
    p_reason: 'Exit withdrawn',
    p_note: '',
    p_details: {},
  });

  /* The stage may already be `active` - somebody deleting an exit twice, or a
     membership that was reinstated in between - and the function refuses a
     no-op. That refusal is correct and is not a failure of this request. */
  return success({ deleted: true, reinstated: !re });
}
