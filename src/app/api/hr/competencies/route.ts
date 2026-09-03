import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * The competency framework.
 *
 * Readable by everybody who can open HR, and that is deliberate rather than
 * lax: being assessed against a standard you are not allowed to read is the
 * complaint every competency framework attracts, and it is a fair one. The
 * RLS policy (0048) says the same thing, so this is not the only place it
 * holds.
 *
 * Writable on `manage` — owner, administrator and HR. A competency framework
 * is a policy about what the company values, not a preference a department
 * head sets for their own team; two managers with different frameworks make
 * calibration impossible, which is the failure this restriction prevents.
 *
 * Note there is no DELETE in the ordinary sense: see the record route.
 */
const SELECT =
  '*, creator:organization_members!competencies_created_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'competencies',
    module: 'hr',
    select: SELECT,
    searchColumns: ['name', 'description', 'category'],
    sortable: ['sort_order', 'name', 'category', 'created_at'],
    filterable: ['is_active', 'category'],
    defaultSort: 'sort_order',
    defaultSortDir: 'asc',
  },
  {
    table: 'competencies',
    module: 'hr',
    action: 'manage',
    select: SELECT,
    prepare: (b, ctx) => {
      const name = String(b.name ?? '').trim();
      if (!name) throw new Error('Give the competency a name, like "Communication"');
      return {
        name,
        description: b.description ?? '',
        category: b.category ?? '',
        sort_order: Number(b.sort_order) || 0,
        created_by: ctx.org.memberId,
      };
    },
  },
);
