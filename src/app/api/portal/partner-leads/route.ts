import { collectionHandlers } from '@/lib/supabase/crud';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A partner's own prospects
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Guarded on `portal`, which is the only module an external partner holds.
 *  The rows are bounded by `partner_leads_select`: your own always, and the
 *  company's staff see the ones that have been submitted to them. A draft is
 *  genuinely private, because somebody typing a half-remembered name into
 *  their own workspace has not told the company anything yet.
 *
 *  ── What is not reachable from here ──────────────────────────────────────
 *
 *  Anything in the CRM. A partner holds no `crm` grant at any scope, so every
 *  lead, deal, contact and company endpoint refuses them at `authorize()`,
 *  and the RLS behind those tables refuses them again. This table is their
 *  entire view of the sales process by design.
 */

const SELECT =
  '*, partner:organization_members!partner_leads_partner_id_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), '
  + 'decider:organization_members!partner_leads_decided_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name))';

export const { GET, POST } = collectionHandlers(
  {
    table: 'partner_leads',
    module: 'portal',
    select: SELECT,
    searchColumns: ['first_name', 'last_name', 'company_name', 'email'],
    sortable: ['created_at', 'submitted_at', 'status', 'estimated_value', 'company_name'],
    filterable: ['status'],
    defaultSort: 'created_at',
  },
  {
    table: 'partner_leads',
    module: 'portal',
    select: SELECT,
    prepare: (b, ctx) => {
      const named = String(b.first_name ?? '').trim() || String(b.last_name ?? '').trim();
      if (!named && !String(b.company_name ?? '').trim()) {
        throw new Error('A prospect needs at least a name or a company');
      }
      return {
        /*
         * Always the caller. Accepting a partner id from the body would let
         * one partner file prospects under another's name, and attribution is
         * what this whole table exists to carry.
         */
        partner_id: ctx.org.memberId,
        first_name: b.first_name ?? '',
        last_name: b.last_name ?? '',
        email: b.email || null,
        phone: b.phone ?? null,
        company_name: b.company_name ?? null,
        job_title: b.job_title ?? null,
        note: b.note ?? '',
        estimated_value: Math.max(0, Number(b.estimated_value) || 0),
        /* New ones start as drafts. Submitting is a separate, deliberate act. */
        status: 'draft',
      };
    },
  },
);
