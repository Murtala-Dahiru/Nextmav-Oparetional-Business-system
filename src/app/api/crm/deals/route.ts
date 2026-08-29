import { collectionHandlers } from '@/lib/supabase/crud';
import { ownedScope } from '@/lib/supabase/crm-scope';

// The owner is resolved here as it is for leads. Without it the deal's
// owner column had nothing to render.
const SELECT =
  '*, company:companies(id, name), contact:contacts(id, first_name, last_name), ' +
  'owner:organization_members!deals_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'deals', module: 'crm', select: SELECT, softDelete: true,
    searchColumns: ['name', 'notes'],
    // `closed_at` is what the board's Won and Lost columns order by: the useful
    // Won column is the business just won, not the largest deal of all time.
    sortable: ['created_at', 'updated_at', 'name', 'value', 'stage', 'probability', 'expected_close', 'closed_at'],
    filterable: ['stage', 'owner_id', 'company_id'],
    // A role granted CRM at `scope: 'own'` sees its own records and no more.
    // See lib/supabase/crm-scope.ts for why this applies here and not to
    // companies or contacts.
    scope: ownedScope,
  },
  {
    table: 'deals', module: 'crm', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.name?.trim()) throw new Error('Deal name is required');
      /**
       * `??` cannot supply this default.
       *
       * `Number(undefined)` is `NaN`, and `NaN` is neither null nor undefined,
       * so `Number(b.probability) ?? 20` evaluates to `NaN` — which survives
       * the clamp, is sent as null, and fails the NOT NULL constraint. Any
       * deal created without an explicit probability answered 500.
       */
      const parsed = Number(b.probability);
      const probability = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 20;
      return {
        name: b.name.trim(),
        company_id: b.company_id || null, contact_id: b.contact_id || null,
        stage: b.stage ?? 'prospecting',
        value: Math.max(0, Number(b.value) || 0),
        probability,
        expected_close: b.expected_close || null,
        notes: b.notes ?? '', owner_id: b.owner_id ?? ctx.org.memberId,
      };
    },
  },
);
