import { authorize } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { crmDatabaseError } from '@/lib/crm/database-error';
export async function GET() {
  const ctx = await authorize('crm', 'manage'); if (ctx instanceof Response) return ctx;
  const org = ctx.org.organizationId;
  const statuses = ['published', 'paused', 'draft', 'archived'];
  const results = await Promise.all([
    ...statuses.map(s => ctx.supabase.from('crm_automations').select('id', { head: true, count: 'exact' }).eq('organization_id', org).eq('status', s)),
    ctx.supabase.from('crm_automation_runs').select('id', { head: true, count: 'exact' }).eq('organization_id', org).eq('status', 'failed'),
    ctx.supabase.from('crm_automation_runs').select('id', { head: true, count: 'exact' }).eq('organization_id', org).gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ctx.supabase.from('crm_automation_audit').select('*,automation:crm_automations(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(10),
    ctx.supabase.rpc('crm_automation_health', { p_org: org }),
  ]);
  const failure = results.find(r => r.error)?.error; if (failure) return crmDatabaseError(failure);
  return success({ active: results[0].count, paused: results[1].count, drafts: results[2].count, archived: results[3].count, failed: results[4].count, recent: results[5].count, activity: results[6].data, scheduler: results[7].data });
}
