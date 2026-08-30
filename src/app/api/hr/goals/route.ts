import { collectionHandlers } from '@/lib/supabase/crud';
import { TARGET_METRICS } from '@/lib/performance';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Goals
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A goal is either measured or assessed, and the two are not interchangeable.
 *  A measured goal names a metric and its progress comes from
 *  `business_events` with nobody typing anything; an assessed goal is judged
 *  by a person in a review. `check_performance_goal()` refuses the
 *  combinations that would render as a lie - a measured goal with nothing to
 *  measure shows a progress bar stuck at zero and reads as "this person did
 *  nothing" rather than "nobody said what to count".
 *
 *  ── Why `create` and not `manage` ────────────────────────────────────────
 *
 *  People write their own goals in most companies, and a manager agrees them.
 *  The grant is the ordinary `create`, and the RLS policy bounds whose goals
 *  you may touch to `auth_visible_member_ids` - yourself, or your reports.
 */

const SELECT =
  '*, member:organization_members!performance_goals_member_id_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)), '
  + 'cycle:performance_cycles(id, name, period_start, period_end), '
  + 'target:performance_targets(id, metric, target_value, currency, period_start, period_end)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'performance_goals',
    module: 'hr',
    select: SELECT,
    searchColumns: ['title', 'description'],
    sortable: ['created_at', 'due_on', 'title', 'status', 'weight'],
    filterable: ['member_id', 'cycle_id', 'status', 'kind'],
    defaultSort: 'created_at',
  },
  {
    table: 'performance_goals',
    module: 'hr',
    select: SELECT,
    prepare: (b, ctx) => {
      if (!b.title?.trim()) throw new Error('Say what the goal is');

      const kind = b.kind === 'measured' ? 'measured' : 'assessed';
      if (kind === 'measured' && !TARGET_METRICS.includes(b.metric)) {
        throw new Error(`A measured goal needs a metric: ${TARGET_METRICS.join(', ')}`);
      }
      /*
       * Refused rather than quietly stripped. Silently dropping the metric
       * would save the goal in a shape the caller did not ask for, and the
       * person would find out at review time that the thing they thought was
       * being counted never was.
       */
      if (kind === 'assessed' && (b.metric || b.target_id)) {
        throw new Error('An assessed goal is judged, not counted. Remove the metric or make it a measured goal.');
      }

      const weight = Number(b.weight ?? 1);
      if (!Number.isFinite(weight) || weight < 1 || weight > 100) {
        throw new Error('Weight is a number from 1 to 100');
      }

      return {
        /* Yours unless you name somebody, and the policy checks you may. */
        member_id: b.member_id ?? ctx.org.memberId,
        cycle_id: b.cycle_id || null,
        title: b.title.trim(),
        description: b.description ?? '',
        kind,
        metric: kind === 'measured' ? b.metric : null,
        target_id: kind === 'measured' ? (b.target_id || null) : null,
        weight,
        status: b.status ?? 'active',
        due_on: b.due_on || null,
        created_by: ctx.org.memberId,
      };
    },
  },
);
