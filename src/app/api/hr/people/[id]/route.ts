import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { todayIn } from '@/lib/org-time';
import { CHANGE_KINDS, MEMBER_STAGES } from '@/lib/hr';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Employee 360.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One person, and everything the rest of the Business OS knows about them:
 * their employment and how it got that way, their attendance, their leave and
 * what is left of it, the projects they are on, their goals and reviews, their
 * documents, their journey through onboarding, and - only if the caller may
 * see it - what they are paid.
 *
 * ── Why it is one request ────────────────────────────────────────────────
 *
 * Fourteen fetches from the browser is fourteen round trips, fourteen
 * loading states, and a profile that assembles itself in front of the reader.
 * More importantly it is fourteen chances for one of them to be forgotten when
 * a section moves. The screen asks one question - who is this person - and
 * gets one answer.
 *
 * ── Where the permission actually is ─────────────────────────────────────
 *
 * Almost nowhere in this file, deliberately. Every query runs through the
 * caller's own client, so RLS decides what comes back: an employee asking
 * about a colleague gets their own row and nothing else, a manager gets their
 * department, HR gets everybody. `compensation` is the one exception, and it
 * is not an exception to the rule but a second lock on top of it - the
 * `can_see_compensation()` policy already refuses, and the endpoint declines
 * to ask, so a UI reading `data.compensation` cannot render a half-populated
 * panel it should not have drawn at all.
 */

type Params = { params: Promise<{ id: string }> };

const HR_ROLES = ['owner', 'administrator', 'hr_staff'];

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const org = ctx.org.organizationId;
  const isHr = HR_ROLES.includes(ctx.org.role);
  const isSelf = id === ctx.org.memberId;

  const { data: person, error: pe } = await ctx.supabase
    .from('v_hr_people').select('*')
    .eq('organization_id', org).eq('member_id', id)
    .maybeSingle();

  if (pe) return pgError(pe);
  /* Hidden-by-RLS and does-not-exist are the same answer, as everywhere else. */
  if (!person) return error('Not found', 404, 'NOT_FOUND');

  const today = todayIn(ctx.org.timezone);
  const year = Number(today.slice(0, 4));
  /* Ninety days: long enough for a pattern, short enough that the request
     stays one page of rows rather than a year of them. */
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000)
    .toISOString().slice(0, 10);

  const [
    history, reports, attendance, leave, balances,
    goals, reviews, achievements, documents, journeys,
    projects, tasks, cases, origin, exit,
  ] = await Promise.all([
    ctx.supabase.from('employment_events')
      .select('*, recorder:organization_members!employment_events_recorded_by_fkey(id, profiles!organization_members_user_id_fkey(full_name)), department_from:departments!employment_events_department_before_fkey(id, name), department_to:departments!employment_events_department_after_fkey(id, name)')
      .eq('organization_id', org).eq('member_id', id)
      .order('effective_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50),

    ctx.supabase.from('v_hr_people')
      .select('member_id, full_name, avatar_url, job_title, lifecycle_stage, department_name')
      .eq('organization_id', org).eq('manager_id', id)
      .neq('lifecycle_stage', 'former')
      .order('full_name'),

    ctx.supabase.from('attendance_records')
      .select('id, work_date, status, checked_in_at, checked_out_at, worked_minutes, late_minutes, is_remote, note, adjusted_at')
      .eq('organization_id', org).eq('member_id', id)
      .gte('work_date', from)
      .order('work_date', { ascending: false }),

    ctx.supabase.from('leave_requests')
      .select('id, type, status, start_date, end_date, days_requested, is_half_day, reason, decided_at')
      .eq('organization_id', org).eq('member_id', id)
      .order('start_date', { ascending: false })
      .limit(30),

    ctx.supabase.from('leave_balances')
      .select('id, type, year, entitled_days, used_days, carried_days')
      .eq('organization_id', org).eq('member_id', id).eq('year', year)
      .order('type'),

    ctx.supabase.from('performance_goals')
      .select('id, title, kind, status, target_value, current_value, unit, due_on, cycle_id')
      .eq('organization_id', org).eq('member_id', id)
      .order('created_at', { ascending: false }).limit(20),

    ctx.supabase.from('performance_reviews')
      .select('id, status, overall_rating, shared_at, closed_at, created_at, cycle:performance_cycles(id, name, period_start, period_end)')
      .eq('organization_id', org).eq('member_id', id)
      .order('created_at', { ascending: false }).limit(10),

    ctx.supabase.from('performance_achievements')
      .select('id, title, description, happened_on')
      .eq('organization_id', org).eq('member_id', id)
      .order('happened_on', { ascending: false }).limit(10),

    ctx.supabase.from('files')
      .select('id, filename, mime_type, size_bytes, hr_category, is_confidential, created_at, uploader:organization_members!files_uploaded_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))')
      .eq('organization_id', org).eq('member_id', id)
      .not('hr_category', 'is', null).is('deleted_at', null)
      .order('created_at', { ascending: false }),

    ctx.supabase.from('employee_checklists')
      .select('*, items:employee_checklist_items(id, title, description, category, due_on, is_done, completed_at, requires_document, document_file_id, sort_order, assignee:organization_members!employee_checklist_items_assignee_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)))')
      .eq('organization_id', org).eq('member_id', id)
      .order('created_at', { ascending: false }),

    ctx.supabase.from('project_members')
      .select('role, allocation_pct, project:projects(id, name, status, end_date)')
      .eq('member_id', id),

    ctx.supabase.from('tasks')
      .select('id, title, status, priority, due_date, project:projects(id, name)')
      .eq('organization_id', org).eq('assignee_id', id)
      .is('deleted_at', null).neq('status', 'done')
      .order('due_date', { ascending: true, nullsFirst: false }).limit(15),

    ctx.supabase.from('hr_cases')
      .select('id, reference, category, subject, status, priority, created_at, is_restricted')
      .eq('organization_id', org).eq('member_id', id)
      .order('created_at', { ascending: false }).limit(10),

    ctx.supabase.from('candidates')
      .select('id, source, referred_by, created_at, applications:job_applications(id, applied_on, opening:job_openings(id, title, reference))')
      .eq('organization_id', org).eq('hired_member_id', id)
      .maybeSingle(),

    isHr
      ? ctx.supabase.from('employee_exits').select('*')
          .eq('organization_id', org).eq('member_id', id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  /**
   * Compensation, asked for only when it can be answered.
   *
   * The policy would refuse anyway. Not asking means the response has no
   * `compensation` key at all rather than an empty array, which is the
   * difference between a screen that hides a panel and one that draws an empty
   * one captioned "no salary recorded" for somebody who is in fact paid.
   */
  let compensation: unknown = undefined;
  if (isHr || isSelf) {
    const [records, components] = await Promise.all([
      ctx.supabase.from('compensation_records')
        .select('*, approver:organization_members!compensation_records_approved_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))')
        .eq('organization_id', org).eq('member_id', id)
        .order('effective_from', { ascending: false }),
      ctx.supabase.from('compensation_components')
        .select('*')
        .eq('organization_id', org).eq('member_id', id)
        .order('effective_from', { ascending: false }),
    ]);
    compensation = {
      records: records.data ?? [],
      components: components.data ?? [],
      current: (records.data ?? []).find((r: any) => r.effective_to === null) ?? null,
    };
  }

  /**
   * Attendance, summarised over the window rather than in the browser.
   *
   * The rows are sent as well - the profile draws a strip of them - but the
   * figures are computed once, here, so the headline and the strip cannot
   * disagree about the same ninety days.
   */
  const records = attendance.data ?? [];
  const worked = records.reduce((s: number, r: any) => s + (r.worked_minutes ?? 0), 0);
  const late = records.filter((r: any) => (r.late_minutes ?? 0) > 0).length;
  const attendanceSummary = {
    from,
    to: today,
    days: records.length,
    present: records.filter((r: any) => ['present', 'late', 'remote', 'half_day'].includes(r.status)).length,
    absent: records.filter((r: any) => r.status === 'absent').length,
    onLeave: records.filter((r: any) => r.status === 'on_leave').length,
    remote: records.filter((r: any) => r.is_remote).length,
    late,
    totalMinutes: worked,
    averageMinutes: records.length ? Math.round(worked / records.length) : 0,
    punctualityRate: records.length ? Math.round(((records.length - late) / records.length) * 100) : null,
  };

  return success({
    person,
    viewer: { isSelf, isHr, canSeeCompensation: isHr || isSelf },
    history: history.data ?? [],
    reports: reports.data ?? [],
    attendance: { summary: attendanceSummary, records },
    leave: { requests: leave.data ?? [], balances: balances.data ?? [] },
    performance: {
      goals: goals.data ?? [],
      reviews: reviews.data ?? [],
      achievements: achievements.data ?? [],
    },
    documents: documents.data ?? [],
    journeys: journeys.data ?? [],
    work: { projects: projects.data ?? [], tasks: tasks.data ?? [] },
    cases: cases.data ?? [],
    origin: origin.data ?? null,
    exit: (exit as any).data ?? null,
    ...(compensation !== undefined ? { compensation } : {}),
  });
}

/**
 * Change somebody's employment, and record that it changed.
 *
 * Everything goes through `apply_employment_change()`, which writes the
 * membership row and the history row in one transaction. The endpoint could
 * update `organization_members` directly - `/api/hr/employees` still does, for
 * the administrative fields - and that is exactly what this exists not to do:
 * a promotion applied as an UPDATE is a promotion with no date, no reason and
 * no record that the person used to be something else.
 *
 * The function checks the caller's role itself, so the `manage` guard here is
 * the readable 403 rather than the security boundary.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());

    const kind = String(b.kind ?? '');
    if (!(CHANGE_KINDS as readonly string[]).includes(kind)) {
      return error(
        `\`kind\` must be one of: ${CHANGE_KINDS.join(', ')}.`,
        422, 'VALIDATION_ERROR',
      );
    }

    if (b.stage && !(MEMBER_STAGES as readonly string[]).includes(String(b.stage))) {
      return error(
        `A membership cannot be moved to \`${b.stage}\`. Candidate and offer stages belong to recruitment.`,
        422, 'VALIDATION_ERROR',
      );
    }

    /**
     * Empty strings become NULL, and NULL means "leave this alone".
     *
     * A form that sends `department_id: ''` for an untouched select would
     * otherwise be asking for no change, get one, and the no-op check inside
     * the function would refuse the whole request with a message about nothing
     * changing - which is true and useless.
     */
    const orNull = (v: unknown) =>
      v === '' || v === undefined || v === null ? null : v;

    const { data, error: e } = await ctx.supabase.rpc('apply_employment_change', {
      p_member: id,
      p_kind: kind,
      p_effective: orNull(b.effective_on) ?? todayIn(ctx.org.timezone),
      p_job_title: orNull(b.job_title),
      p_department: orNull(b.department_id),
      p_manager: orNull(b.manager_id),
      p_employment_type: orNull(b.employment_type),
      p_stage: orNull(b.stage),
      p_reason: String(b.reason ?? ''),
      p_note: String(b.note ?? ''),
      p_details: b.details ?? {},
    });

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not record the change');
  }
}
