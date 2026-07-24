import { recordHandlers } from '@/lib/supabase/crud';

export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'expenses', module: 'hr', softDelete: true,
});
