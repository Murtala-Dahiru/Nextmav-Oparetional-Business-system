import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT = '*, department:departments(id, name), owner:organization_members!projects_owner_id_fkey(id), client:companies(id, name)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'projects', module: 'projects', select: SELECT, softDelete: true,
    searchColumns: ['name', 'description'],
    sortable: ['created_at', 'updated_at', 'name', 'status', 'priority', 'budget', 'start_date', 'end_date'],
    filterable: ['status', 'priority', 'owner_id', 'department_id'],
  },
  {
    table: 'projects', module: 'projects', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Project name is required');
      if (b.start_date && b.end_date && b.end_date < b.start_date) {
        throw new Error('End date cannot be before the start date');
      }
      return {
        name: b.name.trim(), description: b.description ?? '',
        status: b.status ?? 'planning', priority: b.priority ?? 'medium',
        department_id: b.department_id || null, team_id: b.team_id || null,
        client_company_id: b.client_company_id || null,
        budget: Math.max(0, Number(b.budget) || 0),
        start_date: b.start_date || null, end_date: b.end_date || null,
        owner_id: b.owner_id ?? ctx.org.memberId,
      };
    },
  },
);
