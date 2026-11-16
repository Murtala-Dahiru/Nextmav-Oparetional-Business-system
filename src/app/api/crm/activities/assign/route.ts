import { z } from 'zod';
import { authorize } from '@/lib/auth-context';
import { crmDatabaseError } from '@/lib/crm/database-error';
import { error, success, serverError } from '@/lib/api-response';
const schema = z.object({ id: z.uuid(), updatedAt: z.iso.datetime({ offset: true }), memberId: z.uuid() }).strict();
export async function POST(req: Request) {
  try {
    const ctx = await authorize('crm', 'edit'); if (ctx instanceof Response) return ctx;
    const p = schema.safeParse(await req.json().catch(() => null)); if (!p.success) return error('Invalid activity action', 422);
    const r = await ctx.supabase.rpc('crm_activity_action', { p_org: ctx.org.organizationId, p_id: p.data.id, p_updated: p.data.updatedAt, p_action: 'reassign', p_due: null, p_member: p.data.memberId });
    if (r.error) return crmDatabaseError(r.error);
    return success({ saved: true });
  } catch (cause) { return serverError(cause, 'Could not update activity.'); }
}
