import { collectionHandlers } from '@/lib/supabase/crud';

export const { GET, POST } = collectionHandlers(
  {
    table: 'suppliers', module: 'inventory', softDelete: true,
    searchColumns: ['name', 'contact_name', 'email', 'city'],
    sortable: ['created_at', 'name', 'contact_name', 'lead_time_days'],
    filterable: ['is_active', 'country'],
  },
  {
    table: 'suppliers', module: 'inventory',
    prepare: (b) => {
      if (!b.name?.trim()) throw new Error('Supplier name is required');
      return {
        name: b.name.trim(),
        contact_name: b.contact_name ?? '',
        email: b.email || null,
        phone: b.phone ?? null,
        address: b.address ?? null,
        city: b.city ?? null,
        country: b.country ?? null,
        // Lead time drives the reorder report's judgement about whether stock
        // will arrive before it runs out.
        lead_time_days: Math.min(365, Math.max(0, Number(b.lead_time_days) || 7)),
        payment_terms: b.payment_terms ?? 'net30',
        notes: b.notes ?? '',
        is_active: b.is_active ?? true,
      };
    },
  },
);
