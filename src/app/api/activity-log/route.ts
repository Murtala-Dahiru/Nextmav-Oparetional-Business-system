import { authorize, pgError } from '@/lib/auth-context';
import { success, paginated } from '@/lib/api-response';

const SELECT =
  '*, member:organization_members!activity_log_member_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/**
 * The team activity feed.
 *
 * Distinct from the audit log: this is the human-readable "what is happening"
 * stream shown on the dashboard, whereas the audit log is the tamper-evident
 * record of every row change kept for administrators. Conflating them gives
 * you a feed nobody can read and an audit trail nobody trusts.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let query = ctx.supabase
    .from('activity_log')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const module = searchParams.get('module');
  if (module) query = query.eq('module', module);
  const memberId = searchParams.get('member_id');
  if (memberId) query = query.eq('member_id', memberId);

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Record an activity.
 *
 * Called by the application for events worth surfacing to colleagues. The
 * actor is taken from the session so an entry cannot be attributed to someone
 * else.
 */
export async function POST(req: Request) {
  const ctx = await authorize('communication', 'create');
  if (ctx instanceof Response) return ctx;

  const b = await req.json().catch(() => ({}));
  if (!b?.title || !b?.module) {
    return success({ skipped: true });
  }

  const { data, error: e } = await ctx.supabase
    .from('activity_log')
    .insert({
      organization_id: ctx.org.organizationId,
      member_id: ctx.org.memberId,
      module: b.module,
      action: b.action ?? 'update',
      title: b.title,
      description: b.description ?? '',
      entity_type: b.entity_type ?? null,
      entity_id: b.entity_id ?? null,
      metadata: b.metadata ?? {},
    })
    .select(SELECT)
    .single();

  if (e) return pgError(e);
  return success(data, undefined, 201);
}
