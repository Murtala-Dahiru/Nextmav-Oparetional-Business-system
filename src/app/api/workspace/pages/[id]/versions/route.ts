import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

/**
 * Revision history for a document.
 *
 * Snapshots are written by the `snapshot_page_version` trigger, not by this
 * endpoint - the page is edited from the document view, the rename control and
 * the move dialog, and a snapshot that three call sites have to remember to
 * take is one that eventually is not.
 */
export async function GET(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  /**
   * One revision, with its body.
   *
   * The list deliberately omits `content` - fifty full document bodies to
   * render fifty rows of "v12, Ada, Tuesday" is a payload nobody reads. Asking
   * for a specific version is how the panel previews one before restoring it,
   * which is the difference between a history somebody trusts and a button
   * marked Restore that they will not press.
   */
  const wanted = new URL(req.url).searchParams.get('version');
  if (wanted !== null) {
    const version = Number(wanted);
    if (!Number.isFinite(version)) {
      return error('version must be a number', 422, 'VALIDATION_ERROR');
    }
    const { data, error: readError } = await ctx.supabase
      .from('workspace_page_versions')
      .select('id, version, title, content, created_at, edited_by')
      .eq('page_id', id).eq('version', version)
      .maybeSingle();

    if (readError) return pgError(readError);
    if (!data) return error('That revision no longer exists.', 404, 'NOT_FOUND');
    return success(data);
  }

  const { data, error: e } = await ctx.supabase
    .from('workspace_page_versions')
    .select('id, version, title, created_at, edited_by, editor:organization_members!workspace_page_versions_edited_by_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))')
    .eq('page_id', id)
    .order('version', { ascending: false })
    .limit(50);

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Restore a revision.
 *
 * Restoring writes the old body back as a *new* edit rather than rewinding the
 * counter, so the version that was current before the restore is itself
 * snapshotted on the way past. Undoing a restore is then the same action
 * again, which is the only behaviour that does not lose work.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const version = Number(b.version);
  if (!Number.isFinite(version)) return error('version is required', 422, 'VALIDATION_ERROR');

  const { data: snapshot, error: readError } = await ctx.supabase
    .from('workspace_page_versions')
    .select('content, title, version')
    .eq('page_id', id)
    .eq('version', version)
    .maybeSingle();

  if (readError) return pgError(readError);
  if (!snapshot) return error('That revision no longer exists.', 404, 'NOT_FOUND');

  const { data, error: e } = await ctx.supabase
    .from('workspace_pages')
    .update({
      content: snapshot.content,
      title: snapshot.title,
      last_edited_by: ctx.org.memberId,
    })
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('You do not have permission to change this page.', 403, 'RLS_DENIED');
  return success(data);
}
