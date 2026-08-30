import { authorize } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { scopeFor } from '@/lib/permissions';
import { todayIn } from '@/lib/org-time';
import {
  resolvePeriod, periodPace, rollUp, achievedFor, monthsBetween, monthOf,
  METRIC_META, type RawEvent, type TargetMetric,
} from '@/lib/performance';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  One person's performance, in one request.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this answers ────────────────────────────────────────────────────
 *
 *  Four questions, in the order a salesperson actually asks them: am I going
 *  to make it, what is my pipeline worth, what have I closed, and what did it
 *  earn. Everything else belongs on CRM Home, which already exists and
 *  already answers the commercial question well.
 *
 *  ── Whose performance ────────────────────────────────────────────────────
 *
 *  `?member=` names somebody else. It is not access control: the RLS policy
 *  on `business_events` already bounds every row to
 *  `auth_visible_member_ids`, which returns the whole organisation for an
 *  owner, a department plus direct reports for a manager, and yourself for
 *  everybody else. Asking for a colleague you may not see returns their
 *  identity and an empty achievement rather than an error, because a 403 here
 *  would confirm the person exists.
 *
 *  That is a deliberate difference from the CRM routes, where scope is an
 *  application decision. Here the data is *about* members, so the database's
 *  own answer to "which members" is the right one and duplicating it in the
 *  route would be a second rule to drift.
 *
 *  ── Why open pipeline is read from `deals` and revenue is not ────────────
 *
 *  A pipeline is the current state of things that have not happened yet, so
 *  the live rows are the truth. Revenue is a thing that happened, and
 *  `deals.value` is editable for ever, so reading it would let a correction
 *  in March rewrite February. Revenue comes from the frozen event payloads.
 */

const OPEN_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation'];

/** Enough recent achievements to show the shape of a quarter, not an archive. */
const RECENT_LIMIT = 12;

export async function GET(request: Request) {
  const ctx = await authorize('performance', 'view');
  if (ctx instanceof Response) return ctx;

  const { supabase, org } = ctx;
  const orgId = org.organizationId;
  const zone = org.timezone;
  const url = new URL(request.url);

  const memberId = url.searchParams.get('member') || org.memberId;
  if (!memberId) return error('You have no membership in this organization.', 403);

  const period = resolvePeriod(zone, url.searchParams.get('from'), url.searchParams.get('to'));
  const self = memberId === org.memberId;

  /**
   * A member with `own` scope asking about somebody else gets themselves.
   *
   * Without this the request would succeed and return an empty screen with a
   * colleague's name on it, which reads as "this person has done nothing"
   * rather than "you may not look".
   */
  const scope = scopeFor(org.role, 'performance');
  const subject = scope === 'own' && !self ? org.memberId! : memberId;

  const [whoRes, eventsRes, targetsRes, pipelineRes, activityRes, stageRes] = await Promise.all([
    supabase
      .from('organization_members')
      .select('id, role, department_id, department:departments!organization_members_department_id_fkey(id, name), '
        + 'profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)')
      .eq('organization_id', orgId).eq('id', subject).maybeSingle(),

    /**
     * Every event in the window. Bounded by time rather than by count: "this
     * quarter" is a fixed question whose answer grows with the company, and a
     * limit on it would quietly become wrong at the point the company got
     * interesting.
     */
    supabase
      .from('business_events')
      .select('event_type, subject_member_id, entity_id, occurred_at, payload')
      .eq('organization_id', orgId)
      .eq('subject_member_id', subject)
      .gte('occurred_at', period.start)
      .lte('occurred_at', `${period.end}T23:59:59.999Z`)
      .order('occurred_at', { ascending: false }),

    supabase
      .from('performance_targets')
      .select('id, metric, target_value, currency, period_start, period_end, period_label, notes')
      .eq('organization_id', orgId)
      .eq('subject_type', 'member').eq('subject_id', subject)
      .is('superseded_by', null)
      .lte('period_start', period.end).gte('period_end', period.start),

    /* Open pipeline: the live rows, because nothing has happened to them yet. */
    supabase
      .from('deals')
      .select('id, name, value, stage, probability, expected_close, company:companies(id, name)')
      .eq('organization_id', orgId).is('deleted_at', null)
      .eq('owner_id', subject)
      .in('stage', OPEN_STAGES)
      .order('value', { ascending: false })
      .limit(500),

    supabase
      .from('crm_activities')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('member_id', subject)
      .gte('created_at', period.start)
      .lte('created_at', `${period.end}T23:59:59.999Z`),

    /**
     * The whole stage history of this person's deals, deliberately unbounded
     * in time.
     *
     * Bounding it by the period looked reasonable and produced nonsense: a
     * deal opened in May and won in August has only its closing event inside
     * a Q3 window, so "first seen" and "closed" were the same row and the
     * cycle came out as zero days. Averaged in with real cycles that drags the
     * figure towards zero, and a sales cycle that is wrong in the flattering
     * direction is worse than one that is missing.
     *
     * The rows are narrow and one salesperson's deal history is small.
     * Filtering to deals that closed in the window happens below, once the
     * closures are known.
     */
    supabase
      .from('deal_stage_events')
      .select('deal_id, from_stage, to_stage, created_at')
      .eq('organization_id', orgId)
      .eq('member_id', subject)
      .order('created_at', { ascending: true })
      .limit(5000),
  ]);

  const failed = [whoRes, eventsRes, targetsRes, pipelineRes, stageRes].find(r => r.error);
  if (failed?.error) return error(failed.error.message, 500);

  const rawEvents: RawEvent[] = (eventsRes.data ?? []).map((e: any) => ({
    eventType: e.event_type,
    subjectMemberId: e.subject_member_id,
    entityId: e.entity_id,
    occurredAt: e.occurred_at,
    payload: e.payload ?? {},
  }));

  const achievement = rollUp(rawEvents);
  const activitiesLogged = activityRes.count ?? 0;

  /* Pipeline, live. */
  const pipeline = (pipelineRes.data ?? []) as any[];
  const openValue = pipeline.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
  const weightedValue = pipeline.reduce(
    (sum, d) => sum + (Number(d.value ?? 0) * Number(d.probability ?? 0)) / 100, 0,
  );

  const byStage = OPEN_STAGES.map(stage => {
    const rows = pipeline.filter(d => d.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((s, d) => s + Number(d.value ?? 0), 0),
    };
  });

  /* Targets, with pace so a percentage means something. */
  const pace = periodPace(period, zone);
  const targets = (targetsRes.data ?? []).map((t: any) => {
    const metric = t.metric as TargetMetric;
    const target = Number(t.target_value ?? 0);
    const achieved = achievedFor(metric, achievement, activitiesLogged);
    return {
      id: t.id,
      metric,
      label: METRIC_META[metric]?.label ?? metric,
      unit: METRIC_META[metric]?.unit ?? 'count',
      note: METRIC_META[metric]?.note ?? '',
      target,
      currency: t.currency,
      achieved,
      progress: target > 0 ? achieved / target : null,
      /**
       * What the run rate says they will finish on.
       *
       * Only once a tenth of the period has passed: projecting a quarter from
       * its first afternoon produces a confident number that is nonsense, and
       * a blank is more honest than a wrong forecast.
       */
      projected: pace >= 0.1 ? achieved / pace : null,
      periodLabel: t.period_label || `${t.period_start} to ${t.period_end}`,
      periodStart: t.period_start,
      periodEnd: t.period_end,
      notes: t.notes ?? '',
    };
  });

  /* Revenue by month, from the frozen payloads. */
  const months = monthsBetween(period, zone);
  const wonByMonth = new Map(months.map(m => [m, { won: 0, lost: 0, count: 0 }]));
  for (const e of rawEvents) {
    const key = monthOf(e.occurredAt, zone);
    const bucket = wonByMonth.get(key);
    if (!bucket) continue;
    if (e.eventType === 'deal.won') {
      bucket.won += Number(e.payload?.value ?? 0);
      bucket.count += 1;
    } else if (e.eventType === 'deal.lost') {
      bucket.lost += Number(e.payload?.value ?? 0);
    }
  }

  /**
   * Average days from a deal's first stage event to its close, for this
   * person's deals inside the window. Null rather than zero when nothing has
   * closed, because "no cycle yet" and "an instant cycle" are different facts.
   */
  const firstSeen = new Map<string, string>();
  const closedAt = new Map<string, string>();
  for (const s of (stageRes.data ?? []) as any[]) {
    if (!firstSeen.has(s.deal_id)) firstSeen.set(s.deal_id, s.created_at);
    if (s.to_stage === 'closed_won' || s.to_stage === 'closed_lost') {
      closedAt.set(s.deal_id, s.created_at);
    }
  }
  const cycles: number[] = [];
  for (const [dealId, end] of closedAt) {
    /* Only deals that closed inside the window being looked at. */
    if (end < period.start || end > `${period.end}T23:59:59.999Z`) continue;
    const start = firstSeen.get(dealId);
    if (!start) continue;
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    /**
     * A deal whose whole history is one row has no measurable cycle: it was
     * created already closed, by the seeder or by somebody recording business
     * that was won elsewhere. Counting it as a zero-day sale would be a lie in
     * the flattering direction.
     */
    if (days > 0) cycles.push(days);
  }
  const salesCycle = cycles.length
    ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
    : null;

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
    period: { ...period, pace, today: todayIn(zone) },
    currency: org.currency,
    achievement: { ...achievement, activitiesLogged, salesCycle },
    pipeline: {
      openValue,
      weightedValue,
      count: pipeline.length,
      byStage,
      top: pipeline.slice(0, 8).map((d: any) => ({
        id: d.id, name: d.name, value: Number(d.value ?? 0), stage: d.stage,
        probability: d.probability, expectedClose: d.expected_close,
        company: d.company?.name ?? null,
      })),
    },
    targets,
    months: months.map(m => ({ month: m, ...wonByMonth.get(m)! })),
    recent: rawEvents.slice(0, RECENT_LIMIT).map(e => ({
      type: e.eventType,
      at: e.occurredAt,
      entityId: e.entityId,
      title: e.payload?.deal_name ?? e.payload?.lead_name ?? e.payload?.invoice_number ?? 'Record',
      value: Number(e.payload?.value ?? e.payload?.amount_paid ?? e.payload?.estimated_value ?? 0),
    })),
  });
}
