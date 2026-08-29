import { collectionHandlers } from '@/lib/supabase/crud';
import { TARGET_METRICS } from '@/lib/performance';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Targets: the only thing in the performance layer that is written down.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Everything else here is derived from `business_events` on read. A target
 *  is an input - nothing in the CRM implies that somebody agreed to close
 *  forty million this quarter - so it is a row, and this is its endpoint.
 *
 *  ── What guards this ─────────────────────────────────────────────────────
 *
 *  Three things, in layers, and each catches what the others cannot:
 *
 *    · `authorize('performance', 'create' | 'edit')` decides whether the
 *      endpoint answers at all. `employee` and `sales_staff` hold `view`
 *      only, so they never reach the body.
 *
 *    · The RLS policy `performance_targets_write` bounds *whose* target a
 *      manager may set to `auth_visible_member_ids` - their department and
 *      their direct reports. A manager cannot set a target for another
 *      department by posting its member id.
 *
 *    · `check_performance_target()` refuses a subject that is not in the
 *      organisation, and refuses to change the number on a period that has
 *      already closed. A quota history that can be rewritten is not one.
 *
 *  The route itself validates shape, and deliberately does not re-implement
 *  any of the three. `prepare` throwing on a bad metric is about giving a
 *  readable message, not about safety.
 */

const SELECT =
  '*, setter:organization_members!performance_targets_set_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const SUBJECTS = ['member', 'team', 'department'];

export const { GET, POST } = collectionHandlers(
  {
    table: 'performance_targets',
    module: 'performance',
    select: SELECT,
    sortable: ['created_at', 'period_start', 'period_end', 'target_value', 'metric'],
    filterable: ['subject_type', 'subject_id', 'metric'],
    defaultSort: 'period_start',
    /**
     * No `scope` hook.
     *
     * Unlike the CRM tables, this one's row visibility is enforced by RLS:
     * `performance_targets_select` already bounds member targets to
     * `auth_visible_member_ids`. Adding an application filter on top would be
     * a second answer to the same question, and the two would drift the way
     * `ROLE_GRANTS` and `can_access_module` have.
     */
  },
  {
    table: 'performance_targets',
    module: 'performance',
    select: SELECT,
    prepare: (b, ctx) => {
      const subjectType = String(b.subject_type ?? 'member');
      if (!SUBJECTS.includes(subjectType)) {
        throw new Error('A target is set on a member, a team or a department');
      }
      if (!b.subject_id) {
        throw new Error('Choose who this target is for');
      }
      if (!TARGET_METRICS.includes(b.metric)) {
        throw new Error(`Choose one of: ${TARGET_METRICS.join(', ')}`);
      }

      const start = String(b.period_start ?? '');
      const end = String(b.period_end ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        throw new Error('A target needs a start and end date');
      }
      if (end < start) {
        throw new Error('The period ends before it starts');
      }

      const value = Number(b.target_value);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('A target has to be a number above zero');
      }

      return {
        subject_type: subjectType,
        subject_id: b.subject_id,
        metric: b.metric,
        period_label: b.period_label ?? '',
        period_start: start,
        period_end: end,
        target_value: value,
        /* Frozen at the time it is set, for the reason events freeze theirs. */
        currency: b.currency ?? ctx.org.currency,
        notes: b.notes ?? '',
        set_by: ctx.org.memberId,
      };
    },
  },
);
