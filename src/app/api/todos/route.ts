import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { todayIn, startOfDayIn } from '@/lib/org-time';
import { acceptBody } from '@/lib/case';
import { readRecurrence } from '@/lib/todo-recurrence';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Personal to-dos — "My Work"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately not the tasks endpoint, and deliberately smaller than it.
 *
 * A project task is work the organization is tracking: it has an assignee, a
 * reporter, a status the team agreed on, an estimate, a place in a plan, and
 * it moves reports and burndown charts. A to-do is a private note somebody
 * wrote to themselves — "call the client back", "read the contract before
 * Thursday". Those are different objects with different rules, and collapsing
 * them is how you end up with software where ticking off a personal reminder
 * changes a project's reported progress.
 *
 * So this endpoint has no assignee parameter, no status vocabulary, no
 * estimated or logged hours, no milestone and no priority. It has a title, a
 * checkbox, optionally a day, optionally a list, and a star.
 *
 * ── Access ────────────────────────────────────────────────────────────────
 *
 * Guarded on `mywork`, its own module, which every internal role holds and no
 * client does. Not on `projects`: an HR officer or a finance clerk with no
 * project rights at all still has their own work to organise, and a customer
 * has no business having a to-do list inside their supplier's system.
 *
 * Every query is filtered to the caller's own membership, and the RLS policy
 * enforces the same with no administrator exception. That is unusual in this
 * schema and intentional: a private checklist a manager can read is one nobody
 * will use honestly, which makes the feature worthless rather than merely
 * intrusive.
 */

const SELECT =
  'id, title, note, is_done, completed_at, due_on, is_starred, sort_order, ' +
  'list_id, linked_task_id, recurrence, created_at, updated_at, ' +
  'list:todo_lists(id, name, color), ' +
  // The linked task is read-only context: what the assigned work is called and
  // where it stands, so the list can show it without a second request.
  'linkedTask:tasks(id, title, status, due_date, project:projects(id, name))';

export async function GET(req: Request) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('todos')
    .select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .eq('member_id', ctx.org.memberId);

  /**
   * Views, not filters.
   *
   * These are the four questions anyone asks their own list, expressed as
   * named views rather than left to the client to assemble out of query
   * parameters — so "today" means the same thing everywhere it appears,
   * including on the dashboard widget.
   */
  const view = searchParams.get('view');
  // The organisation's today. "Due today" has to mean the same day the person
  // reading the list is living in, not UTC's.
  const today = todayIn(ctx.org.timezone);

  switch (view) {
    case 'today':
      // Due today *or* already overdue: an overdue item that drops off today's
      // list is an item nobody ever does.
      q = q.eq('is_done', false).lte('due_on', today).not('due_on', 'is', null);
      break;
    case 'upcoming':
      q = q.eq('is_done', false).gt('due_on', today);
      break;
    case 'starred':
      q = q.eq('is_done', false).eq('is_starred', true);
      break;
    case 'done':
      q = q.eq('is_done', true);
      break;
    case 'all':
      break;
    default:
      // The default list is what is still to do. Completed items are history.
      q = q.eq('is_done', false);
  }

  const listId = searchParams.get('listId') ?? searchParams.get('list_id');
  if (listId) {
    q = listId === 'none' ? q.is('list_id', null) : q.eq('list_id', listId);
  }

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) q = q.or(`title.ilike.%${safe}%,note.ilike.%${safe}%`);
  }

  const { data, error: e } = await q
    // Starred first, then by the day it is due, then by hand-ordering. An
    // undated item sorts last rather than first — it is the least urgent thing
    // on the list, not the most.
    .order('is_starred', { ascending: false })
    .order('due_on', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(500);

  if (e) return pgError(e);

  /**
   * Counts for the view switcher.
   *
   * Computed from the returned rows only when the caller asked for everything;
   * otherwise a separate cheap count, because a badge that reflects the
   * current filter rather than the whole list is a badge that lies.
   */
  const [openCount, todayCount, starredCount, doneTodayCount] = await Promise.all([
    ctx.supabase.from('todos').select('id', { count: 'exact', head: true })
      .eq('member_id', ctx.org.memberId).eq('is_done', false),
    ctx.supabase.from('todos').select('id', { count: 'exact', head: true })
      .eq('member_id', ctx.org.memberId).eq('is_done', false)
      .lte('due_on', today).not('due_on', 'is', null),
    ctx.supabase.from('todos').select('id', { count: 'exact', head: true })
      .eq('member_id', ctx.org.memberId).eq('is_done', false).eq('is_starred', true),
    /**
     * What was finished today, for the day's progress.
     *
     * Counted here rather than from the rows returned, because the default
     * view excludes completed items — deriving it on the client would show
     * "0 done today" to somebody who had just spent the morning clearing
     * their list, which is the most demoralising possible reading.
     *
     * `completed_at` is a `timestamptz` stamped by a trigger, so the bound is
     * the *instant* local midnight happened rather than a date string.
     */
    ctx.supabase.from('todos').select('id', { count: 'exact', head: true })
      .eq('member_id', ctx.org.memberId).eq('is_done', true)
      .gte('completed_at', startOfDayIn(ctx.org.timezone)),
  ]);

  return success(data ?? [], {
    counts: {
      open: openCount.count ?? 0,
      today: todayCount.count ?? 0,
      starred: starredCount.count ?? 0,
      doneToday: doneTodayCount.count ?? 0,
    },
  });
}

/**
 * Add something to your own list.
 *
 * `member_id` comes from the session and is never accepted from the body —
 * writing a to-do onto somebody else's list is the one thing this feature must
 * never permit, because the moment it can, it stops being personal and becomes
 * a second, worse task system.
 */
export async function POST(req: Request) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const title = String(b.title ?? '').trim();
    if (!title) return error('A to-do needs a title', 422, 'VALIDATION_ERROR');

    // A list you do not own is not a list you can file into.
    let listId: string | null = b.list_id || null;
    if (listId) {
      const { data: list } = await ctx.supabase
        .from('todo_lists').select('id')
        .eq('member_id', ctx.org.memberId).eq('id', listId).maybeSingle();
      if (!list) return error('That list does not exist on your account.', 404, 'LIST_NOT_FOUND');
    }

    /**
     * Pinning an assigned task onto your own list.
     *
     * Checked against tasks you can actually see. The link is one-way and
     * inert: completing the to-do does not complete the task, because "I have
     * planned my day around this" and "the work is finished" are different
     * statements and only the second belongs to the team.
     */
    let linkedTaskId: string | null = b.linked_task_id || null;
    if (linkedTaskId) {
      const { data: task } = await ctx.supabase
        .from('tasks').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', linkedTaskId)
        .is('deleted_at', null).maybeSingle();
      if (!task) return error('That task is not one you can see.', 404, 'TASK_NOT_FOUND');
    }

    const dueOn = b.due_on || null;
    const recurrence = readRecurrence(b.recurrence, dueOn);
    if ('message' in recurrence) return error(recurrence.message, 422, 'INVALID_RECURRENCE');

    const { data, error: e } = await ctx.supabase
      .from('todos')
      .insert({
        organization_id: ctx.org.organizationId,
        member_id: ctx.org.memberId,
        title,
        note: b.note ?? '',
        due_on: dueOn,
        is_starred: b.is_starred === true,
        list_id: listId,
        linked_task_id: linkedTaskId,
        recurrence: recurrence.value,
        sort_order: Number(b.sort_order) || 0,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add the to-do');
  }
}

/**
 * Reorder the list.
 *
 * A batch of ids in their new order, because dragging one item changes the
 * position of everything below it and issuing one request per row would make
 * a five-item reorder five round trips that can half-fail.
 */
export async function PATCH(req: Request) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    const order: string[] = Array.isArray(b.order) ? b.order.filter(Boolean) : [];
    if (!order.length) return error('Send an "order" array of to-do ids', 422, 'VALIDATION_ERROR');
    if (order.length > 500) return error('Too many items to reorder at once', 422, 'TOO_MANY');

    /**
     * Every id must be one of yours before anything is written.
     *
     * Verified up front rather than relying on each update matching nothing:
     * a partial reorder leaves the list in an order the user did not ask for
     * and cannot undo, which is worse than refusing outright.
     */
    const { data: owned } = await ctx.supabase
      .from('todos').select('id')
      .eq('member_id', ctx.org.memberId).in('id', order);

    if ((owned ?? []).length !== order.length) {
      return error('That reorder refers to a to-do that is not yours.', 403, 'NOT_YOURS');
    }

    await Promise.all(
      order.map((id, index) =>
        ctx.supabase.from('todos').update({ sort_order: index })
          .eq('member_id', ctx.org.memberId).eq('id', id),
      ),
    );

    return success({ reordered: order.length });
  } catch (e: any) {
    return serverError(e, 'Could not reorder');
  }
}
