import { recordHandlers } from '@/lib/supabase/crud';
import { updateIncentiveRuleSchema } from '@/lib/validations';

/**
 * A single incentive rule.
 *
 * `manage`, like the create route, because these are compensation policy.
 *
 * `calculation` and `basis` are in the update schema on purpose: a rate does
 * legitimately change. What stops that rewriting history is
 * `check_incentive_rule()`, which bumps `version` whenever the terms move,
 * and `incentive_entries.rule_version`, which pins what each entry was
 * calculated under. The old entries keep their old sum and can still explain
 * themselves.
 *
 * Switching a rule off is the ordinary way to retire one. `DELETE` exists but
 * the foreign key from `incentive_entries` is `ON DELETE RESTRICT`, so a rule
 * that has ever paid anybody cannot be deleted at all - which is the correct
 * answer, and a better one than a cascade that would erase the reason a
 * payment happened.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'incentive_rules',
  module: 'performance',
  updateAction: 'manage',
  select: '*, creator:organization_members!incentive_rules_created_by_fkey('
    + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), '
    + 'department:departments!incentive_rules_applies_to_department_fkey(id, name), '
    + 'member:organization_members!incentive_rules_applies_to_member_fkey('
    + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))',
  updateSchema: updateIncentiveRuleSchema,
});
