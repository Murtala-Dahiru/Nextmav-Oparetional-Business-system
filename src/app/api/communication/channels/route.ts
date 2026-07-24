import { collectionHandlers } from '@/lib/supabase/crud';

export const { GET, POST } = collectionHandlers(
  {
    table: 'channels', module: 'communication',
    searchColumns: ['name', 'description'],
    sortable: ['created_at', 'name', 'type'],
    filterable: ['type', 'department_id', 'is_archived'],
  },
  {
    table: 'channels', module: 'communication',
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Channel name is required');
      // Normalised to a slug so "#General" and "#general" cannot become two
      // separate channels that half the company is missing from.
      const slug = b.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!slug) throw new Error('Channel name must contain letters or numbers');
      return {
        name: slug,
        description: b.description ?? '',
        type: b.type ?? 'public',
        department_id: b.department_id || null,
        team_id: b.team_id || null,
        created_by: ctx.org.memberId,
      };
    },
  },
);
