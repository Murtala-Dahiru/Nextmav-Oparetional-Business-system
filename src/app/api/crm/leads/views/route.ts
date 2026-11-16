import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { leadViewsSchema } from '@/lib/crm/lead-views';
export async function GET() {
  const ctx = await authorize('crm', 'view'); if (ctx instanceof Response) return ctx;
  const r = await ctx.supabase.from('crm_lead_views').select('views,version').eq('organization_id', ctx.org.organizationId).eq('member_id', ctx.org.memberId).maybeSingle();
  if (r.error) return pgError(r.error);
  return success(r.data ?? { views: [], version: 0 });
}
export async function PUT(req: Request) {
  try {
    const ctx = await authorize('crm', 'view'); if (ctx instanceof Response) return ctx;
    const parsed = leadViewsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return error('Check saved view names and filters (maximum 20 views).', 422);
    const r = await ctx.supabase.rpc('crm_save_lead_views', { p_org: ctx.org.organizationId, p_version: parsed.data.version, p_views: parsed.data.views });
    if (!r.error && r.data === -1) return error('Saved views changed in another session. Reload before saving.', 409);
    if (r.error) return pgError(r.error);
    return success({ version: r.data });
  } catch (cause) { return serverError(cause, 'Could not save lead views.'); }
}
