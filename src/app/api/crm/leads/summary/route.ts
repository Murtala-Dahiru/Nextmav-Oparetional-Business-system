import { authorize, pgError } from '@/lib/auth-context';
import { success, serverError } from '@/lib/api-response';
import { ownedScope } from '@/lib/supabase/crm-scope';

/** Exact counts, independent of list pagination; uses the same tenant and owner boundary. */
export async function GET() {
  try {
    const ctx = await authorize('crm', 'view');
    if (ctx instanceof Response) return ctx;
    const base = () => ownedScope(ctx.supabase.from('leads').select('id', { count: 'exact', head: true })
      .eq('organization_id', ctx.org.organizationId).is('deleted_at', null), ctx);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const results = await Promise.all([
      base().is('converted_contact_id', null).not('status', 'in', '(won,lost)'),
      base().gte('created_at', since),
      base().is('converted_contact_id', null).is('owner_id', null),
      base().is('converted_contact_id', null).eq('status', 'qualified'),
      base().eq('awaiting_response', true),
      base().eq('overdue_follow_up', true),
    ]);
    const failed = results.find(r => r.error);
    if (failed?.error) return pgError(failed.error);
    return success({ active: results[0].count, recent: results[1].count, unassigned: results[2].count, qualified: results[3].count, awaitingResponse: results[4].count, overdueFollowUp: results[5].count, since });
  } catch (cause) { return serverError(cause, 'Could not load lead summary.'); }
}
