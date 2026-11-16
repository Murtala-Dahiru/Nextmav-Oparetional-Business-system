import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { crmObjectSchema } from '@/lib/crm/customization';
const input = z.object({ object: crmObjectSchema, view: z.uuid().nullable() }).strict();
export async function POST(req: Request) {
  const ctx = await authorize('crm');
  if (ctx instanceof Response) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error('Choose a saved view', 422);
  const result = await ctx.supabase.rpc('crm_default_view_save', { p_org: ctx.org.organizationId, p_object: parsed.data.object, p_view: parsed.data.view });
  return result.error ? pgError(result.error) : success({ saved: true });
}
