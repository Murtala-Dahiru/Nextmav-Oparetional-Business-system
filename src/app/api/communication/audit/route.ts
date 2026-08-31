import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The moderation trail.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What is deliberately absent ──────────────────────────────────────────
 *
 *  Not one word of anybody's message. The trail records that a message was
 *  removed, by whom, in which channel and why - never what it said. An
 *  administrator reading this table must not be able to reconstruct a private
 *  conversation from it, and a table shaped so that they could is one that
 *  would eventually be used that way.
 *
 *  The channel *name* is joined in, which is a deliberate exception and a safe
 *  one: an administrator can already see every non-direct channel's name in
 *  their own sidebar. Direct conversations resolve to "a direct message"
 *  rather than to the two people in it.
 *
 *  ── Why the gate is `admin` and not `communication` ──────────────────────
 *
 *  Because a route's module says who may call it, not what the data is about.
 *  Everybody has a conversation; almost nobody should read the moderation log
 *  of one. `comm_audit_select` enforces the same thing underneath, so a caller
 *  who reached this handler another way still gets nothing.
 */
export async function GET(req: Request) {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 100));
  const action = searchParams.get('action');

  let q = ctx.supabase
    .from('communication_audit')
    .select(`
      id, action, message_id, reason, created_at,
      actor:organization_members!communication_audit_actor_id_fkey(
        id, profiles!organization_members_user_id_fkey(full_name)
      ),
      target:organization_members!communication_audit_target_member_id_fkey(
        id, profiles!organization_members_user_id_fkey(full_name)
      ),
      channel:channels!communication_audit_channel_id_fkey(id, name, display_name, type)
    `)
    .eq('organization_id', ctx.org.organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (action && action !== 'all') q = q.eq('action', action);

  const { data, error: e } = await q;
  if (e) return pgError(e);

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    action: r.action,
    messageId: r.message_id,
    reason: r.reason,
    createdAt: r.created_at,
    actorName: r.actor?.profiles?.full_name ?? 'Someone who has left',
    targetName: r.target?.profiles?.full_name ?? null,
    // A direct conversation is never named here, even for an administrator.
    // The act is auditable; who two colleagues were talking to is not the
    // audit's business.
    channelLabel: !r.channel
      ? null
      : r.channel.type === 'direct'
        ? 'a direct message'
        : (r.channel.display_name || `#${r.channel.name}`),
  }));

  return success(rows, { total: rows.length });
}
