import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';
import {
  HR_CASE_CATEGORIES, HR_CASE_STATUSES, OPEN_CASE_STATUSES, RESTRICTED_BY_DEFAULT,
} from '@/lib/hr';
import { TICKET_PRIORITIES } from '@/lib/constants';

const SELECT =
  '*, raiser:organization_members!hr_cases_raised_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'subject:organization_members!hr_cases_member_id_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url), ' +
  'department:departments!organization_members_department_id_fkey(id, name)), ' +
  'assignee:organization_members!hr_cases_assigned_to_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The HR case desk.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What the module's "Internal HR Case & Incident Desk" claimed to be. That
 * screen pushed onto a `useState` array and toasted "submitted successfully";
 * its dialogue said "Private, confidential case submission directly to the HR
 * Management team", which is the part that made it worse than an ordinary
 * fake - somebody could have typed a grievance into it, and nothing received
 * it.
 *
 * Visibility is `hr_cases_select`. HR and administrators see everything; the
 * person who raised it always sees their own; the subject and the assignee see
 * it unless it is restricted. Nobody's manager, ever - a department head is
 * not in their team's HR correspondence.
 */
export async function GET(req: Request) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));

  let q = ctx.supabase
    .from('hr_cases').select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId);

  for (const [param, column] of [
    ['status', 'status'],
    ['category', 'category'],
    ['priority', 'priority'],
    ['assignedTo', 'assigned_to'],
    ['memberId', 'member_id'],
  ] as const) {
    const v = searchParams.get(param);
    if (isFilterValue(v)) q = q.eq(column, v);
  }

  /* Mine, which is the employee's whole view of this screen. */
  if (searchParams.get('mine') === 'true') q = q.eq('raised_by', ctx.org.memberId);

  /* Open by default: a queue that shows every case ever closed is not a queue. */
  if (searchParams.get('include') !== 'all' && !isFilterValue(searchParams.get('status'))) {
    q = q.in('status', [...OPEN_CASE_STATUSES]);
  }

  const search = searchParams.get('search')?.trim().replace(/[,()*]/g, ' ').trim();
  if (search) q = q.or(`subject.ilike.%${search}%,reference.ilike.%${search}%`);

  const offset = (page - 1) * pageSize;
  const { data, count, error: e } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

/**
 * Raise a case.
 *
 * `create` on `hr`, which every internal role holds - the desk is for
 * everybody, and a case desk only HR can write to is a mailbox with extra
 * steps. `raised_by` is the caller and the policy enforces it, so nobody files
 * as somebody else.
 */
export async function POST(req: Request) {
  const ctx = await authorize('hr', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const subject = String(b.subject ?? '').trim();
    if (!subject) return error('A case needs a subject', 422, 'VALIDATION_ERROR');

    const category = String(b.category ?? 'inquiry');
    if (!(HR_CASE_CATEGORIES as readonly string[]).includes(category)) {
      return error(`Category must be one of: ${HR_CASE_CATEGORIES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    const priority = String(b.priority ?? 'medium');
    if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) {
      return error(`Priority must be one of: ${TICKET_PRIORITIES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }

    /**
     * Restriction defaults by category, and the caller may still change it.
     *
     * A grievance is about somebody, and the somebody must not be able to read
     * it - so the sensitive categories start restricted rather than relying on
     * the person remembering the toggle in the case where forgetting matters
     * most.
     */
    const isRestricted = typeof b.is_restricted === 'boolean'
      ? b.is_restricted
      : (RESTRICTED_BY_DEFAULT as readonly string[]).includes(category);

    /**
     * Who the case is about.
     *
     * Defaults to the person raising it, which is the ordinary case. Naming
     * somebody else is how a manager reports an incident, and the restriction
     * above is what stops the subject reading it.
     */
    const memberId = b.member_id ?? ctx.org.memberId;

    const { data, error: e } = await ctx.supabase
      .from('hr_cases')
      .insert({
        organization_id: ctx.org.organizationId,
        category,
        subject,
        description: b.description ?? '',
        raised_by: ctx.org.memberId,
        member_id: memberId || null,
        assigned_to: b.assigned_to || null,
        priority,
        is_restricted: isRestricted,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not raise the case');
  }
}
