import { authorize, pgError } from '@/lib/auth-context';
import { success, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { visibleModuleFilter } from '@/lib/activity';

const SELECT =
  '*, member:organization_members!activity_log_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(first_name, last_name, full_name, avatar_url))';

/**
 * Flatten the actor to the shape every screen in this codebase reads.
 *
 * The embedded relation arrives as `member.profiles.first_name`, and both the
 * dashboard panel and the entity timeline declare `user: { firstName, lastName,
 * avatar }`. Two nested levels of naming difference is precisely the drift
 * `contract:check` exists to catch, so it is resolved once here rather than in
 * each consumer.
 */
function withActor(row: any) {
  const p = row?.member?.profiles ?? null;
  return {
    ...row,
    user: p
      ? { firstName: p.first_name ?? '', lastName: p.last_name ?? '', avatar: p.avatar_url ?? '' }
      : null,
  };
}

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

  /**
   * Scoped to the modules this role may open.
   *
   * RLS scopes these rows to the tenant and stops there, because Postgres has
   * no notion of a module grant — those live in `lib/permissions.ts`. Without
   * this filter the feed is an oblique read of every module in the product: a
   * support agent with no Finance access would watch "Created expense:
   * Executive bonus" go past on their dashboard. Same decision, and same
   * reason, as the module check in `/api/search`.
   */
  let query = ctx.supabase
    .from('activity_log')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId)
    .in('module', visibleModuleFilter(ctx));

  // Named `moduleName`: assigning to `module` shadows the CommonJS global and
  // breaks Next's bundler.
  const moduleName = searchParams.get('module');
  if (moduleName) query = query.eq('module', moduleName);
  const memberId = searchParams.get('member_id');
  if (memberId) query = query.eq('member_id', memberId);

  /**
   * `?entityType=` + `?entityId=` is what makes this a record's own history
   * rather than only a global feed — the client-360 view asks for one
   * company's timeline through exactly these two parameters.
   */
  const entityType = searchParams.get('entityType') ?? searchParams.get('entity_type');
  if (entityType) query = query.eq('entity_type', entityType);
  const entityId = searchParams.get('entityId') ?? searchParams.get('entity_id');
  if (entityId) query = query.eq('entity_id', entityId);

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated((data ?? []).map(withActor), count ?? 0, page, pageSize);
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

  const b = acceptBody(await req.json().catch(() => ({})));
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
  return success(withActor(data), undefined, 201);
}
