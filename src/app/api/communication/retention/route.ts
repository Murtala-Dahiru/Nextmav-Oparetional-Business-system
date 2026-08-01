import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { communicationPolicy } from '@/lib/communication';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Apply the retention policy.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this is a button and not a nightly job ───────────────────────────
 *
 *  Because it deletes a company's conversations, and that should not happen
 *  quietly at three in the morning because a number was typed into a settings
 *  box six weeks ago. An administrator runs it, is told first how many
 *  messages it will affect, sees how many went, and the act is written into
 *  the moderation trail with their name on it.
 *
 *  A scheduled job is a reasonable thing to want on top of this. It is not a
 *  reasonable thing to have *instead* of it, and building the job first is how
 *  a product ends up destroying data with no record of who asked.
 */

/** How many messages the current policy would remove, without removing them. */
export async function GET() {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const policy = await communicationPolicy(ctx);
  if (policy.retentionDays <= 0) {
    return success({ retentionDays: 0, affected: 0, enabled: false });
  }

  const cutoff = new Date(Date.now() - policy.retentionDays * 86_400_000).toISOString();

  const { count, error: e } = await ctx.supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.org.organizationId)
    .is('deleted_at', null)
    .lt('created_at', cutoff);

  if (e) return pgError(e);

  return success({
    retentionDays: policy.retentionDays,
    affected: count ?? 0,
    cutoff,
    enabled: true,
  });
}

/**
 * Run it.
 *
 * `apply_message_retention()` refuses anybody who is not an organisation
 * administrator, reads the policy from `org_settings` rather than from this
 * request — a retention period passed in a request body would be a way to
 * delete a year of history without ever changing a setting anybody could see
 * — and writes the audit entry itself.
 */
export async function POST() {
  const ctx = await authorize('admin', 'manage');
  if (ctx instanceof Response) return ctx;

  const policy = await communicationPolicy(ctx);
  if (policy.retentionDays <= 0) {
    return error(
      'No retention period is set, so there is nothing to apply. '
      + 'Set one in the communication policy first.',
      422, 'NOTHING_TO_APPLY',
    );
  }

  const { data, error: e } = await ctx.supabase
    .rpc('apply_message_retention', { org: ctx.org.organizationId });

  if (e) {
    if (e.code === '42501') {
      return error('Only an administrator can apply a retention policy.', 403, 'FORBIDDEN_ACTION');
    }
    return pgError(e);
  }

  return success({ removed: data ?? 0, retentionDays: policy.retentionDays });
}
