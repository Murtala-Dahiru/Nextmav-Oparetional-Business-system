import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT = '*, owner:organization_members!leads_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'leads', module: 'crm', select: SELECT, softDelete: true,
    searchColumns: ['first_name', 'last_name', 'email', 'company_name'],
    sortable: ['created_at', 'updated_at', 'first_name', 'last_name', 'status', 'score', 'estimated_value'],
    filterable: ['status', 'owner_id', 'source'],
  },
  {
    table: 'leads', module: 'crm', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.first_name?.trim() && !b.last_name?.trim() && !b.company_name?.trim()) {
        throw new Error('A lead needs at least a name or a company');
      }
      return {
        first_name: b.first_name ?? '', last_name: b.last_name ?? '',
        email: b.email || null, phone: b.phone ?? null,
        company_name: b.company_name ?? null, job_title: b.job_title ?? null,
        source: b.source ?? 'manual', status: b.status ?? 'new',
        score: Math.min(100, Math.max(0, Number(b.score) || 0)),
        estimated_value: Math.max(0, Number(b.estimated_value) || 0),
        notes: b.notes ?? '',
        // Unassigned leads get lost; default ownership to whoever created it.
        owner_id: b.owner_id ?? ctx.org.memberId,
      };
    },
  },
);
