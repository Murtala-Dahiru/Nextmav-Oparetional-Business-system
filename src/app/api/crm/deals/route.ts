import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT = '*, company:companies(id, name), contact:contacts(id, first_name, last_name)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'deals', module: 'crm', select: SELECT, softDelete: true,
    searchColumns: ['name', 'notes'],
    sortable: ['created_at', 'updated_at', 'name', 'value', 'stage', 'probability', 'expected_close'],
    filterable: ['stage', 'owner_id', 'company_id'],
  },
  {
    table: 'deals', module: 'crm', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Deal name is required');
      const probability = Math.min(100, Math.max(0, Number(b.probability) ?? 20));
      return {
        name: b.name.trim(),
        company_id: b.company_id || null, contact_id: b.contact_id || null,
        stage: b.stage ?? 'prospecting',
        value: Math.max(0, Number(b.value) || 0),
        probability,
        expected_close: b.expected_close || null,
        notes: b.notes ?? '', owner_id: b.owner_id ?? ctx.org.memberId,
      };
    },
  },
);
