import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * Project milestones.
 *
 * The table, its RLS policy and its foreign key from `tasks.milestone_id` have
 * existed since the first migrations. Nothing ever read or wrote them: there
 * was no endpoint, so a project could not be broken into phases, and the
 * `milestone_id` on every task could never be set to anything.
 *
 * This is the missing half of a relationship the schema already models, not a
 * new concept being introduced.
 */
const SELECT =
  '*, project:projects(id, name, status), ' +
  'owner:organization_members!milestones_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'tasks(count)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'milestones', module: 'projects', select: SELECT,
    searchColumns: ['name', 'description'],
    sortable: ['due_date', 'sort_order', 'created_at', 'name', 'completed_at'],
    // A roadmap reads in the order the work happens, not the order it was
    // typed, so the sequence is the default rather than creation time.
    defaultSort: 'sort_order',
    // A roadmap reads first phase first.
    defaultSortDir: 'asc',
    filterable: ['project_id', 'owner_id'],
  },
  {
    table: 'milestones', module: 'projects', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Milestone name is required');
      if (!b.project_id) throw new Error('A milestone belongs to a project');

      return {
        project_id: b.project_id,
        name: b.name.trim(),
        description: b.description ?? '',
        due_date: b.due_date || null,
        owner_id: b.owner_id || ctx.org.memberId,
        sort_order: Number(b.sort_order) || 0,
        /**
         * Completion is a decision, not an input on creation. A milestone
         * created as already-complete would fire the notification and move the
         * progress bar before anyone had done the work; marking it done is a
         * PATCH, which is where that belongs.
         */
        completed_at: null,
      };
    },
  },
);
