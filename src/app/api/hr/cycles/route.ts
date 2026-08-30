import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * Review cycles.
 *
 * Readable by anybody who can open HR, because when review season runs is
 * company-wide news rather than a secret. Writable on `manage`, which only
 * owner, administrator and HR hold: a manager runs reviews inside a cycle,
 * they do not decide when the company holds one.
 */
const SELECT =
  '*, creator:organization_members!performance_cycles_created_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'performance_cycles',
    module: 'hr',
    select: SELECT,
    searchColumns: ['name', 'description'],
    sortable: ['created_at', 'period_start', 'period_end', 'name', 'status'],
    filterable: ['status'],
    defaultSort: 'period_start',
  },
  {
    table: 'performance_cycles',
    module: 'hr',
    action: 'manage',
    select: SELECT,
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Give the cycle a name, like "H2 2026"');
      const start = String(b.period_start ?? '');
      const end = String(b.period_end ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        throw new Error('A cycle needs a start and an end date');
      }
      if (end < start) throw new Error('The cycle ends before it starts');
      return {
        name: b.name.trim(),
        description: b.description ?? '',
        period_start: start,
        period_end: end,
        status: b.status ?? 'planning',
        created_by: ctx.org.memberId,
      };
    },
  },
);
