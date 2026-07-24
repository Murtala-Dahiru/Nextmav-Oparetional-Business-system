import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT =
  '*, space:workspace_spaces(id, name), editor:organization_members!workspace_pages_last_edited_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'workspace_pages', module: 'workspace', select: SELECT, softDelete: true,
    searchColumns: ['title', 'content'],
    sortable: ['created_at', 'updated_at', 'title', 'sort_order'],
    filterable: ['space_id', 'parent_id', 'is_folder', 'is_template'],
  },
  {
    table: 'workspace_pages', module: 'workspace', select: SELECT,
    prepare: (b, ctx) => ({
      // A page with no title is normal while drafting; naming it "Untitled"
      // keeps it findable instead of rendering as a blank row.
      title: b.title?.trim() || 'Untitled',
      content: b.content ?? '',
      icon: b.icon ?? null,
      space_id: b.space_id || null,
      parent_id: b.parent_id || null,
      is_folder: b.is_folder ?? false,
      is_template: b.is_template ?? false,
      sort_order: Number(b.sort_order) || 0,
      created_by: ctx.org.memberId,
      last_edited_by: ctx.org.memberId,
    }),
  },
);
