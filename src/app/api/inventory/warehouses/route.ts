import { collectionHandlers } from '@/lib/supabase/crud';

export const { GET, POST } = collectionHandlers(
  {
    table: 'warehouses', module: 'inventory',
    searchColumns: ['name', 'location'],
    sortable: ['created_at', 'name', 'location', 'capacity'],
    filterable: ['is_active'],
  },
  {
    table: 'warehouses', module: 'inventory',
    prepare: (b) => {
      if (!b.name?.trim()) throw new Error('Warehouse name is required');
      return {
        name: b.name.trim(),
        location: b.location ?? '',
        capacity: Math.max(0, Number(b.capacity) || 0),
        is_active: b.is_active ?? true,
      };
    },
  },
);
