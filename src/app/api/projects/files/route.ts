import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * A project's files.
 *
 * ── What this endpoint is and is not ──────────────────────────────────────
 *
 * Bytes go straight from the browser to Supabase Storage; this records what
 * was stored and what it belongs to. Keeping the metadata in Postgres is what
 * makes a file findable — storage knows a bucket and a path, and nothing else.
 * It cannot answer "which files belong to this project", "who uploaded this"
 * or "may the client see it", and those are the only questions anybody asks.
 *
 * `folder` is a text path rather than a folder table. A project's file tree is
 * small and is renamed wholesale far more often than it is restructured, so
 * giving folders their own identity buys nothing and costs a join, a delete
 * cascade and an orphan problem.
 */

const SELECT =
  'id, filename, mime_type, size_bytes, bucket, path, folder, is_client_visible, ' +
  'is_confidential, created_at, project_id, task_id, ' +
  'uploader:organization_members!files_uploaded_by_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

/** Buckets a project file may live in. Anything else is a client mistake. */
const PROJECT_BUCKETS = ['documents', 'attachments'];

export async function GET(req: Request) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId') ?? searchParams.get('project_id');
  if (!projectId) return error('projectId is required', 422, 'VALIDATION_ERROR');

  let q = ctx.supabase
    .from('files')
    .select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .eq('project_id', projectId)
    .is('deleted_at', null);

  const folder = searchParams.get('folder');
  if (folder !== null) q = q.eq('folder', folder);

  const { data, error: e } = await q.order('created_at', { ascending: false }).limit(500);
  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Record an uploaded file against a project.
 *
 * Called after the upload succeeds, with the bucket and path storage returned.
 * The upload itself is governed by the storage policies, which already confine
 * a member to their own organization's prefix — so a caller cannot register a
 * path they were never able to write.
 */
export async function POST(req: Request) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const projectId = b.project_id;
    const filename = String(b.filename ?? '').trim();
    const path = String(b.path ?? '').trim();
    const bucket = String(b.bucket ?? 'documents').trim();

    if (!projectId) return error('projectId is required', 422, 'VALIDATION_ERROR');
    if (!filename) return error('filename is required', 422, 'VALIDATION_ERROR');
    if (!path) return error('path is required', 422, 'VALIDATION_ERROR');
    if (!PROJECT_BUCKETS.includes(bucket)) {
      return error(
        `Project files live in ${PROJECT_BUCKETS.join(' or ')}, not "${bucket}".`,
        422, 'INVALID_BUCKET',
      );
    }

    const { data: project } = await ctx.supabase
      .from('projects').select('id')
      .eq('organization_id', ctx.org.organizationId).eq('id', projectId)
      .is('deleted_at', null).maybeSingle();
    if (!project) return error('That project does not exist in this organization.', 404, 'NOT_FOUND');

    /**
     * The stored path must begin with this organization's id.
     *
     * The storage policy enforces the same rule on write, but a metadata row
     * is written by a separate request — so without this check a caller could
     * register another tenant's object against their own project and then read
     * it back through a signed URL this application generates.
     */
    if (path.split('/')[0] !== ctx.org.organizationId) {
      return error('That storage path does not belong to this organization.', 422, 'PATH_MISMATCH');
    }

    const { data, error: e } = await ctx.supabase
      .from('files')
      .insert({
        organization_id: ctx.org.organizationId,
        project_id: projectId,
        task_id: b.task_id || null,
        bucket,
        path,
        filename,
        mime_type: b.mime_type || null,
        size_bytes: Math.max(0, Number(b.size_bytes) || 0),
        // Folder is free text but normalised: no leading or trailing slash, so
        // "designs" and "/designs/" do not become two different folders.
        folder: String(b.folder ?? '').replace(/^\/+|\/+$/g, ''),
        // Both default closed. Sharing with a client is an act, not an omission.
        is_client_visible: b.is_client_visible === true,
        is_confidential: b.is_confidential === true,
        uploaded_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) {
      if (e.code === '23505') {
        return error('That file has already been recorded.', 409, 'DUPLICATE_PATH');
      }
      return pgError(e);
    }
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not record the file');
  }
}
