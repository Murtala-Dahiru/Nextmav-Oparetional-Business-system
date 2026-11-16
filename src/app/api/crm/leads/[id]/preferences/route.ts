import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { error, success, serverError } from '@/lib/api-response';
import { activeOwnedScope } from '@/lib/supabase/crm-scope';
import { communicationPreferencesSchema } from '@/lib/crm/lead-preferences';
const input = z.object({ updatedAt: z.iso.datetime({ offset: true }), preferences: communicationPreferencesSchema });
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authorize('crm', 'edit'); if (ctx instanceof Response) return ctx;
    const { id } = await params;
    const parsed = input.safeParse(await req.json().catch(() => null));
    if (!z.uuid().safeParse(id).success || !parsed.success) return error('Check the preferences and reload the lead before saving.', 422);
    const r = await activeOwnedScope(ctx.supabase.from('leads').update({ communication_preferences: parsed.data.preferences })
      .eq('organization_id', ctx.org.organizationId).eq('id', id).eq('updated_at', parsed.data.updatedAt), ctx).select('id,updated_at').maybeSingle();
    if (r.error) return pgError(r.error);
    if (!r.data) return error('This lead changed or is unavailable. Reload before saving preferences.', 409);
    return success(r.data);
  } catch (cause) { return serverError(cause, 'Could not save communication preferences.'); }
}
