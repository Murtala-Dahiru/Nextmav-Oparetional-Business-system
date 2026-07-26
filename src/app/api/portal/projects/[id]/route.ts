import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * One project, as the client sees it.
 *
 * The internal counterpart is `/api/projects/projects/[id]/overview`, and the
 * difference between them is the whole design of the portal:
 *
 *   internal                        client
 *   ────────────────────────────    ────────────────────────────
 *   every task, with assignees      no tasks at all
 *   budget, logged hours            neither
 *   all files                       files marked client-visible
 *   the whole discussion            comments marked client-visible
 *   risks and blockers, derived     the health verdict only
 *   team with allocations           who to talk to
 *
 * A client is shown the plan and the outcome, not the execution. Task-level
 * detail invites a customer to manage the team, budget figures invite a
 * negotiation nobody scheduled, and an unfiltered discussion means the team
 * cannot talk candidly on their own project — which ends with the real
 * conversation moving somewhere the record does not reach.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  /**
   * Read through the portal view, not the projects table.
   *
   * The view already carries the client-appropriate column list, so a column
   * added to `projects` later — a margin, an internal note — cannot leak into
   * the portal by default. Opt-in beats opt-out for anything customer-facing.
   */
  const { data: project, error: e } = await ctx.supabase
    .from('v_client_portal_projects')
    .select('*')
    .eq('organization_id', ctx.org.organizationId)
    .eq('project_id', id)
    .maybeSingle();

  if (e) return pgError(e);
  if (!project) return error('Not found', 404, 'NOT_FOUND');

  const [milestones, files, comments, events] = await Promise.all([
    // The roadmap in full, including phases that are late. Hiding those would
    // make the portal a marketing page; the client finds out anyway, and
    // finding out late is what damages the relationship.
    ctx.supabase
      .from('milestones')
      .select('id, name, description, stage, start_date, due_date, completed_at, progress_pct, sort_order')
      .eq('project_id', id)
      .order('sort_order')
      .order('due_date', { nullsFirst: false }),

    ctx.supabase
      .from('files')
      .select('id, filename, mime_type, size_bytes, folder, created_at')
      .eq('project_id', id)
      .eq('is_client_visible', true)
      .eq('is_confidential', false)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),

    ctx.supabase
      .from('comments')
      .select('id, body, created_at, edited_at, author:organization_members!comments_author_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('project_id', id)
      .eq('is_client_visible', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200),

    ctx.supabase
      .from('calendar_events')
      .select('id, title, description, starts_at, ends_at, location')
      .eq('project_id', id)
      .order('starts_at', { ascending: false })
      .limit(50),
  ]);

  const milestoneRows = milestones.data ?? [];
  const eventRows = events.data ?? [];

  const today = new Date().toISOString().slice(0, 10);

  /**
   * The timeline the client reads.
   *
   * Milestones and meetings only — the two things that were agreed with them.
   * Internal task movement is not part of the story a customer is owed.
   */
  const timeline = [
    ...(project.start_date
      ? [{ at: project.start_date, kind: 'project_start', title: 'Project started', detail: project.name }]
      : []),
    ...milestoneRows.map((m: any) => ({
      at: m.completed_at ? String(m.completed_at).slice(0, 10) : m.due_date,
      kind: m.completed_at
        ? 'milestone_completed'
        : (m.due_date && m.due_date < today ? 'milestone_overdue' : 'milestone_due'),
      title: m.name,
      detail: m.completed_at ? 'Delivered' : `Scheduled — ${m.stage}`,
      id: m.id,
    })),
    ...eventRows.map((ev: any) => ({
      at: String(ev.starts_at).slice(0, 10),
      kind: 'meeting',
      title: ev.title,
      detail: ev.location || 'Meeting',
      id: ev.id,
    })),
    ...(project.end_date
      ? [{ at: project.end_date, kind: 'project_end', title: 'Target completion', detail: project.name }]
      : []),
  ]
    .filter(t => !!t.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return success({
    project,
    milestones: milestoneRows,
    deliverables: files.data ?? [],
    messages: comments.data ?? [],
    meetings: eventRows,
    timeline,
    readOnly: true,
  });
}

/**
 * A client replying on their own project.
 *
 * The one write the portal permits, and it is narrow: a message on a project
 * that is theirs, authored as themselves, always client-visible. The RLS
 * policy `comments_client_insert` enforces every one of those independently,
 * so a malformed call here cannot widen it.
 *
 * A portal that only broadcasts is a portal customers stop opening — the
 * question they wanted to ask goes to email instead, and the project record
 * loses the thread.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const body = String(b.body ?? '').trim();
    if (!body) return error('A message cannot be empty', 422, 'VALIDATION_ERROR');

    // Confirms the project is genuinely theirs before writing, so a wrong id
    // is a clear 404 rather than an RLS rejection that reads as a server fault.
    const { data: project } = await ctx.supabase
      .from('v_client_portal_projects')
      .select('project_id, name')
      .eq('organization_id', ctx.org.organizationId)
      .eq('project_id', id)
      .maybeSingle();

    if (!project) return error('Not found', 404, 'NOT_FOUND');

    const { data, error: e } = await ctx.supabase
      .from('comments')
      .insert({
        organization_id: ctx.org.organizationId,
        author_id: ctx.org.memberId,
        project_id: id,
        body,
        // Always. A client cannot post an internal note, and the trigger that
        // notifies the project team reads this thread.
        is_client_visible: true,
        mentions: [],
      })
      .select('id, body, created_at, author:organization_members!comments_author_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Could not send the message', 500);
  }
}
