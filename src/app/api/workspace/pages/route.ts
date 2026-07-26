import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT =
  '*, space:workspace_spaces(id, name), editor:organization_members!workspace_pages_last_edited_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'workspace_pages', module: 'workspace', select: SELECT, softDelete: true,
    searchColumns: ['title', 'content'],
    sortable: ['created_at', 'updated_at', 'title', 'sort_order'],
    filterable: ['space_id', 'parent_id', 'is_folder', 'is_template', 'is_starred'],
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
      // The editor has always offered these two and had nowhere to store them,
      // so the colour reverted on every read and starring a page did nothing.
      // 'color' is accepted as well as 'colour' because the client spells it
      // the American way and the schema does not.
      colour: b.colour || b.color || '#10b981',
      is_starred: b.is_starred ?? false,
      sort_order: Number(b.sort_order) || 0,
      created_by: ctx.org.memberId,
      last_edited_by: ctx.org.memberId,
    }),
  },
);
