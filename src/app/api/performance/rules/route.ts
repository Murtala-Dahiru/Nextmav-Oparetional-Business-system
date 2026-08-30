import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Incentive rules
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Readable by everybody, writable by almost nobody ─────────────────────
 *
 *  The list is guarded on `performance.view`, which every internal role
 *  holds, and the RLS policy behind it is deliberately open to the whole
 *  organisation. A commission scheme people cannot read is not a scheme, it
 *  is a rumour, and the requirement that employees understand how their
 *  incentives are calculated cannot be met by a table only administrators can
 *  see.
 *
 *  Writing is `manage`, which only owner, administrator and HR hold, and the
 *  RLS policy `incentive_rules_write` says the same thing again in the
 *  database. Compensation policy is not a department head's to write, which
 *  is why `manager` has `approve` on this module and not `manage`.
 *
 *  ── What the route does not check ────────────────────────────────────────
 *
 *  The shape of `calculation`. `check_incentive_rule()` does that, and does
 *  it for every writer including a migration or a psql session, which a route
 *  cannot. The messages it raises are written to be read by a person, so they
 *  travel back through `pgError` unchanged.
 */

const SELECT =
  '*, creator:organization_members!incentive_rules_created_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), '
  + 'department:departments!incentive_rules_applies_to_department_fkey(id, name), '
  + 'member:organization_members!incentive_rules_applies_to_member_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const TRIGGERS = ['deal.won', 'invoice.paid', 'lead.qualified', 'lead.converted'];
const BASES = ['booked_revenue', 'collected_revenue', 'per_event'];

export const { GET, POST } = collectionHandlers(
  {
    table: 'incentive_rules',
    module: 'performance',
    select: SELECT,
    searchColumns: ['name', 'description'],
    sortable: ['created_at', 'name', 'effective_from', 'trigger_event'],
    filterable: ['trigger_event', 'basis', 'is_active', 'applies_to_role'],
    defaultSort: 'created_at',
  },
  {
    table: 'incentive_rules',
    module: 'performance',
    /**
     * `manage`, not `create`.
     *
     * A manager holds `create` on this module so they can set targets. Rules
     * are a different thing entirely, and letting the same grant cover both
     * would mean a department head could write their own team's commission
     * rate.
     */
    action: 'manage',
    select: SELECT,
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Give the rule a name people will recognise');
      if (!TRIGGERS.includes(b.trigger_event)) {
        throw new Error(`Choose what fires it: ${TRIGGERS.join(', ')}`);
      }
      if (!BASES.includes(b.basis ?? 'booked_revenue')) {
        throw new Error(`Choose a basis: ${BASES.join(', ')}`);
      }
      if (!b.calculation || typeof b.calculation !== 'object') {
        throw new Error('A rule needs a calculation');
      }

      return {
        name: b.name.trim(),
        description: b.description ?? '',
        basis: b.basis ?? 'booked_revenue',
        trigger_event: b.trigger_event,
        calculation: b.calculation,
        applies_to_role: b.applies_to_role || null,
        applies_to_department: b.applies_to_department || null,
        applies_to_member: b.applies_to_member || null,
        effective_from: b.effective_from ?? new Date().toISOString().slice(0, 10),
        effective_to: b.effective_to || null,
        is_active: b.is_active ?? true,
        created_by: ctx.org.memberId,
      };
    },
  },
);
