'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Send, Loader2, Reply, Pencil, Trash2, MoreHorizontal, Eye, AtSign,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Head } from '@/components/shared/readout/primitives';
import { initialsOf, formatDateTime, formatRelativeTime } from '@/lib/format';
import { useAppStore } from '@/store/app-store';

import { post, patch, remove } from '../data';
import { Nothing } from '../ui';
import type { Comment, Member, Workspace } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Discussion - decisions kept with the work
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Three things the schema could do and the screen could not ────────────
 *
 *   · **Replies.** `comments.parent_id` is as old as the table and the POST
 *     handler has always accepted it. Nothing ever sent one and the select
 *     never returned one, so every message was top level and a thread of
 *     fifteen was fifteen unrelated cards.
 *
 *   · **Editing and retracting.** `PATCH` and `DELETE` exist, mark an edit
 *     rather than hiding it, and refuse anybody who is not the author. No
 *     control called either.
 *
 *   · **Mentioning by typing.** Mentions were a dropdown beside the box: pick
 *     a name from a list of everybody, and it becomes a chip that is not in
 *     the message. Typing `@` is how a person mentions somebody, and the
 *     membership ids still go to `comments.mentions` - which is the column the
 *     notification trigger reads, so an edit later cannot change who was told.
 *
 * ── Not a chat ───────────────────────────────────────────────────────────
 *
 * No typing indicators, no read receipts, no unread badge on every message.
 * Communication is where conversation belongs; this is where decisions are
 * written down so they can be found in March. The one thing it does carry
 * that chat cannot is the client-visible switch: a message marked so is read
 * by the customer in their portal, in the same chronology as everything else,
 * because a team keeping two histories of one project is how context gets
 * lost.
 */

export function DiscussionPanel({
  projectId, data, directory, onChanged,
}: {
  projectId: string;
  data: Workspace;
  directory: Member[];
  onChanged: () => void;
}) {
  const { comments, project } = data;
  const me = useAppStore(s => s.user?.memberId);

  const [replyTo, setReplyTo] = React.useState<Comment | null>(null);
  const [editing, setEditing] = React.useState<Comment | null>(null);
  const [deleting, setDeleting] = React.useState<Comment | null>(null);

  /**
   * Roots oldest first, replies under their parent.
   *
   * The endpoint returns newest first, which is right for the overview's
   * five-line preview and wrong here: a discussion reads top to bottom like a
   * conversation. A reply whose parent is not in the list - retracted, or
   * beyond the 200 the endpoint returns - is promoted to a root rather than
   * dropped, because losing a message because its parent is missing is worse
   * than showing it slightly out of place.
   */
  const threads = React.useMemo(() => {
    const byParent = new Map<string, Comment[]>();
    const ids = new Set(comments.map(c => c.id));
    const roots: Comment[] = [];

    const ordered = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const c of ordered) {
      if (c.parentId && ids.has(c.parentId)) {
        const list = byParent.get(c.parentId) ?? [];
        list.push(c);
        byParent.set(c.parentId, list);
      } else {
        roots.push(c);
      }
    }
    return roots.map(r => ({ root: r, replies: byParent.get(r.id) ?? [] }));
  }, [comments]);

  const confirmDelete = React.useCallback(async () => {
    if (!deleting) return;
    try {
      await remove(`/api/projects/comments/${deleting.id}`);
      setDeleting(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not retract that');
    }
  }, [deleting, onChanged]);

  const message = (c: Comment, isReply = false) => {
    const mine = !!me && c.authorId === me;
    const mentioned = c.mentions
      .map(id => directory.find(d => d.memberId === id)?.fullName)
      .filter(Boolean) as string[];

    return (
      <article
        key={c.id}
        className={cn(
          'group grid grid-cols-[auto_1fr] gap-3',
          isReply && 'pl-4 sm:pl-8',
        )}
      >
        <Avatar className={isReply ? 'size-6' : 'size-8'}>
          {c.author?.profiles?.avatarUrl ? <AvatarImage src={c.author.profiles.avatarUrl} alt="" /> : null}
          <AvatarFallback className={cn('bg-muted font-medium text-muted-foreground', isReply ? 'text-[9px]' : 'text-[11px]')}>
            {initialsOf(c.author?.profiles?.fullName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-medium text-foreground">
              {c.author?.profiles?.fullName ?? 'Unknown'}
            </span>
            <time
              dateTime={c.createdAt}
              title={formatDateTime(c.createdAt)}
              className="text-[11.5px] text-muted-foreground"
            >
              {formatRelativeTime(c.createdAt)}
            </time>
            {c.editedAt && <span className="text-[11.5px] text-muted-foreground/70">edited</span>}
            {c.isClientVisible && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground">
                <Eye className="size-3" aria-hidden="true" />
                {project.client?.name ?? 'client'} can see this
              </span>
            )}

            <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {!isReply && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 gap-1.5 px-2 text-[12px] text-muted-foreground"
                  onClick={() => { setEditing(null); setReplyTo(c); }}
                >
                  <Reply className="size-3.5" /> Reply
                </Button>
              )}
              {mine && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Message actions">
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setReplyTo(null); setEditing(c); }}>
                      <Pencil className="mr-2 size-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 className="mr-2 size-4" /> Retract
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          </div>

          {editing?.id === c.id ? (
            <Composer
              className="mt-2"
              directory={directory}
              initialBody={c.body}
              initialClientVisible={c.isClientVisible}
              submitLabel="Save"
              onCancel={() => setEditing(null)}
              onSubmit={async (body, mentions, clientVisible) => {
                await patch(`/api/projects/comments/${c.id}`, { body, mentions, isClientVisible: clientVisible });
                setEditing(null);
                onChanged();
              }}
            />
          ) : (
            <>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
                {c.body}
              </p>
              {mentioned.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                  <AtSign className="size-3" aria-hidden="true" />
                  {mentioned.join(', ')} {mentioned.length === 1 ? 'was' : 'were'} notified
                </p>
              )}
            </>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <Head
        title="Discussion"
        count={comments.length}
        note="Decisions kept here stay with the project rather than scrolling away in chat"
      />

      {threads.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          <Nothing
            className="px-4"
            title="No discussion yet"
            note="Write down what was decided and why. Mention somebody with @ to notify them, and mark a message client-visible to put it in their portal."
          />
        </div>
      ) : (
        <ol className="flex flex-col gap-5">
          {threads.map(({ root, replies }) => (
            <li
              key={root.id}
              className={cn(
                'rounded-xl border bg-card p-4 shadow-e1',
                root.isClientVisible ? 'border-[var(--chart-3)]/35' : 'border-border',
              )}
            >
              {message(root)}

              {replies.length > 0 && (
                <div className="mt-4 flex flex-col gap-4 border-l border-border pl-3 sm:pl-4">
                  {replies.map(r => message(r, true))}
                </div>
              )}

              {replyTo?.id === root.id && (
                <Composer
                  className="mt-4 border-t border-border/70 pt-4"
                  directory={directory}
                  placeholder={`Reply to ${root.author?.profiles?.fullName ?? 'this message'}`}
                  submitLabel="Reply"
                  autoFocus
                  onCancel={() => setReplyTo(null)}
                  onSubmit={async (body, mentions, clientVisible) => {
                    await post('/api/projects/comments', {
                      projectId, body, mentions, parentId: root.id, isClientVisible: clientVisible,
                    });
                    setReplyTo(null);
                    onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      {/* ── The composer ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
        <Composer
          directory={directory}
          placeholder="Add to the discussion. Type @ to notify somebody."
          submitLabel="Post"
          onSubmit={async (body, mentions, clientVisible) => {
            await post('/api/projects/comments', {
              projectId, body, mentions, isClientVisible: clientVisible,
            });
            onChanged();
          }}
        />
      </div>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Retract this message"
        description="It disappears from the thread, and from the client portal if it was shared. Replies underneath it are kept."
        confirmLabel="Retract"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The composer                                                              */
/* -------------------------------------------------------------------------- */

/**
 * ── Mentions are typed, and stored as ids ────────────────────────────────
 *
 * Typing `@` opens a list filtered by what follows it; choosing somebody
 * writes their name into the text *and* records their membership id.
 *
 * The id is what matters: `comments.mentions` is a `uuid[]` and the
 * notification trigger reads that column rather than re-parsing the body, so
 * an author who later edits the message cannot change who was told. Names in
 * the text are for the reader; the array is the record.
 *
 * A name that is deleted from the text has its id dropped on submit, so
 * writing "@Ada" and deleting it does not silently notify Ada.
 */
function Composer({
  directory, onSubmit, onCancel, placeholder, submitLabel = 'Post',
  initialBody = '', initialClientVisible = false, autoFocus = false, className,
}: {
  directory: Member[];
  onSubmit: (body: string, mentions: string[], clientVisible: boolean) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  submitLabel?: string;
  initialBody?: string;
  initialClientVisible?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [body, setBody] = React.useState(initialBody);
  const [clientVisible, setClientVisible] = React.useState(initialClientVisible);
  const [sending, setSending] = React.useState(false);
  const [picked, setPicked] = React.useState<Map<string, string>>(new Map());
  const [query, setQuery] = React.useState<string | null>(null);
  const [highlight, setHighlight] = React.useState(0);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const matches = React.useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return directory
      .filter(d => d.fullName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, directory]);

  /** The `@word` immediately before the caret, if the caret is inside one. */
  const readQuery = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const upto = el.value.slice(0, el.selectionStart ?? 0);
    const m = /(?:^|\s)@([\w'-]*)$/.exec(upto);
    setQuery(m ? m[1] : null);
    setHighlight(0);
  }, []);

  const choose = React.useCallback((member: Member) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? body.length;
    const upto = body.slice(0, caret);
    const m = /(?:^|\s)@([\w'-]*)$/.exec(upto);
    if (!m) return;

    const start = caret - m[1].length - 1;
    const next = `${body.slice(0, start)}@${member.fullName} ${body.slice(caret)}`;
    setBody(next);
    setPicked(prev => new Map(prev).set(member.memberId, member.fullName));
    setQuery(null);

    // The caret belongs after the name that was just inserted.
    requestAnimationFrame(() => {
      const pos = start + member.fullName.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, [body]);

  const submit = React.useCallback(async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      // Only the people still named in the text are notified.
      const mentions = [...picked.entries()]
        .filter(([, name]) => text.includes(`@${name}`))
        .map(([id]) => id);
      await onSubmit(text, mentions, clientVisible);
      setBody('');
      setPicked(new Map());
      setClientVisible(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post that');
    } finally {
      setSending(false);
    }
  }, [body, picked, clientVisible, onSubmit]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative">
        <Textarea
          ref={ref}
          rows={3}
          autoFocus={autoFocus}
          value={body}
          placeholder={placeholder}
          onChange={e => { setBody(e.target.value); }}
          onKeyUp={readQuery}
          onClick={readQuery}
          onKeyDown={e => {
            if (query !== null && matches.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % matches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + matches.length) % matches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[highlight]); return; }
              if (e.key === 'Escape') { setQuery(null); return; }
            }
            /**
             * Ctrl/Cmd + Enter posts.
             *
             * Not bare Enter: this is a place people write paragraphs, and a
             * box that submits on Enter turns every line break into a
             * half-finished message. The same combination My Work uses.
             */
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          }}
          className="min-h-[5rem] text-[13px]"
        />

        {query !== null && matches.length > 0 && (
          <ul
            role="listbox"
            aria-label="People to mention"
            className="absolute bottom-full z-20 mb-1 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-e2"
          >
            {matches.map((m, i) => (
              <li key={m.memberId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={e => { e.preventDefault(); choose(m); }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                    i === highlight ? 'bg-accent text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Avatar className="size-5">
                    {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="bg-muted text-[9px]">{initialsOf(m.fullName)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{m.fullName}</span>
                  {m.jobTitle && (
                    <span className="ml-auto shrink-0 truncate text-[11.5px] text-muted-foreground/70">
                      {m.jobTitle}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
          Internal by default, and the label says what it means in plain words
          rather than "visibility". Somebody skim-reading must not be able to
          mistake this for a formatting option.
        */}
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox checked={clientVisible} onCheckedChange={v => setClientVisible(v === true)} />
          Show this to the client
        </label>

        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>Cancel</Button>
          )}
          <Button size="sm" className="h-8 gap-1.5" disabled={sending || !body.trim()} onClick={submit}>
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
