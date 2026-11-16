import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT = '*, company:companies(id, name), owner:organization_members!contacts_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'contacts', module: 'crm', select: SELECT, softDelete: true,
    searchColumns: ['first_name', 'last_name', 'email', 'job_title'],
    sortable: ['created_at', 'updated_at', 'first_name', 'last_name', 'email'],
    filterable: ['company_id', 'owner_id', 'is_active'],
    scope: (q, _ctx, url) => { const role = url.searchParams.get('relationshipRole')?.trim(); return role ? q.eq('crm_profile->>relationshipRole', role) : q; },
  },
  {
    table: 'contacts', module: 'crm', select: SELECT,
    prepare: (b, ctx) => ({
      first_name: b.first_name ?? '', last_name: b.last_name ?? '',
      email: b.email || null, phone: b.phone ?? null,
      job_title: b.job_title ?? null, company_id: b.company_id || null,
      source: b.source ?? null, notes: b.notes ?? '',
      is_active: b.is_active ?? true,
      owner_id: b.owner_id ?? ctx.org.memberId,
      custom_values: b.custom_values ?? {},
    }),
  },
);
