import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';

export async function GET(req: Request) {
  try {
    const ctx = await authorize('crm', 'view');
    if (ctx instanceof Response) return ctx;
    const ids = z.array(z.uuid()).min(1).max(100).safeParse(new URL(req.url).searchParams.get('ids')?.split(','));
    if (!ids.success) return error('Choose between 1 and 100 leads.', 422);
    const result = await ctx.supabase.rpc('crm_lead_engagement', { p_org: ctx.org.organizationId, p_ids: ids.data });
    if (result.error) return pgError(result.error);
    return success(result.data);
  } catch (cause) { return serverError(cause, 'Could not load lead engagement.'); }
}
