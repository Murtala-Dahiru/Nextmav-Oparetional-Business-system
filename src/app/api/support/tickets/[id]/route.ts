import { recordHandlers } from '@/lib/supabase/crud';

export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'support_tickets', module: 'support', softDelete: true,
});
