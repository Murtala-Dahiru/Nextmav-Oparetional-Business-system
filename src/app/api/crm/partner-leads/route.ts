import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { isFilterValue } from '@/lib/filters';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The company's side of the wall
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  What partners have submitted, and the decision on each. Guarded on `crm`,
 *  so the people who work the pipeline see the queue and the partners
 *  themselves cannot reach this path at all - they hold no `crm` grant.
 *
 *  ── Why approving is an RPC and not two writes here ──────────────────────
 *
 *  Approving creates a lead and marks the submission approved, and those two
 *  must not come apart. A `partner_leads` row marked approved with no lead
 *  behind it is a promise about somebody's commission that nothing will keep.
 *  `approve_partner_lead()` does both in one statement, re-checks the
 *  caller's role and module access itself, and raises a readable message when
 *  it refuses - so this route is the shape of the request rather than the
 *  guarantee.
 */

const SELECT =
  '*, partner:organization_members!partner_leads_partner_id_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), '
  + 'decider:organization_members!partner_leads_decided_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name))';

export async function GET(request: Request) {
  const ctx = await authorize('crm', 'view');
  if (ctx instanceof Response) return ctx;

  const url = new URL(request.url);
  let q = ctx.supabase
    .from('partner_leads')
    .select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .limit(200);

  const status = url.searchParams.get('status');
  /*
   * Defaults to the queue rather than to everything: what a sales manager
   * opens this for is "what is waiting on me", and a list that leads with
   * decided rows buries it.
   */
  q = isFilterValue(status) ? q.eq('status', status) : q.eq('status', 'submitted');

  const { data, error: e } = await q;
  if (e) return pgError(e);

  return success(data ?? [], {
    /* So the screen can show a count without a second request. */
    waiting: (data ?? []).filter((r: any) => r.status === 'submitted').length,
  });
}

/** Accept one, which creates the company's own lead from it. */
export async function POST(request: Request) {
  const ctx = await authorize('crm', 'create');
  if (ctx instanceof Response) return ctx;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return error('That request had no body.', 422, 'VALIDATION_ERROR');
  }

  const id = String(body?.id ?? '');
  if (!id) return error('Which submission?', 422, 'VALIDATION_ERROR');

  const decision = body?.decision === 'reject' ? 'reject' : 'approve';
  const note = typeof body?.note === 'string' ? body.note : '';

  if (decision === 'reject') {
    const { data, error: e } = await ctx.supabase
      .from('partner_leads')
      .update({
        status: 'rejected',
        decided_at: new Date().toISOString(),
        decided_by: ctx.org.memberId,
        decision_note: note,
      })
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .eq('status', 'submitted')
      .select('id, status')
      .maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('That submission has already been decided.', 409, 'INVALID_TRANSITION');
    return success(data);
  }

  const { data, error: e } = await ctx.supabase.rpc('approve_partner_lead', {
    p_partner_lead: id,
    p_owner: body?.ownerId ?? null,
    p_note: note,
  });

  if (e) return pgError(e);
  return success({ leadId: data }, undefined, 201);
}
