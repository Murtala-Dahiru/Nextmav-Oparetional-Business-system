import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

/**
 * A time-limited link to something posted in a conversation.
 *
 * ── Why this is not `/api/workspace/files/[id]` ──────────────────────────
 *
 * That endpoint's gate is `workspace`, and a member of staff with no workspace
 * grant may still have a conversation. More importantly, its permission check
 * is "which folder is this in" - a question a chat attachment has no answer to.
 * Here the equivalent question is "which conversation is this in", and it is
 * already answered: `files_select` was narrowed in 0023 so a row carrying a
 * `channel_id` is only selectable by somebody who can see that channel. If the
 * caller cannot read the conversation, this query returns nothing and the
 * handler answers 404 - the same shape of answer a private channel gives for
 * everything else, and for the same reason.
 */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data: file, error: e } = await ctx.supabase
    .from('files')
    .select('id, filename, mime_type, size_bytes, bucket, path, channel_id, message_id, created_at')
    .eq('organization_id', ctx.org.organizationId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle<any>();

  if (e) return pgError(e);
  if (!file) return error('Not found', 404, 'NOT_FOUND');

  /**
   * Only conversation attachments are served here.
   *
   * A file with no `channel_id` belongs to a workspace page, a project or an
   * expense claim, each of which has its own endpoint with its own permission
   * question. Serving them from this one would mean this route quietly became
   * a way around all three.
   */
  if (!file.channel_id) {
    return error('That file was not posted in a conversation.', 404, 'NOT_FOUND');
  }

  // Ten minutes: long enough to open or download, short enough that a link
  // pasted somewhere else has stopped working by the time anyone finds it.
  const { data: signed, error: signError } = await ctx.supabase
    .storage.from(file.bucket).createSignedUrl(file.path, 600);

  if (signError) {
    return error(
      'The file record exists but the stored object could not be reached.',
      502, 'STORAGE_UNAVAILABLE',
    );
  }

  return success({ ...file, url: signed?.signedUrl ?? null, expiresIn: 600 });
}
