'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, Reply, MoreHorizontal, Trash2, Pencil, AtSign } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime, initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

import { Nothing } from './ui';
import { getList, post, patch, remove } from './data';
import type { PageComment, DirectoryMember } from './types';

/**
 * ===========================================================================
 *  Discussion on a page
 * ===========================================================================
 *
 *  `comments.page_id` has had a foreign key and an index since the first
 *  business migration and no row has ever carried one. A workspace where a
 *  policy cannot be questioned in place is one where the questions happen in
 *  chat and are unfindable a week later.
 *
 *  -- Mentions -------------------------------------------------------------
 *
 *  Typing `@` opens the directory. What is *sent* is the list of membership
 *  ids the author picked, not a re-parse of the text: the notification trigger
 *  reads `comments.mentions`, so somebody is notified exactly when the author
 *  chose them, and editing the body afterwards cannot silently notify anybody
 *  new. The rendering resolves the same ids back to names, so a person who
 *  changes their name does not leave stale text behind.
 *
 *  -- One level of replies -------------------------------------------------
 *
 *  A thread of threads is a thread nobody reads. The endpoint refuses a reply
 *  to a reply, and this composes them flat under their parent, which is what
 *  the projects discussion settled on for the same reason.
 */

export function Discussion({
  pageId, members, canPost, comments, onChanged,
}: {
  pageId: string;
  members: DirectoryMember[];
  canPost: boolean;
  comments: PageComment[];
  onChanged: (next: PageComment[]) => void;
}) {
  const me = useAppStore(s => s.user);
  const [replyTo, setReplyTo] = React.useState<PageComment | null>(null);
  const [editing, setEditing] = React.useState<PageComment | null>(null);

  const reload = React.useCallback(async () => {
    try {
      onChanged(await getList<PageComment>(`/api/workspace/comments?pageId=${pageId}`));
    } catch { /* leave what is on screen */ }
  }, [pageId, onChanged]);

  const threads = React.useMemo(() => {
    const roots = comments.filter(c => !c.parentId);
    const repliesOf = new Map<string, PageComment[]>();
    for (const comment of comments) {
      if (!comment.parentId) continue;
      repliesOf.set(comment.parentId, [...(repliesOf.get(comment.parentId) ?? []), comment]);
    }
    return roots.map(root => ({ root, replies: repliesOf.get(root.id) ?? [] }));
  }, [comments]);

  const send = React.useCallback(async (body: string, mentions: string[], parentId: string | null) => {
    try {
      await post('/api/workspace/comments', { pageId, body, mentions, parentId });
      setReplyTo(null);
      await reload();
    } catch (err: any) {
      toast.error(err.message || 'Could not post that');
    }
  }, [pageId, reload]);

  return (
    <div className="space-y-4">
      {threads.length === 0 ? (
        <Nothing>
          {canPost
            ? 'No discussion yet. Ask a question here and it stays with the document.'
            : 'No discussion yet.'}
        </Nothing>
      ) : (
        <ul className="space-y-4">
          {threads.map(({ root, replies }) => (
            <li key={root.id}>
              <Comment
                comment={root}
                members={members}
                isMine={root.author?.id === me?.memberId}
                editing={editing?.id === root.id}
                onEdit={() => setEditing(root)}
                onCancelEdit={() => setEditing(null)}
                onSaveEdit={async (body) => {
                  try {
                    await patch(`/api/workspace/comments/${root.id}`, { body });
                    setEditing(null);
                    await reload();
                  } catch (err: any) { toast.error(err.message || 'Could not save that'); }
                }}
                onDelete={async () => {
                  try { await remove(`/api/workspace/comments/${root.id}`); await reload(); }
                  catch (err: any) { toast.error(err.message || 'Could not remove that'); }
                }}
                onReply={canPost ? () => setReplyTo(root) : undefined}
              />

              {(replies.length > 0 || replyTo?.id === root.id) && (
                <div className="ml-4 mt-3 space-y-3 border-l border-border pl-4">
                  {replies.map(reply => (
                    <Comment
                      key={reply.id}
                      comment={reply}
                      members={members}
                      isMine={reply.author?.id === me?.memberId}
                      editing={editing?.id === reply.id}
                      onEdit={() => setEditing(reply)}
                      onCancelEdit={() => setEditing(null)}
                      onSaveEdit={async (body) => {
                        try {
                          await patch(`/api/workspace/comments/${reply.id}`, { body });
                          setEditing(null);
                          await reload();
                        } catch (err: any) { toast.error(err.message || 'Could not save that'); }
                      }}
                      onDelete={async () => {
                        try { await remove(`/api/workspace/comments/${reply.id}`); await reload(); }
                        catch (err: any) { toast.error(err.message || 'Could not remove that'); }
                      }}
                    />
                  ))}

                  {replyTo?.id === root.id && (
                    <Composer
                      members={members}
                      placeholder={`Reply to ${root.author?.profiles?.fullName ?? 'this'}`}
                      autoFocus
                      onCancel={() => setReplyTo(null)}
                      onSubmit={(body, mentions) => send(body, mentions, root.id)}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canPost && (
        <Composer
          members={members}
          placeholder="Add a comment. Type @ to bring somebody in."
          onSubmit={(body, mentions) => send(body, mentions, null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  One comment                                                               */
/* -------------------------------------------------------------------------- */

function Comment({
  comment, members, isMine, editing, onEdit, onCancelEdit, onSaveEdit, onDelete, onReply,
}: {
  comment: PageComment;
  members: DirectoryMember[];
  isMine: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onReply?: () => void;
}) {
  const name = comment.author?.profiles?.fullName ?? 'A colleague';
  const avatar = comment.author?.profiles?.avatarUrl ?? undefined;

  return (
    <article className="group flex gap-3">
      <Avatar className="mt-0.5 size-7 shrink-0">
        <AvatarImage src={avatar} alt="" />
        <AvatarFallback className="text-[10px]">{initialsOf(name)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium">{name}</span>
          <span className="text-[11.5px] text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
            {comment.editedAt ? ' · edited' : ''}
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {onReply && (
              <Button variant="ghost" size="icon" className="size-6" title="Reply" onClick={onReply}>
                <Reply className="size-3.5" />
              </Button>
            )}
            {isMine && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6" aria-label="Comment options">
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="mr-2 size-3.5" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                    <Trash2 className="mr-2 size-3.5" /> Retract
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {editing ? (
          <Composer
            members={members}
            initial={comment.body}
            autoFocus
            submitLabel="Save"
            onCancel={onCancelEdit}
            onSubmit={async (body) => { await onSaveEdit(body); }}
          />
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
            {renderMentions(comment.body, members)}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * `@Name` becomes a mark, and everything else is text.
 *
 * Driven by the directory rather than by a pattern over `@\w+`: a bare pattern
 * cannot span "@Ada Lovelace" without also colouring "@lunch", and it would
 * disagree with the ids the composer actually sent. Longest name first, so
 * "@Ada Lovelace" wins over "@Ada" when both are in the company.
 *
 * Nothing here interprets markup. Every branch produces a React element with
 * the source as a child, so a comment containing `<script>` renders those
 * characters and does nothing else.
 */
function renderMentions(body: string, members: DirectoryMember[]): React.ReactNode {
  const named = [...members]
    .filter(m => m.fullName)
    .sort((a, b) => b.fullName.length - a.fullName.length);
  if (!named.length) return body;

  const escaped = named.map(m => m.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'gi');

  const out: React.ReactNode[] = [];
  let cursor = 0;
  let hit: RegExpExecArray | null;

  while ((hit = pattern.exec(body))) {
    if (hit.index > cursor) out.push(body.slice(cursor, hit.index));
    out.push(
      <span key={`${hit.index}-${hit[1]}`} className="rounded bg-[--ring]/12 px-1 font-medium text-foreground">
        @{hit[1]}
      </span>,
    );
    cursor = hit.index + hit[0].length;
  }
  if (cursor < body.length) out.push(body.slice(cursor));
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Composer                                                                  */
/* -------------------------------------------------------------------------- */

function Composer({
  members, placeholder, initial = '', autoFocus, submitLabel = 'Comment', onSubmit, onCancel,
}: {
  members: DirectoryMember[];
  placeholder?: string;
  initial?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  onSubmit: (body: string, mentions: string[]) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [body, setBody] = React.useState(initial);
  const [sending, setSending] = React.useState(false);
  const [picker, setPicker] = React.useState<{ query: string; at: number } | null>(null);
  const [highlight, setHighlight] = React.useState(0);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);

  /**
   * Who has been named, resolved from the text.
   *
   * Held as a set of ids alongside the body rather than derived at send time,
   * because the same person can be inserted and then deleted from the text and
   * an id left behind would notify them about a comment that does not mention
   * them.
   */
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());

  const mentions = React.useMemo(
    () => members.filter(m => chosen.has(m.memberId) && body.includes(`@${m.fullName}`))
      .map(m => m.memberId),
    [members, chosen, body],
  );

  const matches = React.useMemo(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    return members
      .filter(m => !q || m.fullName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [picker, members]);

  const onType = (value: string, caret: number) => {
    setBody(value);
    // The `@` that starts a mention is the last one before the caret with no
    // whitespace after it: "email me @ 5pm" is not the start of a mention.
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at === -1) { setPicker(null); return; }
    const query = upto.slice(at + 1);
    if (/[\n]/.test(query) || query.length > 24) { setPicker(null); return; }
    if (at > 0 && !/[\s(]/.test(upto[at - 1])) { setPicker(null); return; }
    setPicker({ query, at });
    setHighlight(0);
  };

  const insert = (member: DirectoryMember) => {
    if (!picker) return;
    const area = areaRef.current;
    const caret = area?.selectionStart ?? body.length;
    const next = `${body.slice(0, picker.at)}@${member.fullName} ${body.slice(caret)}`;
    setBody(next);
    setChosen(prev => new Set(prev).add(member.memberId));
    setPicker(null);
    requestAnimationFrame(() => {
      const position = picker.at + member.fullName.length + 2;
      area?.focus();
      area?.setSelectionRange(position, position);
    });
  };

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    await onSubmit(text, mentions);
    setSending(false);
    setBody('');
    setChosen(new Set());
  };

  return (
    <div className="relative">
      <div className="rounded-md border border-border bg-card focus-within:border-[--ring]">
        <textarea
          ref={areaRef}
          value={body}
          autoFocus={autoFocus}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => onType(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (picker && matches.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % matches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + matches.length) % matches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[highlight]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setPicker(null); return; }
            }
            // Enter sends, Shift+Enter breaks the line. That is the convention
            // in every chat tool, and a comment is closer to a message than to
            // a document.
            if (e.key === 'Enter' && !e.shiftKey && !picker) { e.preventDefault(); void submit(); }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
          className="w-full resize-none bg-transparent px-3 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
          <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <AtSign className="size-3" /> to mention
          </span>
          {mentions.length > 0 && (
            <span className="text-[11.5px] text-muted-foreground">
              {mentions.length} will be notified
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {onCancel && (
              <Button variant="ghost" size="sm" className="h-7 text-[12.5px]" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button size="sm" className="h-7 text-[12.5px]" disabled={!body.trim() || sending} onClick={submit}>
              {sending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>

      {picker && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute bottom-full left-2 z-30 mb-1 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-md"
        >
          {matches.map((member, index) => (
            <li key={member.memberId}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insert(member); }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px]',
                  index === highlight ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <Avatar className="size-5">
                  <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="text-[9px]">{initialsOf(member.fullName)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{member.fullName}</span>
                {member.jobTitle && (
                  <span className="shrink-0 truncate text-[11px] text-muted-foreground">{member.jobTitle}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
