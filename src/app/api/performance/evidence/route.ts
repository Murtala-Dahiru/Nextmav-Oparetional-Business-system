import { authorize } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { scopeFor } from '@/lib/permissions';
import { todayIn } from '@/lib/org-time';
import { resolvePeriod, type RawEvent } from '@/lib/performance';
import { workingDaysBetween, type AttendanceStatus } from '@/lib/attendance';
import {
  deliveryEvidence, goalEvidence, attendanceEvidence, recognitionEvidence,
  reviewEvidence, commercialEvidence, EVIDENCE_SOURCES, TIMELINE_LABELS, eventTitle,
  type EvidenceSection, type TimelineEntry,
} from '@/lib/evidence';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  One person's performance evidence, from every module that has any
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this replaces ───────────────────────────────────────────────────
 *
 *  `/api/performance/overview` answers "how are your deals going", and it does
 *  that well. It is also the only thing the Performance module has ever
 *  answered, which means a developer, a designer or an accountant opens their
 *  own performance screen and finds a permanently empty pipeline chart. This
 *  route answers the question that was actually being asked: *what is the
 *  evidence for how I am doing here.*
 *
 *  The commercial figures are still here. They are one section among six
 *  rather than the whole screen.
 *
 *  ── Why one request ──────────────────────────────────────────────────────
 *
 *  Six sections read six different tables, and a screen that fires six
 *  requests renders in six stages, each one moving the layout. They are
 *  independent queries so they go out together and arrive as one answer.
 *
 *  ── Authorisation ────────────────────────────────────────────────────────
 *
 *  Every table read here is bounded by `auth_visible_member_ids()` in its own
 *  RLS policy — the same function, in all six. So asking about a colleague you
 *  may not see returns their name and empty sections rather than an error, for
 *  the reason `/overview` gives: a 403 would confirm the person exists.
 *
 *  The one application-level rule is the `own` scope check below, which turns
 *  "show me somebody else" into "show me myself" rather than showing an empty
 *  screen with a colleague's name on it. That reads as "this person has done
 *  nothing", which is a worse answer than the right one.
 *
 *  ── What is deliberately not counted ─────────────────────────────────────
 *
 *  Logins, sessions, messages, time online, and the private My Work list. The
 *  reasoning for each is in `lib/evidence.ts`; the short version is that this
 *  is a record of outcomes, not a record of presence, and that a private list
 *  whose RLS has no administrator override must not become manager-visible
 *  evidence by the back door.
 */

/** Enough to show the shape of a period without becoming an archive. */
const TIMELINE_LIMIT = 40;

export async function GET(request: Request) {
  const ctx = await authorize('performance', 'view');
  if (ctx instanceof Response) return ctx;

  const { supabase, org } = ctx;
  const orgId = org.organizationId;
  const zone = org.timezone;
  const url = new URL(request.url);

  const requested = url.searchParams.get('member') || org.memberId;
  if (!requested) return error('You have no membership in this organization.', 403);

  const period = resolvePeriod(zone, url.searchParams.get('from'), url.searchParams.get('to'));
  const scope = scopeFor(org.role, 'performance');
  const subject = scope === 'own' && requested !== org.memberId ? org.memberId! : requested;

  const windowEnd = `${period.end}T23:59:59.999Z`;

  const [
    whoRes, eventsRes, openTasksRes, goalsRes,
    attendanceRes, receivedRes, givenRes, reviewsRes, expectedRes,
  ] = await Promise.all([
    supabase
      .from('organization_members')
      .select('id, role, department_id, '
        + 'department:departments!organization_members_department_id_fkey(id, name), '
        + 'profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)')
      .eq('organization_id', orgId).eq('id', subject).maybeSingle(),

    /**
     * Every event about this person in the window, of every type.
     *
     * One query rather than one per area: they all live in the same table and
     * the sections are a presentation concern. Bounded by time rather than by
     * count for the reason `/overview` gives — "this quarter" is a fixed
     * question whose answer grows with the company.
     */
    supabase
      .from('business_events')
      .select('event_type, subject_member_id, entity_id, occurred_at, payload')
      .eq('organization_id', orgId)
      .eq('subject_member_id', subject)
      .gte('occurred_at', period.start)
      .lte('occurred_at', windowEnd)
      .order('occurred_at', { ascending: false }),

    /**
     * Open work, read live.
     *
     * "Overdue right now" is the one delivery figure that cannot come from an
     * event, because nothing has happened yet — that is what overdue means.
     * Read from the live rows and labelled `record` in the response so the
     * screen can say it moves.
     */
    supabase
      .from('tasks')
      .select('id, due_date')
      .eq('organization_id', orgId)
      .eq('assignee_id', subject)
      .is('deleted_at', null)
      .neq('status', 'done')
      .limit(1000),

    supabase
      .from('performance_goals')
      .select('id, status, weight, title, due_on, cycle_id')
      .eq('organization_id', orgId)
      .eq('member_id', subject)
      .limit(500),

    supabase
      .from('attendance_records')
      .select('work_date, status, worked_minutes, late_minutes')
      .eq('organization_id', orgId)
      .eq('member_id', subject)
      .gte('work_date', period.start)
      .lte('work_date', period.end)
      .limit(500),

    supabase
      .from('performance_achievements')
      .select('id, title, description, happened_on')
      .eq('organization_id', orgId)
      .eq('member_id', subject)
      .gte('happened_on', period.start)
      .lte('happened_on', period.end)
      .order('happened_on', { ascending: false })
      .limit(200),

    /**
     * Recognition this person *gave*.
     *
     * Counted because recognising colleagues is a contribution and a record
     * that only shows what you received describes half of somebody. It is
     * deliberately not framed as better-when-higher — see the metric's own
     * `basis` text.
     */
    supabase
      .from('performance_achievements')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('recorded_by', subject)
      .gte('happened_on', period.start)
      .lte('happened_on', period.end),

    supabase
      .from('performance_reviews')
      .select('id, status, overall_rating, closed_at, shared_at, cycle_id, '
        + 'cycle:performance_cycles(id, name, period_start, period_end)')
      .eq('organization_id', orgId)
      .eq('member_id', subject)
      .order('created_at', { ascending: false })
      .limit(50),

    supabase.rpc('working_days_between', {
      org: orgId, from_date: period.start, to_date: period.end,
    }),
  ]);

  /**
   * A failure in one section is not a failure of the screen.
   *
   * The member lookup is the only one worth refusing over: without it there is
   * nobody to describe. If attendance is unreadable — a module the role cannot
   * access, a policy that excludes them — that section reports itself
   * unavailable and the other five still render. Failing the whole request
   * because one of six tables said no would make the screen unusable for every
   * role that legitimately cannot see one part of it.
   */
  if (whoRes.error) return error(whoRes.error.message, 500);

  const rawEvents: RawEvent[] = (eventsRes.data ?? []).map((e: any) => ({
    eventType: e.event_type,
    subjectMemberId: e.subject_member_id,
    entityId: e.entity_id,
    occurredAt: e.occurred_at,
    payload: e.payload ?? {},
  }));

  const today = todayIn(zone);
  const expectedDays = typeof expectedRes.data === 'number'
    ? expectedRes.data
    : workingDaysBetween(new Date(period.start), new Date(period.end));

  const attendanceRows = (attendanceRes.data ?? []).map((r: any) => ({
    status: r.status as AttendanceStatus,
    workedMinutes: r.worked_minutes ?? 0,
    lateMinutes: r.late_minutes ?? 0,
  }));

  const goalRows = (goalsRes.data ?? []).map((g: any) => ({
    status: g.status, weight: g.weight ?? 1,
  }));

  const reviewRows = (reviewsRes.data ?? []).map((r: any) => ({
    status: r.status,
    overallRating: r.overall_rating ?? null,
    closedAt: r.closed_at ?? null,
  }));

  const received = receivedRes.data ?? [];

  const sections: EvidenceSection[] = [
    deliveryEvidence({
      completed: rawEvents.filter(e => e.eventType === 'task.completed'),
      openAssigned: (openTasksRes.data ?? []).map((t: any) => ({ dueDate: t.due_date ?? null })),
      today,
    }),
    goalEvidence(goalRows, rawEvents.filter(e => e.eventType === 'goal.achieved')),
    attendanceEvidence(attendanceRows, expectedDays),
    commercialEvidence(
      rawEvents.filter(e => e.eventType.startsWith('deal.')
        || e.eventType.startsWith('lead.') || e.eventType === 'invoice.paid'),
      org.currency,
    ),
    recognitionEvidence(received.length, givenRes.count ?? 0),
    reviewEvidence(reviewRows),
  ];

  /**
   * The timeline: events, recognitions and completed reviews in one order.
   *
   * Recognition and reviews are not events in `business_events` — see 0047's
   * header for why — so they are folded in here rather than being a second
   * list the reader has to merge in their head.
   */
  const timeline: TimelineEntry[] = [
    ...rawEvents
      .filter(e => TIMELINE_LABELS[e.eventType])
      .map(e => {
        const meta = TIMELINE_LABELS[e.eventType];
        const onTime = e.payload?.on_time;
        return {
          at: e.occurredAt,
          kind: e.eventType,
          title: eventTitle(e),
          detail: onTime === true ? 'On time'
            : onTime === false ? 'After its due date'
              : e.payload?.project_name ? String(e.payload.project_name) : meta.verb,
          area: meta.area,
          provenance: 'event' as const,
          openIn: meta.opens
            ? { module: meta.opens.module, type: meta.opens.type, id: e.entityId }
            : null,
        };
      }),
    ...received.map((a: any) => ({
      at: `${a.happened_on}T12:00:00.000Z`,
      kind: 'recognition.received',
      title: a.title,
      detail: a.description || 'Recognition recorded',
      area: 'recognition' as const,
      provenance: 'record' as const,
      openIn: null,
    })),
    ...(reviewsRes.data ?? [])
      .filter((r: any) => r.closed_at)
      .map((r: any) => ({
        at: r.closed_at,
        kind: 'review.completed',
        title: r.cycle?.name ? `${r.cycle.name} review closed` : 'Review closed',
        detail: r.overall_rating ? `Overall rating ${r.overall_rating} of 5` : 'Completed',
        area: 'review' as const,
        provenance: 'record' as const,
        openIn: null,
      })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, TIMELINE_LIMIT);

  const who = whoRes.data as any;

  return success({
    member: {
      id: subject,
      name: who?.profiles?.full_name ?? 'Unknown member',
      jobTitle: who?.profiles?.job_title ?? null,
      avatarUrl: who?.profiles?.avatar_url ?? null,
      role: who?.role ?? null,
      department: who?.department?.name ?? null,
    },
    self: subject === org.memberId,
    period: { ...period, today },
    currency: org.currency,
    sections,
    timeline,
    /**
     * What fed this, named. The screen prints it so that "where does this come
     * from" is answerable without reading the source, and so that a module
     * which contributes nothing yet is visibly absent rather than silently so.
     */
    sources: EVIDENCE_SOURCES.map(s => ({
      area: s.area, label: s.label, module: s.module,
      note: s.note, events: s.events, tables: s.tables,
    })),
  });
}
