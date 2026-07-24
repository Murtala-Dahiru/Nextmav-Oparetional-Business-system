import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT = '*, project:projects(id, name), assignee:organization_members!tasks_assignee_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'tasks', module: 'projects', select: SELECT, softDelete: true,
    searchColumns: ['title', 'description'],
    sortable: ['created_at', 'updated_at', 'title', 'status', 'priority', 'due_date', 'sort_order'],
    filterable: ['status', 'priority', 'project_id', 'assignee_id', 'milestone_id'],
  },
  {
    table: 'tasks', module: 'projects', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.title?.trim()) throw new Error('Task title is required');
      return {
        title: b.title.trim(), description: b.description ?? '',
        status: b.status ?? 'todo', priority: b.priority ?? 'medium',
        project_id: b.project_id || null, milestone_id: b.milestone_id || null,
        parent_task_id: b.parent_task_id || null,
        assignee_id: b.assignee_id || null,
        // Who raised it, for accountability on the board.
        reporter_id: ctx.org.memberId,
        due_date: b.due_date || null,
        estimated_hours: Math.max(0, Number(b.estimated_hours) || 0),
        sort_order: Number(b.sort_order) || 0,
      };
    },
  },
);
