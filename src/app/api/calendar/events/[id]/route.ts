import { recordHandlers } from '@/lib/supabase/crud';

export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'calendar_events', module: 'calendar', softDelete: false,
});
