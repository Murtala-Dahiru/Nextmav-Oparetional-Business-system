import { collectionHandlers } from '@/lib/supabase/crud';

export const { GET, POST } = collectionHandlers(
  {
    table: 'companies', module: 'crm', softDelete: true,
    searchColumns: ['name', 'industry', 'city', 'country', 'email'],
    sortable: ['created_at', 'updated_at', 'name', 'industry', 'employee_count', 'annual_revenue'],
    filterable: ['industry', 'owner_id', 'country'],
  },
  {
    table: 'companies', module: 'crm',
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Company name is required');
      return {
        name: b.name.trim(), industry: b.industry ?? null, website: b.website ?? null,
        email: b.email || null, phone: b.phone ?? null, address: b.address ?? null,
        city: b.city ?? null, country: b.country ?? null,
        employee_count: b.employee_count ? Number(b.employee_count) : null,
        annual_revenue: b.annual_revenue ? Number(b.annual_revenue) : null,
        notes: b.notes ?? '', owner_id: b.owner_id ?? ctx.org.memberId,
      };
    },
  },
);
