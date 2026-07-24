import { recordHandlers } from '@/lib/supabase/crud';

export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'invoices', module: 'finance', softDelete: true,
});
