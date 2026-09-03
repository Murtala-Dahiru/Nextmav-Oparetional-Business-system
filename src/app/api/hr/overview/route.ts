import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { todayIn } from '@/lib/org-time';
import { OPEN_CASE_STATUSES } from '@/lib/hr';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HR Home - the workforce, in one answer.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The rule this endpoint follows ───────────────────────────────────────
 *
 * **Every number here is counted from rows the caller may actually see.**
 *
 * That is not a nicety. `v_hr_people`, `leave_requests`, `hr_cases` and the
 * rest are all `security_invoker` or RLS-bound, so an employee opening this
 * screen gets figures about themselves and a manager gets their department -
 * and the headline says whose workforce it is describing. The alternative,
 * which every dashboard in this repository has been tempted by, is to compute
 * an organisation-wide figure with a privileged client and then hide the
 * detail: that produces a screen where the total and the list under it
 * disagree, and the total is the one that leaks.
 *
 * ── And the rule it inherits ─────────────────────────────────────────────
 *
 * No figure is invented and none is smoothed. The dashboard phase found
 * `/api/dashboard` answering a hard-coded `0` for overdue receivables while a
 * view had computed the real number since 0007, and told every organisation on
 * the platform it had nothing overdue. Where something genuinely cannot be
 * computed - because nobody has entered the data - this returns the absence
 * and the screen renders an empty state that says what is missing.
 */
export async function GET() {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const org = ctx.org.organizationId;
  const today = todayIn(ctx.org.timezone);
  const day = 86_400_000;
  const shift = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + days * day).toISOString().slice(0, 10);

  const thirtyAgo = shift(-30);
  const ninetyAgo = shift(-90);
  const inFourteen = shift(14);
  const inThirty = shift(30);
  const inSeven = shift(7);

  const [
    roster, formerRoster, attendance, leaveToday, upcomingLeave, pendingLeave,
    openings, applications, interviews, journeys, cases, activity, payroll, balances,
  ] = await Promise.all([
    ctx.supabase.from('v_hr_people')
      .select('member_id, full_name, avatar_url, job_title, department_id, department_name, ' +
              'employment_type, lifecycle_stage, hired_on, joined_at, terminated_on, ' +
              'probation_ends_on, manager_id, tenure_months, presence')
      .eq('organization_id', org).neq('lifecycle_stage', 'former'),

    /* Departures, which are exactly the rows the roster above excludes. */
    ctx.supabase.from('v_hr_people')
      .select('member_id, full_name, avatar_url, department_name, terminated_on, hired_on, joined_at')
      .eq('organization_id', org).eq('lifecycle_stage', 'former'),

    ctx.supabase.from('attendance_records')
      .select('member_id, status, is_remote, late_minutes, checked_in_at, checked_out_at')
      .eq('organization_id', org).eq('work_date', today),

    ctx.supabase.from('leave_requests')
      .select('id, member_id, type, start_date, end_date, ' +
              'member:organization_members!leave_requests_member_id_fkey(id, ' +
              'profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('organization_id', org).eq('status', 'approved')
      .lte('start_date', today).gte('end_date', today),

    ctx.supabase.from('leave_requests')
      .select('id, member_id, type, start_date, end_date, days_requested, ' +
              'member:organization_members!leave_requests_member_id_fkey(id, department_id, ' +
              'profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('organization_id', org).eq('status', 'approved')
      .gt('start_date', today).lte('start_date', inFourteen)
      .order('start_date'),

    ctx.supabase.from('leave_requests')
      .select('id, member_id, type, start_date, end_date, created_at, reason, ' +
              'member:organization_members!leave_requests_member_id_fkey(id, department_id, ' +
              'profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('organization_id', org).eq('status', 'pending')
      .order('start_date'),

    ctx.supabase.from('job_openings')
      .select('id, title, status, positions, created_at, opened_on, department:departments(id, name)')
      .eq('organization_id', org).in('status', ['open', 'draft', 'on_hold']),

    ctx.supabase.from('job_applications')
      .select('id, stage, status, opening_id, updated_at')
      .eq('organization_id', org).eq('status', 'active'),

    ctx.supabase.from('interviews')
      .select('id, kind, starts_at, status, application:job_applications(id, ' +
              'candidate:candidates(id, full_name), opening:job_openings(id, title))')
      .eq('organization_id', org).eq('status', 'scheduled')
      .gte('starts_at', `${today}T00:00:00Z`).lte('starts_at', `${inSeven}T23:59:59Z`)
      .order('starts_at'),

    ctx.supabase.from('employee_checklists')
      .select('id, kind, status, anchor_date, member_id, ' +
              'member:organization_members!employee_checklists_member_id_fkey(id, ' +
              'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
              'items:employee_checklist_items(id, is_done, due_on)')
      .eq('organization_id', org).eq('status', 'active'),

    ctx.supabase.from('hr_cases')
      .select('id, reference, subject, category, status, priority, created_at, assigned_to, raised_by')
      .eq('organization_id', org).in('status', [...OPEN_CASE_STATUSES])
      .order('created_at', { ascending: false }),

    ctx.supabase.from('employment_events')
      .select('id, kind, effective_on, created_at, reason, title_after, member_id, ' +
              'member:organization_members!employment_events_member_id_fkey(id, ' +
              'profiles!organization_members_user_id_fkey(full_name, avatar_url))')
      .eq('organization_id', org)
      .order('created_at', { ascending: false }).limit(12),

    ctx.supabase.from('payroll_periods')
      .select('id, name, status, period_start, period_end, pay_date, total_net, employee_count, currency')
      .eq('organization_id', org)
      .order('period_start', { ascending: false }).limit(6),

    ctx.supabase.from('leave_balances')
      .select('type, entitled_days, used_days, carried_days')
      .eq('organization_id', org)
      .eq('member_id', ctx.org.memberId)
      .eq('year', Number(today.slice(0, 4))),
  ]);

  if (roster.error) return pgError(roster.error);

  const people = (roster.data ?? []) as any[];
  const former = (formerRoster.data ?? []) as any[];
  const startOf = (p: any) => p.hired_on ?? (p.joined_at ? String(p.joined_at).slice(0, 10) : null);

  // ── Workforce ───────────────────────────────────────────────────────────

  const byStage: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byDepartment = new Map<string, { id: string | null; name: string; count: number }>();

  for (const p of people) {
    byStage[p.lifecycle_stage] = (byStage[p.lifecycle_stage] ?? 0) + 1;
    byType[p.employment_type] = (byType[p.employment_type] ?? 0) + 1;

    const key = p.department_id ?? 'unassigned';
    const held = byDepartment.get(key);
    if (held) held.count++;
    else byDepartment.set(key, {
      id: p.department_id, name: p.department_name ?? 'No department', count: 1,
    });
  }

  const newHires = people.filter(p => { const s = startOf(p); return s && s >= thirtyAgo && s <= today; });
  const newHires90 = people.filter(p => { const s = startOf(p); return s && s >= ninetyAgo && s <= today; });
  const departures = former.filter(p => p.terminated_on && p.terminated_on >= thirtyAgo);
  const departures90 = former.filter(p => p.terminated_on && p.terminated_on >= ninetyAgo);

  /**
   * Headcount over twelve months, counted from the dates on the memberships
   * themselves rather than from a stored series.
   *
   * Somebody is in a month's figure if they had started by its end and had not
   * left by then. That makes the last point today's headcount by construction,
   * so the chart and the number above it cannot disagree - which is the failure
   * the dashboard phase found in project health and fixed the same way.
   */
  const trend: Array<{ month: string; headcount: number; joined: number; left: number }> = [];
  const now = new Date(`${today}T00:00:00Z`);
  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    const from = monthStart.toISOString().slice(0, 10);
    const to = monthEnd.toISOString().slice(0, 10);
    /* The month in progress ends today, not on the 31st: counting a future
       leaver as already gone would make the last point dip for no reason. */
    const boundary = to > today ? today : to;

    const all = [...people, ...former];
    const headcount = all.filter(p => {
      const s = startOf(p);
      if (!s || s > boundary) return false;
      return !p.terminated_on || p.terminated_on > boundary;
    }).length;

    trend.push({
      month: from.slice(0, 7),
      headcount,
      joined: all.filter(p => { const s = startOf(p); return s && s >= from && s <= boundary; }).length,
      left: former.filter(p => p.terminated_on && p.terminated_on >= from && p.terminated_on <= boundary).length,
    });
  }

  // ── Today ───────────────────────────────────────────────────────────────

  const records = (attendance.data ?? []) as any[];
  const onLeave = (leaveToday.data ?? []) as any[];
  const onLeaveIds = new Set(onLeave.map((l: any) => l.member_id));

  const attendanceToday = {
    date: today,
    expected: people.filter(p => !onLeaveIds.has(p.member_id) && p.lifecycle_stage !== 'onboarding').length,
    recorded: records.length,
    present: records.filter((r: any) => ['present', 'late', 'half_day'].includes(r.status) && !r.is_remote).length,
    remote: records.filter((r: any) => r.is_remote || r.status === 'remote').length,
    late: records.filter((r: any) => (r.late_minutes ?? 0) > 0).length,
    absent: records.filter((r: any) => r.status === 'absent').length,
    stillIn: records.filter((r: any) => r.checked_in_at && !r.checked_out_at).length,
    onLeave: onLeave.length,
    /**
     * Everybody who has neither a record nor approved leave.
     *
     * Reported as "not yet recorded" rather than counted as absent: at nine in
     * the morning most of an organisation is in that state, and a screen that
     * calls them absent is wrong every day before lunch.
     */
    unrecorded: people.filter(p =>
      !onLeaveIds.has(p.member_id)
      && !records.some((r: any) => r.member_id === p.member_id)
      && p.lifecycle_stage !== 'onboarding').length,
  };

  // ── Events worth knowing about ──────────────────────────────────────────

  /**
   * Work anniversaries, probation ends, and people starting.
   *
   * No birthdays: `profiles` has no date of birth and inventing one would be
   * exactly the fabrication this phase exists to remove. An anniversary is
   * derived from the start date, which is a real column.
   */
  const anniversaries = people
    .map(p => {
      const s = startOf(p);
      if (!s) return null;
      const anniversary = `${today.slice(0, 4)}-${s.slice(5)}`;
      const next = anniversary >= today ? anniversary
        : `${Number(today.slice(0, 4)) + 1}-${s.slice(5)}`;
      if (next > inThirty) return null;
      const years = Number(next.slice(0, 4)) - Number(s.slice(0, 4));
      return years > 0 ? { ...p, date: next, years } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.date.localeCompare(b.date));

  const probationEnding = people
    .filter(p => p.probation_ends_on && p.probation_ends_on >= today && p.probation_ends_on <= inThirty)
    .sort((a, b) => String(a.probation_ends_on).localeCompare(String(b.probation_ends_on)));

  const starting = people
    .filter(p => p.lifecycle_stage === 'onboarding')
    .sort((a, b) => String(startOf(a) ?? '').localeCompare(String(startOf(b) ?? '')));

  const leaving = people.filter(p => ['notice_period', 'offboarding'].includes(p.lifecycle_stage));

  // ── Journeys ────────────────────────────────────────────────────────────

  const activeJourneys = ((journeys.data ?? []) as any[]).map((j: any) => {
    const items = j.items ?? [];
    const done = items.filter((i: any) => i.is_done).length;
    return {
      id: j.id, kind: j.kind, anchor_date: j.anchor_date,
      member: j.member, member_id: j.member_id,
      total: items.length, done,
      percent: items.length ? Math.round((done / items.length) * 100) : 0,
      overdue: items.filter((i: any) => !i.is_done && i.due_on && i.due_on < today).length,
    };
  });

  // ── Recruitment ─────────────────────────────────────────────────────────

  const apps = (applications.data ?? []) as any[];
  const byApplicationStage: Record<string, number> = {};
  for (const a of apps) byApplicationStage[a.stage] = (byApplicationStage[a.stage] ?? 0) + 1;

  // ── Approvals waiting on the person looking ─────────────────────────────

  const pending = (pendingLeave.data ?? []) as any[];
  const openCases = (cases.data ?? []) as any[];

  return success({
    asOf: today,
    /* Whose workforce this describes. An employee sees one person and the
       screen must say so rather than reporting "headcount: 1". */
    scope: {
      role: ctx.org.role,
      memberId: ctx.org.memberId,
      visiblePeople: people.length,
    },

    workforce: {
      headcount: people.length,
      active: byStage.active ?? 0,
      onboarding: byStage.onboarding ?? 0,
      onLeaveStage: byStage.on_leave ?? 0,
      leaving: leaving.length,
      former: former.length,
      byStage,
      byType,
      byDepartment: [...byDepartment.values()].sort((a, b) => b.count - a.count),
      newHires: newHires.length,
      newHires90: newHires90.length,
      departures: departures.length,
      departures90: departures90.length,
      /**
       * Turnover over the trailing quarter, as a percentage of the headcount
       * at its start - which is the only denominator that means anything, and
       * `null` rather than zero when there is nobody to divide by.
       */
      turnover90: (people.length + departures90.length) > 0
        ? Math.round((departures90.length / (people.length + departures90.length)) * 1000) / 10
        : null,
      trend,
      medianTenureMonths: medianOf(people.map(p => p.tenure_months).filter((n): n is number => typeof n === 'number')),
    },

    attendanceToday,
    peopleOnLeaveToday: onLeave,

    leave: {
      pending: pending.length,
      pendingRequests: pending.slice(0, 12),
      upcoming: ((upcomingLeave.data ?? []) as any[]).slice(0, 12),
      myBalances: ((balances.data ?? []) as any[]).map((b: any) => ({
        ...b,
        total_days: Number(b.entitled_days) + Number(b.carried_days),
        remaining_days: Math.max(0, Number(b.entitled_days) + Number(b.carried_days) - Number(b.used_days)),
      })),
    },

    events: {
      starting: starting.slice(0, 8),
      anniversaries: anniversaries.slice(0, 8),
      probationEnding: probationEnding.slice(0, 8),
      leaving,
    },

    journeys: {
      onboarding: activeJourneys.filter((j: any) => j.kind === 'onboarding'),
      offboarding: activeJourneys.filter((j: any) => j.kind === 'offboarding'),
      overdueSteps: activeJourneys.reduce((s: number, j: any) => s + j.overdue, 0),
    },

    recruitment: {
      openOpenings: ((openings.data ?? []) as any[]).filter((o: any) => o.status === 'open').length,
      openings: (openings.data ?? []) as any[],
      activeApplications: apps.length,
      byStage: byApplicationStage,
      interviewsThisWeek: interviews.data ?? [],
      /* Positions still to fill, which is not the same as openings: one
         opening can advertise three. */
      positions: ((openings.data ?? []) as any[])
        .filter((o: any) => o.status === 'open')
        .reduce((s: number, o: any) => s + (o.positions ?? 1), 0),
    },

    cases: {
      open: openCases.length,
      mine: openCases.filter((c: any) => c.raised_by === ctx.org.memberId).length,
      assignedToMe: openCases.filter((c: any) => c.assigned_to === ctx.org.memberId).length,
      unassigned: openCases.filter((c: any) => !c.assigned_to).length,
      recent: openCases.slice(0, 8),
    },

    payroll: {
      /* Refused by RLS for anybody who is not HR, which is the correct answer
         and renders as the panel simply not being there. */
      periods: payroll.error ? [] : ((payroll.data ?? []) as any[]),
      awaitingApproval: payroll.error
        ? 0
        : ((payroll.data ?? []) as any[]).filter((p: any) => p.status === 'calculated').length,
    },

    activity: activity.data ?? [],
  });
}

/** The middle value, or null when there is nothing to take a middle of. */
function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
