import { authorize } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { scopeFor } from '@/lib/permissions';
import {
  resolvePeriod, periodPace, rollUp, achievedFor,
  METRIC_META, type RawEvent, type TargetMetric,
} from '@/lib/performance';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A team, ranked by what it did.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this route is short ──────────────────────────────────────────────
 *
 *  It is the same computation as `/api/performance/overview`, grouped by
 *  member instead of filtered to one. The part that would normally be hard -
 *  deciding whose numbers a caller may see - is already answered by
 *  `auth_visible_member_ids()`, which the RLS policy on `business_events`
 *  applies on every read. Owners, administrators and HR get the whole
 *  organisation; a manager gets their department plus their direct reports;
 *  everybody else gets themselves.
 *
 *  Reusing that rather than writing a second visibility rule here is the
 *  whole point. Two answers to "who may I see" is one answer too many, and
 *  the second one is always the one that drifts.
 *
 *  ── Aggregates and records are separate grants ───────────────────────────
 *
 *  This returns totals per person, never the deals behind them. A manager
 *  seeing that a colleague closed forty million is a different disclosure
 *  from letting them open every one of those deals, and in a company where
 *  commission is sensitive the difference matters. Whoever wants the records
 *  goes to CRM, where CRM's own scope applies.
 */

export async function GET(request: Request) {
  const ctx = await authorize('performance', 'view');
  if (ctx instanceof Response) return ctx;

  const { supabase, org } = ctx;
  const orgId = org.organizationId;
  const zone = org.timezone;
  const url = new URL(request.url);

  const period = resolvePeriod(zone, url.searchParams.get('from'), url.searchParams.get('to'));
  const metric = (url.searchParams.get('metric') ?? 'revenue_won') as TargetMetric;

  /**
   * Somebody at `own` scope has no team to look at.
   *
   * Answered as an empty team rather than a 403, because the module is
   * legitimately theirs - their own screen lives at `/overview` - and a
   * refusal here would read as a fault rather than as an absence.
   */
  if (scopeFor(org.role, 'performance') === 'own') {
    return success({
      period: { ...period, pace: periodPace(period, zone) },
      currency: org.currency,
      metric,
      members: [],
      totals: null,
      scope: 'own',
    });
  }

  /* Whose numbers this caller may see, straight from the database's answer. */
  const visibleRes = await supabase.rpc('auth_visible_member_ids', { org: orgId });
  if (visibleRes.error) return error(visibleRes.error.message, 500);
  const visible: string[] = visibleRes.data ?? [];

  if (!visible.length) {
    return success({
      period: { ...period, pace: periodPace(period, zone) },
      currency: org.currency, metric, members: [], totals: null, scope: 'none',
    });
  }

  const [peopleRes, eventsRes, targetsRes, pipelineRes, activityRes] = await Promise.all([
    supabase
      .from('organization_members')
      .select('id, role, is_active, department:departments(id, name), '
        + 'profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)')
      .eq('organization_id', orgId)
      .in('id', visible),

    supabase
      .from('business_events')
      .select('event_type, subject_member_id, entity_id, occurred_at, payload')
      .eq('organization_id', orgId)
      .in('subject_member_id', visible)
      .gte('occurred_at', period.start)
      .lte('occurred_at', `${period.end}T23:59:59.999Z`),

    supabase
      .from('performance_targets')
      .select('subject_id, metric, target_value, currency')
      .eq('organization_id', orgId)
      .eq('subject_type', 'member')
      .in('subject_id', visible)
      .is('superseded_by', null)
      .lte('period_start', period.end).gte('period_end', period.start),

    supabase
      .from('deals')
      .select('owner_id, value, probability')
      .eq('organization_id', orgId).is('deleted_at', null)
      .in('owner_id', visible)
      .in('stage', ['prospecting', 'qualification', 'proposal', 'negotiation'])
      .limit(5000),

    supabase
      .from('crm_activities')
      .select('member_id')
      .eq('organization_id', orgId)
      .in('member_id', visible)
      .gte('created_at', period.start)
      .lte('created_at', `${period.end}T23:59:59.999Z`)
      .limit(20000),
  ]);

  const failed = [peopleRes, eventsRes, targetsRes, pipelineRes].find(r => r.error);
  if (failed?.error) return error(failed.error.message, 500);

  /* Bucket every input by member once, rather than filtering per person. */
  const eventsBy = new Map<string, RawEvent[]>();
  for (const e of (eventsRes.data ?? []) as any[]) {
    const key = e.subject_member_id;
    if (!key) continue;
    const row: RawEvent = {
      eventType: e.event_type, subjectMemberId: key, entityId: e.entity_id,
      occurredAt: e.occurred_at, payload: e.payload ?? {},
    };
    eventsBy.set(key, [...(eventsBy.get(key) ?? []), row]);
  }

  const activityBy = new Map<string, number>();
  for (const a of (activityRes.data ?? []) as any[]) {
    if (!a.member_id) continue;
    activityBy.set(a.member_id, (activityBy.get(a.member_id) ?? 0) + 1);
  }

  const pipelineBy = new Map<string, { open: number; weighted: number; count: number }>();
  for (const d of (pipelineRes.data ?? []) as any[]) {
    if (!d.owner_id) continue;
    const cur = pipelineBy.get(d.owner_id) ?? { open: 0, weighted: 0, count: 0 };
    cur.open += Number(d.value ?? 0);
    cur.weighted += (Number(d.value ?? 0) * Number(d.probability ?? 0)) / 100;
    cur.count += 1;
    pipelineBy.set(d.owner_id, cur);
  }

  const targetBy = new Map<string, number>();
  for (const t of (targetsRes.data ?? []) as any[]) {
    if (t.metric !== metric) continue;
    targetBy.set(t.subject_id, Number(t.target_value ?? 0));
  }

  const pace = periodPace(period, zone);

  const members = ((peopleRes.data ?? []) as any[])
    .map(p => {
      const achievement = rollUp(eventsBy.get(p.id) ?? []);
      const activities = activityBy.get(p.id) ?? 0;
      const pipe = pipelineBy.get(p.id) ?? { open: 0, weighted: 0, count: 0 };
      const target = targetBy.get(p.id) ?? null;
      const achieved = achievedFor(metric, achievement, activities);
      return {
        id: p.id,
        name: p.profiles?.full_name ?? 'Unknown member',
        jobTitle: p.profiles?.job_title ?? null,
        avatarUrl: p.profiles?.avatar_url ?? null,
        role: p.role,
        isActive: p.is_active !== false,
        department: p.department?.name ?? null,
        achievement: { ...achievement, activitiesLogged: activities },
        pipeline: pipe,
        target,
        achieved,
        progress: target && target > 0 ? achieved / target : null,
        self: p.id === org.memberId,
      };
    })
    /**
     * Everyone visible, including people who did nothing.
     *
     * A leaderboard that silently drops the bottom of the team is the
     * gamified version of this screen, and it is the version a manager cannot
     * use: the person with no closed business this quarter is precisely who
     * they are looking for.
     */
    .sort((a, b) => b.achieved - a.achieved || a.name.localeCompare(b.name));

  const totals = members.reduce(
    (acc, m) => ({
      revenueWon: acc.revenueWon + m.achievement.revenueWon,
      revenueCollected: acc.revenueCollected + m.achievement.revenueCollected,
      dealsWon: acc.dealsWon + m.achievement.dealsWon,
      dealsLost: acc.dealsLost + m.achievement.dealsLost,
      openPipeline: acc.openPipeline + m.pipeline.open,
      weightedPipeline: acc.weightedPipeline + m.pipeline.weighted,
      target: acc.target + (m.target ?? 0),
      achieved: acc.achieved + m.achieved,
      activitiesLogged: acc.activitiesLogged + m.achievement.activitiesLogged,
    }),
    {
      revenueWon: 0, revenueCollected: 0, dealsWon: 0, dealsLost: 0,
      openPipeline: 0, weightedPipeline: 0, target: 0, achieved: 0, activitiesLogged: 0,
    },
  );

  return success({
    period: { ...period, pace },
    currency: org.currency,
    metric,
    metricLabel: METRIC_META[metric]?.label ?? metric,
    metricUnit: METRIC_META[metric]?.unit ?? 'count',
    members,
    totals: {
      ...totals,
      winRate: totals.dealsWon + totals.dealsLost > 0
        ? totals.dealsWon / (totals.dealsWon + totals.dealsLost)
        : null,
      progress: totals.target > 0 ? totals.achieved / totals.target : null,
      headcount: members.length,
    },
    scope: scopeFor(org.role, 'performance'),
  });
}
