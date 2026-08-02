import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * One project file: a link to read it, a change of visibility, or removal.
 */

type Params = { params: Promise<{ id: string }> };

const SELECT =
  'id, filename, mime_type, size_bytes, bucket, path, folder, is_client_visible, ' +
  'is_confidential, created_at, project_id, requires_approval, approval_decision, ' +
  'approved_at, approval_note, ' +
  'approver:organization_members!files_approved_by_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name))';

/**
 * A time-limited link to the object.
 *
 * The buckets are private, so a path alone is not readable. Signing happens on
 * the server after the row has been resolved through RLS, which means the
 * permission decision is made against the *metadata* — where "this belongs to
 * a project you can see" is expressible — rather than against the storage
 * path, where it is not.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  // `any` for the same reason as the other handlers that embed relations:
  // PostgREST's generated types widen the row into a union with
  // `GenericStringError`, which makes every field access fail to compile.
  const { data: file, error: e } = await ctx.supabase
    .from('files').select(SELECT)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null).maybeSingle<any>();

  if (e) return pgError(e);
  if (!file) return error('Not found', 404, 'NOT_FOUND');

  // Ten minutes: long enough to open or download, short enough that a link
  // pasted into a chat has stopped working by the time anyone finds it.
  const { data: signed, error: signError } = await ctx.supabase
    .storage.from(file.bucket)
    .createSignedUrl(file.path, 600);

  if (signError) {
    return error(
      'The file record exists but the stored object could not be reached.',
      502, 'STORAGE_UNAVAILABLE',
    );
  }

  return success({ ...file, url: signed?.signedUrl ?? null, expiresIn: 600 });
}

/**
 * Rename, refile, or publish to the client.
 *
 * The stored object is never touched: `bucket` and `path` are immutable here,
 * because changing them would leave the row pointing at bytes that are not the
 * ones it describes. Renaming changes the display name only, which is what
 * people mean by renaming a file in a project.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('filename' in b) {
      const filename = String(b.filename ?? '').trim();
      if (!filename) return error('A file needs a name', 422, 'VALIDATION_ERROR');
      update.filename = filename;
    }
    if ('folder' in b) update.folder = String(b.folder ?? '').replace(/^\/+|\/+$/g, '');
    if ('is_client_visible' in b) update.is_client_visible = b.is_client_visible === true;
    if ('is_confidential' in b) update.is_confidential = b.is_confidential === true;

    /**
     * Putting a file forward as a deliverable, or withdrawing it.
     *
     * `requires_approval` is what makes a file part of the acceptance component
     * of project progress, so setting it changes the number the client sees.
     * Withdrawing it clears any decision as well: a file that is no longer up
     * for acceptance should not carry a stale approval, and leaving one behind
     * would let a withdrawn-then-reinstated deliverable count as approved
     * without anyone looking at it again.
     */
    if ('requires_approval' in b) {
      update.requires_approval = b.requires_approval === true;
      if (!update.requires_approval) {
        update.approval_decision = null;
        update.approved_at = null;
        update.approved_by = null;
        update.approval_note = '';
      }
    }

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    /**
     * A deliverable has to be something the client can actually see.
     *
     * Refused rather than silently corrected: "this is a deliverable, awaiting
     * their approval" against a file they cannot open is a project that waits
     * for a decision nobody was ever asked to make.
     */
    if (update.requires_approval === true) {
      const visibleNow = 'is_client_visible' in update
        ? update.is_client_visible
        : (await ctx.supabase
            .from('files').select('is_client_visible')
            .eq('organization_id', ctx.org.organizationId).eq('id', id)
            .maybeSingle()).data?.is_client_visible;

      if (!visibleNow) {
        return error(
          'A deliverable has to be shared with the client before they can approve it.',
          422, 'DELIVERABLE_NOT_SHARED',
        );
      }
    }

    /**
     * Withdrawing a file from the client withdraws it as a deliverable too.
     *
     * Otherwise `requires_approval` stays true on a file the portal no longer
     * lists, and the project's denominator counts a deliverable that cannot be
     * approved — progress would be permanently capped with nothing on screen to
     * explain it.
     */
    if (update.is_client_visible === false) {
      update.requires_approval = false;
      update.approval_decision = null;
      update.approved_at = null;
      update.approved_by = null;
    }

    /**
     * Confidential and client-visible are mutually exclusive.
     *
     * The portal policy already excludes confidential files, so the
     * combination would simply not appear — silently, which is the worst
     * outcome: somebody would tick "share with client", see no error, and
     * believe the client had it.
     */
    const wantsVisible = update.is_client_visible === true;
    const wantsConfidential = update.is_confidential === true;
    if (wantsVisible && wantsConfidential) {
      return error(
        'A confidential file cannot also be shared with the client.',
        422, 'VISIBILITY_CONFLICT',
      );
    }
    if (wantsVisible || wantsConfidential) {
      const { data: current } = await ctx.supabase
        .from('files').select('is_client_visible, is_confidential')
        .eq('organization_id', ctx.org.organizationId).eq('id', id).maybeSingle();

      if (wantsVisible && current?.is_confidential && !('is_confidential' in update)) {
        return error(
          'That file is marked confidential. Clear that first if you mean to share it.',
          422, 'VISIBILITY_CONFLICT',
        );
      }
      if (wantsConfidential && current?.is_client_visible && !('is_client_visible' in update)) {
        // Marking something confidential withdraws it from the client rather
        // than refusing — the stricter intent is obviously the one meant.
        update.is_client_visible = false;
      }
    }

    const { data, error: e } = await ctx.supabase
      .from('files').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .is('deleted_at', null)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return serverError(e, 'Update failed');
  }
}

export { PATCH as PUT };

/**
 * Remove a file from the project.
 *
 * Soft. The stored object is deliberately left in place: a metadata row can be
 * restored, a deleted object cannot, and "someone removed the wrong file" is a
 * far more common support request than "storage is too full". Cleaning up
 * orphaned objects is a housekeeping job, not something a click should do.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'delete');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('files')
    .update({ deleted_at: new Date().toISOString(), is_client_visible: false })
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true, soft: true });
}
