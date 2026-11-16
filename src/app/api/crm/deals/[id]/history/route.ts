import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { scopeFor } from '@/lib/permissions';

/**
 * Where this deal has been, and how long it spent there.
 *
 * ── Why the endpoint exists rather than a wider deal payload ─────────────
 *
 * The deal panel is opened far more often than its history is looked at, and
 * the history is the only part that needs a second table. Folding it into
 * `GET /api/crm/deals/[id]` would put a join on every list refresh and every
 * pipeline drag - and the pipeline drags a lot.
 *
 * The durations are computed here rather than in the browser because the
 * arithmetic has to agree with the average-cycle figure on CRM Home, and two
 * implementations of "how long was it in qualification" is two answers.
 *
 * `deal_stage_events` has no UPDATE or DELETE policy, so this is the only
 * shape in which that table is ever read by a person.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('crm', 'view');
  if (ctx instanceof Response) return ctx;

  const { id } = await params;

  let query = ctx.supabase
    .from('deal_stage_events')
    .select('id, from_stage, to_stage, value_at, created_at, deal:deals!inner(id), member:organization_members!deal_stage_events_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))')
    .eq('organization_id', ctx.org.organizationId)
    .eq('deal_id', id)
    .eq('deal.organization_id', ctx.org.organizationId)
    .is('deal.deleted_at', null)
    .order('created_at', { ascending: true });
  if (scopeFor(ctx.org.role, 'crm') === 'own') {
    query = query.eq('deal.owner_id', ctx.org.memberId);
  }
  const { data, error: e } = await query;

  if (e) return pgError(e);

  const rows = (data ?? []) as any[];

  /**
   * How long each stage lasted.
   *
   * The last event has no successor, so its duration runs to now - which is
   * the honest answer for an open deal ("42 days in negotiation") and also for
   * a closed one, where the final event is the close itself and the elapsed
   * time since is not a stage duration at all. `open: true` marks it so the
   * screen can say "since" rather than "for".
   */
  const events = rows.map((row, i) => {
    const { deal: _deal, ...event } = row;
    const next = rows[i + 1];
    const from = Date.parse(row.created_at);
    const to = next ? Date.parse(next.created_at) : Date.now();
    return {
      ...event,
      days: Math.max(0, Math.round((to - from) / 86_400_000)),
      open: !next,
    };
  });

  return success({
    events,
    /** Written down to closed, where the deal is closed. */
    totalDays: rows.length
      ? Math.max(0, Math.round((Date.now() - Date.parse(rows[0].created_at)) / 86_400_000))
      : 0,
  });
}
