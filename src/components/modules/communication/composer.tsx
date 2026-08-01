'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { toast } from 'sonner';
import {
  Send, Paperclip, X, Loader2, MessageSquare, Link2, AtSign, Smile, FileText,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { createClient } from '@/lib/supabase/client';
import { formatFileSize, initialsOf, truncate } from '@/lib/format';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

import {
  type ChannelMember, type Message, type RecordReference,
  QUICK_REACTIONS, REFERENCE_TARGETS, avatarColor, channelLabel,
  safeName, type ChannelRow,
} from './types';
import { plainPreview } from './rich-text';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The composer.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What it was ──────────────────────────────────────────────────────────
 *
 *  A single-line `<Input>`. One line means a message longer than a sentence
 *  scrolls sideways while you write it, and Shift+Enter — the gesture everyone
 *  uses for a second line — did nothing at all, because a text input has no
 *  second line to go to. Mentions had to be typed exactly: `@` then the
 *  colleague's full name, spelled correctly, or the notification silently did
 *  not happen. Nothing could be attached, though the endpoint had accepted
 *  attachments since the first migration.
 *
 *  ── The three things this adds, and why each is here ─────────────────────
 *
 *  · A growing textarea. It starts one line tall and grows to about six, then
 *    scrolls. Growing rather than fixed because a composer that is always six
 *    lines tall steals a third of a conversation to hold nothing.
 *
 *  · Mention completion. Typing `@` opens the room; arrow keys and Enter pick.
 *    The resolved names are what the module sends as `mentions`, so what was
 *    highlighted is exactly who was notified — the completion is not a
 *    convenience laid over a text match, it is the same list.
 *
 *  · Attachments and record links, which are different things and stay
 *    different. A file has bytes and goes to storage; a task is already
 *    somewhere and only needs referencing. Conflating them is what left
 *    `messages.attachments` empty for the product's whole life.
 */

export interface PendingFile {
  key: string;
  file: File;
  progress: number;
  bucket: string;
  path: string;
  /** A local object URL, so an image previews before it has finished uploading. */
  preview: string | null;
}

export interface ComposerProps {
  channel: ChannelRow;
  members: ChannelMember[];
  currentMemberId: string | null;
  organizationId: string | null;
  maxAttachmentMb: number;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (payload: {
    body: string;
    mentions: string[];
    files: { bucket: string; path: string; filename: string; mimeType: string | null; sizeBytes: number }[];
    attachments: RecordReference[];
  }) => Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
}

const MAX_ROWS = 6;

export function Composer({
  channel, members, currentMemberId, organizationId, maxAttachmentMb,
  replyTo, onCancelReply, onSend, onTyping, disabled,
}: ComposerProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [references, setReferences] = useState<RecordReference[]>([]);
  const [dragging, setDragging] = useState(false);

  /** The `@…` fragment under the caret, if the caret is in one. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ─── Height ──────────────────────────────────────────────────────────────

  /**
   * Grow to fit, up to a limit.
   *
   * Measured from `scrollHeight` after resetting to `auto`: without the reset
   * the box can only ever grow, because `scrollHeight` of an element already
   * tall enough is its own height and deleting a line would leave the gap.
   */
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = 24;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 16)}px`;
  }, [draft]);

  // ─── Mentions ────────────────────────────────────────────────────────────

  const candidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members
      .filter(m => m.memberId !== currentMemberId)
      .filter(m => !q || m.fullName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, members, currentMemberId]);

  /**
   * Find the mention being typed.
   *
   * Looks backwards from the caret for an `@` that is not preceded by a word
   * character — so an email address does not open the picker — and gives up at
   * a newline or after enough characters that this is clearly prose rather
   * than a name. Two words are allowed after the `@` because most people are
   * called two words.
   */
  const detectMention = useCallback((value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at < 0) { setMentionQuery(null); return; }
    if (at > 0 && /[\w@]/.test(upto[at - 1])) { setMentionQuery(null); return; }
    const fragment = upto.slice(at + 1);
    if (fragment.includes('\n') || fragment.length > 40) { setMentionQuery(null); return; }
    if (fragment.split(/\s+/).length > 2) { setMentionQuery(null); return; }
    setMentionQuery(fragment);
    setMentionIndex(0);
  }, []);

  const applyMention = useCallback((member: ChannelMember) => {
    const el = textRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? draft.length;
    const upto = draft.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at < 0) return;
    const next = `${draft.slice(0, at)}@${member.fullName} ${draft.slice(caret)}`;
    setDraft(next);
    setMentionQuery(null);
    // The caret goes after the name that was just inserted, not to the end of
    // the message — somebody mentioning a colleague mid-sentence is still in
    // the middle of that sentence.
    requestAnimationFrame(() => {
      const pos = at + member.fullName.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, [draft]);

  /**
   * Resolve `@Name` to the membership ids the notification trigger expects.
   *
   * Matched longest-first so "@Ada Lovelace" wins over "@Ada" when both are in
   * the channel; otherwise the shorter match consumes the prefix and the wrong
   * person is notified. Restricted to this channel's members, because
   * mentioning somebody who cannot see the channel would notify them about a
   * message they can never open.
   */
  const resolveMentions = useCallback((text: string): string[] => {
    const haystack = text.toLowerCase();
    const found = new Set<string>();
    for (const m of [...members].sort((a, b) => b.fullName.length - a.fullName.length)) {
      if (!m.fullName) continue;
      if (haystack.includes(`@${m.fullName.toLowerCase()}`)) found.add(m.memberId);
    }
    if (currentMemberId) found.delete(currentMemberId);
    return [...found];
  }, [members, currentMemberId]);

  // ─── Attachments ─────────────────────────────────────────────────────────

  const upload = useCallback(async (list: FileList | File[]) => {
    if (!organizationId) {
      toast.error('Your workspace is still loading — try again in a moment.');
      return;
    }

    for (const file of Array.from(list)) {
      if (file.size > maxAttachmentMb * 1024 * 1024) {
        toast.error(`"${file.name}" is larger than the ${maxAttachmentMb}MB limit.`);
        continue;
      }

      const key = `${file.name}-${file.size}-${Date.now()}`;
      /**
       * The path must begin with the organisation id.
       *
       * That is the whole storage security model — every policy checks the
       * first segment against the caller's memberships — and the message
       * endpoint refuses a path that does not match, so getting this wrong
       * fails loudly rather than storing something unreachable.
       */
      const path = `${organizationId}/communication/${channel.channelId}/${Date.now()}-${safeName(file.name)}`;

      setPending(prev => [...prev, {
        key, file, progress: 10, bucket: 'attachments', path,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }]);

      try {
        const supabase = createClient();
        const { error } = await supabase.storage
          .from('attachments')
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (error) throw new Error(error.message);
        setPending(prev => prev.map(p => p.key === key ? { ...p, progress: 100 } : p));
      } catch (err: any) {
        toast.error(`${file.name}: ${err.message || 'could not be uploaded'}`);
        setPending(prev => prev.filter(p => p.key !== key));
      }
    }
  }, [organizationId, channel.channelId, maxAttachmentMb]);

  /**
   * A half-uploaded attachment that is removed is removed from storage too.
   *
   * Without this, every abandoned draft leaves an object nobody will ever
   * reference — invisible, un-deletable through any screen, and counted
   * against the organisation's storage for ever.
   */
  const dropPending = useCallback(async (key: string) => {
    const target = pending.find(p => p.key === key);
    setPending(prev => prev.filter(p => p.key !== key));
    if (target?.preview) URL.revokeObjectURL(target.preview);
    if (target?.progress === 100) {
      try {
        await createClient().storage.from(target.bucket).remove([target.path]);
      } catch {
        // Best effort. A stranded object is a housekeeping problem; failing
        // the removal in front of the user is a worse one.
      }
    }
  }, [pending]);

  // ─── Sending ─────────────────────────────────────────────────────────────

  const uploading = pending.some(p => p.progress < 100);
  const canSend = !sending && !uploading
    && (!!draft.trim() || pending.length > 0 || references.length > 0);

  const send = useCallback(async () => {
    if (!canSend) return;
    const body = draft.trim();
    const files = pending.map(p => ({
      bucket: p.bucket,
      path: p.path,
      filename: p.file.name,
      mimeType: p.file.type || null,
      sizeBytes: p.file.size,
    }));
    const refs = references;

    setSending(true);
    // Cleared optimistically: a composer that stays full while a request is in
    // flight invites a second send of the same message.
    setDraft('');
    setPending([]);
    setReferences([]);

    try {
      await onSend({ body, mentions: resolveMentions(body), files, attachments: refs });
    } catch {
      // The module has already reported it. Put the work back so nothing
      // anybody typed is lost to a failed request.
      setDraft(body);
      setReferences(refs);
    } finally {
      setSending(false);
      textRef.current?.focus();
    }
  }, [canSend, draft, pending, references, resolveMentions, onSend]);

  // ─── Render ──────────────────────────────────────────────────────────────

  const mentionOpen = mentionQuery !== null && candidates.length > 0;

  return (
    <div
      className={cn(
        'border-t bg-card/40 px-4 py-3 transition-colors',
        dragging && 'bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/40',
      )}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
      }}
    >
      {/* What this draft is answering. Without it, "Reply in thread" and a
          normal send look identical from the composer, and the message lands
          somewhere the sender did not expect. */}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-emerald-500 bg-muted/50 px-2.5 py-1.5">
          <MessageSquare className="size-3.5 shrink-0 text-emerald-600" />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            Replying to{' '}
            <span className="font-medium text-foreground">
              {replyTo.sender?.profiles?.fullName || 'Unknown member'}
            </span>
            {' — '}{truncate(plainPreview(replyTo.body), 60)}
          </p>
          <Button variant="ghost" size="icon" className="size-5 shrink-0"
            onClick={onCancelReply} aria-label="Cancel reply">
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Staged attachments and links, above the box rather than inside it, so
          the text does not reflow as things are added. */}
      {(pending.length > 0 || references.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map(p => (
            <div key={p.key}
              className="group relative flex items-center gap-2 rounded-lg border bg-background p-1.5 pr-7">
              {p.preview ? (
                <img src={p.preview} alt="" className="size-9 rounded object-cover" />
              ) : (
                <div className="flex size-9 items-center justify-center rounded bg-muted">
                  <FileText className="size-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <p className="max-w-[10rem] truncate text-xs font-medium">{p.file.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {p.progress < 100 ? 'Uploading…' : formatFileSize(p.file.size)}
                </p>
              </div>
              {p.progress < 100 && (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
              <button
                onClick={() => void dropPending(p.key)}
                className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${p.file.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}

          {references.map(r => (
            <Badge key={`${r.kind}-${r.id}`} variant="outline" className="gap-1.5 py-1 pl-2 pr-1">
              <Link2 className="size-3 text-violet-500" />
              <span className="max-w-[12rem] truncate">{r.label}</span>
              <button
                onClick={() => setReferences(prev =>
                  prev.filter(x => !(x.kind === r.kind && x.id === r.id)))}
                className="rounded p-0.5 hover:bg-muted"
                aria-label={`Remove link to ${r.label}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {/* The mention picker is anchored above the box rather than below it:
            the composer sits at the bottom of the viewport, so a list opening
            downwards would open off-screen. */}
        {mentionOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-lg border bg-popover shadow-lg">
            <p className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Notify someone in this conversation
            </p>
            {candidates.map((m, i) => (
              <button
                key={m.memberId}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => applyMention(m)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left',
                  i === mentionIndex ? 'bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <Avatar className="size-6">
                  <AvatarFallback className={cn('text-[10px] text-white', avatarColor(m.memberId))}>
                    {initialsOf(m.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.fullName}</span>
                  {m.jobTitle && (
                    <span className="block truncate text-[11px] text-muted-foreground">{m.jobTitle}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5 pb-1">
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8"
                  onClick={() => fileRef.current?.click()} disabled={disabled}>
                  <Paperclip className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach a file — or drop one here</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <RecordLinkButton
            onPick={(ref) => setReferences(prev =>
              prev.some(r => r.kind === ref.kind && r.id === ref.id) ? prev : [...prev, ref])}
            disabled={disabled}
          />

          <EmojiButton
            onPick={(emoji) => {
              setDraft(d => d + emoji);
              textRef.current?.focus();
            }}
            disabled={disabled}
          />
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }}
        />

        <textarea
          ref={textRef}
          rows={1}
          value={draft}
          disabled={disabled || sending}
          placeholder={
            replyTo
              ? 'Reply in thread…'
              : `Message ${channelLabel(channel)}   ·   @ to notify, ** for bold`
          }
          onChange={(e) => {
            setDraft(e.target.value);
            detectMention(e.target.value, e.target.selectionStart ?? 0);
            onTyping();
          }}
          onClick={(e) => detectMention(draft, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          /**
           * Pasting a screenshot posts it.
           *
           * A clipboard image has no filename, so one is invented from the
           * moment — otherwise every screenshot in the organisation is called
           * "image.png" and the file list becomes unusable within a week.
           */
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (!files.length) return;
            e.preventDefault();
            void upload(files.map(f => f.name && f.name !== 'image.png'
              ? f
              : new File([f], `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`,
                  { type: f.type })));
          }}
          onKeyDown={(e) => {
            if (mentionOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault(); setMentionIndex(i => (i + 1) % candidates.length); return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex(i => (i - 1 + candidates.length) % candidates.length); return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault(); applyMention(candidates[mentionIndex]); return;
              }
              if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
            }
            // Enter sends, Shift+Enter is a new line. The other way round is a
            // defensible choice and the wrong one for a chat: the common act
            // should be the shorter gesture.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); return; }
            // Escape drops out of a reply rather than leaving the draft
            // silently bound to a thread.
            if (e.key === 'Escape' && replyTo) onCancelReply();
          }}
          className={cn(
            'min-h-9 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-emerald-500/40',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />

        <Button
          size="icon"
          className="mb-0.5 size-9 shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => void send()}
          disabled={!canSend || disabled}
          aria-label="Send message"
        >
          {sending || uploading
            ? <Loader2 className="size-4 animate-spin" />
            : <Send className="size-4" />}
        </Button>
      </div>

      {/* One quiet line of help rather than a formatting toolbar. A toolbar in
          a chat composer is six buttons nobody presses twice; the shortcuts
          are the thing worth knowing. */}
      <p className="mt-1.5 hidden px-1 text-[11px] text-muted-foreground sm:block">
        <kbd className="rounded border px-1">Enter</kbd> to send ·{' '}
        <kbd className="rounded border px-1">Shift</kbd>+<kbd className="rounded border px-1">Enter</kbd> for a new line ·{' '}
        <AtSign className="inline size-3" /> to notify · **bold** · `code`
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Linking a record into the conversation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── Why this reuses `/api/search` ────────────────────────────────────────
 *
 * Because it already exists, is permission-filtered per module, and searches
 * exactly the seven things somebody would want to link. Writing a second
 * search here would be a second set of rules about which records an employee
 * may see — and the first one is already the version that gets maintained.
 */
function RecordLinkButton({
  onPick, disabled,
}: {
  onPick: (ref: RecordReference) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Results tagged with the query that produced them — see `SearchDialog`. */
  const [answered, setAnswered] = useState<{ q: string; rows: any[] }>({ q: '', rows: [] });
  const debounced = useDebounce(query, 250);

  const trimmed = debounced.trim();
  const results = answered.q === trimmed ? answered.rows : [];
  const loading = trimmed.length >= 2 && answered.q !== trimmed;

  useEffect(() => {
    if (!open || trimmed.length < 2) return;
    let cancelled = false;
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=5`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        // Only the kinds a message can carry a reference to. A product or a
        // contact comes back from that endpoint and has nowhere to be opened
        // from a chat bubble, so offering it would be offering a dead link.
        setAnswered({
          q: trimmed,
          rows: (j?.data?.results ?? []).filter((r: any) => r.type in REFERENCE_TARGETS),
        });
      })
      .catch(() => { if (!cancelled) setAnswered({ q: trimmed, rows: [] }); });
    return () => { cancelled = true; };
  }, [trimmed, open]);

  return (
    // Clearing the query is enough to clear the results: they are derived from
    // it, so there is nothing else to reset.
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" disabled={disabled}>
                <Link2 className="size-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Link a task, project, document or client</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, tasks, documents…"
            className="h-8 text-sm"
          />
        </div>
        <ScrollArea className="max-h-64">
          {loading && (
            <p className="p-4 text-center text-xs text-muted-foreground">Searching…</p>
          )}
          {!loading && query.trim().length < 2 && (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Type at least two letters. Whatever you link stays clickable in the conversation.
            </p>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">Nothing matches that.</p>
          )}
          {results.map((r: any) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => {
                onPick({ kind: r.type, id: r.id, label: r.title });
                setOpen(false);
                setQuery('');
              }}
              className="flex w-full items-start gap-2.5 border-b px-3 py-2 text-left last:border-0 hover:bg-accent/50"
            >
              <Link2 className="mt-0.5 size-3.5 shrink-0 text-violet-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {REFERENCE_TARGETS[r.type as RecordReference['kind']]?.label}
                  {r.subtitle ? ` · ${r.subtitle}` : ''}
                </span>
              </span>
            </button>
          ))}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A small emoji tray.
 *
 * Deliberately the same six the reaction bar offers rather than a full picker:
 * a full picker is a large dependency and a long scroll for something people
 * use to add a thumbs-up. Anything else is typed, as it is everywhere else.
 */
function EmojiButton({
  onPick, disabled,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 hidden sm:inline-flex" disabled={disabled}>
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex w-auto gap-1 p-1.5">
        {QUICK_REACTIONS.map(emoji => (
          <button
            key={emoji}
            onClick={() => { onPick(emoji); setOpen(false); }}
            className="rounded px-1.5 py-1 text-lg transition-colors hover:bg-accent"
          >
            {emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
