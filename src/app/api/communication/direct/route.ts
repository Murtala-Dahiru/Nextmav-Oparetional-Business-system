import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * Open a direct conversation with a colleague.
 *
 * Delegates to `open_direct_channel()`, which is where the rules live: the
 * pair must be unique in *both* directions — otherwise Ada messaging Grace and
 * Grace messaging Ada produce two half-empty threads neither of them can find
 * the other in — and creating the channel with both memberships has to be one
 * atomic act, or a crash between them leaves a conversation nobody is in.
 *
 * Returns the existing thread when there is one, so "message" is idempotent
 * and the client can call it every time somebody clicks a name.
 */
export async function POST(req: Request) {
  const ctx = await authorize('communication', 'create');
  if (ctx instanceof Response) return ctx;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const other = b.member_id || b.other_member_id;
  if (!other) return error('memberId is required', 422, 'VALIDATION_ERROR');

  const { data: channelId, error: e } = await ctx.supabase.rpc('open_direct_channel', {
    org: ctx.org.organizationId,
    other_member: other,
  });

  if (e) return pgError(e);

  const { data: channel } = await ctx.supabase
    .from('channels').select('*').eq('id', channelId).maybeSingle();

  const { data: members } = await ctx.supabase
    .from('v_channel_members').select('*').eq('channel_id', channelId);

  return success({ ...(channel ?? { id: channelId }), members: members ?? [] }, undefined, 201);
}
