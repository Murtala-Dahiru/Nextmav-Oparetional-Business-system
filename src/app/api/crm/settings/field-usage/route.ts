import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { error, success } from '@/lib/api-response';
export async function GET(req: Request) {
  const ctx = await authorize('crm', 'manage');
  if (ctx instanceof Response) return ctx;
  const id = z.uuid().safeParse(new URL(req.url).searchParams.get('id'));
  if (!id.success) return error('Invalid field', 422);
  const result = await ctx.supabase.rpc('crm_field_usage', { p_org: ctx.org.organizationId, p_field: id.data });
  return result.error ? pgError(result.error) : success(result.data);
}
