import { z } from 'zod';
import { authorize } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { activeOwnedScope } from '@/lib/supabase/crm-scope';
import { recordActivity } from '@/lib/activity';

const input = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'negotiation']),
  leads: z.array(z.object({ id: z.uuid(), updatedAt: z.iso.datetime({ offset: true }) })).min(1).max(100),
});
/** Independent, optimistic writes: a stale selection never overwrites a newer edit/conversion. */
export async function POST(req: Request) {
  try {
    const ctx = await authorize('crm', 'edit');
    if (ctx instanceof Response) return ctx;
    const parsed = input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return error('Choose up to 100 current leads and a valid status.', 422);
    const results: { id: string; updated: boolean; message?: string }[] = [];
    for (const lead of parsed.data.leads) {
      const result = await activeOwnedScope(ctx.supabase.from('leads').update({ status: parsed.data.status })
        .eq('organization_id', ctx.org.organizationId).eq('id', lead.id).eq('updated_at', lead.updatedAt)
        .is('converted_contact_id', null), ctx).select('*').maybeSingle();
      if (result.error || !result.data) {
        results.push({ id: lead.id, updated: false, message: result.error ? 'Status rejected. Review qualification and permissions in the lead record.' : 'Lead changed or is no longer available. Reload before retrying.' });
      } else {
        recordActivity(ctx, { action: 'update', table: 'leads', row: result.data });
        results.push({ id: lead.id, updated: true });
      }
    }
    return success(results);
  } catch (cause) { return serverError(cause, 'Could not update lead statuses.'); }
}
