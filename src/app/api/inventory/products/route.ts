import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT = '*, warehouse:warehouses(id, name), supplier:suppliers(id, name, lead_time_days)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'products', module: 'inventory', select: SELECT, softDelete: true,
    searchColumns: ['name', 'sku', 'description', 'category'],
    sortable: ['created_at', 'updated_at', 'name', 'sku', 'category', 'price', 'stock'],
    filterable: ['category', 'warehouse_id', 'supplier_id', 'is_active'],
  },
  {
    table: 'products', module: 'inventory', select: SELECT,
    prepare: (b) => {
      if (!b.sku?.trim()) throw new Error('SKU is required');
      if (!b.name?.trim()) throw new Error('Product name is required');
      return {
        sku: b.sku.trim(),
        name: b.name.trim(),
        description: b.description ?? '',
        category: b.category ?? 'general',
        unit: b.unit ?? 'unit',
        price: Math.max(0, Number(b.price) || 0),
        cost: Math.max(0, Number(b.cost) || 0),
        reorder_level: Math.max(0, Number(b.reorder_level) || 10),
        warehouse_id: b.warehouse_id || null,
        supplier_id: b.supplier_id || null,
        is_active: b.is_active ?? true,
        // `stock` is deliberately omitted: it is the running total of the
        // movement ledger, written only by record_stock_movement(). Accepting
        // it here would let the balance and its own history disagree.
      };
    },
  },
);
