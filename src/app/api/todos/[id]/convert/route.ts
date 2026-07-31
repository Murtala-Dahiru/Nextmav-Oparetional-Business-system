import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { can } from '@/lib/permissions';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Promote a private note into work the team can see.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this direction needed an endpoint of its own ─────────────────────
 *
 *  The bridge already ran one way: "pin a task" copies an assigned project
 *  task onto your list so you can plan around it. The other way is the one
 *  that happens more often and had no path at all — you write "chase the
 *  Henderson quote" to yourself, it turns out to be two days of work, and it
 *  now belongs to a project where somebody else can see it.
 *
 *  Without this, that transition is: retype the title into the Projects task
 *  dialog, fill in the fields, then come back and delete the to-do. Three
 *  screens, and in practice the to-do is never deleted, so the same work
 *  exists twice with two different states.
 *
 *  ── What it deliberately does not do ─────────────────────────────────────
 *
 *  The to-do is **kept**, not consumed, and linked to the new task through the
 *  `linked_task_id` the pin flow already uses. Deleting somebody's private
 *  note as a side effect of a different action is the kind of surprise this
 *  table exists to avoid, and after conversion the note is still how they plan
 *  their own day. The two stay independent exactly as a pinned task does:
 *  ticking the to-do off does not complete the task.
 *
 *  ── Access ───────────────────────────────────────────────────────────────
 *
 *  `mywork.view` to read your own to-do, and `projects.create` to make a task
 *  — checked separately, because most roles hold the first and not every role
 *  holds the second. A finance clerk keeping a to-do list must not be able to
 *  write into a project through the side door.
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  if (!can(ctx.org.role, 'projects', 'create')) {
    return error(
      `Your role (${ctx.org.role}) cannot create project tasks. The to-do stays on your list.`,
      403, 'FORBIDDEN',
    );
  }

  const b = acceptBody(await req.json().catch(() => ({})));
  const projectId = b.project_id || null;
  if (!projectId) {
    return error('Choose the project this belongs to.', 422, 'PROJECT_REQUIRED');
  }

  const { data: todo, error: readError } = await ctx.supabase
    .from('todos')
    .select('id, title, note, due_on, is_done, linked_task_id')
    .eq('member_id', ctx.org.memberId).eq('id', id)
    .maybeSingle();

  if (readError) return pgError(readError);
  if (!todo) return error('Not found', 404, 'NOT_FOUND');

  /**
   * Converting twice would leave two tasks for one note and no way to tell
   * which the team is working from.
   */
  if (todo.linked_task_id) {
    return error(
      'This to-do is already linked to a project task.',
      409, 'ALREADY_LINKED',
    );
  }

  // RLS would refuse a project in another tenant anyway; checking here makes
  // the failure a sentence rather than a foreign-key violation.
  const { data: project } = await ctx.supabase
    .from('projects').select('id, name')
    .eq('organization_id', ctx.org.organizationId).eq('id', projectId)
    .is('deleted_at', null).maybeSingle();

  if (!project) return error('That project is not one you can see.', 404, 'PROJECT_NOT_FOUND');

  const { data: task, error: taskError } = await ctx.supabase
    .from('tasks')
    .insert({
      organization_id: ctx.org.organizationId,
      project_id: project.id,
      title: todo.title,
      description: todo.note ?? '',
      // Assigned to the person who wrote it. They are already doing it; making
      // them pick themselves from a list would be a question with one answer.
      assignee_id: ctx.org.memberId,
      status: todo.is_done ? 'done' : 'todo',
      priority: b.priority ?? 'medium',
      due_date: todo.due_on ?? null,
    })
    .select('id, title, status, due_date, project:projects(id, name)')
    .single();

  if (taskError) return pgError(taskError);

  const { data: linked, error: linkError } = await ctx.supabase
    .from('todos')
    .update({ linked_task_id: task.id })
    .eq('member_id', ctx.org.memberId).eq('id', id)
    .select('id, linked_task_id')
    .maybeSingle();

  if (linkError) return pgError(linkError);

  return success({ task, todo: linked }, undefined, 201);
}
