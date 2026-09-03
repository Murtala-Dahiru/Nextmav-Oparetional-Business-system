import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT = '*';

type Params = { params: Promise<{ id: string }> };

/**
 * Amend or end a component.
 *
 * Ending one is the ordinary case, and it is `effective_to`, not a delete: an
 * allowance that was paid for eight months is part of what somebody earned, and
 * removing the row would make last year's payslips unexplainable. Delete is
 * reserved for a component created by mistake and never used.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of ['label', 'note', 'effective_from', 'effective_to']) {
      if (k in b) update[k] = b[k] === '' ? null : b[k];
    }
    if ('note' in update && update.note === null) update.note = '';
    if ('label' in update && !String(update.label ?? '').trim()) {
      return error('A label is required', 422, 'VALIDATION_ERROR');
    }
    if ('is_taxable' in b) update.is_taxable = b.is_taxable !== false;

    if ('amount' in b) {
      const amount = b.amount === '' || b.amount === null ? null : Number(b.amount);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        return error('An amount cannot be negative.', 422, 'VALIDATION_ERROR');
      }
      update.amount = amount;
    }
    if ('rate' in b) {
      const rate = b.rate === '' || b.rate === null ? null : Number(b.rate);
      if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 10)) {
        return error('A percentage is a fraction: 0.25 for 25%.', 422, 'VALIDATION_ERROR');
      }
      update.rate = rate;
    }

    if (!Object.keys(update).length) {
      return error('Nothing to update', 422, 'VALIDATION_ERROR');
    }

    const { data, error: e } = await ctx.supabase
      .from('compensation_components').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    /* `comp_component_has_value` refuses a shape that computes nothing - a
       fixed component with its amount cleared, say. */
    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { error: e } = await ctx.supabase
    .from('compensation_components').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
