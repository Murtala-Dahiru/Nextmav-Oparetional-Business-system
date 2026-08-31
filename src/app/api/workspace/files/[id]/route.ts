import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { normaliseLink } from '@/lib/links';

type Params = { params: Promise<{ id: string }> };

/**
 * One workspace file: a link to read it, a rename or a move, or removal.
 */

/**
 * A time-limited link to the object.
 *
 * The document buckets are private, so a path alone is not readable. Signing
 * happens on the server after the row has been resolved through RLS, which
 * means the permission decision is made against the *metadata* - where "this
 * is in a folder you can open" is expressible - rather than against the
 * storage path, where it is not.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  // `maybeSingle<any>` for the same reason as the other handlers that embed
  // relations: PostgREST's generated types widen the row into a union with
  // `GenericStringError`, which makes every field access fail to compile.
  const { data: file, error: e } = await ctx.supabase
    .from('files')
    .select('id, filename, mime_type, size_bytes, bucket, path, page_id, description, ' +
      'external_url, created_at')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null).maybeSingle<any>();

  if (e) return pgError(e);
  if (!file) return error('Not found', 404, 'NOT_FOUND');

  /**
   * The folder's sharing rule governs the file.
   *
   * RLS on `files` scopes by organization, which was the right rule while
   * every workspace page was readable by every employee. Now that a folder can
   * be private, the check has to be made against the folder - otherwise a file
   * in the HR folder would be downloadable by anybody who could guess its id.
   */
  if (file.page_id) {
    const { data: folder } = await ctx.supabase
      .from('v_workspace_tree').select('id, permission')
      .eq('organization_id', ctx.org.organizationId).eq('id', file.page_id).maybeSingle();
    if (!folder) return error('Not found', 404, 'NOT_FOUND');
  }

  /**
   * A link has nothing to sign.
   *
   * Its address is the resource, and it is returned exactly as it was stored:
   * `normaliseLink` already refused everything that was not http or https on
   * the way in, so a stored value cannot carry a scheme that does something
   * when clicked. Signing is skipped rather than attempted - `createSignedUrl`
   * against a bucket called "link" fails, and the panel would then report a
   * storage outage for a row that has no storage.
   */
  if (file.external_url) {
    return success({ ...file, url: file.external_url, expiresIn: null, isLink: true });
  }

  // Ten minutes: long enough to open or download, short enough that a link
  // pasted into a chat has stopped working by the time anyone finds it.
  const { data: signed, error: signError } = await ctx.supabase
    .storage.from(file.bucket).createSignedUrl(file.path, 600);

  if (signError) {
    return error(
      'The file record exists but the stored object could not be reached.',
      502, 'STORAGE_UNAVAILABLE',
    );
  }

  return success({ ...file, url: signed?.signedUrl ?? null, expiresIn: 600, isLink: false });
}

/**
 * Rename, describe, or move to another folder.
 *
 * The stored object is never touched: `bucket` and `path` are immutable here,
 * because changing them would leave the row pointing at bytes that are not the
 * ones it describes. Renaming changes the display name only, which is what
 * people mean by renaming a file.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const update: Record<string, any> = { updated_at: new Date().toISOString() };

  if ('filename' in b) {
    const filename = String(b.filename ?? '').trim();
    if (!filename) return error('A file needs a name.', 422, 'VALIDATION_ERROR');
    update.filename = filename;
  }
  if ('description' in b) update.description = String(b.description ?? '');

  /**
   * A link's address can be corrected; an upload's path cannot.
   *
   * The two are the same field conceptually - where the thing is - and they
   * differ in exactly one respect: changing a storage path leaves the row
   * describing bytes it is not about, while a document that has moved in Drive
   * has a new address and the old one is simply wrong. The CHECK added in 0034
   * keeps `bucket = 'link'` and `external_url` honest in both directions, so
   * this cannot turn an upload into a link by accident.
   */
  if ('external_url' in b) {
    const next = normaliseLink(String(b.external_url ?? ''));
    if (!next) {
      return error(
        'That does not look like a web address. Links start with http:// or https://.',
        422, 'INVALID_LINK',
      );
    }
    update.external_url = next;
  }

  if ('page_id' in b) {
    if (!b.page_id) return error('A file has to live in a folder.', 422, 'VALIDATION_ERROR');
    // Moving into a folder requires the right to write in the destination.
    const { data: dest } = await ctx.supabase
      .from('v_workspace_tree').select('id, permission')
      .eq('organization_id', ctx.org.organizationId).eq('id', b.page_id).maybeSingle();
    if (!dest) return error('That folder does not exist in this organization.', 404, 'NOT_FOUND');
    if (!['edit', 'manage'].includes(dest.permission)) {
      return error('You do not have permission to move files there.', 403, 'RLS_DENIED');
    }
    update.page_id = b.page_id;
  }

  if (Object.keys(update).length === 1) return error('Nothing to update', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('files').update(update)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null)
    .select('*').maybeSingle();

  if (e) return pgError(e);
  /**
   * An empty result is a permission refusal about as often as a miss.
   *
   * 0035 widened `files_update` so that somebody who may write in the folder a
   * file sits in can rename it, not only the person who uploaded it. The old
   * rule meant the owner of the Finance folder could not correct a misspelt
   * filename in it, and this endpoint answered with a sentence that was true
   * and useless.
   */
  if (!data) {
    return error(
      'Not found, or you do not have permission to change it.',
      404, 'NOT_FOUND',
    );
  }
  return success(data);
}

export { PATCH as PUT };

/**
 * Remove a file.
 *
 * Soft. The stored object is deliberately left in place: a metadata row can be
 * restored, a deleted object cannot, and "someone removed the wrong file" is a
 * far more common support request than "storage is too full". Cleaning up
 * orphaned objects is a housekeeping job, not something a click should do.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'delete');
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
