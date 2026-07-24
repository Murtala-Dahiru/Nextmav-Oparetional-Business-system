import { recordHandlers } from '@/lib/supabase/crud';

export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'workspace_pages', module: 'workspace', softDelete: true,
});
