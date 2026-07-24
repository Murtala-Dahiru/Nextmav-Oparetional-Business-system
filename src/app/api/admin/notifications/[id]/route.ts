import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

/** Toggle a single notification's read state. */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('dashboard', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const read = body?.is_read ?? true;

  const { data, error: e } = await ctx.supabase
    .from('notifications')
    .update({ is_read: read, read_at: read ? new Date().toISOString() : null })
    .eq('recipient_id', ctx.org.memberId)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success(data);
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await authorize('dashboard', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { error: e } = await ctx.supabase
    .from('notifications')
    .delete()
    .eq('recipient_id', ctx.org.memberId)
    .eq('id', id);

  if (e) return pgError(e);
  return success({ deleted: true });
}
