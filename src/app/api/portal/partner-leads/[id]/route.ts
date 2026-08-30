import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { recordHandlers } from '@/lib/supabase/crud';
import { updatePartnerLeadSchema } from '@/lib/validations';

/**
 * One partner prospect.
 *
 * ── Why submitting is a POST to its own path and not a status PATCH ──────
 *
 * It is the moment the row stops being the partner's and becomes the
 * company's, and `partner_leads_update` enforces exactly that: a partner may
 * write their row only while it is a `draft`. So the transition cannot be a
 * field the partner sets on the way past - the policy that lets them write it
 * is the policy that stops applying the instant they do.
 *
 * The handler runs the change as an ordinary update while the row is still
 * theirs, which the policy permits, and after it lands they can no longer
 * touch it. Approving is a different act entirely and lives on the company's
 * side of the wall, in `/api/crm/partner-leads`.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'partner_leads',
  module: 'portal',
  select: '*, partner:organization_members!partner_leads_partner_id_fkey('
    + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))',
  updateSchema: updatePartnerLeadSchema,
});

/**
 * Hand it over.
 *
 * Separate from PATCH because it is a one-way door and should read like one
 * at the call site. Refuses anything that is not currently a draft, so a
 * double submit is a clear answer rather than a silent no-op.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authorize('portal', 'edit');
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const { supabase, org } = ctx;

  const current = await supabase
    .from('partner_leads')
    .select('id, status, partner_id')
    .eq('organization_id', org.organizationId)
    .eq('id', id)
    .maybeSingle();

  if (current.error) return pgError(current.error);
  if (!current.data) return error('That prospect no longer exists.', 404, 'NOT_FOUND');

  if (current.data.partner_id !== org.memberId) {
    return error('That is not yours to submit.', 403);
  }
  if (current.data.status !== 'draft') {
    return error(
      current.data.status === 'submitted'
        ? 'You have already sent that one over.'
        : 'That has already been decided.',
      409, 'INVALID_TRANSITION',
    );
  }

  const { data, error: e } = await supabase
    .from('partner_leads')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('organization_id', org.organizationId)
    .eq('id', id)
    .select('id, status, submitted_at')
    .single();

  if (e) return pgError(e);
  return success(data);
}
