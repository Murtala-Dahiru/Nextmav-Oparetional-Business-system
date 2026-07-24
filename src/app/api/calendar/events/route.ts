import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT =
  '*, creator:organization_members!calendar_events_created_by_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'calendar_events', module: 'calendar', select: SELECT,
    searchColumns: ['title', 'description', 'location'],
    sortable: ['starts_at', 'ends_at', 'created_at', 'title'],
    // A calendar is read chronologically, not by creation order.
    defaultSort: 'starts_at',
    filterable: ['visibility', 'department_id', 'project_id'],
  },
  {
    table: 'calendar_events', module: 'calendar', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.title?.trim()) throw new Error('Event title is required');
      if (!b.starts_at || !b.ends_at) throw new Error('Start and end times are required');
      if (new Date(b.ends_at) < new Date(b.starts_at)) {
        throw new Error('An event cannot end before it starts');
      }
      return {
        title: b.title.trim(),
        description: b.description ?? '',
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        all_day: b.all_day ?? false,
        location: b.location ?? null,
        colour: b.colour ?? '#10b981',
        visibility: b.visibility ?? 'organization',
        department_id: b.department_id || null,
        project_id: b.project_id || null,
        created_by: ctx.org.memberId,
      };
    },
  },
);
