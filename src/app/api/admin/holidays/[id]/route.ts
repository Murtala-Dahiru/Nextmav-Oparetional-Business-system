import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('name' in b) {
      const name = String(b.name ?? '').trim();
      if (!name) return error('A holiday needs a name', 422, 'VALIDATION_ERROR');
      update.name = name;
    }
    if ('holiday_date' in b) {
      const date = String(b.holiday_date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return error('holidayDate must be a date, as YYYY-MM-DD', 422, 'VALIDATION_ERROR');
      }
      update.holiday_date = date;
    }
    if ('is_recurring' in b) update.is_recurring = b.is_recurring === true;
    if ('is_half_day' in b) update.is_half_day = b.is_half_day === true;
    if ('notes' in b) update.notes = String(b.notes ?? '');

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase
      .from('holidays').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select('id, name, holiday_date, is_recurring, is_half_day, notes').maybeSingle();

    if (e) {
      if (e.code === '23505') {
        return error('There is already a holiday on that date.', 409, 'DUPLICATE_HOLIDAY');
      }
      return pgError(e);
    }
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

export { PATCH as PUT };

/**
 * Remove a holiday.
 *
 * Hard delete. Leave already approved across the date keeps the attendance
 * rows it generated — those are a record of what was agreed at the time, and
 * silently re-consuming somebody's entitlement because an admin corrected the
 * calendar would be worse than the inconsistency.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('holidays').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true });
}
