import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT = '*, company:companies(id, name)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'contacts', module: 'crm', select: SELECT, softDelete: true,
    searchColumns: ['first_name', 'last_name', 'email', 'job_title'],
    sortable: ['created_at', 'updated_at', 'first_name', 'last_name', 'email'],
    filterable: ['company_id', 'owner_id', 'is_active'],
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
    }),
  },
);
