import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { readRecurrence } from '@/lib/todo-recurrence';
import { readRemindAt } from '@/lib/todo-reminder';

/**
 * One personal to-do.
 *
 * Every query carries `member_id = <caller>` in addition to the RLS policy.
 * Belt and braces on this table specifically, because it is the one place in
 * the schema where an administrator has no override - if a filter were ever
 * dropped here, RLS is the only thing standing between a private list and the
 * rest of the company.
 */

type Params = { params: Promise<{ id: string }> };

const SELECT =
  'id, title, note, is_done, completed_at, due_on, is_starred, sort_order, ' +
  'list_id, linked_task_id, recurrence, remind_at, reminder_sent_at, ' +
  'source_module, source_type, source_id, source_label, created_at, updated_at, ' +
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

    /**
     * The reminder.
     *
     * `reminder_sent_at` is deliberately not accepted: a client that could
     * write it could mark a reminder delivered without delivering it, which is
     * the same class of thing as letting one choose `completed_at`. The trigger
     * clears it whenever `remind_at` moves, so snoozing re-arms without anyone
     * having to say so.
     */
    if ('remind_at' in b) {
      const parsed = readRemindAt(b.remind_at);
      if ('message' in parsed) return error(parsed.message, 422, 'INVALID_REMINDER');
      update.remind_at = parsed.value;
    }

    /**
     * The source is written once, at intake, and is not editable afterwards.
     *
     * Where a to-do came from is a fact about its history. Letting it be
     * changed would allow the chip on the row to point at a record the item
     * was never taken from, and - because a unique index enforces one personal
     * item per source - would let somebody move a duplicate onto a source that
     * already had one. Accepted here only so that a body carrying the fields
     * is refused loudly rather than silently ignored.
     */
    if ('source_module' in b || 'source_type' in b || 'source_id' in b) {
      return error(
        'Where a to-do came from cannot be changed after it was added.',
        422, 'SOURCE_IMMUTABLE',
      );
    }
    if ('source_label' in b) update.source_label = String(b.source_label ?? '').slice(0, 200) || null;

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

    /**
     * The repeat, and the date it repeats from.
     *
     * These two are validated together because they constrain each other: the
     * database refuses a recurrence with no due date, and clearing a due date
     * on a repeating item would leave a row the CHECK constraint rejects - a
     * 23514 the user would see as an unexplained failure.
     *
     * So the effective due date is resolved first, reading the stored one when
     * this request does not mention it, and the pair is judged as it will
     * actually be written.
     */
    if ('recurrence' in b || 'due_on' in b) {
      const { data: current } = await ctx.supabase
        .from('todos').select('due_on, recurrence')
        .eq('member_id', ctx.org.memberId).eq('id', id).maybeSingle();

      const effectiveDue = 'due_on' in b ? update.due_on : (current?.due_on ?? null);
      const effectiveRule = 'recurrence' in b ? b.recurrence : (current?.recurrence ?? null);

      const parsed = readRecurrence(effectiveRule, effectiveDue);
      if ('message' in parsed) {
        return error(
          // Clearing the date on a repeating item is the common way to hit
          // this, so the message names that case rather than the constraint.
          'due_on' in b && !effectiveDue && effectiveRule
            ? 'This to-do repeats, so it needs a date. Turn the repeat off to leave it undated.'
            : parsed.message,
          422, 'INVALID_RECURRENCE',
        );
      }
      update.recurrence = parsed.value;
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
    return serverError(e, 'Update failed');
  }
}

export { PATCH as PUT };

/**
 * Delete a to-do outright.
 *
 * Hard, unlike almost everything else in this schema. Nothing references a
 * to-do, it is not a business record, and it carries no audit obligation -
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
