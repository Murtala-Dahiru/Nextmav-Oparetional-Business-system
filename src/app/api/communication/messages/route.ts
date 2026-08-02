import { authorize, pgError } from '@/lib/auth-context';
import { success, error, paginated, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { communicationPolicy } from '@/lib/communication';

/**
 * What a message carries on the way out.
 *
 * `files` is new in 0023 and is what makes an attachment real: the bytes are
 * in storage, the governance is a `files` row, and this is the join that puts
 * them on the message without a second request per bubble. Embedded rather
 * than fetched separately because a timeline of a hundred messages would
 * otherwise be a hundred attachment lookups — the same arithmetic that made
 * `channel_overview()` necessary.
 */
const SELECT =
  '*, sender:organization_members!messages_sender_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), '
  + 'reactions:message_reactions(emoji, member_id), '
  + 'files!files_message_id_fkey(id, filename, mime_type, size_bytes, bucket, path, created_at)';

/**
 * Messages in a channel.
 *
 * Visibility is enforced by RLS: a message in a private channel is readable
 * only by members of that channel, so this handler does not re-check
 * membership and cannot drift from the policy.
 *
 * Ordered newest-first and paginated, which is how a chat scrollback loads.
 * The client reverses for display; fetching oldest-first would mean reading
 * the whole history to show the last twenty messages.
 */
export async function GET(req: Request) {
  const ctx = await authorize('communication', 'view');
  if (ctx instanceof Response) return ctx;

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channel_id') ?? searchParams.get('channelId');
  if (!channelId) return error('channel_id is required', 422, 'VALIDATION_ERROR');

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));

  let query = ctx.supabase
    .from('messages')
    .select(SELECT, { count: 'exact' })
    .eq('organization_id', ctx.org.organizationId)
    .eq('channel_id', channelId)
    .is('deleted_at', null);

  /**
   * Thread replies are fetched explicitly; the main timeline shows roots only.
   *
   * Both spellings accepted, as `channel_id` above already is. This read only
   * `parent_id`, so a component asking for `?parentId=` got the channel's root
   * messages back instead of the thread it asked for — no error, just the wrong
   * list, which is the failure mode that takes longest to notice.
   */
  const parentId = searchParams.get('parent_id') ?? searchParams.get('parentId');
  if (parentId) query = query.eq('parent_id', parentId);
  else query = query.is('parent_id', null);

  /**
   * Scrolling back.
   *
   * ── Why a cursor and not `page=2` ─────────────────────────────────────────
   *
   * Offset paging over a live conversation is wrong in a way that is easy to
   * miss: between loading page 1 and asking for page 2, three messages arrive.
   * Every row shifts by three, so page 2 re-serves rows the reader already has
   * and skips others — the scrollback repeats itself and loses things at the
   * same time. A cursor on `created_at` asks for "older than what I already
   * hold", which is stable no matter what arrives at the other end of the list.
   *
   * `page` is still honoured for anything that wants a fixed window, and both
   * spellings are accepted as everywhere else here.
   */
  const before = searchParams.get('before') ?? searchParams.get('beforeCreatedAt');
  if (before) query = query.lt('created_at', before);

  const off = before ? 0 : (page - 1) * pageSize;
  const { data, count, error: e } = await query
    .order('created_at', { ascending: false })
    .range(off, off + pageSize - 1);

  if (e) return pgError(e);

  const rows = data ?? [];
  return paginated(rows, count ?? 0, page, pageSize, {
    // The oldest row in this batch, ready to be handed straight back as
    // `?before=`. Derived here so the client never has to know that the list
    // it holds has been reversed for display.
    nextBefore: rows.length === pageSize
      ? ((rows[rows.length - 1] as any)?.created_at ?? null)
      : null,
    hasMore: rows.length === pageSize,
  });
}

/** Record references a message may carry. See section 9 of migration 0023. */
const REFERENCE_KINDS = [
  'task', 'page', 'project', 'invoice', 'ticket', 'company', 'deal', 'meeting',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Post a message.
 *
 * The sender is taken from the session, never the body — accepting it would
 * let anyone post as a colleague. Mentions are stored as membership ids so the
 * notification trigger does not have to re-parse the text.
 */
export async function POST(req: Request) {
  const ctx = await authorize('communication', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());
    if (!b.channel_id) return error('channel_id is required', 422, 'VALIDATION_ERROR');

    const body = String(b.body ?? '').trim();

    /**
     * Two different things arrive under two different names, deliberately.
     *
     *   `files`       — objects already uploaded to storage by the browser.
     *                   Each becomes a `files` row, which is what makes it
     *                   findable, attributable and revocable afterwards.
     *   `attachments` — references to business records: a task, a project, a
     *                   workspace page. No bytes, no storage, and nothing to
     *                   govern beyond what already governs the record.
     *
     * They were one field before, which is a large part of why
     * `messages.attachments` has been accepted since the first migration and
     * has never once been non-empty: there is no shape that is right for both.
     */
    const uploads: any[] = Array.isArray(b.files) ? b.files : [];
    const references = normaliseReferences(b.attachments);

    // A message with nothing in it at all is an accidental empty send.
    if (!body && !uploads.length && !references.length) {
      return error('A message needs text, a file, or a link to something', 422, 'VALIDATION_ERROR');
    }

    /**
     * Uploads are checked before the message exists.
     *
     * The path prefix is the whole storage security model — every policy checks
     * the first segment against the caller's memberships — and a `files` row
     * pointing outside it would be a way to register another tenant's object
     * against this organisation and then read it back through a signed URL this
     * application generates. The workspace endpoint makes the same check for
     * the same reason.
     */
    const policy = await communicationPolicy(ctx);
    const maxBytes = policy.maxAttachmentMb * 1024 * 1024;

    for (const f of uploads) {
      if (!f?.path || !f?.filename) {
        return error('Each file needs a path and a filename.', 422, 'VALIDATION_ERROR');
      }
      if (String(f.path).split('/')[0] !== ctx.org.organizationId) {
        return error('That file was stored outside your organisation.', 403, 'FORBIDDEN_ACTION');
      }
      if (!['attachments', 'documents'].includes(String(f.bucket ?? 'attachments'))) {
        return error('A conversation attachment lives in the attachments bucket.', 422, 'VALIDATION_ERROR');
      }
      if (Number(f.size_bytes ?? f.sizeBytes ?? 0) > maxBytes) {
        return error(
          `"${f.filename}" is larger than the ${policy.maxAttachmentMb}MB this organisation allows.`,
          422, 'FILE_TOO_LARGE',
        );
      }
    }

    const { data, error: e } = await ctx.supabase
      .from('messages')
      .insert({
        organization_id: ctx.org.organizationId,
        channel_id: b.channel_id,
        sender_id: ctx.org.memberId,
        body,
        parent_id: b.parent_id || null,
        mentions: Array.isArray(b.mentions) ? b.mentions : [],
        attachments: references,
      })
      .select('id')
      .single();

    if (e) return pgError(e);

    if (uploads.length) {
      const { error: fileError } = await ctx.supabase.from('files').insert(
        uploads.map(f => ({
          organization_id: ctx.org.organizationId,
          bucket: String(f.bucket ?? 'attachments'),
          path: String(f.path),
          filename: String(f.filename),
          mime_type: f.mime_type ?? f.mimeType ?? null,
          size_bytes: Number(f.size_bytes ?? f.sizeBytes ?? 0),
          message_id: data.id,
          channel_id: b.channel_id,
          uploaded_by: ctx.org.memberId,
        })),
      );
      /**
       * A message whose attachments could not be recorded is worse than no
       * message at all: the sender watches their file post and nobody can open
       * it. The message is withdrawn and the real error surfaced rather than
       * leaving that behind.
       */
      if (fileError) {
        await ctx.supabase.from('messages').delete().eq('id', data.id);
        return pgError(fileError);
      }
    }

    // Read back through the full projection, so the client receives exactly the
    // shape the timeline renders — attachments included.
    const { data: full } = await ctx.supabase
      .from('messages').select(SELECT).eq('id', data.id).single();

    // Keep the sender's own unread marker current, so their message does not
    // come back to them as unread.
    await ctx.supabase
      .from('channel_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('channel_id', b.channel_id)
      .eq('member_id', ctx.org.memberId);

    return success(full ?? data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Failed to send the message');
  }
}

/**
 * Keep only well-formed record references.
 *
 * Dropped rather than rejected: a reference the client got wrong should not
 * cost somebody the message they typed. The kinds are checked because a label
 * is rendered as a link into a module, and an unknown kind would be a chip
 * that goes nowhere.
 */
function normaliseReferences(raw: unknown): { kind: string; id: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r: any) =>
      r && typeof r === 'object'
      && REFERENCE_KINDS.includes(String(r.kind))
      && UUID.test(String(r.id)))
    .slice(0, 10)
    .map((r: any) => ({
      kind: String(r.kind),
      id: String(r.id),
      label: String(r.label ?? '').slice(0, 200),
    }));
}
