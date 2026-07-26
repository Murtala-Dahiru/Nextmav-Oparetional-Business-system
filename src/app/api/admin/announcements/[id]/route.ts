import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

const AUDIENCES = ['staff', 'clients', 'everyone'];

const SELECT =
  'id, title, body, audience, project_id, is_pinned, published_at, expires_at, ' +
  'author:organization_members!announcements_author_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if ('title' in b) {
      const title = String(b.title ?? '').trim();
      if (!title) return error('An announcement needs a title', 422, 'VALIDATION_ERROR');
      update.title = title;
    }
    if ('body' in b) update.body = String(b.body ?? '');
    if ('audience' in b) {
      const audience = String(b.audience ?? '');
      if (!AUDIENCES.includes(audience)) {
        return error(
          `"${audience}" is not an audience. Expected one of: ${AUDIENCES.join(', ')}.`,
          422, 'INVALID_AUDIENCE',
        );
      }
      update.audience = audience;
    }
    if ('is_pinned' in b) update.is_pinned = b.is_pinned === true;
    if ('expires_at' in b) update.expires_at = b.expires_at || null;

    /**
     * `published_at` is deliberately not editable.
     *
     * The notification fan-out fires once, on insert. Moving the publication
     * date afterwards would produce an announcement dated today that nobody
     * was ever told about — the record and the delivery would disagree, and
     * the record is the thing people trust.
     */

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase
      .from('announcements').update(update)
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .is('deleted_at', null)
      .select(SELECT).maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

export { PATCH as PUT };

/**
 * Withdraw an announcement.
 *
 * Soft, so the notifications already delivered still resolve to something
 * rather than becoming dead links in people's trays.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('announcements')
    .update({ deleted_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.organizationId).eq('id', id)
    .is('deleted_at', null)
    .select('id').maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true, soft: true });
}
