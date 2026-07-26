import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * One personal to-do.
 *
 * Every query carries `member_id = <caller>` in addition to the RLS policy.
 * Belt and braces on this table specifically, because it is the one place in
 * the schema where an administrator has no override — if a filter were ever
 * dropped here, RLS is the only thing standing between a private list and the
 * rest of the company.
 */

type Params = { params: Promise<{ id: string }> };

const SELECT =
  'id, title, note, is_done, completed_at, due_on, is_starred, sort_order, ' +
  'list_id, linked_task_id, created_at, updated_at, ' +
  'list:todo_lists(id, name, color), ' +
  'linkedTask:tasks(id, title, status, due_date, project:projects(id, name))';

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('todos').select(SELECT)
    .eq('member_id', ctx.org.memberId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('title' in b) {
      const title = String(b.title ?? '').trim();
      if (!title) return error('A to-do needs a title', 422, 'VALIDATION_ERROR');
      update.title = title;
    }
    if ('note' in b) update.note = String(b.note ?? '');
    if ('due_on' in b) update.due_on = b.due_on || null;
    if ('is_starred' in b) update.is_starred = b.is_starred === true;
    if ('sort_order' in b) update.sort_order = Number(b.sort_order) || 0;

    /**
     * The checkbox.
     *
     * Only the flag is accepted; `completed_at` is stamped by a trigger. A
     * client choosing when something was completed would let a list be
     * backdated, and the timestamp is what any future "what did I get done
     * this week" view would count.
     */
    if ('is_done' in b) update.is_done = b.is_done === true;

    if ('list_id' in b) {
      const listId = b.list_id || null;
      if (listId) {
        const { data: list } = await ctx.supabase
          .from('todo_lists').select('id')
          .eq('member_id', ctx.org.memberId).eq('id', listId).maybeSingle();
        if (!list) return error('That list does not exist on your account.', 404, 'LIST_NOT_FOUND');
      }
      update.list_id = listId;
    }

    if ('linked_task_id' in b) {
      const taskId = b.linked_task_id || null;
      if (taskId) {
        const { data: task } = await ctx.supabase
          .from('tasks').select('id')
          .eq('organization_id', ctx.org.organizationId).eq('id', taskId)
          .is('deleted_at', null).maybeSingle();
        if (!task) return error('That task is not one you can see.', 404, 'TASK_NOT_FOUND');
      }
      update.linked_task_id = taskId;
    }

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase
      .from('todos').update(update)
      .eq('member_id', ctx.org.memberId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

export { PATCH as PUT };

/**
 * Delete a to-do outright.
 *
 * Hard, unlike almost everything else in this schema. Nothing references a
 * to-do, it is not a business record, and it carries no audit obligation —
 * keeping a tombstone of someone's deleted private reminder would be a
 * surprising thing for the product to do.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('todos').delete()
    .eq('member_id', ctx.org.memberId).eq('id', id)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true });
}
