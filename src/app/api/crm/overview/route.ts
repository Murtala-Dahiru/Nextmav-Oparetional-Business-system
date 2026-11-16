import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { readReportRows, activityWeeks, shiftCalendarDay } from '@/lib/crm/reporting';
import { acquisitionSources, openDealAging, recordedLossReasons } from '@/lib/crm/insights';
import { can, scopeFor } from '@/lib/permissions';
import { todayIn, dateIn, daysFromTodayIn } from '@/lib/org-time';
import type { ModuleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The commercial position, in one request.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this is, and what it is not ─────────────────────────────────────
 *
 *  `/api/dashboard` answers "how is the company doing" for whoever runs it.
 *  This answers "how is the book doing, and what do I do next" for whoever
 *  sells. They overlap on exactly one figure - pipeline value - and diverge
 *  on everything else, which is why this is a second endpoint rather than a
 *  wider one: an executive does not need a stale-deal list and a salesperson
 *  does not need headcount.
 *
 *  ── Why it is one request ────────────────────────────────────────────────
 *
 *  The CRM the redesign replaced computed its figures by fetching
 *  `?pageSize=100` and calling `reduce()`. That is wrong in a way that is
 *  invisible until it matters: the totals are silently capped at a hundred
 *  records, and the hundred are the most recently *created*, so a workspace
 *  with more than a hundred deals showed a pipeline value that was neither the
 *  whole pipeline nor any meaningful part of it. The aggregates here come from
 *  `v_crm_pipeline_owner` and `v_crm_lead_funnel`, which are GROUP BYs over
 *  every row, and the row lists are separately bounded and explicitly ordered.
 *
 *  ── Scope ────────────────────────────────────────────────────────────────
 *
 *  `sales_staff` holds CRM at `scope: 'own'`. Until now nothing enforced that
 *  anywhere, so an account manager saw the whole company's book. Here the
 *  scope is applied, and it is also *reported* - the client says "Your
 *  pipeline" rather than "Pipeline" when it is narrowed, because a figure that
 *  silently means something different for different people is worse than
 *  either version of it.
 *
 *  ── Time ─────────────────────────────────────────────────────────────────
 *
 *  Every bound is the organisation's calendar day. `closed_at` is a
 *  `timestamptz`, so bucketing it by month in SQL would put a deal signed at
 *  half past eleven on the 31st into the wrong month for every workspace east
 *  of UTC. The buckets are built here, where the timezone is in hand.
 */

/** How far back the monthly series and the win-rate window reach. */
const MONTHS_BACK = 12;

/** Nothing touched in this many days is "gone quiet". */
const STALE_DAYS = 30;

/** How far ahead "closing soon" looks. */
const CLOSING_DAYS = 30;

const OPEN_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation'];
const CLOSED_STAGES = ['closed_won', 'closed_lost'];

const DEAL_ROW =
  'id, name, value, currency, stage, probability, expected_close, closed_at, created_at, updated_at, ' +
  'owner_id, company_id, company:companies(id, name), ' +
  'owner:organization_members!deals_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const LEAD_ROW =
  'id, first_name, last_name, email, company_name, status, score, estimated_value, ' +
  'source, owner_id, created_at, updated_at';

const ACTIVITY_ROW =
  'id, activity_type, subject, body, due_at, remind_at, completed_at, created_at, member_id, ' +
  'member:organization_members!crm_activities_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'company:companies(id, name), contact:contacts(id, first_name, last_name), ' +
  'lead:leads(id, first_name, last_name), deal:deals(id, name)';

/** The month key an instant falls in, in the organisation's own calendar. */
function monthOf(instant: string, zone: string): string {
  return dateIn(new Date(instant), zone).slice(0, 7);
}

/** The last `n` month keys, oldest first, ending with the current one. */
function monthKeys(zone: string, n: number): string[] {
  const [y, m] = todayIn(zone).slice(0, 7).split('-').map(Number);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

export async function GET() {
  const ctx = await authorize('crm', 'view');
  if (ctx instanceof Response) return ctx;

  const { supabase, org } = ctx;
  const orgId = org.organizationId;
  const zone = org.timezone;
  const scope = scopeFor(org.role, 'crm');
  const mine = scope === 'own';
  const sees = (m: ModuleId) => can(org.role, m, 'view');

  const today = todayIn(zone);
  const closingBy = daysFromTodayIn(zone, CLOSING_DAYS);
  const staleBefore = daysFromTodayIn(zone, -STALE_DAYS);
  const windowStart = monthKeys(zone, MONTHS_BACK)[0] + '-01';
  const activityStart = shiftCalendarDay(today, -55);
  // Over-read UTC boundaries, then filter using the organization's calendar.
  const windowQueryStart = shiftCalendarDay(windowStart, -1);
  const activityQueryStart = shiftCalendarDay(activityStart, -1);
  const report = (query: () => any) => readReportRows<any>((from, to) => query().range(from, to));

  /**
   * The owner filter, applied to a query builder.
   *
   * A function rather than a value because it has to be applied to eight
   * different queries and forgetting it on one of them is how a scoped screen
   * ends up leaking a single panel.
   */
  const own = (q: any) => (mine ? q.eq('owner_id', org.memberId) : q);

  const [
    pipelineRes, funnelRes, closedRes, closingRes, staleRes, topRes,
    followupRes, recentRes, volumeRes, newLeadsRes, membersRes, movementRes, scheduledRes,
    sourceRes, agingRes, diaryRes,
  ] = await Promise.all([
    report(() => own(supabase.from('v_crm_pipeline_owner').select('*', { count: 'exact' }).eq('organization_id', orgId)).order('owner_id').order('stage')),

    report(() => own(supabase.from('v_crm_lead_funnel').select('*', { count: 'exact' }).eq('organization_id', orgId)).order('owner_id').order('status')),

    /**
     * Closed business inside the window.
     *
     * Bounded by time rather than by count, which is the bound that makes
     * sense: "the last twelve months" is a fixed question whose answer grows
     * with the company, and a `limit(100)` on it would quietly become wrong
     * at exactly the point the company got interesting.
     */
    report(() => own(
      supabase.from('deals')
        .select('id, name, value, currency, stage, closed_at, created_at, owner_id, lost_reason', { count: 'exact' })
        .eq('organization_id', orgId).eq('currency', org.currency).is('deleted_at', null)
        .in('stage', CLOSED_STAGES)
        .gte('closed_at', windowQueryStart)
        .order('closed_at', { ascending: false }).order('id'),
    )),

    own(
      supabase.from('deals').select(DEAL_ROW, { count: 'exact' })
        .eq('organization_id', orgId).eq('currency', org.currency).is('deleted_at', null)
        .in('stage', OPEN_STAGES)
        .not('expected_close', 'is', null)
        .lte('expected_close', closingBy)
        .order('expected_close', { ascending: true })
        .limit(12),
    ),

    /**
     * Gone quiet.
     *
     * `updated_at` rather than the last activity, deliberately: an activity is
     * one of several ways a deal moves, and `trg_set_updated_at` catches all
     * of them. A deal whose value, stage, close date or owner changed
     * yesterday is not stale, however long since anybody logged a call.
     */
    own(
      supabase.from('deals').select(DEAL_ROW, { count: 'exact' })
        .eq('organization_id', orgId).eq('currency', org.currency).is('deleted_at', null)
        .in('stage', OPEN_STAGES)
        .lt('updated_at', staleBefore)
        .order('updated_at', { ascending: true })
        .limit(12),
    ),

    own(
      supabase.from('deals').select(DEAL_ROW)
        .eq('organization_id', orgId).eq('currency', org.currency).is('deleted_at', null)
        .in('stage', OPEN_STAGES)
        .order('value', { ascending: false })
        .limit(8),
    ),

    /**
     * The follow-up queue.
     *
     * Scoped to the caller whatever their role: a follow-up is a diary entry,
     * and an administrator opening CRM Home wants their own diary, not
     * everybody's. The queue is the one panel on this page that is personal by
     * definition rather than by permission.
     */
    supabase.from('crm_activities').select(ACTIVITY_ROW)
      .eq('organization_id', orgId)
      .eq('member_id', org.memberId)
      .is('completed_at', null)
      .not('due_at', 'is', null)
      .order('due_at', { ascending: true })
      .limit(60),

    supabase.from('crm_activities').select(ACTIVITY_ROW)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(12),

    // Just the timestamps: this feeds a bar per week and nothing else.
    report(() => supabase.from('crm_activities').select('id, created_at, activity_type', { count: 'exact' })
      .eq('organization_id', orgId)
      .gte('created_at', activityQueryStart)
      .order('id')),

    own(
      supabase.from('leads').select(LEAD_ROW, { count: 'exact' })
        .eq('organization_id', orgId).is('deleted_at', null)
        .eq('status', 'new')
        .order('created_at', { ascending: true })
        .limit(12),
    ),

    report(() => supabase.from('organization_members')
      .select('id, profiles!organization_members_user_id_fkey(full_name, avatar_url)', { count: 'exact' })
      .eq('organization_id', orgId).order('id')),

    /**
     * Deal movement over the last eight weeks.
     *
     * 0028's `deal_stage_events` is the only honest source for this: `deals`
     * knows where a deal is, not where it has been. Without the table the
     * screen would have to infer movement from `updated_at`, which changes for
     * every edit and would report a corrected typo as pipeline progress.
     */
    report(() => {
      let q = supabase.from('deal_stage_events')
        .select('id, deal_id, from_stage, to_stage, value_at, created_at, deal:deals!inner(owner_id, deleted_at)', { count: 'exact' })
        .eq('organization_id', orgId)
        .is('deal.deleted_at', null)
        .gte('created_at', activityQueryStart)
        .order('created_at', { ascending: false }).order('id');
      if (mine) q = q.eq('deal.owner_id', org.memberId);
      return q;
    }),

    /**
     * Which deals have an open follow-up against them, from anybody.
     *
     * Ids only. "This deal is closing in a week and nobody has arranged to
     * speak to them" is one of the few genuinely useful things a CRM can tell
     * you, and it cannot be computed from the caller's own diary - a
     * colleague's follow-up counts. Reading the whole open queue as bare ids
     * is one index scan and a few kilobytes.
     */
    report(() => supabase.from('crm_activities')
      .select('id, deal_id, company_id', { count: 'exact' })
      .eq('organization_id', orgId)
      .is('completed_at', null)
      .not('due_at', 'is', null)
      .order('id')),
    report(() => own(supabase.from('leads')
      .select('id, source, created_at, converted_at', { count: 'exact' })
      .eq('organization_id', orgId).is('deleted_at', null)).order('id')),
    report(() => own(supabase.from('deals')
      .select('id, created_at, value', { count: 'exact' })
      .eq('organization_id', orgId).eq('currency', org.currency).is('deleted_at', null)
      .in('stage', OPEN_STAGES)).order('id')),
    report(() => supabase.from('crm_activities')
      .select('id, due_at', { count: 'exact' }).eq('organization_id', orgId)
      .eq('member_id', org.memberId).is('completed_at', null)
      .not('due_at', 'is', null).order('id')),
  ]);

  const firstError = [pipelineRes, funnelRes, closedRes, closingRes, staleRes, topRes,
    followupRes, recentRes, volumeRes, newLeadsRes, membersRes, movementRes, scheduledRes,
    sourceRes, agingRes, diaryRes]
    .find(result => result.error)?.error;
  if (firstError?.code === 'CRM_REPORT_INCOMPLETE') {
    return error('The CRM report could not be read completely. Retry; if this persists, contact your administrator.', 503, 'CRM_REPORT_INCOMPLETE');
  }
  if (firstError) return pgError(firstError);

  /* ── Owners ────────────────────────────────────────────────────────────── */

  const nameOf = new Map<string, { fullName: string; avatar: string }>();
  for (const m of (membersRes.data ?? []) as any[]) {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    nameOf.set(m.id, { fullName: p?.full_name ?? '', avatar: p?.avatar_url ?? '' });
  }

  /* ── Pipeline ──────────────────────────────────────────────────────────── */

  const pipelineRows = (pipelineRes.data ?? []) as any[];

  const stages = OPEN_STAGES.concat(CLOSED_STAGES).map(stage => {
    const rows = pipelineRows.filter(r => r.stage === stage);
    return {
      stage,
      count: rows.reduce((s, r) => s + Number(r.deal_count ?? 0), 0),
      value: rows.reduce((s, r) => s + Number(r.total_value ?? 0), 0),
      weighted: rows.reduce((s, r) => s + Number(r.weighted_value ?? 0), 0),
    };
  });

  const openStages = stages.filter(s => OPEN_STAGES.includes(s.stage));
  const wonStage = stages.find(s => s.stage === 'closed_won')!;
  const lostStage = stages.find(s => s.stage === 'closed_lost')!;

  const pipelineValue = openStages.reduce((s, r) => s + r.value, 0);
  const weightedPipeline = openStages.reduce((s, r) => s + r.weighted, 0);
  const openCount = openStages.reduce((s, r) => s + r.count, 0);

  /* ── Owner performance ─────────────────────────────────────────────────── */

  const ownerIds = [...new Set(pipelineRows.map(r => r.owner_id).filter(Boolean))];
  const owners = ownerIds.map(id => {
    const rows = pipelineRows.filter(r => r.owner_id === id);
    const at = (stage: string) => rows.find(r => r.stage === stage);
    const won = at('closed_won');
    const lost = at('closed_lost');
    const wonCount = Number(won?.deal_count ?? 0);
    const lostCount = Number(lost?.deal_count ?? 0);
    const decided = wonCount + lostCount;
    return {
      memberId: id,
      name: nameOf.get(id)?.fullName || 'Unassigned',
      wonValue: Number(won?.total_value ?? 0),
      wonCount,
      lostCount,
      openValue: rows
        .filter(r => OPEN_STAGES.includes(r.stage))
        .reduce((s, r) => s + Number(r.total_value ?? 0), 0),
      openCount: rows
        .filter(r => OPEN_STAGES.includes(r.stage))
        .reduce((s, r) => s + Number(r.deal_count ?? 0), 0),
      winRate: decided ? Math.round((wonCount / decided) * 100) : null,
    };
  }).sort((a, b) => b.wonValue - a.wonValue);

  /* ── Revenue over time, and the cycle ──────────────────────────────────── */

  const closed = ((closedRes.data ?? []) as any[]).filter(d => {
    if (!d.closed_at) return false;
    const day = dateIn(new Date(d.closed_at), zone);
    return day >= windowStart && day <= today;
  });
  const keys = monthKeys(zone, MONTHS_BACK);
  const empty = () => ({ won: 0, wonCount: 0, lost: 0, lostCount: 0 });
  const byMonth = new Map(keys.map(k => [k, empty()]));

  let cycleTotal = 0;
  let cycleCount = 0;

  for (const d of closed) {
    if (!d.closed_at) continue;
    const bucket = byMonth.get(monthOf(d.closed_at, zone));
    if (!bucket) continue;
    if (d.stage === 'closed_won') {
      bucket.won += Number(d.value ?? 0);
      bucket.wonCount += 1;
      /**
       * The sales cycle, measured from the deal being written down.
       *
       * Not from the first stage event: for a deal created before 0028 the
       * backfilled event is dated from the deal itself, so the two agree, and
       * where they would not agree `created_at` is the one a salesperson
       * means by "how long did it take".
       */
      const opened = new Date(d.created_at).getTime();
      const shut = new Date(d.closed_at).getTime();
      if (Number.isFinite(opened) && shut > opened) {
        cycleTotal += (shut - opened) / 86_400_000;
        cycleCount += 1;
      }
    } else {
      bucket.lost += Number(d.value ?? 0);
      bucket.lostCount += 1;
    }
  }

  const revenueByMonth = keys.map(k => ({ period: k, ...byMonth.get(k)! }));
  const thisMonth = revenueByMonth[revenueByMonth.length - 1];
  const lastMonth = revenueByMonth[revenueByMonth.length - 2];

  const wonInWindow = closed.filter(d => d.stage === 'closed_won');
  const lostInWindow = closed.filter(d => d.stage === 'closed_lost');
  const decidedInWindow = wonInWindow.length + lostInWindow.length;

  /* ── Leads ─────────────────────────────────────────────────────────────── */

  const funnelRows = (funnelRes.data ?? []) as any[];
  const leadStatus = (status: string) => {
    const rows = funnelRows.filter(r => r.status === status);
    return {
      status,
      count: rows.reduce((s, r) => s + Number(r.lead_count ?? 0), 0),
      value: rows.reduce((s, r) => s + Number(r.estimated_value ?? 0), 0),
    };
  };

  const leadStages = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost']
    .map(leadStatus);

  const leadTotal = leadStages.reduce((s, r) => s + r.count, 0);
  const leadWon = leadStages.find(s => s.status === 'won')?.count ?? 0;
  const leadLost = leadStages.find(s => s.status === 'lost')?.count ?? 0;
  const leadOpen = leadTotal - leadWon - leadLost;
  const leadConverted = funnelRows.reduce((s, r) => s + Number(r.converted_count ?? 0), 0);

  /* ── Follow-ups ────────────────────────────────────────────────────────── */

  const followups = ((followupRes.data ?? []) as any[]).map(a => {
    const day = dateIn(new Date(a.due_at), zone);
    return {
      ...a,
      when: day < today ? 'overdue' : day === today ? 'today' : 'upcoming',
    };
  });
  const diaryCounts = { overdue: 0, today: 0, upcoming: 0 };
  for (const activity of diaryRes.data ?? []) {
    const day = dateIn(new Date(activity.due_at), zone);
    diaryCounts[day < today ? 'overdue' : day === today ? 'today' : 'upcoming']++;
  }

  /* ── Activity volume, by week ──────────────────────────────────────────── */

  const weeks = activityWeeks((volumeRes.data ?? []).map(a => a.created_at), today, zone);

  /* ── Movement ──────────────────────────────────────────────────────────── */

  const moves = ((movementRes.data ?? []) as any[]).filter(m => {
    const day = dateIn(new Date(m.created_at), zone);
    return day >= activityStart && day <= today;
  });
  const order = OPEN_STAGES.concat(CLOSED_STAGES);
  const advanced = moves.filter(
    m => m.from_stage && order.indexOf(m.to_stage) > order.indexOf(m.from_stage)
      && !CLOSED_STAGES.includes(m.to_stage),
  ).length;
  const slipped = moves.filter(
    m => m.from_stage && order.indexOf(m.to_stage) < order.indexOf(m.from_stage),
  ).length;

  /* ── Which deals nobody has arranged to speak to ───────────────────────── */

  const scheduledDeals = new Set(
    ((scheduledRes.data ?? []) as any[]).map(r => r.deal_id).filter(Boolean),
  );
  const scheduledCompanies = new Set(
    ((scheduledRes.data ?? []) as any[]).map(r => r.company_id).filter(Boolean),
  );

  /**
   * Marked on the row rather than counted here.
   *
   * The screen decides how to say it - "closing in six days, nothing
   * scheduled" reads differently from a bare count of nine - and the flag is
   * the only part the server can know, because a colleague's follow-up counts
   * and the caller cannot see somebody else's diary.
   */
  const flag = (rows: any[]) => rows.map(d => ({
    ...d,
    hasNextAction: scheduledDeals.has(d.id)
      || (d.company_id ? scheduledCompanies.has(d.company_id) : false),
  }));

  return success({
    insights: {
      sources: acquisitionSources(sourceRes.data ?? []),
      aging: openDealAging(agingRes.data ?? [], today, zone),
      lossReasons: recordedLossReasons(closed),
    },
    queueCounts: {
      closing: closingRes.count ?? 0,
      stale: staleRes.count ?? 0,
      unworked: newLeadsRes.count ?? 0,
      ...diaryCounts,
    },
    scope,
    currency: org.currency,
    /** Which cross-module links CRM Home may offer. */
    sees: { finance: sees('finance'), projects: sees('projects'), support: sees('support') },

    revenue: {
      wonThisMonth: thisMonth?.won ?? 0,
      wonLastMonth: lastMonth?.won ?? 0,
      wonThisYear: revenueByMonth.reduce((s, m) => s + m.won, 0),
      wonAll: wonStage.value,
      lostAll: lostStage.value,
      pipelineValue,
      weightedPipeline,
      openCount,
      wonCount: wonStage.count,
      lostCount: lostStage.count,
      /**
       * Over the window, not over all time.
       *
       * A win rate that includes every deal ever recorded stops moving after
       * the first year, which makes it useless as a signal - and it is the
       * figure people quote. Twelve months is what "how are we doing" means.
       */
      winRate: decidedInWindow
        ? Math.round((wonInWindow.length / decidedInWindow) * 100)
        : null,
      averageDeal: wonInWindow.length
        ? wonInWindow.reduce((s, d) => s + Number(d.value ?? 0), 0) / wonInWindow.length
        : 0,
      averageCycleDays: cycleCount ? Math.round(cycleTotal / cycleCount) : null,
      byMonth: revenueByMonth,
    },

    stages,
    owners,

    leads: {
      total: leadTotal,
      open: leadOpen,
      won: leadWon,
      lost: leadLost,
      converted: leadConverted,
      /**
       * Conversion, stated as the share of *decided* leads that were won.
       *
       * Counting open leads in the denominator would make the rate fall every
       * time somebody added a lead, which is the opposite of what the number
       * is for.
       */
      conversionRate: leadWon + leadLost
        ? Math.round((leadWon / (leadWon + leadLost)) * 100)
        : null,
      byStatus: leadStages,
      unworked: newLeadsRes.data ?? [],
    },

    movement: { advanced, slipped, total: moves.length },
    activityByWeek: weeks,

    closingSoon: flag((closingRes.data ?? []) as any[]),
    stale: flag((staleRes.data ?? []) as any[]),
    topDeals: flag((topRes.data ?? []) as any[]),
    followups,
    recentActivity: recentRes.data ?? [],
  });
}
