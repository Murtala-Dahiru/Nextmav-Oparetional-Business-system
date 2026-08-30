import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * The record of what somebody did.
 *
 * Not badges, points or levels. A dated note somebody else wrote, which a
 * promotion case can cite. The RLS policy refuses to let anyone write one
 * about themselves, for the same reason: a self-written accomplishment list
 * is a self-assessment, and this is meant to be evidence.
 */
const SELECT =
  '*, member:organization_members!performance_achievements_member_id_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), '
  + 'recorder:organization_members!performance_achievements_recorded_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'performance_achievements',
    module: 'hr',
    select: SELECT,
    searchColumns: ['title', 'description'],
    sortable: ['happened_on', 'created_at', 'title'],
    filterable: ['member_id'],
    defaultSort: 'happened_on',
  },
  {
    table: 'performance_achievements',
    module: 'hr',
    select: SELECT,
    prepare: (b, ctx) => {
      if (!b.title?.trim()) throw new Error('Say what they did');
      if (!b.member_id) throw new Error('Choose who this is about');
      if (b.member_id === ctx.org.memberId) {
        throw new Error('Somebody else records this about you, not you about yourself.');
      }
      return {
        member_id: b.member_id,
        title: b.title.trim(),
        description: b.description ?? '',
        happened_on: b.happened_on ?? new Date().toISOString().slice(0, 10),
        recorded_by: ctx.org.memberId,
      };
    },
  },
);
