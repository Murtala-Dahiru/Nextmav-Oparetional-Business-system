import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * What a task is waiting for, and what is waiting on it.
 *
 * ── Why this endpoint exists now ──────────────────────────────────────────
 *
 * `task_dependencies` has had a table, a self-reference guard and a row policy
 * since the first business migration, and in the whole product nothing has
 * ever written to it. "Blocked" was a status somebody set by hand, which says
 * that a task is stuck and never says what it is stuck behind - so the answer
 * lived in a comment, or in somebody's head.
 *
 * A dependency is the honest version of that: this task cannot start until
 * that one is done, stated once, visible from both ends, and true without
 * anybody remembering to update it.
 *
 * ── Both directions, one read ─────────────────────────────────────────────
 *
 * `blockedBy` is what this task waits for. `blocking` is what waits for it -
 * the question a person asks the moment they finish something, and the one
 * that decides whether finishing it matters today. They are the same table
 * read from either end, so they are answered together rather than by two
 * requests that can disagree.
 *
 * ── What this deliberately is not ─────────────────────────────────────────
 *
 * There is no scheduler behind it. Adding a dependency does not move dates,
 * does not reassign anybody and does not change a task's status: a product
 * that silently rewrites your plan because of an edge you drew is worse than
 * one that shows you the edge. The status a person sets stays the status.
 */

type Params = { params: Promise<{ id: string }> };

const TASK_SELECT =
  'id, title, status, priority, due_date, project_id, ' +
  'assignee:organization_members!tasks_assignee_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const [upstream, downstream] = await Promise.all([
    ctx.supabase
      .from('task_dependencies')
      .select(`id, depends_on:tasks!task_dependencies_depends_on_id_fkey(${TASK_SELECT})`)
      .eq('task_id', id),
    ctx.supabase
      .from('task_dependencies')
      .select(`id, task:tasks!task_dependencies_task_id_fkey(${TASK_SELECT})`)
      .eq('depends_on_id', id),
  ]);

  if (upstream.error) return pgError(upstream.error);
  if (downstream.error) return pgError(downstream.error);

  return success({
    blockedBy: (upstream.data ?? [])
      .map((r: any) => ({ id: r.id, task: r.depends_on }))
      .filter(r => r.task),
    blocking: (downstream.data ?? [])
      .map((r: any) => ({ id: r.id, task: r.task }))
      .filter(r => r.task),
  });
}

/**
 * Record that this task waits for another.
 *
 * Guarded on `edit` rather than `create`: drawing the edge is a fact about
 * work that already exists, and the people doing that work hold `edit`.
 *
 * The three ways this can be wrong are answered in three different places, and
 * all three are worth naming:
 *
 *   · the other task is in another tenant  - the row policy, since 0034;
 *   · the edge closes a loop               - a trigger, since 0034;
 *   · the edge already exists              - the unique constraint, since 0003.
 *
 * Each is translated into a sentence here, because "duplicate key value
 * violates unique constraint task_dependencies_task_id_depends_on_id_key" is
 * accurate and useless.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const dependsOnId = String(b.depends_on_id ?? '').trim();
    if (!dependsOnId) return error('Choose the task this one waits for.', 422, 'VALIDATION_ERROR');
    if (dependsOnId === id) return error('A task cannot wait for itself.', 422, 'SELF_DEPENDENCY');

    /**
     * Both tasks are read first, so the refusal can name them.
     *
     * The row policy would refuse a cross-tenant edge on its own, but it
     * refuses it as a policy violation - which reads to the caller as though
     * the product is broken rather than as though they picked the wrong task.
     */
    const { data: tasks, error: readError } = await ctx.supabase
      .from('tasks').select('id, title, project_id')
      .eq('organization_id', ctx.org.organizationId)
      .in('id', [id, dependsOnId])
      .is('deleted_at', null);

    if (readError) return pgError(readError);
    if ((tasks ?? []).length !== 2) {
      return error('One of those tasks is not in this organization.', 404, 'NOT_FOUND');
    }

    const { data, error: e } = await ctx.supabase
      .from('task_dependencies')
      .insert({ task_id: id, depends_on_id: dependsOnId })
      .select('id, task_id, depends_on_id')
      .single();

    if (e) {
      if (e.code === '23505') {
        return error('That dependency is already recorded.', 409, 'DUPLICATE_DEPENDENCY');
      }
      // The cycle trigger raises `check_violation` with its own sentence.
      if (e.code === '23514') {
        return error(e.message || 'That would make two tasks wait for each other.', 422, 'DEPENDENCY_CYCLE');
      }
      return pgError(e);
    }

    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not add that dependency');
  }
}

/**
 * Remove one edge.
 *
 * By the id of the dependency row, passed as `?edge=`, rather than by the pair
 * of task ids: the row has an identity and the client already holds it from
 * the GET, and a delete addressed by two foreign keys is one typo away from
 * removing the edge in the opposite direction.
 */
export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const edge = new URL(req.url).searchParams.get('edge');
  if (!edge) return error('Which dependency?', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('task_dependencies')
    .delete()
    // Named on both sides so a stale id from another task cannot delete an
    // edge this caller is not looking at.
    .eq('id', edge)
    .or(`task_id.eq.${id},depends_on_id.eq.${id}`)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true });
}
