import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';

export async function GET() {
  const ctx = await authorize('crm', 'manage');
  if (ctx instanceof Response) return ctx;
  const result = await ctx.supabase.from('crm_configuration_audit')
    .select('id,actor_id,change_type,target_id,created_at,after_metadata')
    .eq('organization_id', ctx.org.organizationId).order('id', { ascending: false }).limit(50);
  if (result.error) return pgError(result.error);
  return success(result.data.map(row => ({ id: row.id, actor: row.actor_id, action: row.change_type,
    object: row.after_metadata?.object, label: row.after_metadata?.label, createdAt: row.created_at })));
}
