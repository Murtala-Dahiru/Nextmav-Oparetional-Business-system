import { isFilterValue } from '@/lib/filters';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { todayIn } from '@/lib/org-time';

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
  if (isFilterValue(status)) q = q.eq('status', status);
  const type = searchParams.get('type');
  if (isFilterValue(type)) q = q.eq('type', type);
  const memberId = searchParams.get('memberId');
  if (isFilterValue(memberId)) q = q.eq('member_id', memberId);

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

    /**
     * The organisation's leave policy, enforced here rather than only offered.
     *
     * The request form renders what the policy allows, but a form is a
     * suggestion: the endpoint is what a stale tab, a second browser or a
     * direct call reaches. HR is exempt from the notice period — filing a
     * bereavement or a sick day after the fact is exactly the case a minimum
     * notice rule must not block.
     */
    const { data: policyRow } = await ctx.supabase
      .from('org_settings').select('value')
      .eq('organization_id', ctx.org.organizationId)
      .eq('key', 'leave_policy')
      .maybeSingle();

    const policy = (policyRow?.value ?? {}) as {
      types?: string[]; allow_half_day?: boolean;
      min_notice_days?: number; max_consecutive_days?: number;
    };

    const type = b.type ?? 'vacation';
    if (Array.isArray(policy.types) && policy.types.length && !policy.types.includes(type)) {
      return error(
        `Your organisation does not currently offer ${String(type).replace(/_/g, ' ')} leave.`,
        422, 'LEAVE_TYPE_NOT_OFFERED',
      );
    }

    if (b.is_half_day && policy.allow_half_day === false) {
      return error('Half days are not enabled for this organisation.', 422, 'HALF_DAY_DISABLED');
    }

    /**
     * Span and notice are counted in whole days from the date strings.
     *
     * Both columns are `date`, so parsing them as UTC midnight is exact — this
     * is a difference between two calendar dates, not an instant, and going
     * through the local timezone would introduce an off-by-one at the DST
     * boundary for no benefit.
     */
    const dayMs = 86_400_000;
    const startMs = Date.parse(`${b.start_date}T00:00:00Z`);
    const endMs = Date.parse(`${b.end_date}T00:00:00Z`);
    const span = Math.round((endMs - startMs) / dayMs) + 1;

    const maxDays = Number(policy.max_consecutive_days);
    if (Number.isFinite(maxDays) && maxDays > 0 && span > maxDays) {
      return error(
        `Leave is limited to ${maxDays} consecutive day${maxDays === 1 ? '' : 's'}; this request is ${span}.`,
        422, 'LEAVE_TOO_LONG',
      );
    }

    const notice = Number(policy.min_notice_days);
    if (!isHr && Number.isFinite(notice) && notice > 0) {
      const todayMs = Date.parse(`${todayIn(ctx.org.timezone)}T00:00:00Z`);
      const given = Math.round((startMs - todayMs) / dayMs);
      if (given < notice) {
        return error(
          `Leave needs ${notice} day${notice === 1 ? '' : 's'} of notice. Ask HR to file it for you if it cannot wait.`,
          422, 'INSUFFICIENT_NOTICE',
        );
      }
    }

    const { data, error: e } = await ctx.supabase
      .from('leave_requests')
      .insert({
        organization_id: ctx.org.organizationId,
        member_id: memberId,
        type,
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
    return serverError(e, 'Failed to create leave request');
  }
}
