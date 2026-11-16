import { collectionHandlers } from '@/lib/supabase/crud';
import { companyListScope } from '@/lib/crm/company-list-scope';

export const { GET, POST } = collectionHandlers(
  {
    table: 'companies', module: 'crm', softDelete: true,
    select: '*, custom_values:crm_company_values, owner:organization_members!companies_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name))',
    searchColumns: ['name', 'industry', 'city', 'country', 'email'],
    sortable: ['created_at', 'updated_at', 'name', 'industry', 'employee_count', 'annual_revenue'],
    filterable: ['industry', 'owner_id', 'country', 'parent_company_id', 'domain'],
    scope: companyListScope,
  },
  {
    table: 'companies', module: 'crm',
    select: '*, custom_values:crm_company_values',
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Company name is required');
      return {
        name: b.name.trim(), industry: b.industry ?? null, website: b.website ?? null,
        email: b.email || null, phone: b.phone ?? null, address: b.address ?? null,
        city: b.city ?? null, country: b.country ?? null,
        employee_count: b.employee_count ? Number(b.employee_count) : null,
        annual_revenue: b.annual_revenue ? Number(b.annual_revenue) : null,
        notes: b.notes ?? '', owner_id: b.owner_id ?? ctx.org.memberId,
      custom_values: b.custom_values ?? {},
      };
    },
  },
);
