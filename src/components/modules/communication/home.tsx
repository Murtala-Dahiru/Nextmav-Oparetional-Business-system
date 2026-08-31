'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Search, Plus, UserPlus, Video, Radio, Bookmark, Star, ArrowRight, Loader2,
  Clock, X, Calendar, ChevronRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PersonAvatar } from '@/components/shared/person-avatar';
import { type PresenceRow } from '@/hooks/use-presence';
import { formatRelativeTime, truncate } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  type ChannelRow, type InboxItem, type MeetingRow, type SavedMessage,
  api, apiWithMeta, channelLabel, clockTime,
} from './types';
import { plainPreview } from './rich-text';
import { ChannelGlyph, InboxGlyph, INBOX_WORDS, LivePip, UnreadPill } from './ui';

/**
 * ===========================================================================
 *  Communication Home
 * ===========================================================================
 *
 *  -- What the first version got wrong -------------------------------------
 *
 *  Five bands in two columns, each in its own bordered card: what needs you,
 *  your conversations, meetings, saved messages, recently shared files. Every
 *  one of them was defensible on its own and the page as a whole said nothing,
 *  because five boxes of equal weight is a page with no subject. It read as a
 *  dashboard about communication rather than as a place to communicate.
 *
 *  -- What it is now -------------------------------------------------------
 *
 *  One question, answered at the top in the page's own voice: **what needs
 *  you**. Underneath it, the two things a person reaches for next - their
 *  conversations and their meetings - side by side and visibly secondary.
 *  Nothing else.
 *
 *  Three changes carry that:
 *
 *  · **The boxes are gone.** A section is a small heading and a ruled list on
 *    the page, not a card. A border around a list says "this is a separate
 *    thing"; five of them said "these are five separate things of equal
 *    importance", which was the opposite of the intent.
 *  · **Attention is the only full-width column**, and the only place a
 *    coloured mark appears. Everything below it is ink and grey.
 *  · **Files and saved messages left.** A file belongs in the conversation it
 *    was posted in, where the details rail now lists it. Saved is one line at
 *    the foot of the page, because it is a shelf you visit, not news.
 *
 *  -- Why it is given two lists and fetches one ----------------------------
 *
 *  The shell holds `channels` and `meetings` live. Refetching them here would
 *  mean two components disagreeing about the unread count on the same row. The
 *  inbox is Home's own.
 */

export function Home({
  channels, meetings, presence, inCall, reloadKey, greeting,
  onOpenChannel, onOpenMessage, onOpenMeeting, onOpenMeetings, onNewChannel,
  onNewDirect, onSchedule, onSearch, onOpenSaved,
}: {
  channels: ChannelRow[];
  meetings: MeetingRow[];
  presence: Record<string, PresenceRow>;
  /** Membership ids currently joined to a live meeting. */
  inCall: string[];
  /** Bumped by the shell when a message arrives, so the inbox catches up. */
  reloadKey: number;
  /** The reader's first name, when the session has one. */
  greeting: string | null;
  onOpenChannel: (id: string) => void;
  onOpenMessage: (channelId: string, messageId: string) => void;
  onOpenMeeting: (meeting: MeetingRow) => void;
  onOpenMeetings: () => void;
  onNewChannel: () => void;
  onNewDirect: () => void;
  onSchedule: () => void;
  onSearch: (seed?: string) => void;
  onOpenSaved: () => void;
}) {
  const [inbox, setInbox] = React.useState<InboxItem[] | null>(null);
  const [savedCount, setSavedCount] = React.useState<number | null>(null);
  const [kind, setKind] = React.useState<'all' | InboxItem['kind']>('all');
  const [query, setQuery] = React.useState('');
  const [showRead, setShowRead] = React.useState(false);

  const load = React.useCallback(async () => {
    /**
     * Two requests, in parallel, neither of which may take the other down.
     * A band that cannot load is an empty band, not a broken module.
     */
    const [inboxRes, savedRes] = await Promise.allSettled([
      apiWithMeta<InboxItem[]>('/api/communication/inbox?limit=40'),
      api<SavedMessage[]>('/api/communication/saved?limit=200'),
    ]);
    setInbox(inboxRes.status === 'fulfilled' ? inboxRes.value.data ?? [] : []);
    setSavedCount(savedRes.status === 'fulfilled' ? (savedRes.value ?? []).length : 0);
  }, []);

  React.useEffect(() => { void load(); }, [load, reloadKey]);

  const outstanding = React.useMemo(
    () => (inbox ?? []).filter(i => i.isUnread), [inbox]);

  /**
   * A meeting somebody has been invited to and has not answered.
   *
   * It belongs in Attention rather than in the meetings column, because it is
   * a question addressed to this person and everything else in that column is
   * information. Derived from the list the shell already holds; no request.
   */
  const invitations = React.useMemo(
    () => meetings.filter(m => m.status === 'scheduled' && m.myState === 'invited'),
    [meetings],
  );

  const shown = React.useMemo(() => {
    const rows = showRead ? (inbox ?? []) : outstanding;
    return rows.filter(i => kind === 'all' || i.kind === kind);
  }, [inbox, outstanding, showRead, kind]);

  const live = meetings.filter(m => m.status === 'live');
  const upcoming = meetings
    .filter(m => m.status === 'scheduled')
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
    .slice(0, 3);
  const recentMeetings = meetings.filter(m => m.status === 'ended').slice(0, 2);

  /**
   * The conversations worth putting in front of somebody.
   *
   * Starred first, because that is what starring is for; then anything with
   * something unread in it; then whatever was spoken in most recently. Rooms
   * nobody has joined are not here: they belong in the sidebar's list, which is
   * where you go to find a channel rather than to catch up.
   */
  const conversations = React.useMemo(() => {
    const rank = (c: ChannelRow) =>
      (c.isFavourite ? 0 : 2) + (c.unreadCount || c.mentionCount ? -1 : 0);
    return channels
      .filter(c => c.isMember)
      .slice()
      .sort((a, b) => rank(a) - rank(b)
        || (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
      .slice(0, 9);
  }, [channels]);

  const nothingWaiting = inbox !== null && outstanding.length === 0 && invitations.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-8 lg:px-10">

        {/* ---------------------------------------------------------------
            One line saying where you are and what is outstanding, then the
            field that is the fastest way out of it. Three verbs, quiet.
           --------------------------------------------------------------- */}
        <header className="pb-7">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
            {greeting ? `Good ${partOfDay()}, ${greeting}` : 'Communication'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {inbox === null ? 'Catching up…'
              : outstanding.length > 0
                ? `${outstanding.length} ${outstanding.length === 1 ? 'thing needs' : 'things need'} you.`
                : 'Nothing is waiting on you.'}
          </p>

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim()) { onSearch(query.trim()); setQuery(''); }
                }}
                placeholder="Search messages, people and channels"
                className="h-10 pl-9"
                aria-label="Search communication"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={onNewDirect}>
                <UserPlus className="size-4" />
                <span className="hidden sm:inline">Message</span>
              </Button>
              <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={onNewChannel}>
                <Plus className="size-4" />
                <span className="hidden sm:inline">Channel</span>
              </Button>
              <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={onSchedule}>
                <Video className="size-4" />
                <span className="hidden sm:inline">Meet</span>
              </Button>
            </div>
          </div>
        </header>

        {/* ---------------------------------------------------------------
            Attention
           --------------------------------------------------------------- */}
        <section className="pb-10">
          <div className="flex items-center justify-between gap-3 border-b pb-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Needs you
            </h3>
            <div className="flex items-center gap-0.5">
              {(['all', 'mention', 'reply', 'direct', 'announcement'] as const).map(id => {
                const n = id === 'all'
                  ? outstanding.length
                  : outstanding.filter(i => i.kind === id).length;
                // A filter for a kind nothing has arrived under is a control
                // that can only ever empty the list.
                if (id !== 'all' && n === 0) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setKind(id)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                      kind === id
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {id === 'all' ? 'All'
                      : id === 'mention' ? 'Mentions'
                      : id === 'reply' ? 'Replies'
                      : id === 'direct' ? 'Direct' : 'Announcements'}
                    {n > 0 && <span className="ml-1 tabular-nums opacity-60">{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* A meeting invitation is a question, so it sits above the messages
              rather than in the meetings column with the answers. */}
          {invitations.map(meeting => (
            <button
              key={meeting.meetingId}
              onClick={onOpenMeetings}
              className="flex w-full items-center gap-3 border-b py-3 text-left transition-colors hover:bg-accent/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Calendar className="size-4 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{meeting.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {meeting.hostName ? `${meeting.hostName} invited you` : 'You are invited'}
                  {meeting.scheduledAt ? ` · ${whenWords(meeting.scheduledAt)}` : ''}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}

          {inbox === null ? (
            <LoadingRows />
          ) : shown.length === 0 && invitations.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {nothingWaiting
                  ? 'You are up to date. Nothing has named you, answered you or written to you.'
                  : 'Nothing here in the last thirty days.'}
              </p>
              {nothingWaiting && (inbox?.length ?? 0) > 0 && !showRead && (
                <button
                  onClick={() => setShowRead(true)}
                  className="mt-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Show what you have already read
                </button>
              )}
            </div>
          ) : (
            <>
              {shown.slice(0, 10).map(item => (
                <button
                  key={`${item.kind}-${item.messageId}`}
                  onClick={() => onOpenMessage(item.channelId, item.messageId)}
                  className="flex w-full items-start gap-3 border-b py-3 text-left transition-colors hover:bg-accent/50"
                >
                  <PersonAvatar
                    id={item.senderId}
                    name={item.senderName}
                    src={item.senderAvatar}
                    size="md"
                    decorative
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn(
                        'truncate text-sm',
                        item.isUnread ? 'font-semibold' : 'font-medium text-muted-foreground',
                      )}>
                        {item.senderName ?? 'Someone'}
                      </span>
                      <InboxGlyph kind={item.kind} className="text-muted-foreground" />
                      {/*
                        A direct conversation is named after the person in it,
                        so "messaged you in Ngozi Balogun" says her name twice
                        and reads as a room called after her.
                      */}
                      <span className="truncate text-xs text-muted-foreground">
                        {INBOX_WORDS[item.kind]}
                        {item.channelType === 'direct' ? '' : ` in ${item.channelLabel}`}
                      </span>
                    </span>
                    <span className={cn(
                      'mt-0.5 block truncate text-sm',
                      item.isUnread ? 'text-foreground/85' : 'text-muted-foreground',
                    )}>
                      {truncate(
                        plainPreview(item.body)
                          || (item.hasFiles ? 'Shared a file' : 'Shared a link'),
                        120,
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 pt-0.5">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                    {item.isUnread && (
                      <span className="size-1.5 rounded-full bg-brand" aria-label="Unread" />
                    )}
                  </span>
                </button>
              ))}

              {/* The read tail, behind one word. An inbox that empties
                  completely is one people stop trusting; an inbox that never
                  empties is one they stop reading. */}
              {!showRead && (inbox?.length ?? 0) > outstanding.length && (
                <button
                  onClick={() => setShowRead(true)}
                  className="w-full py-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Show earlier, including what you have read
                </button>
              )}
            </>
          )}
        </section>

        {/* ---------------------------------------------------------------
            Conversations, and what is on
           --------------------------------------------------------------- */}
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section className="min-w-0">
            <div className="flex items-center justify-between gap-3 border-b pb-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                Conversations
              </h3>
              {conversations.length > 0 && (
                <button
                  onClick={() => onOpenChannel(conversations[0].channelId)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Open all <ArrowRight className="size-3" />
                </button>
              )}
            </div>

            {conversations.length === 0 ? (
              <p className="py-8 text-sm text-muted-foreground">
                No conversations yet. Start a channel, or message a colleague.
              </p>
            ) : conversations.map(channel => {
              const dmId = channel.type === 'direct' ? channel.counterpartId : null;
              const unread = channel.unreadCount > 0 || channel.mentionCount > 0;
              return (
                <button
                  key={channel.channelId}
                  onClick={() => onOpenChannel(channel.channelId)}
                  className="flex w-full items-center gap-3 border-b py-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  {dmId ? (
                    <PersonAvatar
                      id={dmId}
                      name={channel.counterpartName}
                      src={channel.counterpartAvatar}
                      size="sm"
                      presence={presence[dmId]?.presence ?? 'offline'}
                      lastSeenAt={presence[dmId]?.lastSeenAt}
                      inCall={inCall.includes(dmId)}
                      decorative
                    />
                  ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                      <ChannelGlyph type={channel.type} className="size-3.5" />
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {channel.isFavourite && (
                        <Star className="size-3 shrink-0 fill-current text-brand" />
                      )}
                      <span className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
                        {channelLabel(channel)}
                      </span>
                      {channel.liveMeetingId && <LivePip />}
                    </span>
                    {channel.lastMessage !== null && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {channel.lastSender && (
                          <span className="font-medium">{channel.lastSender}: </span>
                        )}
                        {truncate(plainPreview(channel.lastMessage) || 'Shared a file', 64)}
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {channel.lastMessageAt && !unread && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {formatRelativeTime(channel.lastMessageAt)}
                      </span>
                    )}
                    <UnreadPill
                      unread={channel.unreadCount}
                      mentions={channel.mentionCount}
                      muted={channel.isMuted}
                    />
                  </span>
                </button>
              );
            })}
          </section>

          <section className="min-w-0">
            <div className="flex items-center justify-between gap-3 border-b pb-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                Meetings
              </h3>
              <button
                onClick={onOpenMeetings}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                All meetings <ArrowRight className="size-3" />
              </button>
            </div>

            {live.length === 0 && upcoming.length === 0 && recentMeetings.length === 0 ? (
              <p className="py-8 text-sm text-muted-foreground">
                Nothing scheduled. Start a call from any conversation.
              </p>
            ) : (
              <>
                {live.map(meeting => (
                  <MeetingLine key={meeting.meetingId} meeting={meeting} tone="live"
                    onClick={() => onOpenMeeting(meeting)} />
                ))}
                {upcoming.map(meeting => (
                  <MeetingLine key={meeting.meetingId} meeting={meeting} tone="next"
                    onClick={() => onOpenMeeting(meeting)} />
                ))}
                {recentMeetings.map(meeting => (
                  <MeetingLine key={meeting.meetingId} meeting={meeting} tone="past"
                    onClick={onOpenMeetings} />
                ))}
              </>
            )}
          </section>
        </div>

        {/* One line at the foot of the page for the shelf. Not a band: it is
            somewhere you go on purpose, not news. */}
        <div className="mt-10 border-t pt-4">
          <button
            onClick={onOpenSaved}
            className="inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Bookmark className="size-3.5" />
            Saved messages
            {savedCount !== null && savedCount > 0 && (
              <span className="tabular-nums opacity-70">{savedCount}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function MeetingLine({
  meeting, tone, onClick,
}: {
  meeting: MeetingRow;
  tone: 'live' | 'next' | 'past';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b py-2.5 text-left transition-colors hover:bg-accent/50"
    >
      <span className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md',
        tone === 'live' ? 'bg-destructive/12 text-destructive' : 'bg-muted text-muted-foreground',
      )}>
        {tone === 'live' ? <Radio className="size-3.5" /> : <Clock className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn(
          'block truncate text-sm',
          tone === 'past' ? 'font-medium text-muted-foreground' : 'font-semibold',
        )}>
          {meeting.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {tone === 'live'
            ? `${meeting.presentCount} in the room`
            : tone === 'next'
              ? meeting.scheduledAt ? whenWords(meeting.scheduledAt) : 'Not scheduled'
              : meeting.endedAt ? `Ended ${formatRelativeTime(meeting.endedAt)}` : 'Ended'}
          {meeting.channelLabel ? ` · ${meeting.channelLabel}` : ''}
        </span>
      </span>
      {tone === 'live' && (
        <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-semibold text-white">
          Join
        </span>
      )}
    </button>
  );
}

function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b py-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Today 14:30", "Tomorrow 09:00", "Thu 4 Sep 11:00". */
function whenWords(iso: string, locale = 'en-GB'): string {
  const when = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (when.toDateString() === today.toDateString()) return `Today ${clockTime(iso)}`;
  if (when.toDateString() === tomorrow.toDateString()) return `Tomorrow ${clockTime(iso)}`;
  return `${when.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} `
    + clockTime(iso);
}

/**
 * Morning, afternoon or evening, from the reader's own clock.
 *
 * The one piece of warmth on the page, and the only place the product uses
 * somebody's name. It earns its place because this is the screen people open
 * first thing; anything more would be the marketing voice the brief rules out.
 */
function partOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * The saved shelf, in full.
 *
 * A sheet rather than a fourth view: the shelf is something a person dips into
 * and leaves, and giving it a tab of its own would put a permanent piece of
 * navigation in front of a list that is empty for most people in their first
 * month.
 */
export function SavedPanel({
  open, onOpenChange, onOpenMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenMessage: (channelId: string, messageId: string) => void;
}) {
  const [rows, setRows] = React.useState<SavedMessage[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRows(null);
    void api<SavedMessage[]>('/api/communication/saved')
      .then(r => setRows(r ?? []))
      .catch(() => setRows([]));
  }, [open]);

  // Escape closes it, as it does every other overlay in the product.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const unsave = React.useCallback(async (item: SavedMessage) => {
    setBusy(item.saveId);
    try {
      await api(`/api/communication/saved?messageId=${item.messageId}`, { method: 'DELETE' });
      setRows(prev => (prev ?? []).filter(r => r.saveId !== item.saveId));
    } catch (e: any) {
      toast.error(e.message || 'Could not remove that');
    } finally {
      setBusy(null);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => onOpenChange(false)}>
      <aside
        className="flex h-full w-full max-w-md flex-col border-l bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Saved messages"
      >
        <header className="flex items-center justify-between border-b px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">Saved</h2>
            <p className="text-xs text-muted-foreground">Only you can see this.</p>
          </div>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => onOpenChange(false)}
            aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-8 py-14 text-center">
              <Bookmark className="mx-auto size-7 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Nothing saved yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The bookmark on any message keeps it here, out of everybody else&apos;s way.
              </p>
            </div>
          ) : (
            rows.map(item => (
              <div key={item.saveId} className="group border-b px-5 py-3.5">
                <div className="flex items-start gap-2.5">
                  <PersonAvatar
                    id={item.senderId}
                    name={item.senderName}
                    src={item.senderAvatar}
                    size="sm"
                    decorative
                    className="mt-0.5"
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => { onOpenMessage(item.channelId, item.messageId); onOpenChange(false); }}
                  >
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {item.senderName ?? 'Someone'}
                      </span>
                      {' in '}{item.channelLabel}
                      {' · '}{formatRelativeTime(item.createdAt)}
                    </p>
                    <p className="mt-1 line-clamp-3 text-sm text-foreground/90">
                      {plainPreview(item.body) || (item.hasFiles ? 'Shared a file' : 'Shared a link')}
                    </p>
                    {item.note && (
                      <p className="mt-1.5 border-l-2 border-brand/40 pl-2 text-xs italic text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost" size="icon"
                        className="size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                        disabled={busy === item.saveId}
                        onClick={() => void unsave(item)}
                        aria-label="Remove from saved"
                      >
                        {busy === item.saveId
                          ? <Loader2 className="size-3.5 animate-spin" />
                          : <X className="size-3.5" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove from saved</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
