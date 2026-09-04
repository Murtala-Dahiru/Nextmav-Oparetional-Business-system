import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { todayIn } from '@/lib/org-time';

type Params = { params: Promise<{ id: string }> };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What is still attached to this person
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The gap this closes ──────────────────────────────────────────────────
 *
 *  Offboarding worked: an exit record, an offboarding checklist, and a clear
 *  statement that closing the account is the identity lifecycle's job and not
 *  HR's. What none of it said was what the person was *in the middle of*.
 *
 *  So somebody leaves and their eleven open tasks stay assigned to a former
 *  employee, three people wake up reporting to nobody, two reviews they were
 *  the named reviewer for cannot progress, and a leave request they submitted
 *  sits pending until it expires. Every one of those is discovered weeks
 *  later by whoever trips over it.
 *
 *  This answers it in one request, from the modules that already hold the
 *  facts. It changes nothing — reassigning is a decision, and a screen that
 *  silently redistributed somebody's work on their last day would be worse
 *  than the problem.
 *
 *  ── Why it is not only for leavers ───────────────────────────────────────
 *
 *  The same question is the right one for a transfer, for a long absence, and
 *  for a manager wondering what somebody is actually carrying. It is keyed on
 *  a person rather than on an exit record for that reason.
 *
 *  ── Direct reports come first ────────────────────────────────────────────
 *
 *  Of everything here, an orphaned reporting line is the one that does real
 *  damage quietly: `auth_visible_member_ids()` walks the manager chain, so
 *  people whose manager has left stop being visible to anybody except HR —
 *  their leave has no approver, their reviews have no reviewer, and nothing
 *  announces it.
 */

/**
 * A management view of somebody's workload.
 *
 * `approve` rather than `view`: an ordinary employee holds `view` on HR for
 * their own self-service, and this is a list of everything a named colleague
 * is carrying. Managers hold `approve` at department scope and HR at
 * organisation scope, which is the right shape — but the module grant is
 * coarse, so the visibility check below is the one that actually decides.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'approve');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const orgId = ctx.org.organizationId;

  /**
   * Is this person within the caller's reach at all?
   *
   * `auth_visible_member_ids()` is the same function every other people-data
   * policy uses, asked here rather than reimplemented: HR sees the
   * organisation, a manager their department and their reports. Somebody
   * outside that set is reported as absent rather than refused, for the reason
   * the rest of this module gives — a 403 confirms the person exists.
   */
  const { data: visible, error: ve } = await ctx.supabase
    .rpc('auth_visible_member_ids', { org: orgId });
  if (ve) return pgError(ve);
  if (!((visible as string[] | null) ?? []).includes(id)) {
    return error('No such employee.', 404, 'NOT_FOUND');
  }

  const today = todayIn(ctx.org.timezone);

  const [
    who, reports, tasks, projects, leave, reviewing, feedback, cases, checklists,
  ] = await Promise.all([
    ctx.supabase.from('organization_members')
      .select('id, job_title, lifecycle_stage, is_active, '
        + 'department:departments!organization_members_department_id_fkey(id, name), '
        + 'profiles!organization_members_user_id_fkey(full_name, avatar_url)')
      .eq('organization_id', orgId).eq('id', id).maybeSingle(),

    /* People who would be left reporting to nobody. */
    ctx.supabase.from('organization_members')
      .select('id, profiles!organization_members_user_id_fkey(full_name, avatar_url)')
      .eq('organization_id', orgId).eq('manager_id', id).eq('is_active', true),

    ctx.supabase.from('tasks')
      .select('id, title, status, due_date, priority, project:projects(id, name)')
      .eq('organization_id', orgId).eq('assignee_id', id)
      .is('deleted_at', null).neq('status', 'done')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(200),

    ctx.supabase.from('project_members')
      .select('role, allocation_pct, project:projects(id, name, status)')
      .eq('member_id', id).limit(100),

    ctx.supabase.from('leave_requests')
      .select('id, type, status, start_date, end_date, days_requested')
      .eq('organization_id', orgId).eq('member_id', id)
      .in('status', ['pending', 'approved'])
      .gte('end_date', today)
      .order('start_date', { ascending: true }).limit(50),

    /* Reviews this person is the named reviewer for, still in flight. */
    ctx.supabase.from('performance_reviews')
      .select('id, status, member:organization_members!performance_reviews_member_id_fkey('
        + 'id, profiles!organization_members_user_id_fkey(full_name)), '
        + 'cycle:performance_cycles(id, name)')
      .eq('organization_id', orgId).eq('reviewer_id', id)
      .neq('status', 'closed').limit(100),

    ctx.supabase.from('review_feedback')
      .select('id, status, subject:organization_members!review_feedback_subject_id_fkey('
        + 'id, profiles!organization_members_user_id_fkey(full_name))')
      .eq('organization_id', orgId).eq('respondent_id', id)
      .eq('status', 'pending').limit(100),

    ctx.supabase.from('hr_cases')
      .select('id, reference, subject, status, priority, is_restricted')
      .eq('organization_id', orgId).eq('assigned_to', id)
      .not('status', 'in', '("resolved","closed")').limit(100),

    ctx.supabase.from('employee_checklists')
      .select('id, kind, name, status, anchor_date')
      .eq('organization_id', orgId).eq('member_id', id)
      .eq('status', 'active').limit(50),
  ]);

  if (who.error) return pgError(who.error);
  if (!who.data) return error('No such employee.', 404, 'NOT_FOUND');

  const person = who.data as any;
  const taskRows = (tasks.data ?? []) as any[];
  const overdue = taskRows.filter(t => t.due_date && t.due_date < today);

  /**
   * Each group carries its own count and a short reason it matters.
   *
   * The reason is here rather than in the component because the same list is
   * read on the profile and in the offboarding flow, and a caption that only
   * exists in one of them is the one that goes stale. It is also the part that
   * makes the list actionable: "3 direct reports" is a number, "3 people would
   * be left reporting to nobody" is a task.
   */
  const groups = [
    {
      key: 'reports',
      label: 'Direct reports',
      count: (reports.data ?? []).length,
      why: 'They would be left reporting to nobody, which quietly removes them from '
        + 'their manager’s view, their leave approvals and their reviews.',
      items: (reports.data ?? []).map((r: any) => ({
        id: r.id, title: r.profiles?.full_name ?? 'Unknown', detail: null,
      })),
      module: 'hr',
    },
    {
      key: 'tasks',
      label: 'Open tasks',
      count: taskRows.length,
      why: overdue.length
        ? `${overdue.length} of them ${overdue.length === 1 ? 'is' : 'are'} already past a due date.`
        : 'Assigned work in the shared tracker that nobody else is watching.',
      items: taskRows.slice(0, 25).map(t => ({
        id: t.id,
        title: t.title,
        detail: [t.project?.name, t.due_date ? `due ${t.due_date}` : null]
          .filter(Boolean).join(' · ') || null,
      })),
      module: 'projects',
    },
    {
      key: 'projects',
      label: 'Projects',
      count: (projects.data ?? []).length,
      why: 'Membership does not lapse on its own, and a project can lose the only '
        + 'person who knew a part of it.',
      items: (projects.data ?? []).map((p: any) => ({
        id: p.project?.id, title: p.project?.name ?? 'Project', detail: p.role,
      })),
      module: 'projects',
    },
    {
      key: 'reviewing',
      label: 'Reviews they are conducting',
      count: (reviewing.data ?? []).length,
      why: 'A review with a departed reviewer cannot be shared or closed, and the '
        + 'person being reviewed is the one left waiting.',
      items: (reviewing.data ?? []).map((r: any) => ({
        id: r.id,
        title: r.member?.profiles?.full_name ?? 'An employee',
        detail: r.cycle?.name ?? null,
      })),
      module: 'hr',
    },
    {
      key: 'feedback',
      label: 'Feedback asked of them',
      count: (feedback.data ?? []).length,
      why: 'Somebody else’s review is waiting on an answer that is not going to come.',
      items: (feedback.data ?? []).map((f: any) => ({
        id: f.id, title: f.subject?.profiles?.full_name ?? 'A colleague', detail: null,
      })),
      module: 'hr',
    },
    {
      key: 'cases',
      label: 'HR cases they are handling',
      count: (cases.data ?? []).length,
      why: 'An open case with no owner stops moving.',
      items: (cases.data ?? []).map((c: any) => ({
        id: c.id,
        /* A restricted case's subject is not repeated here. */
        title: c.is_restricted ? `${c.reference ?? 'Case'} (restricted)` : (c.subject ?? 'Case'),
        detail: c.status,
      })),
      module: 'hr',
    },
    {
      key: 'leave',
      label: 'Leave still ahead of them',
      count: (leave.data ?? []).length,
      why: 'Approved or pending leave that falls after today, which affects the last '
        + 'working day and the final pay.',
      items: (leave.data ?? []).map((l: any) => ({
        id: l.id,
        title: `${l.type} · ${l.days_requested} day${Number(l.days_requested) === 1 ? '' : 's'}`,
        detail: `${l.start_date} to ${l.end_date} · ${l.status}`,
      })),
      module: 'hr',
    },
    {
      key: 'checklists',
      label: 'Journeys in progress',
      count: (checklists.data ?? []).length,
      why: 'An onboarding or offboarding checklist that has not finished.',
      items: (checklists.data ?? []).map((c: any) => ({
        id: c.id, title: c.name || c.kind, detail: c.kind,
      })),
      module: 'hr',
    },
  ];

  const outstanding = groups.reduce((n, g) => n + g.count, 0);

  return success({
    member: {
      id: person.id,
      name: person.profiles?.full_name ?? 'Unknown member',
      jobTitle: person.job_title ?? null,
      avatarUrl: person.profiles?.avatar_url ?? null,
      department: person.department?.name ?? null,
      lifecycleStage: person.lifecycle_stage,
      isActive: person.is_active,
    },
    today,
    outstanding,
    /** Groups with nothing in them are kept, so "nothing outstanding" is visible. */
    groups,
    /**
     * Nothing here has been changed, and the response says so.
     *
     * Reassigning somebody's work is a decision with a person's name on it.
     * A screen that offered "hand it all over" as one button would make that
     * decision on somebody's last day, when nobody is looking closely.
     */
    note: 'Nothing has been reassigned. This is what somebody has to decide about.',
  });
}
