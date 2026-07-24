import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

const SELECT =
  '*, member:organization_members!leave_requests_member_id_fkey(id, department_id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), approver:organization_members!leave_requests_approved_by_fkey(id, profiles!organization_members_user_id_fkey(full_name))';

/**
 * Leave requests.
 *
 * Visibility is governed by RLS through `auth_visible_member_ids()`, so an
 * employee sees their own, a manager their department's and HR everyone's,
 * without this handler restating the rule.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  let q = ctx.supabase
    .from('leave_requests')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  const status = searchParams.get('status');
  if (status) q = q.eq('status', status);
  const type = searchParams.get('type');
  if (type) q = q.eq('type', type);
  const memberId = searchParams.get('memberId');
  if (memberId) q = q.eq('member_id', memberId);

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('start_date', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Raise a leave request.
 *
 * The requester and the initial status are set here, not taken from the body:
 * a request that arrives pre-approved, or filed against someone else, is a
 * self-authorisation. HR may file on another member's behalf.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    if (!b.start_date || !b.end_date) {
      return error('Start and end dates are required', 422, 'VALIDATION_ERROR');
    }
    if (b.end_date < b.start_date) {
      return error('End date cannot be before the start date', 422, 'VALIDATION_ERROR');
    }

    const isHr = ['owner', 'administrator', 'hr_staff'].includes(ctx.org.role);
    const memberId = isHr && b.member_id ? b.member_id : ctx.org.memberId;

    const { data, error: e } = await ctx.supabase
      .from('leave_requests')
      .insert({
        organization_id: ctx.org.organizationId,
        member_id: memberId,
        type: b.type ?? 'vacation',
        // Always enters the workflow as pending.
        status: 'pending',
        start_date: b.start_date,
        end_date: b.end_date,
        is_half_day: b.is_half_day ?? false,
        reason: b.reason ?? '',
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return error(e.message || 'Failed to create leave request', 500);
  }
}
