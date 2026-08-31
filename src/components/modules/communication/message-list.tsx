'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Pin, PinOff, MoreHorizontal, SmilePlus, MessageSquare, Trash2, Pencil,
  Eye, Link2, FileText, Download, Loader2, CornerDownRight, Check, Bookmark,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PersonAvatar } from '@/components/shared/person-avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatFileSize, formatRelativeTime } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

import {
  type ChannelMember, type ChannelRow, type Message, type MessageFile,
  type RecordReference, type Receipt, type ThreadSummary,
  QUICK_REACTIONS, REFERENCE_TARGETS, api, clockTime, isImage,
} from './types';
import { RichText } from './rich-text';
import { TurnIntoMenu } from './actions';

// ===========================================================================
//  One message
// ===========================================================================

export interface MessageBubbleProps {
  message: Message;
  /** The conversation it is in, which is what decides where it can be sent. */
  channel: ChannelRow;
  isOwn: boolean;
  /** Same author, within a few minutes: render without a repeated header. */
  isConsecutive: boolean;
  currentMemberId: string | null;
  canModerate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  members: ChannelMember[];
  /** Highlighted because a search or a jump brought the reader here. */
  highlighted?: boolean;
  /**
   * What is under this message, known before it is opened.
   *
   * From `channel_threads()`, fetched once per conversation. Before 0036 the
   * count could not be known without fetching the replies, so a message with
   * eleven answers was drawn identically to one nobody had responded to.
   */
  thread?: ThreadSummary;
  /** Whether this message is on the reader's own shelf. */
  isSaved: boolean;
  onToggleSave: () => void;
  /** Turning a sentence into work. See `actions.tsx`. */
  onTurnInto: (destination: 'todo' | 'reminder' | 'crm' | 'task') => void;
  onScheduleMeeting: () => void;
  onTogglePin: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onReply: () => void;
  onEdit: (body: string) => Promise<void>;
  onToggleThread: () => void;
  threadOpen: boolean;
  replies: Message[] | undefined;
}

export function MessageBubble({
  message, channel, isOwn, isConsecutive, currentMemberId, canModerate, canEdit, canDelete,
  members, highlighted, thread, isSaved, onToggleSave, onTurnInto, onScheduleMeeting,
  onTogglePin, onReact, onDelete, onReply, onEdit,
  onToggleThread, threadOpen, replies,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);
  const [savingEdit, setSavingEdit] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);

  const commitEdit = async () => {
    const next = editDraft.trim();
    // An unchanged body must not stamp `edited_at` and label the message as
    // edited when nothing was.
    if (!next || next === message.body) { setEditing(false); return; }
    setSavingEdit(true);
    try {
      await onEdit(next);
      setEditing(false);
    } catch {
      // The module reported it; the draft stays so nothing is lost.
    } finally {
      setSavingEdit(false);
    }
  };

  // Falls back rather than rendering 'undefined': a profile can legitimately
  // have no name yet, and a chat line is still readable without one.
  const senderName = message.sender?.profiles?.fullName || 'Unknown member';

  const mentionNames = useMemo(
    () => members.map(m => ({ memberId: m.memberId, fullName: m.fullName })),
    [members],
  );

  // Reactions arrive as one row per person per emoji; the bubble shows one
  // chip per emoji with a count, and highlights the ones you added.
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean; who: string[] }>();
    for (const r of message.reactions ?? []) {
      const entry = map.get(r.emoji) ?? { count: 0, mine: false, who: [] };
      entry.count += 1;
      if (r.memberId === currentMemberId) entry.mine = true;
      const name = members.find(m => m.memberId === r.memberId)?.fullName;
      if (name) entry.who.push(name);
      map.set(r.emoji, entry);
    }
    return [...map.entries()];
  }, [message.reactions, currentMemberId, members]);

  /**
   * Whether this message names the reader.
   *
   * Read from `messages.mentions` - the column the notification trigger fires
   * on - rather than by looking for the reader's name in the text. The two can
   * disagree: somebody can type a name the composer did not resolve, and a
   * message edited afterwards keeps the mentions it was sent with. The column
   * is what actually notified somebody, so it is what the highlight should
   * follow.
   */
  const namesMe = !!currentMemberId && (message.mentions ?? []).includes(currentMemberId);

  const references = (message.attachments ?? []) as RecordReference[];

  return (
    <div
      id={`message-${message.id}`}
      /**
       * Three states, and only one of them may carry colour at a time.
       *
       * Being named is the brand; being pinned is the warning ramp, which is
       * the colour a pin already wears everywhere else in the product. The
       * washes are a twentieth of full strength, because a timeline in a busy
       * channel can have a dozen of these in view at once and a column of
       * tinted blocks has no hierarchy left in it.
       */
      className={cn(
        'group relative flex gap-2.5 rounded-md px-3 py-1 transition-colors',
        'hover:bg-muted/50',
        message.isPinned && 'border-l-2 border-warning/70 bg-warning/[0.05]',
        namesMe && !message.isPinned && 'border-l-2 border-brand bg-brand/[0.05]',
        highlighted && 'bg-brand/15 ring-1 ring-inset ring-brand/30',
      )}
    >
      {!isConsecutive ? (
        <PersonAvatar
          id={message.senderId}
          name={senderName}
          src={message.sender?.profiles?.avatarUrl}
          size="md"
          decorative
          className="mt-0.5"
        />
      ) : (
        /* The time appears in the gutter on hover, so a run of consecutive
           messages stays clean and is still individually timestamped. */
        <div className="w-9 shrink-0 pt-1 text-right">
          <span className="hidden text-[10px] leading-5 text-muted-foreground group-hover:inline">
            {clockTime(message.createdAt)}
          </span>
        </div>
      )}

      <div className="min-w-0 flex-1 pb-0.5">
        {!isConsecutive && (
          <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold">{senderName}</span>
            <span className="text-[11px] text-muted-foreground">
              {clockTime(message.createdAt)}
            </span>
            {message.editedAt && (
              <span className="text-[10px] text-muted-foreground">(edited)</span>
            )}
            {message.isPinned && (
              <Badge variant="outline" className="h-4 gap-1 px-1 text-[9px]">
                <Pin className="size-2.5" /> Pinned
              </Badge>
            )}
          </div>
        )}

        {editing ? (
          <div className="flex flex-col gap-1.5 py-1">
            <textarea
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void commitEdit(); }
                // Escape abandons the edit and restores what was there, which is
                // what every editor in the product does.
                if (e.key === 'Escape') { setEditDraft(message.body); setEditing(false); }
              }}
              disabled={savingEdit}
              autoFocus
              rows={Math.min(6, editDraft.split('\n').length + 1)}
              className="resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <p className="text-[10px] text-muted-foreground">
              Enter to save · Shift+Enter for a new line · Escape to cancel
            </p>
          </div>
        ) : message.body ? (
          /*
            A reading measure, not the width of the window.

            A timeline that fills a 1440px screen puts 190 characters on a
            line, which is roughly two and a half times what anybody reads
            comfortably - and a conversation is read for hours. Capped at 75
            characters and left aligned, so the eye returns to the same place.
          */
          <RichText
            body={message.body}
            mentions={mentionNames}
            currentMemberId={currentMemberId}
            className="max-w-[75ch] text-[13.5px] leading-relaxed text-foreground/90"
          />
        ) : null}

        {/* ── Files ── */}
        {!!message.files?.length && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {message.files.map(file => (
              <Attachment key={file.id} file={file} />
            ))}
          </div>
        )}

        {/* ── Linked records ── */}
        {references.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {references.map(ref => <ReferenceChip key={`${ref.kind}-${ref.id}`} reference={ref} />)}
          </div>
        )}

        {/* ── Reactions ── */}
        {grouped.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {grouped.map(([emoji, { count, mine, who }]) => (
              <TooltipProvider key={emoji} delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onReact(emoji)}
                      className={cn(
                        'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors',
                        mine
                          ? 'border-brand bg-brand/10'
                          : 'border-transparent bg-muted hover:border-border',
                      )}
                    >
                      <span>{emoji}</span>
                      <span className="text-[10px] text-muted-foreground">{count}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{who.join(', ') || 'Someone'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        )}

        {/* -- Thread --
            The count comes from `channel_threads()` and arrives with the
            timeline, so a discussion announces itself instead of hiding until
            somebody happens to click. A "0 replies" affordance on every
            message would still be noise, so nothing is drawn until there is
            something under the message or the reader has opened it. */}
        {(threadOpen || (thread?.replyCount ?? 0) > 0 || (replies?.length ?? 0) > 0) && (
          <div className="mt-1.5">
            <button
              onClick={onToggleThread}
              className={cn(
                'group/thread flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-xs',
                'text-muted-foreground transition-colors hover:text-foreground',
              )}
            >
              <CornerDownRight className="size-3 shrink-0" />
              <span className="font-medium text-foreground">
                {threadCountLabel(thread, replies)}
              </span>
              {/*
                Who is in it, and whether you are.

                "Ada and two others" is the sentence people use out loud, and
                `iReplied` is what "following a discussion" means here: having
                said something in it. There is no separate follow list, on
                purpose - one would need upkeep and would fall out of step with
                the conversation it claims to describe.
              */}
              {!!thread?.participants?.length && (
                <span className="hidden truncate sm:inline">
                  {participantWords(thread.participants)}
                </span>
              )}
              {thread?.iReplied && (
                <span className="hidden shrink-0 rounded border px-1 text-[10px] font-medium sm:inline">
                  You replied
                </span>
              )}
              {thread?.lastReplyAt && !threadOpen && (
                <span className="hidden shrink-0 text-muted-foreground/80 md:inline">
                  {formatRelativeTime(thread.lastReplyAt)}
                </span>
              )}
              <span className="shrink-0 opacity-0 transition-opacity group-hover/thread:opacity-100">
                {threadOpen ? 'Hide' : 'Open'}
              </span>
            </button>

            {threadOpen && replies === undefined && (
              <p className="mt-1.5 flex items-center gap-1.5 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading the thread
              </p>
            )}

            {threadOpen && !!replies?.length && (
              <div className="mt-1.5 flex flex-col gap-2 border-l-2 border-border pl-3">
                {replies.map(r => (
                  <div key={r.id} className="flex gap-2">
                    <PersonAvatar
                      id={r.senderId}
                      name={r.sender?.profiles?.fullName}
                      src={r.sender?.profiles?.avatarUrl}
                      size="xs"
                      decorative
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold">
                          {r.sender?.profiles?.fullName || 'Unknown member'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(r.createdAt)}
                        </span>
                      </div>
                      <RichText
                        body={r.body}
                        mentions={mentionNames}
                        currentMemberId={currentMemberId}
                        className="text-foreground/90"
                      />
                      {!!r.files?.length && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {r.files.map(f => <Attachment key={f.id} file={f} compact />)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/*
              Continuing the thread from inside it.

              Without this, replying to a thread meant scrolling back to the
              root message and finding the reply control on it, which is the
              gesture that makes people give up and answer in the channel
              instead. The composer is the same one at the bottom of the
              screen; this points it at this message.
            */}
            {threadOpen && (
              <button
                onClick={onReply}
                className="mt-1.5 ml-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Reply in this thread
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Hover actions ──
          Rendered always and revealed on hover or focus rather than mounted on
          hover: mounting on `onMouseEnter` means the bar cannot be reached by
          keyboard at all, and it flickers when the pointer crosses the gap
          between the message and the bar itself. */}
      <div className={cn(
        'absolute -top-3 right-3 flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-sm',
        'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
      )}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6" aria-label="Add a reaction">
              <SmilePlus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="flex w-auto gap-0.5 p-1">
            {QUICK_REACTIONS.map(emoji => (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                className="rounded px-1.5 py-1 text-base transition-colors hover:bg-accent"
              >
                {emoji}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" onClick={onReply}
                aria-label="Reply in thread">
                <MessageSquare className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reply in thread</TooltipContent>
          </Tooltip>

          {/*
            The shelf.

            Beside the pin rather than buried in the menu, because these are
            the two "keep this" gestures and the difference between them is
            worth teaching by proximity: a pin is for the room, a bookmark is
            for you. Quiet on purpose - it is the most-used control in the bar
            and the least important-looking, which is the right way round for
            something a person does thirty times a week.
          */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" onClick={onToggleSave}
                aria-pressed={isSaved} aria-label={isSaved ? 'Remove from saved' : 'Save this message'}>
                <Bookmark className={cn('size-3.5', isSaved && 'fill-current text-brand')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isSaved ? 'Saved. Only you can see it.' : 'Save for later'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" onClick={onTogglePin}
                aria-label={message.isPinned ? 'Unpin' : 'Pin'}>
                {message.isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{message.isPinned ? 'Unpin' : 'Pin to this conversation'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6" aria-label="More">
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/*
              Communication to action.

              First in the menu because it is the thing this module can do that
              a standalone chat product cannot: a sentence that is work becomes
              work, in the place work lives, without anybody retyping it. The
              submenu offers a client note only in a conversation that has a
              client, and a project task only in one that has a project.
            */}
            <TurnIntoMenu
              channel={channel}
              onPick={onTurnInto}
              onScheduleMeeting={onScheduleMeeting}
            />
            <DropdownMenuItem onClick={onToggleSave}>
              <Bookmark className={cn('mr-2 size-4', isSaved && 'fill-current')} />
              {isSaved ? 'Remove from saved' : 'Save for later'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/*
              Who has seen it: asked for, never announced.

              The brief is explicit that a message must not wear "Seen by Ada,
              Grace" the moment somebody opens the channel. So it is an item in
              the author's own menu: nothing under any message until it is
              asked for, and when it is, names and times rather than a count.
              Offered only on your own messages, because "who has read this" is
              a question about something you said.
            */}
            {isOwn && (
              <DropdownMenuItem onClick={() => setReceiptsOpen(true)}>
                <Eye className="mr-2 size-4" /> Who has seen this
              </DropdownMenuItem>
            )}
            {isOwn && canEdit && (
              <DropdownMenuItem onClick={() => { setEditDraft(message.body); setEditing(true); }}>
                <Pencil className="mr-2 size-4" /> Edit message
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => {
              void navigator.clipboard?.writeText(message.body);
              toast.success('Message copied');
            }}>
              <Check className="mr-2 size-4" /> Copy text
            </DropdownMenuItem>
            {/*
              Only the author edits. Moderation can remove a message but not
              rewrite it - putting words in somebody's mouth is a different
              power from taking them away, and the RLS policy allows an UPDATE
              only to rows whose sender is the caller, so this is the UI
              agreeing with the boundary rather than inventing one.
            */}
            {((isOwn && canDelete) || canModerate) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive"
                  onClick={onDelete}>
                  <Trash2 className="mr-2 size-4" />
                  {isOwn ? 'Delete message' : 'Remove message'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/*
        Mounted only once it has been asked for.

        A timeline holds forty of these bubbles, and a dialog per bubble is
        forty components carrying their own state and effects for a panel
        almost nobody opens. Radix renders nothing while closed, so the cost is
        small - but it is a cost paid on every message in every channel, for
        the life of the session.
      */}
      {receiptsOpen && (
        <ReceiptsDialog
          open
          onOpenChange={setReceiptsOpen}
          messageId={message.id}
          sentAt={message.createdAt}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Who has seen a message
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── Why this fetches rather than deriving ────────────────────────────────
 *
 * The module holds the channel roster, so "who has read this" could be worked
 * out in the browser by comparing each member's `lastReadAt` against the
 * message - and that is exactly what the old inline "Read by …" line did.
 * Two problems: the roster in state is whatever was last fetched, so a large
 * channel silently under-reports, and it is a second definition of "has read"
 * that will disagree with the badge the moment either is touched.
 *
 * `message_receipts()` answers from `channel_members.last_read_at`, refuses
 * anybody but the author, and is the same marker the unread count comes from.
 */
function ReceiptsDialog({
  open, onOpenChange, messageId, sentAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  sentAt: string;
}) {
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Fetched on mount, because this component only exists once it has been
   * asked for - the bubble does not render it until then, so there is no
   * "opened" transition to hang the request on.
   */
  useEffect(() => {
    let cancelled = false;
    void api<Receipt[]>(`/api/communication/messages/${messageId}/receipts`)
      .then(r => { if (!cancelled) setRows(r ?? []); })
      .catch(err => { if (!cancelled) setFailure(err.message || 'Could not load that'); });
    return () => { cancelled = true; };
  }, [messageId]);

  const seen = rows?.filter(r => r.hasRead) ?? [];
  const notYet = rows?.filter(r => !r.hasRead) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Who has seen this</DialogTitle>
          <DialogDescription>
            Sent {formatRelativeTime(sentAt)}. Only you can see this.
          </DialogDescription>
        </DialogHeader>

        {failure && <p className="py-6 text-center text-sm text-destructive">{failure}</p>}

        {!failure && rows === null && (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {rows !== null && !failure && (
          <ScrollArea className="max-h-80">
            {seen.length === 0 && notYet.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                There is nobody else in this conversation yet.
              </p>
            )}

            {seen.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Seen by {seen.length}
                </p>
                <div className="mb-4 divide-y rounded-md border">
                  {seen.map(r => (
                    <div key={r.memberId} className="flex items-center gap-2.5 p-2.5">
                      <PersonAvatar id={r.memberId} name={r.fullName} src={r.avatarUrl} size="sm" decorative />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.fullName}</p>
                        {r.jobTitle && (
                          <p className="truncate text-xs text-muted-foreground">{r.jobTitle}</p>
                        )}
                      </div>
                      {/*
                        The time is when they last read the conversation, which
                        for a message they have read is the earliest instant we
                        can honestly claim - not a per-message receipt, and
                        labelled so nobody reads more into it than that.
                      */}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {r.readAt ? formatRelativeTime(r.readAt) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {notYet.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Not yet {notYet.length}
                </p>
                <div className="divide-y rounded-md border">
                  {notYet.map(r => (
                    <div key={r.memberId} className="flex items-center gap-2.5 p-2.5 opacity-70">
                      <PersonAvatar id={r.memberId} name={r.fullName} src={r.avatarUrl} size="sm" decorative />
                      <p className="min-w-0 flex-1 truncate text-sm">{r.fullName}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Attachments
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A file posted in a conversation.
 *
 * ── Why the URL is fetched on demand ─────────────────────────────────────
 *
 * The `attachments` bucket is private, so a path is not readable - it needs a
 * signed URL, and a signed URL has an expiry. Signing every attachment when
 * the timeline loads would mean a request per file on every channel open, and
 * links that have expired by the time somebody scrolls back to them. So the
 * signature is fetched when somebody actually wants the file.
 *
 * The exception is an image, which is fetched as soon as it is on screen -
 * an image preview that needs a click is not a preview.
 */
function Attachment({ file, compact }: { file: MessageFile; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  const resolve = useCallback(async (): Promise<string | null> => {
    if (url) return url;
    setBusy(true);
    try {
      const data = await api<{ url: string | null }>(`/api/communication/files/${file.id}`);
      setUrl(data.url);
      return data.url;
    } catch (err: any) {
      setFailed(true);
      toast.error(err.message || 'Could not open that file');
      return null;
    } finally {
      setBusy(false);
    }
  }, [file.id, url]);

  const download = useCallback(async () => {
    const href = await resolve();
    if (!href) return;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = file.filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [resolve, file.filename]);

  if (isImage(file.mimeType) && !compact) {
    return (
      <>
        <button
          onClick={async () => { await resolve(); setLightbox(true); }}
          className="group/img relative overflow-hidden rounded-lg border bg-muted"
          aria-label={`Open ${file.filename}`}
        >
          {/* Loaded eagerly through a lazily-signed URL: the `<img>` asks for
              the signature the first time it is rendered, which for a message
              in view is immediately and for one far up the scrollback is
              never. */}
          <InlineImage file={file} onNeedUrl={resolve} url={url} failed={failed} />
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-left text-[10px] text-white opacity-0 transition-opacity group-hover/img:opacity-100">
            {file.filename} · {formatFileSize(file.sizeBytes)}
          </span>
        </button>

        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="truncate text-sm">{file.filename}</DialogTitle>
              <DialogDescription>{formatFileSize(file.sizeBytes)}</DialogDescription>
            </DialogHeader>
            {url && (
              <img src={url} alt={file.filename} className="max-h-[70vh] w-full rounded-md object-contain" />
            )}
            <Button variant="outline" className="gap-2" onClick={() => void download()}>
              <Download className="size-4" /> Download
            </Button>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <button
      onClick={() => void download()}
      className="flex items-center gap-2.5 rounded-lg border bg-background p-2 pr-3 text-left transition-colors hover:bg-accent/40"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded bg-muted">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4 text-muted-foreground" />}
      </div>
      <span className="min-w-0">
        <span className="block max-w-[14rem] truncate text-xs font-medium">{file.filename}</span>
        <span className="block text-[10px] text-muted-foreground">
          {formatFileSize(file.sizeBytes)} · click to download
        </span>
      </span>
    </button>
  );
}

/** The `<img>` half of an image attachment, once its URL has been signed. */
function InlineImage({
  file, url, onNeedUrl, failed,
}: {
  file: MessageFile;
  url: string | null;
  onNeedUrl: () => Promise<string | null>;
  failed: boolean;
}) {
  /**
   * The signature is asked for in an effect, not during render.
   *
   * Fetching in the render body is the shorthand that seems to work and is a
   * side effect in a function React is allowed to call, discard and call
   * again - under concurrent rendering that is a signing request per attempt.
   * `onNeedUrl` already memoises its result, so this runs once per file.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (url || failed || asked.current) return;
    asked.current = true;
    void onNeedUrl();
  }, [url, failed, onNeedUrl]);

  if (failed) {
    return (
      <div className="flex h-40 w-56 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        {file.filename} could not be loaded
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-40 w-56 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={file.filename}
      className="max-h-56 max-w-xs object-cover"
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  A link to somewhere else in the business
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── Why this goes through the store ──────────────────────────────────────
 *
 * There is no route per record in this product - modules are swapped by id
 * inside one page - so "open task X" cannot be expressed as a URL and an
 * `<a href>` would be a dead link. `openRecord` switches the module and leaves
 * a focus request the target module consumes once.
 */
function ReferenceChip({ reference }: { reference: RecordReference }) {
  const openRecord = useAppStore(s => s.openRecord);
  const allows = useAppStore(s => s.allows);
  const target = REFERENCE_TARGETS[reference.kind];

  if (!target) return null;

  /**
   * A reference to a module the reader cannot open is shown, and is not
   * clickable.
   *
   * Hiding it would be worse: the conversation would read differently for
   * different people, and somebody would be told "see the invoice I linked"
   * with nothing there. This says what was linked without pretending it can
   * be opened.
   */
  const reachable = allows(target.module, 'view');

  const content = (
    <>
      <Link2 className="size-3 shrink-0 text-muted-foreground" />
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {target.label}
      </span>
      <span className="max-w-[16rem] truncate">{reference.label || 'Untitled'}</span>
    </>
  );

  if (!reachable) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs opacity-60"
        title={`You do not have access to ${target.module}`}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      onClick={() => openRecord(target.module, target.type, reference.id)}
      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs transition-colors hover:border-foreground/30 hover:bg-accent"
    >
      {content}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Day separator
// ═══════════════════════════════════════════════════════════════════════════

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 my-2 flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Where the reader had got to.
 *
 * ── Why this is worth its own element ────────────────────────────────────
 *
 * An unread badge says how many; it does not say *which*. Coming back to a
 * channel with nineteen new messages, the useful question is where to start
 * reading, and scrolling up looking for the last thing you recognise is the
 * friction this removes. Rendered once, from the read marker captured when the
 * channel was opened, not from the live marker, which is about to be cleared
 * by the act of reading.
 *
 * The rule is the brand rather than a red: nothing here is wrong or urgent,
 * and red in this product means live or destructive. A label on one side
 * rather than centred, because a centred pill reads as a section heading and
 * this is a place marker.
 */
export function NewMessagesDivider() {
  return (
    <div className="my-3 flex items-center gap-2" role="separator" aria-label="New messages">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
        New
      </span>
      <div className="h-px flex-1 bg-brand/40" />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/*  Thread wording                                                            */
/* ------------------------------------------------------------------------- */

/**
 * "3 replies", from whichever source knows.
 *
 * The summary is authoritative until the thread is opened, at which point the
 * fetched replies are newer than it - somebody may have answered in between.
 * Taking the larger of the two is what stops the count flickering downwards
 * the moment a thread is expanded.
 */
function threadCountLabel(thread?: ThreadSummary, replies?: Message[]): string {
  const known = Math.max(thread?.replyCount ?? 0, replies?.length ?? 0);
  if (!known) return replies === undefined ? 'Thread' : 'No replies yet';
  return `${known} ${known === 1 ? 'reply' : 'replies'}`;
}

/** "Ada Lovelace", "Ada and Grace", "Ada and 4 others". */
function participantWords(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${firstName(names[0])} and ${firstName(names[1])}`;
  return `${firstName(names[0])} and ${names.length - 1} others`;
}

function firstName(full: string): string {
  return full.split(' ')[0] || full;
}
