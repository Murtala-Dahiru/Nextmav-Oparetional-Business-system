import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { crmObjectSchema, layoutSaveSchema } from '@/lib/crm/customization';
import { can } from '@/lib/permissions';
export async function GET(req: Request) {
  const ctx = await authorize('crm'); if (ctx instanceof Response) return ctx;
  const object = crmObjectSchema.safeParse(new URL(req.url).searchParams.get('object'));
  if (!object.success) return error('Select a CRM object', 422);
  const result = await ctx.supabase.from('crm_record_layouts').select(can(ctx.org.role, 'crm', 'manage') ? '*' : 'object,published,version').eq('organization_id', ctx.org.organizationId).eq('object', object.data).maybeSingle();
  if (result.error) return pgError(result.error);
  return success(result.data);
}
export async function POST(req: Request) {
  const ctx = await authorize('crm', 'manage'); if (ctx instanceof Response) return ctx;
  const parsed = layoutSaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0].message, 422);
  const p = parsed.data;
  const result = await ctx.supabase.rpc('crm_layout_save', { p_org: ctx.org.organizationId, p_object: p.object, p_version: p.version, p_action: p.action, p_sections: p.sections });
  if (result.error) return pgError(result.error);
  return success({ version: result.data });
}
