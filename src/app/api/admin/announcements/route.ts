import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * Announcements — the one thing the organization pushes at people.
 *
 * Everything else in this platform is pull: you go to a module and look. An
 * announcement is how "we are closed on Monday" or "the new expense policy
 * starts next month" reaches everyone without somebody writing an email that
 * half the company filters away.
 *
 * `audience` decides who: staff, clients, or both. A client-facing
 * announcement is the portal's news feed, which is why this is not simply a
 * workspace page.
 *
 * Publishing fires the notification fan-out in 0016, so posting one puts it in
 * every recipient's tray immediately. That is the point — an announcement
 * nobody is told about is a document.
 */

const AUDIENCES = ['staff', 'clients', 'everyone'];

const SELECT =
  'id, title, body, audience, project_id, is_pinned, published_at, expires_at, created_at, ' +
  'author:organization_members!announcements_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/**
 * Read is open to any member; the RLS policy is what narrows the list to the
 * announcements meant for that person's audience. A client calling this gets
 * client-facing ones, a member of staff gets staff ones, and neither can see
 * the other's — which is why this is not guarded on `admin`.
 */
export async function GET(req: Request) {
  const ctx = await authorize('dashboard', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  const off = (page - 1) * pageSize;
  const { data, count, error: e } = await ctx.supabase
    .from('announcements')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId)
    .is('deleted_at', null)
    .order('is_pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);
  return paginated(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: Request) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const title = String(b.title ?? '').trim();
    if (!title) return error('An announcement needs a title', 422, 'VALIDATION_ERROR');

    const audience = String(b.audience ?? 'staff');
    if (!AUDIENCES.includes(audience)) {
      return error(
        `"${audience}" is not an audience. Expected one of: ${AUDIENCES.join(', ')}.`,
        422, 'INVALID_AUDIENCE',
      );
    }

    /**
     * A project-specific announcement must be a real project.
     *
     * It narrows who sees it — for clients, only the client of that project —
     * so a bad id silently reduces the audience to nobody rather than failing.
     */
    if (b.project_id) {
      const { data: project } = await ctx.supabase
        .from('projects').select('id')
        .eq('organization_id', ctx.org.organizationId).eq('id', b.project_id)
        .is('deleted_at', null).maybeSingle();
      if (!project) return error('That project does not exist in this organization.', 404, 'NOT_FOUND');
    }

    const { data, error: e } = await ctx.supabase
      .from('announcements')
      .insert({
        organization_id: ctx.org.organizationId,
        title,
        body: b.body ?? '',
        audience,
        project_id: b.project_id || null,
        is_pinned: b.is_pinned === true,
        // Scheduling is allowed; the RLS policy hides anything not yet
        // published, and the notification trigger declines to fan out early.
        published_at: b.published_at || new Date().toISOString(),
        expires_at: b.expires_at || null,
        author_id: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not publish the announcement');
  }
}
