import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { ROADMAP_STAGES } from '@/lib/constants';
import { log, serializeError } from '@/lib/logger';

const SELECT =
  '*, project:projects(id, name, status), ' +
  'owner:organization_members!milestones_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'tasks(count)';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('milestones').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Amend a milestone, or mark it done.
 *
 * Completion is expressed as a boolean rather than by writing a timestamp:
 * `completed` is what the checkbox means, and letting a client choose the
 * moment a milestone completed would let the roadmap be backdated. The server
 * stamps `now()`, and unchecking clears it so a milestone reopened by mistake
 * does not keep a stale completion date.
 *
 * A hand-written handler rather than the shared factory because of that
 * translation, and because the completion notification below needs to know
 * whether this particular call is what closed it.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    for (const k of [
      'name', 'description', 'due_date', 'owner_id', 'sort_order', 'project_id',
      // Added with the roadmap in 0016.
      'start_date', 'stage', 'progress_pct',
    ] as const) {
      if (!(k in b)) continue;
      if (k === 'name') {
        if (!String(b.name ?? '').trim()) return error('Milestone name cannot be empty', 422, 'VALIDATION_ERROR');
        update.name = String(b.name).trim();
      } else if (k === 'sort_order') {
        update.sort_order = Number(b.sort_order) || 0;
      } else if (k === 'progress_pct') {
        update.progress_pct = Math.min(100, Math.max(0, Number(b.progress_pct) || 0));
      } else if (k === 'stage') {
        /**
         * Moving a phase along the roadmap.
         *
         * Rejected with the valid list rather than left to the CHECK
         * constraint, whose message names the constraint and not the mistake.
         *
         * Dragging a milestone into 'completed' is accepted and treated as
         * completing it - the trigger in 0016 keeps `stage` and `completed_at`
         * consistent in both directions, but it only fires on `completed_at`,
         * so the translation has to happen here for the drag to mean anything.
         */
        const stage = String(b.stage ?? '');
        if (!(ROADMAP_STAGES as readonly string[]).includes(stage)) {
          return error(
            `"${stage}" is not a roadmap phase. Expected one of: ${ROADMAP_STAGES.join(', ')}.`,
            422, 'INVALID_STAGE',
          );
        }
        update.stage = stage;
        if (stage === 'completed' && !('completed' in b)) {
          update.completed_at = new Date().toISOString();
        }
      } else {
        update[k] = b[k] || null;
      }
    }

    if (update.start_date && update.due_date && update.due_date < update.start_date) {
      return error('A phase cannot be due before it starts', 422, 'VALIDATION_ERROR');
    }

    if ('completed' in b) {
      update.completed_at = b.completed ? new Date().toISOString() : null;
    }

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    // Read first, so the notification can tell a genuine transition from a
    // repeated save of an already-complete milestone.
    const { data: before } = await ctx.supabase
      .from('milestones').select('id, name, project_id, completed_at')
      .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();
    if (!before) return error('Not found', 404, 'NOT_FOUND');

    const { data, error: e } = await ctx.supabase
      .from('milestones').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');

    const justCompleted = !before.completed_at && !!update.completed_at;
    if (justCompleted) await notifyMilestoneCompleted(ctx, before);

    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

/**
 * Tell the project's owner and team that a phase closed.
 *
 * Written here rather than as a database trigger, unlike task assignment,
 * because the recipient list is the project's team - a set this function can
 * read cheaply, where a trigger would need its own query per row and would
 * fire for bulk corrections too.
 *
 * Failures are logged, never surfaced: the milestone is genuinely complete by
 * this point, and reporting an error would invite the user to click again and
 * complete it twice.
 */
async function notifyMilestoneCompleted(
  ctx: { supabase: any; org: { organizationId: string; memberId: string } },
  milestone: { id: string; name: string; project_id: string },
) {
  try {
    const { data: project } = await ctx.supabase
      .from('projects').select('id, name, owner_id')
      .eq('id', milestone.project_id).maybeSingle();

    const { data: team } = await ctx.supabase
      .from('project_members').select('member_id')
      .eq('project_id', milestone.project_id);

    const recipients = new Set<string>();
    if (project?.owner_id) recipients.add(project.owner_id);
    for (const m of team ?? []) recipients.add(m.member_id);
    // Announcing your own action back to you is noise.
    recipients.delete(ctx.org.memberId);

    if (!recipients.size) return;

    await ctx.supabase.from('notifications').insert(
      [...recipients].map(recipient_id => ({
        organization_id: ctx.org.organizationId,
        recipient_id,
        type: 'milestone_completed',
        title: `Milestone complete: ${milestone.name}`,
        body: project?.name ? `${project.name} has reached a milestone.` : '',
        entity_type: 'milestone',
        entity_id: milestone.id,
      })),
    );
  } catch (e: any) {
    log.warn('milestone notification failed', { err: serializeError(e) });
  }
}

// The board sends PUT for a partial update, as the other record routes accept.
export { PATCH as PUT };

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  /**
   * Tasks are detached rather than deleted with the milestone.
   *
   * Dropping a phase from the plan does not mean the work under it stops
   * existing, and `tasks.milestone_id` is nullable precisely so a task can sit
   * outside any phase. Deleting the work with the label would be silent data
   * loss the user never asked for.
   */
  const { error: detachError } = await ctx.supabase
    .from('tasks').update({ milestone_id: null })
    .eq('organization_id', ctx.org.organizationId).eq('milestone_id', id);
  if (detachError) return pgError(detachError);

  const { data, error: e } = await ctx.supabase
    .from('milestones').delete()
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true, tasksDetached: true });
}
