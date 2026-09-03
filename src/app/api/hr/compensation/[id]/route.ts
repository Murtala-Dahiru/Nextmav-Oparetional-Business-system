import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { PAY_PERIODS, COMP_CHANGE_REASONS } from '@/lib/hr';

const SELECT =
  '*, member:organization_members!compensation_records_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url))';

type Params = { params: Promise<{ id: string }> };

/**
 * Correcting a pay record, and removing one entered by mistake.
 *
 * `compensation_records_update` and `_delete` have existed since 0042 and had
 * no endpoint - which is this repository's dominant defect in miniature, and
 * was found the ordinary way: the verification harness could create a record
 * and had no way to take it back, so a second run collided with the first on
 * the unique key.
 *
 * ── Correction is a real operation, and it is not a pay rise ─────────────
 *
 * A salary typed with a digit missing is a mistake, not a decision, and the
 * effective-dated history is the wrong place to record it twice. So HR may
 * amend a record - the audit log keeps the before and after, as it does for
 * every table - while a *change* in what somebody is paid remains a new row
 * with its own start date, which is what POST does.
 *
 * The one thing this cannot do is undo a payslip. `payroll_items.workings`
 * froze the figures at the moment the run was calculated, so amending the
 * compensation a paid run read changes nothing that has already been paid.
 * That is the point of freezing them.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('base_amount' in b) {
      const amount = Number(b.base_amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return error('A base amount cannot be negative.', 422, 'VALIDATION_ERROR');
      }
      update.base_amount = amount;
    }

    if ('pay_period' in b) {
      if (!(PAY_PERIODS as readonly string[]).includes(String(b.pay_period))) {
        return error(`Pay period must be one of: ${PAY_PERIODS.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.pay_period = b.pay_period;
    }

    if ('change_reason' in b) {
      if (!(COMP_CHANGE_REASONS as readonly string[]).includes(String(b.change_reason))) {
        return error(`Reason must be one of: ${COMP_CHANGE_REASONS.join(', ')}.`, 422, 'VALIDATION_ERROR');
      }
      update.change_reason = b.change_reason;
    }

    for (const k of ['note', 'currency', 'effective_from', 'effective_to']) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if ('note' in update && update.note === null) update.note = '';

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('compensation_records').update(update)
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
 * Remove a record, and reopen the one it closed.
 *
 * Deleting the current record without reopening its predecessor would leave
 * the person with a salary history that stops - and a pay run reading "the
 * record in force on the pay date" would then find nothing and exclude them
 * from payroll silently. So the row before it gets its `effective_to` back.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: existing } = await ctx.supabase
    .from('compensation_records').select('id, member_id, effective_from')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (!existing) return error('Not found', 404, 'NOT_FOUND');

  const { error: e } = await ctx.supabase
    .from('compensation_records').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);

  const { data: previous } = await ctx.supabase
    .from('compensation_records')
    .select('id, effective_to')
    .eq('organization_id', ctx.org.organizationId)
    .eq('member_id', existing.member_id)
    .lt('effective_from', existing.effective_from)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  let reopened = false;
  if (previous?.id && previous.effective_to) {
    const { error: re } = await ctx.supabase
      .from('compensation_records')
      .update({ effective_to: null })
      .eq('id', previous.id);
    reopened = !re;
  }

  return success({ deleted: true, reopenedPrevious: reopened });
}
