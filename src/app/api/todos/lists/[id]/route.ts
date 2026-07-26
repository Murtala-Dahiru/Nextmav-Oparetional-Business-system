import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

const LIST_COLORS = ['slate', 'emerald', 'blue', 'amber', 'rose', 'violet'];

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('name' in b) {
      const name = String(b.name ?? '').trim();
      if (!name) return error('A list needs a name', 422, 'VALIDATION_ERROR');
      update.name = name;
    }
    if ('color' in b) {
      const color = String(b.color ?? '');
      if (!LIST_COLORS.includes(color)) {
        return error(
          `"${color}" is not one of the available colours: ${LIST_COLORS.join(', ')}.`,
          422, 'INVALID_COLOR',
        );
      }
      update.color = color;
    }
    if ('sort_order' in b) update.sort_order = Number(b.sort_order) || 0;

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase
      .from('todo_lists').update(update)
      .eq('member_id', ctx.org.memberId).eq('id', id)
      .select('id, name, color, sort_order').maybeSingle();

    if (e) {
      if (e.code === '23505') {
        return error('You already have a list with that name.', 409, 'DUPLICATE_LIST');
      }
      return pgError(e);
    }
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

export { PATCH as PUT };

/**
 * Delete a list.
 *
 * The to-dos inside it survive and become unfiled — `todos.list_id` is
 * `ON DELETE SET NULL` precisely so this is possible. Removing a folder is a
 * statement about the filing, not about the work, and cascading here would
 * quietly destroy someone's reminders because they tidied up.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { count } = await ctx.supabase
    .from('todos').select('id', { count: 'exact', head: true })
    .eq('member_id', ctx.org.memberId).eq('list_id', id);

  const { data, error: e } = await ctx.supabase
    .from('todo_lists').delete()
    .eq('member_id', ctx.org.memberId).eq('id', id)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true, todosUnfiled: count ?? 0 });
}
