import { authenticate, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { isFilterValue } from '@/lib/filters';
import { isExternalRole } from '@/lib/permissions';

/**
 * The company directory, for people pickers.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every assignee dropdown in the product was calling `/api/admin/users`. That
 * endpoint requires the admin module, which only `owner` and `administrator`
 * hold — so for a manager assigning a task, an HR officer picking an employee,
 * or a support agent reassigning a ticket, the request returned 403 and the
 * dropdown rendered empty. The screens gave no clue why: an empty picker looks
 * like an organization with no staff.
 *
 * It was also returning the wrong shape. `/api/admin/users` reads
 * `v_org_directory`, whose rows are built for the administration table —
 * `member_id`, `full_name`, employment type, reporting line. The Projects
 * module typed them as `{ id, firstName, lastName }`, so even for an owner
 * every option rendered "undefined undefined" against a `SelectItem` with no
 * value, which React silently drops.
 *
 * Knowing who your colleagues are is not privileged information inside a
 * company, so this is available to any member of the organization. What it
 * deliberately does *not* carry is the sensitive half of the directory:
 * no employment type, no hire date, no salary, no reporting line, no
 * `last_seen_at`. Those stay behind the admin and HR endpoints.
 *
 * Client accounts are excluded — you cannot assign work to a customer, and a
 * client must never be able to enumerate the staff of the company they buy
 * from.
 */
export async function GET(req: Request) {
  /**
   * Authentication, not a module grant.
   *
   * Guarding on the *calling* module would mean a picker in Finance needed
   * finance rights to list people, which is backwards: choosing an assignee is
   * not a finance operation. Guarding on any single module would tie the
   * directory to whichever one that role happens to hold.
   */
  const ctx = await authenticate();
  if (ctx instanceof Response) return ctx;

  /**
   * Externals cannot enumerate staff.
   *
   * `v_assignable_members` already excludes client rows from the *results*, so
   * a client would not appear in anyone's picker — but that says nothing about
   * who may *read* it. A customer being able to list every employee of their
   * supplier, with job titles and email addresses, is a disclosure nobody
   * signed up for.
   */
  if (isExternalRole(ctx.org.role)) {
    return error('This is not available to client accounts.', 403, 'FORBIDDEN_MODULE');
  }

  const { searchParams } = new URL(req.url);

  /**
   * Who is currently here.
   *
   * `online_members()` is the presence heartbeat — members whose profile was
   * touched in the last five minutes. Served from this endpoint rather than a
   * new one because it answers a question about the same list, and because
   * `last_seen_at` is deliberately absent from the directory rows below: it is
   * the sensitive half of the directory, and disclosing when a named colleague
   * was last active is different from saying how many people are online.
   */
  if (searchParams.get('online') === 'true') {
    const { data, error: e } = await ctx.supabase
      .rpc('online_members', { org: ctx.org.organizationId });
    if (e) return pgError(e);
    return success(data ?? []);
  }

  /**
   * `presence` is included; `last_seen_at` is still not.
   *
   * The distinction the note above draws is the right one and it survives here.
   * "Online", "Away" and "Offline" are three coarse states that a colleague can
   * already infer from whether you answer in chat, and every people picker,
   * project team panel and directory row is more useful for showing them.
   *
   * An exact timestamp is a different thing: "last active 03:12" says what hours
   * somebody keeps and when they were at their desk, which is not the
   * directory's business. It stays behind the admin and HR endpoints, which read
   * `v_org_directory` and are already restricted to the people who manage staff.
   */
  let q = ctx.supabase
    .from('v_assignable_members')
    .select(
      'member_id, user_id, full_name, email, avatar_url, job_title, role, ' +
      'department_id, department_name, presence',
    )
    .eq('organization_id', ctx.org.organizationId);

  const search = searchParams.get('search')?.trim();
  if (search) {
    // Same escaping rule as the shared list handler: commas and parentheses
    // would break out of the PostgREST filter expression.
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) {
      q = q.or(['full_name', 'email', 'job_title'].map(c => `${c}.ilike.%${safe}%`).join(','));
    }
  }

  // Narrowing a picker to one department is the common case for a manager.
  const dept = searchParams.get('departmentId') ?? searchParams.get('department_id');
  if (isFilterValue(dept)) q = q.eq('department_id', dept);

  const role = searchParams.get('role');
  if (isFilterValue(role)) q = q.eq('role', role);

  /**
   * No pagination.
   *
   * A picker that pages is a picker that silently omits the person you were
   * looking for. The cap is high enough for any single workspace and low
   * enough to stay one cheap query; a directory larger than this needs a
   * search-as-you-type control, not a second page.
   */
  const { data, error: e } = await q.order('full_name').limit(500);
  if (e) return pgError(e);

  return success(data ?? []);
}
