import { z } from 'zod';
import { authorize } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { crmDatabaseError } from '@/lib/crm/database-error';
import { draftWorkflowSchema, workflowSchema } from '@/lib/crm/automation';

export async function GET(req: Request) {
  const ctx = await authorize('crm', 'manage'); if (ctx instanceof Response) return ctx;
  const u = new URL(req.url), page = Math.max(1, Math.min(10000, Number(u.searchParams.get('page')) || 1));
  let q = ctx.supabase.from('crm_automations').select('*,owner:organization_members(profiles!organization_members_user_id_fkey(full_name))', { count: 'exact' }).eq('organization_id', ctx.org.organizationId);
  const search = u.searchParams.get('search')?.slice(0, 120); if (search) q = q.ilike('name', `%${search.replace(/[%_]/g, '')}%`);
  const status = u.searchParams.get('status'); if (status) q = q.eq('status', status);
  const trigger = u.searchParams.get('trigger'); if (trigger) q = q.eq('effective_trigger', trigger);
  const owner = u.searchParams.get('owner'); if (owner && z.uuid().safeParse(owner).success) q = q.eq('owner_id', owner);
  const sort = u.searchParams.get('sort') === 'name' ? 'name' : 'updated_at';
  const r = await q.order(sort, { ascending: sort === 'name' }).range((page - 1) * 20, page * 20 - 1);
  if (r.error) return crmDatabaseError(r.error);
  const versionIds = (r.data ?? []).map(a => a.published_version).filter(Boolean);
  const versions = versionIds.length ? await ctx.supabase.from('crm_automation_versions').select('id,definition').eq('organization_id', ctx.org.organizationId).in('id', versionIds) : { data: [], error: null };
  if (versions.error) return crmDatabaseError(versions.error);
  return paginated((r.data ?? []).map(a => {
    const published = versions.data?.find(v => v.id === a.published_version)?.definition;
    return { ...a, published_trigger: published?.trigger ?? null, has_draft_changes: Boolean(published && JSON.stringify(published) !== JSON.stringify(a.draft)) };
  }), r.count ?? 0, page, 20);
}
const saveSchema = z.object({ id: z.uuid().nullable(), revision: z.number().int().min(0), name: z.string().trim().min(1).max(120), description: z.string().max(1000), definition: z.record(z.string(), z.unknown()), operation: z.enum(['save', 'publish', 'pause', 'resume', 'archive']) }).strict();
export async function POST(req: Request) {
  const ctx = await authorize('crm', 'manage'); if (ctx instanceof Response) return ctx;
  let raw: unknown; try { raw = await req.json(); } catch { return error('Invalid JSON', 422); }
  const p = saveSchema.safeParse(raw); if (!p.success || JSON.stringify(raw).length > 32000) return error('Invalid automation request', 422);
  const v = p.data;
  if (['save', 'publish'].includes(v.operation) && !draftWorkflowSchema.safeParse(v.definition).success) return error('Invalid draft structure', 422);
  if (v.operation === 'publish') { const w = workflowSchema.safeParse(v.definition); if (!w.success) return error(w.error.issues[0]?.message ?? 'Invalid workflow', 422); }
  const r = await ctx.supabase.rpc('crm_automation_save', { p_org: ctx.org.organizationId, p_id: v.id, p_revision: v.revision, p_name: v.name, p_description: v.description, p_definition: v.definition, p_operation: v.operation });
  if (r.error) return crmDatabaseError(r.error);
  const record = await ctx.supabase.from('crm_automations').select('*').eq('id', r.data).eq('organization_id', ctx.org.organizationId).single();
  if (record.error) return crmDatabaseError(record.error);
  return success(record.data);
}
