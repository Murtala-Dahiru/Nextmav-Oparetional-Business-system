import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';

/**
 * Organization members, for the administration screen.
 *
 * Reads v_org_directory so role, department and reporting line arrive
 * resolved. There is no POST: people are invited, never inserted. A member
 * row with no auth user is an account nobody can sign into.
 */
export async function GET(req: Request) {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let q = ctx.supabase.from('v_org_directory').select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) q = q.or(['full_name','email','job_title'].map(c => c + '.ilike.%' + safe + '%').join(','));
  }
  for (const k of ['role','department_id','is_active']) {
    const v = searchParams.get(k);
    if (v) q = q.eq(k, v === 'true' ? true : v === 'false' ? false : v);
  }

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await q.order('full_name').range(off, off + pageSize - 1);
  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}
