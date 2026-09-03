import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { HR_DOCUMENT_CATEGORIES } from '@/lib/hr';

type Params = { params: Promise<{ id: string }> };

/**
 * A signed URL for one document.
 *
 * The bytes are in a private bucket, so a path is not a way to read a file -
 * this is. `files_select` has already decided whether the caller may see the
 * row at all, and a row they cannot see returns 404 here, so the signed URL is
 * only ever minted for somebody the policy has admitted.
 *
 * Sixty seconds. Long enough to open, short enough that a URL pasted into a
 * chat is dead by the time anybody clicks it.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: file, error: e } = await ctx.supabase
    .from('files').select('id, bucket, path, filename, mime_type, hr_category, member_id')
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .not('hr_category', 'is', null)
    .is('deleted_at', null)
    .maybeSingle();

  if (e) return pgError(e);
  if (!file) return error('Not found', 404, 'NOT_FOUND');

  const { data: signed, error: se } = await ctx.supabase
    .storage.from(file.bucket).createSignedUrl(file.path, 60);

  if (se || !signed) {
    return error(
      'The document record exists but its file could not be reached in storage.',
      502, 'STORAGE_UNAVAILABLE',
    );
  }

  return success({ ...file, url: signed.signedUrl, expiresIn: 60 });
}

/** Refiling: the category, and which employee it belongs to. */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const b = acceptBody(await req.json());
  const update: Record<string, any> = {};

  if ('hr_category' in b) {
    if (!(HR_DOCUMENT_CATEGORIES as readonly string[]).includes(String(b.hr_category))) {
      return error(`Category must be one of: ${HR_DOCUMENT_CATEGORIES.join(', ')}.`, 422, 'VALIDATION_ERROR');
    }
    update.hr_category = b.hr_category;
  }
  if ('member_id' in b) update.member_id = b.member_id || null;
  if ('filename' in b && String(b.filename).trim()) update.filename = String(b.filename).trim();

  if (!Object.keys(update).length) {
    return error('Nothing to update', 422, 'VALIDATION_ERROR');
  }

  const { data, error: e } = await ctx.supabase
    .from('files').update(update)
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .not('hr_category', 'is', null)
    .select('id, filename, hr_category, member_id')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

/**
 * Soft delete, like everywhere else files are removed here.
 *
 * `deleted_at` rather than a row delete: a contract that a checklist step cites
 * as its evidence must not leave a dangling reference, and an employment record
 * whose documents can be permanently erased from a list view is one nobody
 * should trust.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('files').update({ deleted_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .not('hr_category', 'is', null)
    .select('id')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true });
}
