import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

type Params = { params: Promise<{ id: string }> };

/**
 * Edit a message.
 *
 * Only the sender may change the text — enforced by RLS, which restricts
 * UPDATE to rows whose sender is the caller. `edited_at` is stamped so the UI
 * can mark it, since a silently altered message is a small integrity problem
 * in a shared channel.
 */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const update: Record<string, any> = {};

    if (typeof b.body === 'string') {
      const text = b.body.trim();
      if (!text) return error('A message cannot be emptied; delete it instead', 422, 'VALIDATION_ERROR');
      update.body = text;
      update.edited_at = new Date().toISOString();
    }
    // Pinning is a channel action rather than an edit, but shares the row.
    if ('is_pinned' in b) update.is_pinned = !!b.is_pinned;

    if (!Object.keys(update).length) return error('Nothing to update', 422, 'VALIDATION_ERROR');

    const { data, error: e } = await ctx.supabase
      .from('messages')
      .update(update)
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (e) return pgError(e);
    if (!data) return error('Not found', 404, 'NOT_FOUND');
    return success(data);
  } catch (e: any) {
    return error(e.message || 'Update failed', 500);
  }
}

/**
 * Delete a message.
 *
 * Soft delete: a thread with holes in it is confusing, and replies reference
 * the parent. The row stays so the conversation structure survives, and the
 * client renders it as removed.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString(), body: '' })
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true });
}

// The message composer sends PUT when saving an edit.
export { PATCH as PUT };
