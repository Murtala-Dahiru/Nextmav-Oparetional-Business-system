import type { RequestContext } from '@/lib/auth-context';
import {
  DEFAULT_COMMUNICATION_POLICY, type CommunicationPolicy,
} from '@/lib/org-settings';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The communication module's shared server-side concerns.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Two things that several routes need and none of them should own: the
 *  organisation's communication policy, and the moderation trail.
 *
 *  Both are here rather than inlined because the alternative is what this
 *  codebase already learned the hard way - three routes each reading
 *  `org_settings` with their own defaults, which is three answers to "may an
 *  author edit their message" that agree until one of them is changed.
 */

/**
 * Read this organisation's communication policy.
 *
 * Falls back to the documented defaults for anything absent, so a key added
 * after an organisation was created behaves as documented rather than as
 * `undefined`. The row itself is seeded by `default_org_settings()` and
 * backfilled by 0023; this covers the third case, a key added later still.
 */
export async function communicationPolicy(
  ctx: RequestContext,
): Promise<CommunicationPolicy> {
  const { data } = await ctx.supabase
    .from('org_settings')
    .select('value')
    .eq('organization_id', ctx.org.organizationId)
    .eq('key', 'communication_policy')
    .maybeSingle();

  const stored = (data?.value ?? {}) as Record<string, unknown>;

  // The row is snake_cased, like every `org_settings` document. Converting
  // here rather than asking each caller to know that is the whole point of
  // this function existing.
  return {
    channelCreation:
      stored.channel_creation === 'admins' ? 'admins' : DEFAULT_COMMUNICATION_POLICY.channelCreation,
    allowMessageEdit:
      stored.allow_message_edit === undefined
        ? DEFAULT_COMMUNICATION_POLICY.allowMessageEdit
        : stored.allow_message_edit !== false,
    editWindowMinutes: numberOr(stored.edit_window_minutes, DEFAULT_COMMUNICATION_POLICY.editWindowMinutes),
    allowMessageDelete:
      stored.allow_message_delete === undefined
        ? DEFAULT_COMMUNICATION_POLICY.allowMessageDelete
        : stored.allow_message_delete !== false,
    retentionDays: numberOr(stored.retention_days, DEFAULT_COMMUNICATION_POLICY.retentionDays),
    allowClientMeetings: stored.allow_client_meetings === true,
    maxAttachmentMb: numberOr(stored.max_attachment_mb, DEFAULT_COMMUNICATION_POLICY.maxAttachmentMb),
  };
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Roles that administer the organisation, as `is_org_admin()` defines them. */
export function isOrgAdmin(ctx: RequestContext): boolean {
  return ctx.org.role === 'owner' || ctx.org.role === 'administrator';
}

/**
 * Whether this message is still within its edit window.
 *
 * Returns the reason it is not, or null. Phrased as a message rather than a
 * boolean because the caller has to say *why* - "you can no longer edit this"
 * with no explanation is the sort of refusal people file a support ticket
 * about.
 */
export function editRefusal(
  policy: CommunicationPolicy,
  createdAt: string,
): string | null {
  if (!policy.allowMessageEdit) {
    return 'This organisation does not allow messages to be edited after they are sent.';
  }
  if (policy.editWindowMinutes > 0) {
    const age = (Date.now() - new Date(createdAt).getTime()) / 60_000;
    if (age > policy.editWindowMinutes) {
      return `Messages can only be edited for ${policy.editWindowMinutes} minutes after they are sent.`;
    }
  }
  return null;
}

/** The vocabulary `log_communication_event()` accepts. Kept in step with it. */
export type AuditAction =
  | 'message_deleted' | 'message_edited' | 'message_pinned' | 'message_unpinned'
  | 'channel_created' | 'channel_archived' | 'channel_deleted' | 'channel_settings_changed'
  | 'member_added' | 'member_removed' | 'member_role_changed'
  | 'policy_changed' | 'retention_applied'
  | 'meeting_started' | 'meeting_ended' | 'participant_removed';

/**
 * Record that something was done, without recording what was said.
 *
 * ── The one rule this function exists to hold ────────────────────────────
 *
 * `reason` is a description of the *act*, never a copy of the message. An
 * audit table is readable by every administrator; a message in a private
 * channel is not. Putting the second inside the first republishes it past its
 * own RLS, which is exactly how an expense title reached the organisation-wide
 * activity feed on 2026-07-31.
 *
 * Failures are swallowed. An audit write that fails must not fail the
 * moderation it was recording - the alternative is a message that could not be
 * deleted because the note about deleting it could not be filed.
 */
export async function audit(
  ctx: RequestContext,
  action: AuditAction,
  opts: {
    channelId?: string | null;
    messageId?: string | null;
    targetMemberId?: string | null;
    reason?: string;
  } = {},
): Promise<void> {
  try {
    await ctx.supabase.rpc('log_communication_event', {
      org: ctx.org.organizationId,
      p_action: action,
      p_channel: opts.channelId ?? null,
      p_message: opts.messageId ?? null,
      p_target: opts.targetMemberId ?? null,
      p_reason: opts.reason ?? '',
    });
  } catch {
    // Deliberately silent. See above.
  }
}
