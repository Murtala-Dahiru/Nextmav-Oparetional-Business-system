import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { error, success } from '@/lib/api-response';
const objectSchema = z.enum(['contacts', 'companies']);
const viewSchema = z.object({
  name: z.string().trim().min(1).max(60), search: z.string().max(250),
  sort: z.enum(['createdAt', 'updatedAt', 'name', 'industry', 'employeeCount', 'annualRevenue', 'firstName', 'lastName', 'email']),
  sortDir: z.enum(['asc', 'desc']), columns: z.array(z.string().max(100)).max(30),
  filters: z.partialRecord(z.enum(['industry', 'ownerId', 'country', 'parentCompanyId', 'domain', 'companyId', 'isActive', 'relationshipRole', 'segment', 'tag', 'custom']), z.string().max(12000)),
}).strict();
const saveSchema = z.object({ object: objectSchema, version: z.number().int().min(0), views: z.array(viewSchema).max(20) }).strict();
export async function GET(req: Request) {
  const ctx = await authorize('crm'); if (ctx instanceof Response) return ctx;
  const object = objectSchema.safeParse(new URL(req.url).searchParams.get('object'));
  if (!object.success) return error('Select contacts or companies', 422);
  const result = await ctx.supabase.from('crm_directory_views').select('version,views').eq('organization_id', ctx.org.organizationId).eq('member_id', ctx.org.memberId).eq('object', object.data).maybeSingle();
  if (result.error) return pgError(result.error);
  return success(result.data ?? { version: 0, views: [] });
}
export async function POST(req: Request) {
  const ctx = await authorize('crm'); if (ctx instanceof Response) return ctx;
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0].message, 422);
  const result = await ctx.supabase.rpc('crm_directory_views_save', { p_org: ctx.org.organizationId, p_object: parsed.data.object, p_version: parsed.data.version, p_views: parsed.data.views });
  if (result.error) return pgError(result.error);
  return success({ version: result.data });
}
