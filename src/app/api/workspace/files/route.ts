import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { isFilterValue } from '@/lib/filters';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Workspace files.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this replaces ───────────────────────────────────────────────────
 *
 *  The workspace's "File Vault" used a component that created an object URL in
 *  the browser, animated a progress bar with setInterval, showed a green tick
 *  and a padlock reading "AES-256 Encrypted", and attributed every upload to a
 *  hard-coded "Alex Morgan". Nothing left the tab. Reloading lost everything,
 *  and no colleague ever saw a file anybody uploaded.
 *
 *  ── How it works now ─────────────────────────────────────────────────────
 *
 *  Bytes go from the browser straight to Supabase Storage, which is the same
 *  path the projects module already uses; this records what was stored and
 *  where it belongs. Storage knows a bucket and a path and nothing else, so
 *  the metadata row is what makes a file findable, attributable, and subject
 *  to the folder's sharing rule.
 */

/** Buckets a workspace file may live in. Anything else is a client mistake. */
const WORKSPACE_BUCKETS = ['documents', 'attachments'];

export async function GET(req: Request) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);

  let q = ctx.supabase
    .from('v_files').select('*')
    .eq('organization_id', ctx.org.organizationId);

  const pageId = searchParams.get('pageId') ?? searchParams.get('page_id');
  if (isFilterValue(pageId)) {
    q = q.eq('page_id', pageId);
  } else if (searchParams.get('scope') === 'all') {
    // The "All files" view: everything filed in the workspace, which means a
    // page_id is set. Project deliverables and HR documents live under their
    // own modules and are not the workspace's to list.
    q = q.not('page_id', 'is', null);
  } else {
    return error('pageId is required, or scope=all', 422, 'VALIDATION_ERROR');
  }

  const search = searchParams.get('search')?.trim();
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) q = q.ilike('filename', `%${safe}%`);
  }

  const { data, error: e } = await q
    .order('created_at', { ascending: false })
    .limit(500);

  if (e) return pgError(e);
  return success(data ?? []);
}

/**
 * Record a file that has just been uploaded to storage.
 *
 * The storage policies already confine a member to their own organization's
 * path prefix, so a caller cannot have written outside it — but the metadata
 * row arrives in a *separate* request, and without the check below a caller
 * could register another tenant's object against their own folder and then
 * read it back through a signed URL this application generates.
 */
export async function POST(req: Request) {
  const ctx = await authorize('workspace', 'create');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const filename = String(b.filename ?? '').trim();
  const path = String(b.path ?? '').trim();
  const bucket = String(b.bucket ?? 'documents').trim();
  const pageId = b.page_id || null;

  if (!filename) return error('filename is required', 422, 'VALIDATION_ERROR');
  if (!path) return error('path is required', 422, 'VALIDATION_ERROR');
  if (!pageId) return error('pageId is required — a file belongs in a folder', 422, 'VALIDATION_ERROR');
  if (!WORKSPACE_BUCKETS.includes(bucket)) {
    return error(
      `Workspace files live in ${WORKSPACE_BUCKETS.join(' or ')}, not "${bucket}".`,
      422, 'INVALID_BUCKET',
    );
  }
  if (path.split('/')[0] !== ctx.org.organizationId) {
    return error('That storage path does not belong to this organization.', 422, 'PATH_MISMATCH');
  }

  // The folder must be one the caller may write in. RLS on `files` scopes by
  // organization only, so without this a file could be filed into a folder the
  // uploader cannot open — and would then be visible to everyone who can.
  const { data: parent } = await ctx.supabase
    .from('v_workspace_tree').select('id, title, permission')
    .eq('organization_id', ctx.org.organizationId).eq('id', pageId).maybeSingle();

  if (!parent) return error('That folder does not exist in this organization.', 404, 'NOT_FOUND');
  if (!['edit', 'manage'].includes(parent.permission)) {
    return error('You do not have permission to add files here.', 403, 'RLS_DENIED');
  }

  const { data, error: e } = await ctx.supabase
    .from('files')
    .insert({
      organization_id: ctx.org.organizationId,
      page_id: pageId,
      project_id: b.project_id || null,
      bucket,
      path,
      filename,
      mime_type: b.mime_type || null,
      size_bytes: Math.max(0, Number(b.size_bytes) || 0),
      description: String(b.description ?? ''),
      folder: String(b.folder ?? '').replace(/^\/+|\/+$/g, ''),
      // Both default closed. Sharing with a client is an act, not an omission.
      is_client_visible: b.is_client_visible === true,
      is_confidential: b.is_confidential === true,
      uploaded_by: ctx.org.memberId,
    })
    .select('*')
    .single();

  if (e) {
    if (e.code === '23505') return error('That file has already been recorded.', 409, 'DUPLICATE_PATH');
    return pgError(e);
  }

  // Filing a document is the kind of thing colleagues look for in the activity
  // feed. Best-effort: a missing feed entry must not fail the upload.
  await ctx.supabase.from('activity_log').insert({
    organization_id: ctx.org.organizationId,
    member_id: ctx.org.memberId,
    module: 'workspace',
    action: 'upload',
    title: `Uploaded ${filename}`,
    description: parent.title ? `to ${parent.title}` : '',
    entity_type: 'file',
    entity_id: data.id,
  });

  return success(data, undefined, 201);
}
