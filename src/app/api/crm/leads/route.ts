import { collectionHandlers } from '@/lib/supabase/crud';
import { leadListScope } from '@/lib/crm/lead-list-scope';
import { leadInputSchema } from '@/lib/crm/lead-input';
import { toCamel, toSnake } from '@/lib/case';

const SELECT = '*, owner:organization_members!leads_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'leads', module: 'crm', select: SELECT, softDelete: true,
    searchColumns: ['first_name', 'last_name', 'email', 'company_name'],
    sortable: ['created_at', 'updated_at', 'first_name', 'last_name', 'status', 'score', 'estimated_value'],
    filterable: ['status', 'owner_id', 'source', 'campaign'],
    // A role granted CRM at `scope: 'own'` sees its own records and no more.
    // See lib/supabase/crm-scope.ts for why this applies here and not to
    // companies or contacts.
    scope: leadListScope,
  },
  {
    table: 'leads', module: 'crm', select: SELECT,
    prepare: (b, ctx) => {
      const parsed = leadInputSchema.safeParse(toCamel(b));
      if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
      const clean = toSnake(parsed.data) as Record<string, any>;
      return {
        ...clean,
        email: clean.email || null,
        // Unassigned leads get lost; default ownership to whoever created it.
        owner_id: clean.owner_id ?? ctx.org.memberId,
      };
    },
  },
);
