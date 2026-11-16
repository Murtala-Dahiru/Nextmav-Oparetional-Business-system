import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { crmObjectSchema, fieldDefinitionSchema } from '@/lib/crm/customization';

export async function GET(req: Request) {
  const ctx = await authorize('crm'); if (ctx instanceof Response) return ctx;
  const object = crmObjectSchema.safeParse(new URL(req.url).searchParams.get('object'));
  if (!object.success) return error('Select a CRM object', 422);
  const result = await ctx.supabase.from('crm_field_definitions').select('*').eq('organization_id', ctx.org.organizationId).eq('object', object.data).order('position').order('id');
  if (result.error) return pgError(result.error);
  return success(result.data);
}
export async function POST(req: Request) {
  const ctx = await authorize('crm', 'manage'); if (ctx instanceof Response) return ctx;
  const parsed = fieldDefinitionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0].message, 422);
  const result = await ctx.supabase.rpc('crm_field_save', { p_org: ctx.org.organizationId, p_value: parsed.data });
  if (result.error) return pgError(result.error);
  return success({ id: result.data });
}
