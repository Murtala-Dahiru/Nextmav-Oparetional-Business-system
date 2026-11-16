import { z } from 'zod';
import { authorize } from '@/lib/auth-context';
import { success, error, paginated } from '@/lib/api-response';
import { crmDatabaseError } from '@/lib/crm/database-error';
export async function GET(req: Request) {
  const ctx = await authorize('crm', 'manage'); if (ctx instanceof Response) return ctx;
  const u = new URL(req.url), page = Math.max(1, Math.min(10000, Number(u.searchParams.get('page')) || 1));
  let q = ctx.supabase.from('crm_automation_runs').select('*,automation:crm_automations(name),event:crm_automation_events!inner(trigger,entity,record_id,created_at),steps:crm_automation_steps(*)', { count: 'exact' }).eq('organization_id', ctx.org.organizationId);
  for (const [param, column] of [['automation', 'automation_id'], ['id', 'id']]) { const v = u.searchParams.get(param); if (v) { if (!z.uuid().safeParse(v).success) return error('Invalid identifier', 422); q = q.eq(column, v); } }
  const status = u.searchParams.get('status'); if (status) q = q.eq('status', status);
  const trigger = u.searchParams.get('trigger'); if (trigger) q = q.eq('event.trigger', trigger);
  const since = u.searchParams.get('since'); if (since) { if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since))) return error('Invalid date', 422); q = q.gte('created_at', since); }
  const r = await q.order('created_at', { ascending: false }).range((page - 1) * 20, page * 20 - 1);
  if (r.error) return crmDatabaseError(r.error); return paginated(r.data ?? [], r.count ?? 0, page, 20);
}
export async function POST(req: Request) {
  const ctx = await authorize('crm', 'manage'); if (ctx instanceof Response) return ctx;
  let raw: unknown; try { raw = await req.json(); } catch { return error('Invalid JSON', 422); }
  const p = z.object({ runId: z.uuid() }).strict().safeParse(raw); if (!p.success) return error('Invalid run', 422);
  const r = await ctx.supabase.rpc('crm_automation_retry', { p_org: ctx.org.organizationId, p_run: p.data.runId });
  if (r.error) return crmDatabaseError(r.error); return success({ queued: true });
}
