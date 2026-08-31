'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Settings, Search, Pin, Plus, MoreHorizontal, Menu, Loader2,
  MessageSquare, Users, UserPlus, LogOut, Trash2, Archive,
  Bell, BellOff, Video, ChevronDown, FolderKanban, Building2, Radio,
  ArrowDown, AtSign, Star, PanelRight, Bookmark, Info,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatRelativeTime, truncate } from '@/lib/format';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/store/app-store';
import { useFocusRequest } from '@/hooks/use-focus-request';
import { useModuleRealtime, useRealtime, useTyping } from '@/hooks/use-realtime';
import { type PresenceRow } from '@/hooks/use-presence';
import { PresenceDot } from '@/components/shared/presence-dot';
import { PersonAvatar } from '@/components/shared/person-avatar';
import {
  DEFAULT_COMMUNICATION_POLICY, settingsOf, type CommunicationPolicy,
} from '@/lib/org-settings';
import { cn } from '@/lib/utils';

import {
  type ChannelMember, type ChannelRow, type DirectoryMember, type MeetingRow,
  type Message, type RecordReference, type SavedMessage, type SearchHit,
  type ThreadSummary,
  api, apiWithMeta, channelLabel, dayKey, dayLabel,
} from './types';
import { plainPreview } from './rich-text';
import { MessageBubble, DaySeparator, NewMessagesDivider } from './message-list';
import { Composer } from './composer';
import {
  ChannelSettingsDialog, CreateChannelDialog, DirectMessageDialog, MembersDialog,
  SearchDialog, type LinkOption,
} from './dialogs';
import { MeetingRoom, MeetingsView, ScheduleMeetingDialog } from './meetings';
import { Home, SavedPanel } from './home';
import { ConversationPanel } from './panel';
import { MessageActionDialog, type MessageActionTarget } from './actions';
import { ChannelGlyph, LivePip, UnreadPill } from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Communication.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Where this module was, and what changed ──────────────────────────────
 *
 *  0017 made it work: a channel could be created, joined and left, a direct
 *  message opened, and a private conversation stopped being listed in
 *  everybody's sidebar. What it left was a competent chat application sitting
 *  next to a business operating system rather than being part of one.
 *
 *  This pass closes that gap, and the shape of the work was the same each
 *  time: something already existed in the database and nothing reached it.
 *
 *    · `messages.attachments`  - accepted since the first migration, never
 *                                once non-empty. Files now go to `files`, and
 *                                the column carries record references.
 *    · `channel_members.is_muted` - accepted by the members endpoint, read by
 *                                nothing. It is a control now.
 *    · `channels.department_id`/`team_id` - never set by anything. Joined by
 *                                `project_id` and `company_id` in 0023, so a
 *                                conversation has a subject and links both
 *                                ways to the work it is about.
 *    · Search               - filtered the hundred messages already loaded.
 *                                Now a real index across everything readable.
 *    · Read receipts        - announced under every message. Now asked for.
 *    · Meetings             - did not exist. Now a room, with a waiting room
 *                                and a host, in the channel the work lives in.
 *
 *  ── Why the file split ───────────────────────────────────────────────────
 *
 *  This was 2,100 lines in one file. The deep modules here - crm, projects,
 *  mywork - are all a folder with a shell and per-concern children, and that
 *  is what this is now: the shell holds the data and the decisions, and the
 *  timeline, the composer, the dialogs and the meeting room are their own.
 */

// The roles that administer an organisation. Rendering only - the server
// decides, through `is_org_admin()`, and this only avoids offering a control
// that would return 403.
const ORG_ADMIN_ROLES = ['owner', 'administrator', 'super_admin', 'admin'];

/** How many messages a scrollback page holds. */
const PAGE_SIZE = 40;

/**
 * Three views, and Home is the one the module opens on.
 *
 * -- Why the module no longer opens straight into a channel ----------------
 *
 * It used to select the most recently active conversation and drop the reader
 * into it. That is right for somebody who is already in a conversation and
 * wrong for everybody arriving in the morning, which is when this module is
 * most often opened: what they need first is what happened while they were
 * away, and the old behaviour answered it by showing them one room out of
 * forty and a column of badges to interpret.
 *
 * Home answers it directly and is one click from every conversation, so
 * nothing is further away than it was.
 */
type View = 'home' | 'messages' | 'meetings';
type Filter = 'all' | 'unread';

export default function CommunicationModule() {
  const isMobile = useIsMobile();
  // The membership id, not the account id: messages.sender_id references the
  // membership, so that is what an "is this mine?" comparison has to use.
  const currentMemberId = useAppStore(s => s.user?.memberId ?? null);
  const organizationId = useAppStore(s => s.organization?.id ?? null);
  const role = useAppStore(s => s.user?.role ?? 'employee');
  const openRecord = useAppStore(s => s.openRecord);
  const isOrgAdmin = ORG_ADMIN_ROLES.includes(role);
  /**
   * The reader's own name and face, for Home's one line of greeting and for
   * the composer's identity.
   *
   * Selected as two primitives rather than as an object: a selector that
   * builds one returns a new reference on every call, which zustand v5 reads
   * as "the store changed" and renders for ever. That failure has already been
   * paid for once in this file, over the communication policy.
   */
  const firstName = useAppStore(s => s.user?.firstName || null);
  const myAvatar = useAppStore(s => s.user?.avatarUrl ?? null);

  /**
   * The organisation's communication policy.
   *
   * Read from the session rather than fetched: `/api/admin/settings` is the
   * only other source and an employee is rightly refused it, so a module that
   * asked there would fall back to defaults for everybody who is not an
   * administrator - and then offer an Edit button the endpoint refuses.
   *
   * Rendering only. Every one of these is enforced again server-side, which is
   * the decision that counts; this is so the module does not present a control
   * that will be turned down.
   *
   * ── Why the raw slice is selected and the merge happens outside ──────────
   *
   * The obvious version of this deriving the policy *inside* the selector -
   * `useAppStore(s => settingsOf(s.organization?.policies, …))` - crashes the
   * module, and it took a reproduction to see why.
   *
   * zustand v5's `useStore` hands `() => selector(getState())` straight to
   * React's `useSyncExternalStore`, which calls it on every render and
   * compares the result with `Object.is`. `settingsOf` merges defaults under
   * the stored document, so it returns a *new object every call* - React reads
   * that as "the external store changed", renders again, gets another new
   * object, and never settles:
   *
   *     The result of getSnapshot should be cached to avoid an infinite loop
   *     Maximum update depth exceeded
   *
   * The subtlety worth remembering: it only bites once a session has loaded.
   * With no `policies` on the organisation, `settingsOf` returns the defaults
   * object itself - one stable reference, no loop - so the module renders
   * perfectly until the moment there is something to read.
   *
   * `s.organization?.policies` is a stable reference between renders, so the
   * snapshot settles, and the merge is memoised on it.
   */
  const storedPolicies = useAppStore(s => s.organization?.policies);
  const policy = useMemo(
    () => settingsOf<CommunicationPolicy>(
      storedPolicies, 'communication_policy', DEFAULT_COMMUNICATION_POLICY),
    [storedPolicies],
  );

  const [view, setView] = useState<View>('home');
  const [showSidebar, setShowSidebar] = useState(false);
  /** The details rail. Closed by default; see `panel.tsx`. */
  const [panelOpen, setPanelOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);

  // ── Data ──
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [directory, setDirectory] = useState<DirectoryMember[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [projects, setProjects] = useState<LinkOption[]>([]);
  const [companies, setCompanies] = useState<LinkOption[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  /**
   * The threads in the open conversation, keyed by the message they hang from.
   *
   * One query per channel rather than one per bubble. Before 0036 a reply
   * count could not be known without fetching the replies, so the timeline
   * drew no thread affordance at all until somebody clicked one, and a
   * discussion that had moved into a thread was invisible to everybody who had
   * not been there when it moved.
   */
  const [threads, setThreads] = useState<Record<string, ThreadSummary>>({});
  /**
   * The reader's own shelf, as a set of message ids.
   *
   * Held as ids rather than as rows because the only question the timeline
   * asks is "is this one saved"; the rows themselves are read by the shelf
   * panel, which fetches its own and is the only thing that renders them.
   */
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  /**
   * Bumped whenever something lands that Home would want to know about, so it
   * refetches its inbox without holding a second copy of the channel list.
   */
  const [homeKey, setHomeKey] = useState(0);
  /** Who is in a call right now, from `/api/communication/meetings` meta. */
  const [inCall, setInCall] = useState<string[]>([]);
  /**
   * Presence by member id, for the dots on avatars.
   *
   * Kept as a map rather than merged into `members`, because the roster is
   * refetched when a channel is opened and presence is refetched on its own
   * schedule - merging would mean one of them clobbering the other's freshness
   * depending on which request happened to land last.
   */
  const [presence, setPresence] = useState<Record<string, PresenceRow>>({});

  // ── Scrollback ──
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  /**
   * Where the reader had got to when they opened this channel.
   *
   * Captured once, before the channel is marked read, because the act of
   * reading is about to move the marker - and the "New" divider has to stay
   * where the reader left off rather than sliding to the end as they scroll.
   */
  const [unreadFrom, setUnreadFrom] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // ── Input ──
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [threadReplies, setThreadReplies] = useState<Record<string, Message[]>>({});
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // ── Loading ──
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(true);

  // ── Dialogs ──
  const [createOpen, setCreateOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /** What Home's field was carrying when it handed over to the search panel. */
  const [searchSeed, setSearchSeed] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<ChannelRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelRow | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Turning a message into work.
   *
   * The target and the destination are held here, and the form is mounted
   * once, because a timeline holds forty bubbles and a dialog per bubble is
   * forty components carrying state for a panel almost nobody opens.
   */
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);
  const [actionDestination, setActionDestination] =
    useState<'todo' | 'reminder' | 'crm' | 'task' | null>(null);
  /** A message the reader wants a meeting about; seeds the schedule dialog. */
  const [meetingSeed, setMeetingSeed] = useState<{ title: string; agenda: string } | null>(null);

  /**
   * The meeting room, held as an id rather than as a row.
   *
   * ── Why the row itself cannot be the state ───────────────────────────────
   *
   * It used to be: `setActiveMeeting(row)` froze one snapshot of
   * `meeting_overview()` for as long as the room was open, and the room read
   * everything from it. Every fact on it then went stale the moment it
   * mattered - the host ended the meeting and nobody else's room noticed,
   * because their copy still said `live`; somebody saved the notes and the
   * panel kept showing the text from when the room opened; the waiting room
   * was turned on and the flag never moved.
   *
   * The id is the thing worth remembering. The row is looked up in the list
   * the module already keeps live, so the room re-renders on the same events
   * every other surface does.
   */
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /**
   * Unsent text, per conversation.
   *
   * A ref rather than state: a draft must survive switching rooms and must not
   * re-render the module on every keystroke. See `ComposerProps.drafts`.
   */
  const drafts = useRef<Record<string, string>>({});
  /**
   * A meeting this browser has just started, which therefore skips the lobby.
   *
   * A ref rather than state: nothing renders differently because of it, it is
   * read once when the room mounts, and putting it in state would re-render
   * the module for a value only the room ever looks at.
   */
  const startedByMe = useRef<string | null>(null);

  const selected = channels.find(c => c.channelId === selectedId) ?? null;
  /**
   * The open meeting, resolved from the live list on every render.
   *
   * This is what makes the room react to the meeting ending, the notes being
   * saved, the waiting room being switched on and somebody being promoted to
   * co-host - none of which the room could see when it held its own copy.
   */
  const activeMeeting = activeMeetingId
    ? meetings.find(m => m.meetingId === activeMeetingId) ?? null
    : null;

  // ─── Loading ─────────────────────────────────────────────────────────────

  /**
   * ═════════════════════════════════════════════════════════════════════════
   *  Unread, and why it used to be wrong
   * ═════════════════════════════════════════════════════════════════════════
   *
   * The count is derived by `channel_overview()` from `channel_members.
   * last_read_at`, which is the only definition of "read" in the product -
   * the badge, the navigation total and the read receipts all come from it,
   * so they cannot disagree with each other. What they *could* disagree with
   * was the screen, in two ways:
   *
   *   · The marker was moved exactly once, when the conversation was opened.
   *     Everything that arrived afterwards while the reader sat looking at it
   *     counted as unread for ever - so the next time anything refetched the
   *     sidebar, a badge appeared on the conversation currently on screen and
   *     stayed there. That is the reported fault, and it is fixed by treating
   *     reading as continuous rather than as a single event: see the effect
   *     below.
   *
   *   · A refetch that was already in flight when the marker moved came back
   *     with the pre-read snapshot and put the badge back for a moment. This
   *     watermark is the fix: once we know the conversation was read at a
   *     given moment, any later snapshot showing unread messages that all
   *     predate it is simply out of date, and is corrected rather than shown.
   */
  const readAt = useRef<Record<string, string>>({});

  const applyReadWatermark = useCallback((rows: ChannelRow[]) => rows.map(c => {
    const at = readAt.current[c.channelId];
    if (!at) return c;
    if (c.lastMessageAt && c.lastMessageAt > at) return c;
    return c.unreadCount || c.mentionCount ? { ...c, unreadCount: 0, mentionCount: 0 } : c;
  }), []);

  const loadChannels = useCallback(async (preferId?: string) => {
    try {
      const data = await api<ChannelRow[]>('/api/communication/channels');
      setChannels(applyReadWatermark(data ?? []));
      setSelectedId(prev => {
        const target = preferId ?? prev;
        if (target && data?.some(c => c.channelId === target)) return target;
        return data?.[0]?.channelId ?? null;
      });
    } catch (err: any) {
      toast.error(err.message || 'Could not load conversations');
    } finally {
      setChannelsLoading(false);
    }
  }, [applyReadWatermark]);

  /**
   * Tell the server this conversation has been read, and tell the rest of the
   * application.
   *
   * The second half is what was missing. The sidebar badge and the dashboard
   * read `unreadByModule` in the store, which is composed by
   * `/api/notifications` from the notification tray *and* the same per-channel
   * unread counts - so reading a conversation moved this module's own numbers
   * and left every badge outside it showing the old figure until the tray
   * happened to poll. One call puts them back in step immediately.
   */
  const markChannelRead = useCallback(async (channelId: string, latestAt?: string | null) => {
    const previous = readAt.current[channelId];
    // Nothing has been said since the last time we marked this read, so there
    // is nothing to mark. Without this the effect below would write on every
    // render that touched the timeline.
    if (previous && latestAt && latestAt <= previous) return;

    setChannels(prev => prev.map(c =>
      c.channelId === channelId && (c.unreadCount || c.mentionCount)
        ? { ...c, unreadCount: 0, mentionCount: 0 }
        : c));

    try {
      const row = await api<{ lastReadAt?: string | null }>(
        `/api/communication/channels/${channelId}/members`,
        { method: 'PATCH', body: JSON.stringify({ markRead: true }) },
      );
      /**
       * The watermark is the server's timestamp, never this browser's.
       *
       * It is compared against `lastMessageAt`, which the server produced -
       * and the two clocks are not the same clock. A laptop running a few
       * minutes fast would set a watermark in the future and then suppress the
       * badge on genuinely unread messages that arrived afterwards, which is
       * this whole section's bug reintroduced by the fix for it. `last_read_at`
       * comes back on the row that was just written; that is the only value
       * comparable with the other.
       *
       * Nothing is recorded when the write fails - reading a channel you are
       * not a member of answers 404, which is correct, and a watermark set on
       * a claim the server refused would suppress a count it will keep sending.
       */
      if (row?.lastReadAt) readAt.current[channelId] = row.lastReadAt;
    } catch {
      return;
    }
    void useAppStore.getState().fetchNotifications();
  }, []);

  const loadMeetings = useCallback(async () => {
    try {
      const page = await apiWithMeta<MeetingRow[]>('/api/communication/meetings');
      setMeetings(page.data ?? []);
      /**
       * "In a call" arrives with the meetings, not with presence.
       *
       * `presence_of()` is read by every module, and a dot that means "at
       * their desk" in the directory and "on a call" in HR is exactly the
       * divergence the shared presence component exists to prevent. This is a
       * communication fact, returned to communication, and overlaid only here.
       */
      setInCall(Array.isArray(page.meta?.inCall) ? page.meta.inCall : []);
    } catch {
      // Meetings failing must not take the conversation list with it.
    } finally {
      setMeetingsLoading(false);
    }
  }, []);

  /**
   * The shelf, as ids.
   *
   * Fetched once and kept in step by the toggle itself rather than by a
   * refetch per save: the only writer is this browser, and the realtime
   * subscription below covers the second device.
   */
  const loadSaved = useCallback(async () => {
    try {
      const rows = await api<SavedMessage[]>('/api/communication/saved');
      setSavedIds(new Set((rows ?? []).map(r => r.messageId)));
    } catch {
      // A shelf that cannot be read is an empty bookmark icon, not a failure
      // worth interrupting a conversation over.
    }
  }, []);

  useEffect(() => { void loadChannels(); }, [loadChannels]);
  useEffect(() => { void loadMeetings(); }, [loadMeetings]);
  useEffect(() => { void loadSaved(); }, [loadSaved]);

  /**
   * The shelf, on the other device.
   *
   * Filtered to the caller's own rows, as `channel_members` is and for the
   * same reason: unfiltered, every save by anybody in the organisation would
   * be an event delivered to every open tab.
   */
  useRealtime({
    name: 'module:saves',
    enabled: !!currentMemberId,
    debounceMs: 800,
    tables: currentMemberId
      ? [{ table: 'message_saves', filter: `member_id=eq.${currentMemberId}` }]
      : [],
    onChange: () => { if (!roomOpen.current) void loadSaved(); },
  });

  /**
   * Everything the module needs that is not a conversation.
   *
   * All four are tolerant of failure: a member of staff with no CRM grant gets
   * a 403 for companies, and the correct behaviour is an empty picker rather
   * than a module that will not open.
   */
  useEffect(() => {
    void api<DirectoryMember[]>('/api/directory').then(setDirectory).catch(() => setDirectory([]));

    void fetch('/api/projects/projects?pageSize=100')
      .then(r => r.json())
      .then(j => setProjects((j?.data ?? []).map((p: any) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));

    void fetch('/api/crm/companies?pageSize=100')
      .then(r => r.json())
      .then(j => setCompanies((j?.data ?? []).map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(() => setCompanies([]));
  }, []);

  /**
   * The channel list itself is live.
   *
   * `channels` covers one being created, renamed or archived. `channel_members`
   * covers being added to or removed from one, which is what makes a channel
   * appear in the sidebar without a reload - and is narrowed to two things on
   * purpose.
   *
   * ── Why the filter and the event list are not optional ───────────────────
   *
   * It was the whole table, every operation. `last_read_at` lives on it, and
   * this module now advances that marker for as long as a conversation is
   * open - so every message anybody read anywhere in the organisation became a
   * row change delivered to every open tab, each of which answered it by
   * refetching its entire channel list. Ten people in one conversation is a
   * hundred `channel_overview()` calls a minute for a marker that concerns
   * exactly one of them.
   *
   * Narrowed to the caller's own memberships, appearing and disappearing:
   * being added to a channel and being removed from one are the only changes
   * to this table that alter what the sidebar should show. `REPLICA IDENTITY
   * FULL` (0020) is what makes the filtered DELETE arrive at all - without it
   * the event carries only the primary key and matches no filter.
   */
  const conversationsLive = useRealtime({
    name: 'module:conversations',
    debounceMs: 400,
    onChange: () => { if (!roomOpen.current) void loadChannels(); },
    tables: [
      { table: 'channels' },
      ...(currentMemberId
        ? ([
            { table: 'channel_members', event: 'INSERT', filter: `member_id=eq.${currentMemberId}` },
            { table: 'channel_members', event: 'DELETE', filter: `member_id=eq.${currentMemberId}` },
          ] as const)
        : []),
    ],
  });

  /**
   * A meeting called, started, ended or cancelled.
   *
   * This is what makes "User A creates a meeting while User B is in the module
   * and B sees it appear" true without a reload. `loadChannels` runs alongside
   * because starting or ending one changes the *channel* row too -
   * `live_meeting_id` is what puts the red dot in the sidebar and the Join
   * button in the conversation header.
   */
  useModuleRealtime('meetings', ['meetings'], () => {
    if (roomOpen.current) return;
    void loadMeetings();
    void loadChannels();
  });

  /**
   * Somebody knocking, arriving or leaving.
   *
   * Separate, and slower, on purpose. `meeting_overview()` computes the waiting
   * and present counts from `meeting_participants`, so a host watching the list
   * from outside a room needs this or the "3 waiting" badge never appears. But
   * it is also the table a running meeting writes to constantly - every camera
   * toggle, every raised hand - and each of those events reaches every tab in
   * the organisation, where all but a handful are about a meeting nobody is
   * looking at. A second and a half collapses a room's chatter into one
   * refetch, and it does not touch the channel list, which none of it changes.
   *
   * The room itself subscribes to the same table filtered to its own meeting,
   * at 150ms, because in there the detail is the point.
   */
  useRealtime({
    name: 'module:meeting-people',
    debounceMs: 1500,
    tables: [{ table: 'meeting_participants' }],
    onChange: () => { if (!roomOpen.current) void loadMeetings(); },
  });

  /**
   * A message posted anywhere the caller can see.
   *
   * This was deliberately left out before, on the grounds that refetching the
   * whole channel list per message is expensive - and it is. But it is also the
   * only thing that can move an unread badge on a conversation that is *not*
   * open, and a chat sidebar whose counts do not move until something else
   * happens to refresh it is not a chat sidebar. The compromise is the
   * debounce: a burst of traffic across the organisation collapses into one
   * `channel_overview()` call a second, which is one query, and RLS has already
   * confined the events to conversations this person can actually see.
   */
  useRealtime({
    name: 'module:messages',
    debounceMs: 1000,
    tables: [{ table: 'messages' }],
    onChange: () => {
      if (roomOpen.current) return;
      void loadChannels();
      // Home holds the inbox and nothing else does, so it is told to refetch
      // rather than given a second copy of the channel list to derive one from.
      setHomeKey(k => k + 1);
    },
  });

  /**
   * Presence, live.
   *
   * A dot that only changes on reload is worse than no dot: it makes a
   * confident claim about somebody who left an hour ago. Debounced heavily -
   * in a company of any size the heartbeats are constant, and a refetch per
   * beat would be a request every second or two for a set of coloured dots.
   */
  /**
   * Whether a meeting room is covering the module.
   *
   * A ref rather than a dependency: the subscriptions below read it at the
   * moment an event arrives, and putting it in their dependency lists would
   * tear every channel down and rebuild it each time somebody opened a room.
   *
   * Everything it gates is work whose only product is pixels behind a
   * full-screen overlay - the sidebar's unread counts, the meeting cards, the
   * presence dots. `closeMeeting` catches all of it up on the way out, which
   * is the moment before any of it is visible again.
   */
  const roomOpen = useRef(false);
  useEffect(() => { roomOpen.current = !!activeMeetingId; }, [activeMeetingId]);

  const readPresence = useCallback(() => {
    void fetch('/api/presence')
      .then(r => r.json())
      .then(j => {
        setOnlineCount(j?.meta?.online ?? 0);
        setPresence(Object.fromEntries(
          (j?.data ?? []).map((r: PresenceRow) => [r.memberId, r]),
        ));
      })
      .catch(() => undefined);
  }, []);

  useRealtime({
    name: 'presence',
    tables: [{ table: 'profiles', event: 'UPDATE' }],
    debounceMs: 2000,
    onChange: readPresence,
  });

  useEffect(() => {
    readPresence();
    // The fallback for a tab whose subscription could not connect - corporate
    // proxies block websockets, and a presence panel that silently stops
    // updating looks exactly like an office where nobody is at their desk.
    // Paused behind a meeting: a panel of coloured dots nobody can see is not
    // worth a request a minute on a device that is encoding video.
    const timer = setInterval(() => { if (!roomOpen.current) readPresence(); }, 60_000);
    return () => clearInterval(timer);
  }, [readPresence]);

  /**
   * Open a conversation: its messages, its participants, and its read marker.
   *
   * Marking read is an explicit call rather than a side effect of the GET, so
   * that reading a channel is a deliberate act the client can decide about -
   * a prefetch should not clear somebody's unread badge.
   */
  /**
   * Every thread in a conversation, described without opening any of them.
   *
   * Tolerant of failure and never awaited by the timeline: a channel whose
   * thread summaries could not be fetched shows its messages with no reply
   * counts, which is exactly what the module did before 0036 and is far better
   * than a conversation that will not open.
   */
  const loadThreads = useCallback(async (channelId: string) => {
    try {
      const rows = await api<ThreadSummary[]>(
        `/api/communication/threads?channelId=${channelId}`);
      setThreads(Object.fromEntries((rows ?? []).map(t => [t.rootId, t])));
    } catch {
      setThreads({});
    }
  }, []);

  const openChannel = useCallback(async (channelId: string) => {
    setMessagesLoading(true);
    setReplyTo(null);
    setOpenThread(null);
    setThreadReplies({});
    setThreads({});
    void loadThreads(channelId);
    try {
      const [page, mem] = await Promise.all([
        apiWithMeta<Message[]>(
          `/api/communication/messages?channelId=${channelId}&pageSize=${PAGE_SIZE}`),
        api<ChannelMember[]>(`/api/communication/channels/${channelId}/members`),
      ]);

      // Newest-first from the API, which is how a scrollback loads; reversed
      // for display.
      setMessages([...(page.data ?? [])].reverse());
      setOlderCursor(page.meta?.hasMore ? page.meta?.nextBefore ?? null : null);
      setMembers(mem ?? []);

      /**
       * Captured before the marker moves - see `unreadFrom`.
       *
       * Taken from the caller's own membership row rather than from the
       * sidebar's unread count. The count lives in `channels`, and reading it
       * here would close over whatever that array held when this callback was
       * created - which is the empty list from the first render, so the
       * divider would never appear. The marker is the same value the count is
       * derived from anyway, and it needs no second source.
       */
      const mine = (mem ?? []).find(m => m.memberId === currentMemberId);
      setUnreadFrom(mine?.lastReadAt ?? null);

      // Opening is the first act of reading; the effect further down carries on
      // from here for as long as the conversation stays open and in front of
      // somebody.
      void markChannelRead(channelId);
    } catch (err: any) {
      toast.error(err.message || 'Could not open that conversation');
      setMessages([]);
      setMembers([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [currentMemberId, markChannelRead, loadThreads]);

  useEffect(() => {
    if (!selectedId) return;
    void openChannel(selectedId);
    if (isMobile) setShowSidebar(false);
  }, [selectedId, openChannel, isMobile]);

  /**
   * Bring in what has arrived, without losing what is loaded.
   *
   * ── Why this merges rather than replacing ────────────────────────────────
   *
   * The previous version refetched the newest hundred messages and replaced
   * state with them. Two costs: somebody who had scrolled back through four
   * pages of history lost all of it the moment anybody typed, and the whole
   * list re-rendered on every keystroke-sized event. Merging by id keeps the
   * scrollback intact and touches only what is new.
   */
  const refreshMessages = useCallback(async (channelId: string) => {
    try {
      const page = await apiWithMeta<Message[]>(
        `/api/communication/messages?channelId=${channelId}&pageSize=${PAGE_SIZE}`);
      const fresh = [...(page.data ?? [])].reverse();
      setMessages(prev => {
        const byId = new Map(prev.map(m => [m.id, m]));
        for (const m of fresh) byId.set(m.id, m);
        // A message that has been deleted disappears from the fetch, so
        // anything at or after the newest page's oldest row that is no longer
        // in it has gone and should go here too.
        const oldest = fresh[0]?.createdAt;
        const kept = [...byId.values()].filter(m =>
          !oldest || m.createdAt < oldest || fresh.some(f => f.id === m.id));
        return kept.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
    } catch {
      // The thread still holds what it had; a failed background refresh is not
      // worth interrupting a conversation over.
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (!selectedId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const before = el?.scrollHeight ?? 0;
    try {
      const page = await apiWithMeta<Message[]>(
        `/api/communication/messages?channelId=${selectedId}&pageSize=${PAGE_SIZE}&before=${encodeURIComponent(olderCursor)}`);
      const older = [...(page.data ?? [])].reverse();
      setMessages(prev => {
        const known = new Set(prev.map(m => m.id));
        return [...older.filter(m => !known.has(m.id)), ...prev];
      });
      setOlderCursor(page.meta?.hasMore ? page.meta?.nextBefore ?? null : null);
      /**
       * Hold the reader where they were.
       *
       * Prepending content pushes everything down by exactly the height that
       * was added, so without this the view jumps and the message somebody was
       * reading is suddenly off-screen. Restoring by the *difference* in
       * scroll height is the only version that is correct regardless of how
       * tall the new messages turned out to be.
       */
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop += el.scrollHeight - before;
      });
    } catch (err: any) {
      toast.error(err.message || 'Could not load earlier messages');
    } finally {
      setLoadingOlder(false);
    }
  }, [selectedId, olderCursor, loadingOlder]);

  /**
   * Who is typing, right now.
   *
   * Broadcast rather than a table: "Alice is typing" is true for two seconds
   * and worthless afterwards, so writing it down would mean a row per
   * keystroke-burst and a cleanup job for state that expires on its own.
   *
   * The name is resolved from the roster rather than sent by the sender, so a
   * client cannot announce itself as somebody else.
   */
  const me = useMemo(
    () => (currentMemberId
      ? {
          memberId: currentMemberId,
          name: members.find(m => m.memberId === currentMemberId)?.fullName ?? 'Someone',
        }
      : null),
    [currentMemberId, members],
  );
  const { typing, signal: signalTyping } = useTyping(selectedId, me);

  /**
   * "Message sent - appears instantly."
   *
   * Filtered to the open channel, which is the case a filter is most clearly
   * worth having: without it every message anywhere in the organisation would
   * refetch this thread. `message_reactions` and `files` are watched too - a
   * reaction and an attachment are both changes to a message on screen, and
   * neither carries a `channel_id` to filter on, so each is subscribed
   * unfiltered and costs a discarded event.
   */
  const channelLive = useRealtime({
    name: `channel:${selectedId ?? 'none'}`,
    enabled: !!selectedId,
    debounceMs: 200,
    tables: selectedId
      ? [
          { table: 'messages', filter: `channel_id=eq.${selectedId}` },
          { table: 'message_reactions' },
          { table: 'files' },
        ]
      : [],
    onChange: () => {
      if (!selectedId || roomOpen.current) return;
      void refreshMessages(selectedId);
      /**
       * The reply counts move with the messages.
       *
       * A reply is a `messages` row with a `parent_id`, so it arrives on this
       * subscription and does not appear in the root timeline at all. Without
       * this the count under a message would be right when the channel was
       * opened and never again, which is the worse kind of wrong: it looks
       * maintained.
       */
      void loadThreads(selectedId);
    },
  });

  /**
   * ═════════════════════════════════════════════════════════════════════════
   *  When the websocket never connects
   * ═════════════════════════════════════════════════════════════════════════
   *
   * A good number of corporate proxies block websockets outright - which is
   * common in exactly the organisations this product is for - and the failure
   * is silent: the subscription reports an error nobody watches, the callback
   * simply never fires, and a quiet channel looks identical to a broken one.
   * Before this, that tab showed whatever was true when it was opened, for the
   * rest of the day, with no indication that it had stopped.
   *
   * So the status is read rather than discarded, and the two intervals are the
   * fallback: eight seconds for the conversation somebody is actually reading,
   * twenty for the lists. Both are far more traffic than the socket would be,
   * which is why they only run when there is no socket - and the footer says
   * so, because a person who knows updates are delayed behaves differently
   * from one who thinks nothing has happened.
   */
  const degraded = conversationsLive === 'unavailable'
    || (!!selectedId && channelLive === 'unavailable');

  useEffect(() => {
    if (conversationsLive !== 'unavailable') return;
    const timer = setInterval(() => { void loadChannels(); void loadMeetings(); }, 20_000);
    return () => clearInterval(timer);
  }, [conversationsLive, loadChannels, loadMeetings]);

  useEffect(() => {
    if (!selectedId || channelLive !== 'unavailable') return;
    const timer = setInterval(() => { void refreshMessages(selectedId); }, 8000);
    return () => clearInterval(timer);
  }, [selectedId, channelLive, refreshMessages]);

  /**
   * Reading, as it happens.
   *
   * A conversation that is open and in front of somebody is being read, so the
   * marker keeps up with it instead of stopping at the moment it was opened.
   * `document.hidden` is the one condition that has to be honoured: a
   * background tab is not somebody reading, and marking its messages read would
   * lose them - the badge is the only thing that would ever have brought the
   * reader back.
   */
  const newestAt = messages.length ? messages[messages.length - 1].createdAt : null;

  useEffect(() => {
    if (!selectedId || !newestAt || messagesLoading) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    void markChannelRead(selectedId, newestAt);
  }, [selectedId, newestAt, messagesLoading, markChannelRead]);

  /**
   * Coming back to the tab counts as reading too.
   *
   * Everything that arrived while it was in the background is on screen the
   * moment it is looked at, and a badge that survives that is the stale badge
   * this whole section exists to prevent.
   */
  useEffect(() => {
    if (!selectedId) return;
    const seen = () => {
      if (document.hidden) return;
      void markChannelRead(selectedId);
    };
    document.addEventListener('visibilitychange', seen);
    window.addEventListener('focus', seen);
    return () => {
      document.removeEventListener('visibilitychange', seen);
      window.removeEventListener('focus', seen);
    };
  }, [selectedId, markChannelRead]);

  /**
   * Follow the conversation, unless the reader has gone looking for something.
   *
   * Scrolling to the newest message whenever anything arrives is right until
   * somebody scrolls up to read - at which point it drags them back down mid
   * sentence, and there is no way to read anything. `atBottom` is what makes
   * the difference; when they are not, the jump button appears instead.
   */
  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, atBottom]);

  /**
   * ========================================================================
   *  The keyboard, on a phone
   * ========================================================================
   *
   * A soft keyboard does not resize the layout viewport. It slides over it.
   * So a module sized to `100%` of a full-height page keeps its full height,
   * the composer stays exactly where it was, and the keyboard covers it -
   * which is the single most common way a mobile chat interface is unusable,
   * and it is invisible on a desktop browser at any width.
   *
   * `visualViewport` is the part of the page that is actually visible. Its
   * height is written to a custom property and the module is sized to that,
   * so the timeline shortens and the composer rides up with the keyboard.
   *
   * -- Three details that matter -------------------------------------------
   *
   * · `offsetTop` is added back, because iOS scrolls the *layout* viewport up
   *   when the keyboard opens, and a height alone would leave the module
   *   ending above the fold.
   * · It is written to the element rather than kept in React state: this
   *   fires on every frame of the keyboard animation, and a re-render per
   *   frame would drop the animation on the devices that need it most.
   * · Desktop is left alone entirely. There is no keyboard to make room for,
   *   and a viewport-sized module would fight the shell.
   */
  const moduleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    const el = moduleRef.current;
    if (!isMobile || !vv || !el) {
      moduleRef.current?.style.removeProperty('height');
      return;
    }

    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.height = `${Math.round(vv.height + vv.offsetTop)}px`;
      });
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      el.style.removeProperty('height');
    };
  }, [isMobile]);
  /** `Ctrl`/`Cmd` + `K` opens search from anywhere in the module. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Somebody opened a conversation or a meeting from another module.
   *
   * There are no per-record routes here - modules are swapped by id inside one
   * page - so this is how the CRM's client panel or a project workspace hands
   * over. Delivered once and cleared, or the module would reopen the same
   * record every time it remounted.
   */
  useFocusRequest('communication', ({ type, id }) => {
    if (type === 'channel') { setView('messages'); setSelectedId(id); }
    if (type === 'meeting') {
      setView('meetings');
      /**
       * The id is enough, and it used to not be.
       *
       * This looked the meeting up in whatever `meetings` happened to hold and
       * did nothing at all if it was not there - which is the ordinary case
       * when the module has just mounted to serve the request. Now the room
       * opens on the row as soon as the list carries it, and the refetch is
       * asked for rather than hoped for.
       */
      setActiveMeetingId(id);
      void loadMeetings();
    }
  });

  /**
   * Stable handles for the room.
   *
   * Written inline they were a new function on every render of this module -
   * which is often - and the room holds both in effect dependency lists. That
   * turned "join this meeting" into a POST several times a second and the host
   * starting a scheduled meeting into a PATCH storm.
   */
  /**
   * Leaving the room is when the list behind it is caught up.
   *
   * The room used to refresh this module on every event inside a meeting - a
   * raised hand, a camera toggled - each one an aggregate query for a sidebar
   * hidden behind a full-screen overlay. Once, here, is the same information at
   * a fraction of the cost, and it lands before anybody can look at it.
   */
  const closeMeeting = useCallback(() => {
    setActiveMeetingId(null);
    void loadMeetings();
    void loadChannels();
  }, [loadMeetings, loadChannels]);
  const openMeetingRoom = useCallback(
    (meeting: MeetingRow) => setActiveMeetingId(meeting.meetingId), []);
  const refreshMeetings = useCallback(() => {
    void loadMeetings();
    void loadChannels();
  }, [loadMeetings, loadChannels]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const toggleThread = useCallback(async (message: Message, force = false) => {
    if (openThread === message.id && !force) { setOpenThread(null); return; }
    setOpenThread(message.id);
    if (threadReplies[message.id] && !force) return;
    try {
      const replies = await api<Message[]>(
        `/api/communication/messages?channelId=${message.channelId}&parentId=${message.id}&pageSize=100`,
      );
      // Oldest-first: a thread reads as a conversation, unlike the scrollback.
      setThreadReplies(prev => ({ ...prev, [message.id]: [...(replies ?? [])].reverse() }));
    } catch (err: any) {
      toast.error(err.message || 'Could not load that thread');
    }
  }, [openThread, threadReplies]);

  const send = useCallback(async (payload: {
    body: string;
    mentions: string[];
    files: { bucket: string; path: string; filename: string; mimeType: string | null; sizeBytes: number }[];
    attachments: RecordReference[];
  }) => {
    if (!selectedId) return;
    const replying = replyTo;
    try {
      const created = await api<Message>('/api/communication/messages', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          channelId: selectedId,
          // A reply carries the message it answers. The GET already separates
          // roots from replies, so nothing else has to change to make threads
          // work - only the composer has to say which it is sending.
          parentId: replying?.id ?? null,
        }),
      });
      // A reply belongs in its thread, not at the end of the main timeline -
      // which is what the endpoint's `parent_id IS NULL` filter already means.
      if (!replying) {
        setMessages(prev => [...prev, created]);
        setAtBottom(true);
      }
      setChannels(prev => prev.map(c => c.channelId === selectedId
        ? {
            ...c,
            lastMessage: payload.body || (payload.files.length ? 'Shared a file' : 'Shared a link'),
            lastMessageAt: created.createdAt,
            messageCount: c.messageCount + 1,
          }
        : c));
      if (replying) { await toggleThread(replying, true); setReplyTo(null); }
    } catch (err: any) {
      toast.error(err.message || 'Could not send that');
      throw err;
    }
  }, [selectedId, replyTo, toggleThread]);

  const editMessage = useCallback(async (message: Message, body: string) => {
    try {
      await api(`/api/communication/messages/${message.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      /**
       * Patched in place rather than refetched.
       *
       * The exception to this file's usual rule: the author is looking straight
       * at the line they just changed, and a refetch would rebuild the whole
       * thread and lose their scroll position for a one-word correction. The
       * realtime subscription still carries the change to everyone else.
       */
      setMessages(prev => prev.map(m =>
        m.id === message.id ? { ...m, body, editedAt: new Date().toISOString() } : m));
    } catch (err: any) {
      toast.error(err.message || 'Could not edit that message');
      throw err;
    }
  }, []);

  const togglePin = useCallback(async (message: Message) => {
    try {
      await api(`/api/communication/messages/${message.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPinned: !message.isPinned }),
      });
      setMessages(prev => prev.map(m =>
        m.id === message.id ? { ...m, isPinned: !m.isPinned } : m));
      setChannels(prev => prev.map(c => c.channelId === selectedId
        ? { ...c, pinnedCount: c.pinnedCount + (message.isPinned ? -1 : 1) } : c));
    } catch (err: any) {
      toast.error(err.message || 'Could not update the pin');
    }
  }, [selectedId]);

  const react = useCallback(async (message: Message, emoji: string) => {
    try {
      const result = await api<{ reactions: { emoji: string; memberId: string }[] }>(
        `/api/communication/messages/${message.id}/reactions`,
        { method: 'POST', body: JSON.stringify({ emoji }) },
      );
      setMessages(prev => prev.map(m =>
        m.id === message.id ? { ...m, reactions: result.reactions } : m));
    } catch (err: any) {
      toast.error(err.message || 'Could not react');
    }
  }, []);

  const deleteMessage = useCallback(async (message: Message) => {
    try {
      await api(`/api/communication/messages/${message.id}`, { method: 'DELETE' });
      setMessages(prev => prev.filter(m => m.id !== message.id));
    } catch (err: any) {
      toast.error(err.message || 'Could not delete that');
    }
  }, []);

  const createChannel = useCallback(async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/api/communication/channels', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setCreateOpen(false);
      await loadChannels(created.id);
      toast.success('Channel created');
    } catch (err: any) {
      toast.error(err.message || 'Could not create the channel');
    } finally {
      setBusy(false);
    }
  }, [loadChannels]);

  const startDirect = useCallback(async (memberId: string) => {
    setBusy(true);
    try {
      const channel = await api<{ id: string }>('/api/communication/direct', {
        method: 'POST',
        body: JSON.stringify({ memberId }),
      });
      setDmOpen(false);
      setMembersOpen(false);
      setView('messages');
      await loadChannels(channel.id);
    } catch (err: any) {
      toast.error(err.message || 'Could not open that conversation');
    } finally {
      setBusy(false);
    }
  }, [loadChannels]);

  const addMembers = useCallback(async (memberIds: string[]) => {
    if (!selectedId || !memberIds.length) return;
    setBusy(true);
    try {
      await api(`/api/communication/channels/${selectedId}/members`, {
        method: 'POST',
        body: JSON.stringify({ memberIds }),
      });
      setMembers(await api<ChannelMember[]>(`/api/communication/channels/${selectedId}/members`));
      await loadChannels(selectedId);
      toast.success(memberIds.length === 1 ? 'Person added' : `${memberIds.length} people added`);
    } catch (err: any) {
      toast.error(err.message || 'Could not add them');
    } finally {
      setBusy(false);
    }
  }, [selectedId, loadChannels]);

  const removeMember = useCallback(async (memberId: string) => {
    if (!selectedId) return;
    try {
      await api(`/api/communication/channels/${selectedId}/members?memberId=${memberId}`, {
        method: 'DELETE',
      });
      setMembers(prev => prev.filter(m => m.memberId !== memberId));
      await loadChannels(selectedId);
    } catch (err: any) {
      toast.error(err.message || 'Could not remove them');
    }
  }, [selectedId, loadChannels]);

  const setMemberRole = useCallback(async (memberId: string, nextRole: string) => {
    if (!selectedId) return;
    try {
      await api(`/api/communication/channels/${selectedId}/members`, {
        method: 'PATCH',
        body: JSON.stringify({ memberId, role: nextRole }),
      });
      setMembers(prev => prev.map(m => m.memberId === memberId
        ? { ...m, role: nextRole as ChannelMember['role'] } : m));
    } catch (err: any) {
      toast.error(err.message || 'Could not change that role');
    }
  }, [selectedId]);

  /**
   * Silence a conversation.
   *
   * `channel_members.is_muted` has existed since 0003 and the members endpoint
   * has accepted it since 0017; nothing has ever set it or read it. Muting
   * removes the channel from the unread total the navigation badge is built
   * from - it does not mark anything read, and it never suppresses a mention.
   */
  const toggleMute = useCallback(async (channel: ChannelRow) => {
    try {
      await api(`/api/communication/channels/${channel.channelId}/members`, {
        method: 'PATCH',
        body: JSON.stringify({ isMuted: !channel.isMuted }),
      });
      setChannels(prev => prev.map(c =>
        c.channelId === channel.channelId ? { ...c, isMuted: !c.isMuted } : c));
      toast.success(channel.isMuted
        ? `Notifications on for ${channelLabel(channel)}`
        : `Muted ${channelLabel(channel)} - you will still be told when you are named`);
    } catch (err: any) {
      toast.error(err.message || 'Could not change that');
    }
  }, []);

  /**
   * Put a message on the shelf, or take it off.
   *
   * -- Why the icon moves before the request lands --------------------------
   *
   * Because it is a toggle a person presses and immediately looks away from,
   * and a bookmark that fills a third of a second later reads as a control
   * that did not work. The set is put back exactly as it was if the endpoint
   * refuses, which is the one case where an optimistic update has to be
   * undone rather than merely re-fetched.
   */
  const toggleSave = useCallback(async (message: Message) => {
    const wasSaved = savedIds.has(message.id);
    setSavedIds(prev => {
      const next = new Set(prev);
      if (wasSaved) next.delete(message.id); else next.add(message.id);
      return next;
    });

    try {
      if (wasSaved) {
        await api(`/api/communication/saved?messageId=${message.id}`, { method: 'DELETE' });
      } else {
        await api('/api/communication/saved', {
          method: 'POST',
          body: JSON.stringify({ messageId: message.id }),
        });
        toast.success('Saved', {
          description: 'Only you can see this. It is on Home under Saved.',
        });
      }
    } catch (err: any) {
      setSavedIds(prev => {
        const next = new Set(prev);
        if (wasSaved) next.add(message.id); else next.delete(message.id);
        return next;
      });
      toast.error(err.message || 'Could not save that');
    }
  }, [savedIds]);

  /**
   * Star a conversation.
   *
   * `channel_members.is_favourite` (0036). The other half of muting: it moves
   * a conversation to the top of the sidebar and changes nothing about what it
   * counts, which is the distinction that keeps starring from becoming a
   * second, quieter notification setting nobody can reason about.
   */
  const toggleFavourite = useCallback(async (channel: ChannelRow) => {
    if (!channel.isMember) {
      toast.message('Join this channel first', {
        description: 'Starring keeps a conversation at the top of your own list.',
      });
      return;
    }
    const next = !channel.isFavourite;
    setChannels(prev => prev.map(c =>
      c.channelId === channel.channelId ? { ...c, isFavourite: next } : c));
    try {
      await api(`/api/communication/channels/${channel.channelId}/members`, {
        method: 'PATCH',
        body: JSON.stringify({ isFavourite: next }),
      });
    } catch (err: any) {
      setChannels(prev => prev.map(c =>
        c.channelId === channel.channelId ? { ...c, isFavourite: !next } : c));
      toast.error(err.message || 'Could not change that');
    }
  }, []);

  const joinChannel = useCallback(async (channel: ChannelRow) => {
    try {
      await api(`/api/communication/channels/${channel.channelId}/members`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await loadChannels(channel.channelId);
      toast.success(`Joined ${channelLabel(channel)}`);
    } catch (err: any) {
      toast.error(err.message || 'Could not join');
    }
  }, [loadChannels]);

  const confirmLeave = useCallback(async () => {
    if (!leaveTarget) return;
    setBusy(true);
    try {
      await api(`/api/communication/channels/${leaveTarget.channelId}/members`, { method: 'DELETE' });
      setLeaveTarget(null);
      setSelectedId(null);
      await loadChannels();
      toast.success('You left the channel');
    } catch (err: any) {
      toast.error(err.message || 'Could not leave');
    } finally {
      setBusy(false);
    }
  }, [leaveTarget, loadChannels]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api(`/api/communication/channels/${deleteTarget.channelId}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setSelectedId(null);
      await loadChannels();
      toast.success('Channel deleted');
    } catch (err: any) {
      toast.error(err.message || 'Could not delete the channel');
    } finally {
      setBusy(false);
    }
  }, [deleteTarget, loadChannels]);

  const saveChannelSettings = useCallback(async (values: Record<string, unknown>) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api(`/api/communication/channels/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
      setSettingsOpen(false);
      await loadChannels(selectedId);
      toast.success('Channel updated');
    } catch (err: any) {
      toast.error(err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }, [selectedId, loadChannels]);

  /**
   * Take the reader to a message a search found.
   *
   * If it is in the open conversation and already loaded, scroll to it. If it
   * is not, the channel is opened and the message highlighted once it arrives.
   * The highlight is what makes a jump legible - landing in the middle of a
   * conversation with nothing marked is disorienting.
   */
  /**
   * How far back a jump will page in pursuit of one message.
   *
   * Search reaches the whole history; the timeline loads forty messages. So a
   * hit from three months ago opened its conversation, scrolled to the bottom
   * and highlighted nothing - the reader was left in the right room with no
   * idea where the thing they searched for had gone, which is the worst of
   * both: it looked like it had worked. `hunted` counts the pages walked back,
   * because "keep loading until you find it" on a busy channel is an
   * unbounded loop of requests.
   */
  const hunted = useRef(0);
  const gaveUpOn = useRef<string | null>(null);

  /**
   * Open a conversation from anywhere: the sidebar, Home, another module.
   *
   * Switching the view is part of it. Selecting a channel while Home is on
   * screen used to change what the Messages view *would* show and leave the
   * reader looking at Home, which reads as a click that did nothing.
   */
  const openConversation = useCallback((channelId: string) => {
    if (!channelId) return;
    setView('messages');
    setSelectedId(channelId);
  }, []);

  const openMessage = useCallback((channelId: string, messageId: string) => {
    setView('messages');
    hunted.current = 0;
    gaveUpOn.current = null;
    setHighlightId(messageId);
    setSelectedId(channelId);
  }, []);

  const jumpTo = useCallback(
    (hit: SearchHit) => openMessage(hit.channelId, hit.messageId), [openMessage]);

  useEffect(() => {
    if (!highlightId || messagesLoading) return;

    const el = document.getElementById(`message-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Cleared after the animation, so a message does not stay marked for the
      // rest of the session - and only once it has actually been shown.
      const timer = setTimeout(() => setHighlightId(null), 2600);
      return () => clearTimeout(timer);
    }

    if (loadingOlder || gaveUpOn.current === highlightId) return;

    if (olderCursor && hunted.current < 5) {
      hunted.current += 1;
      void loadOlder();
      return;
    }

    // Beyond reach: said out loud rather than left as a jump that silently
    // did nothing. The marker is deliberately left armed - if the reader keeps
    // scrolling back and reaches it, it still lights up.
    gaveUpOn.current = highlightId;
    toast.message('That message is further back than this conversation has loaded.', {
      description: 'Keep scrolling up and it will be marked when it appears.',
    });
  }, [highlightId, messagesLoading, messages, olderCursor, loadingOlder, loadOlder]);

  /**
   * Start a call in the open conversation.
   *
   * ── Why the room is opened from the refreshed list ───────────────────────
   *
   * The create endpoint answers with the `meetings` row. The room reads a row
   * of `meeting_overview()`, which is a different and much wider shape - the
   * host's name, the channel's label, the counts, whether the caller is the
   * host. Assembling one by hand from the insert would mean inventing half of
   * those, and every field invented here is a field that will disagree with
   * the server the moment either changes. So the id is remembered, the list is
   * refetched, and the room opens on the real row.
   */
  const startChannelMeeting = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/api/communication/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title: `${channelLabel(selected)} call`,
          channelId: selected.channelId,
          mode: 'video',
        }),
      });
      const rows = await api<MeetingRow[]>('/api/communication/meetings');
      setMeetings(rows);
      if (rows.some(m => m.meetingId === created.id)) {
        // Straight in. Pressing "start a call" is the decision the green room
        // exists to ask for, so asking again would be asking twice.
        startedByMe.current = created.id;
        setActiveMeetingId(created.id);
      }
      else toast.error('The call was started but could not be opened. It is in Meetings.');
    } catch (err: any) {
      toast.error(err.message || 'Could not start the call');
    } finally {
      setBusy(false);
    }
  }, [selected]);

  // ─── Derived ─────────────────────────────────────────────────────────────

  const visible = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    let list = channels;
    if (q) {
      list = list.filter(c =>
        channelLabel(c).toLowerCase().includes(q)
        || (c.topic ?? '').toLowerCase().includes(q)
        || (c.projectName ?? '').toLowerCase().includes(q)
        || (c.companyName ?? '').toLowerCase().includes(q));
    }
    if (filter === 'unread') list = list.filter(c => c.unreadCount > 0 || c.mentionCount > 0);
    return list;
  }, [channels, sidebarQuery, filter]);

  /**
   * The sidebar's four groups.
   *
   * Starred is first and cuts across the other three, which is the point: the
   * three rooms a person lives in are rarely all the same kind, and a sidebar
   * that sorts by kind before importance makes somebody scan three headings to
   * find the one conversation they open twenty times a day.
   */
  const groups = useMemo(() => ({
    starred: visible.filter(c => c.isFavourite),
    channels: visible.filter(c => !c.isFavourite && (c.type === 'public' || c.type === 'announcement')),
    private: visible.filter(c => !c.isFavourite && c.type === 'private'),
    direct: visible.filter(c => !c.isFavourite && c.type === 'direct'),
  }), [visible]);

  /**
   * The same sentence the two endpoints use.
   *
   * `/api/communication/channels` returns this in `meta.unreadTotal` and
   * `/api/notifications` composes the sidebar badge from it. Three copies of
   * a rule is three badges that eventually disagree in front of somebody, so
   * the rule is written the same way in all three: muting silences a
   * conversation's count, and never silences being named in it.
   */
  const unreadTotal = channels.reduce(
    (sum, c) => sum + (c.isMuted ? c.mentionCount : c.unreadCount), 0);
  const mentionTotal = channels.reduce((sum, c) => sum + c.mentionCount, 0);
  const liveMeetings = meetings.filter(m => m.status === 'live').length;

  /**
   * The timeline is the timeline.
   *
   * It used to be filterable down to pinned messages in place, which looked
   * like a view of the pinned messages and was a view of the pinned messages
   * among the forty already loaded. The details rail answers that question
   * properly now, against the endpoint, so the timeline no longer pretends to.
   */
  const shown = messages;

  // Whether the composer is offered at all. The server decides for real; this
  // is so a read-only channel does not present a box that will be refused.
  const canPost = !!selected && !selected.isArchived && (
    selected.postPolicy === 'everyone' ? (selected.type === 'public' || selected.isMember)
      : selected.postPolicy === 'members' ? selected.isMember
      : selected.isAdmin
  );

  const notInChannel = directory.filter(d => !members.some(m => m.memberId === d.memberId));

  /**
   * The person on the other side of a direct conversation.
   *
   * Resolved from the roster rather than from the channel row, because the
   * roster is what carries the job title - the overview row carries only the
   * name and the avatar. Falls back to the directory, which is loaded for
   * everybody in the organisation and is what covers the moment between
   * opening a conversation and its members arriving.
   */
  const isDirect = selected?.type === 'direct';
  const counterpartId = isDirect ? selected?.counterpartId ?? null : null;
  const counterpart = counterpartId
    ? members.find(m => m.memberId === counterpartId)
      ?? directory.find(d => d.memberId === counterpartId)
    : undefined;

  // ─── Render ──────────────────────────────────────────────────────────────

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 className="text-lg font-semibold">Communication</h2>
        <div className="flex items-center gap-0.5">
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setSearchOpen(true)}>
                  <Search className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search every conversation · Ctrl+F</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setDmOpen(true)}>
                  <UserPlus className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Message a colleague</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New channel</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Home, Messages and Meetings are three views of one module rather than
          three modules: a meeting is a conversation with a time attached, and
          the channel a team talks in is the channel they meet in. */}
      <div className="mx-3 mb-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {([
          ['home', 'Home', 0],
          ['messages', 'Messages', unreadTotal],
          ['meetings', 'Meetings', liveMeetings],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={cn(
              'relative rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
              view === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {count > 0 && (
              <span className={cn(
                'ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1',
                'text-[10px] font-semibold tabular-nums',
                id === 'meetings'
                  ? 'bg-destructive text-white'
                  : 'bg-primary text-primary-foreground',
              )}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/*
        The conversation list is the module's navigation, so it stays for Home
        as well as for Messages.

        It was gated on `view === 'messages'`, which left two thirds of the
        sidebar empty whenever Home was open - and Home is what the module now
        opens on, so that was the first thing anybody saw. It is also simply
        wrong as navigation: the list is how you get *to* a conversation, and
        hiding it on the landing screen means the landing screen is the one
        place you cannot.
      */}
      {view !== 'meetings' && (
        <>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter conversations…"
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
                className="h-8 pl-9 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 px-3 pb-2">
            {([['all', 'All'], ['unread', 'Unread']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                  filter === id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
                {id === 'unread' && unreadTotal > 0 && ` (${unreadTotal})`}
              </button>
            ))}
            {mentionTotal > 0 && (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-brand/12 px-2 py-0.5 text-xs font-medium text-brand">
                <AtSign className="size-3" /> {mentionTotal}
              </span>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1 px-2">
            {channelsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : visible.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {filter === 'unread' ? 'Nothing unread. '
                    : sidebarQuery ? 'Nothing matches that.'
                    : 'No conversations yet.'}
                </p>
                {!sidebarQuery && filter === 'all' && (
                  <Button variant="outline" size="sm" className="mt-3 gap-1.5"
                    onClick={() => setCreateOpen(true)}>
                    <Plus className="size-3.5" /> New channel
                  </Button>
                )}
              </div>
            ) : (
              <>
                <ChannelGroup label="Starred" rows={groups.starred} selectedId={selectedId}
                  onSelect={openConversation} presence={presence} inCall={inCall}
                  onToggleFavourite={toggleFavourite} />
                <ChannelGroup label="Channels" rows={groups.channels} selectedId={selectedId}
                  onSelect={openConversation} presence={presence} inCall={inCall}
                  onToggleFavourite={toggleFavourite} />
                <ChannelGroup label="Private" rows={groups.private} selectedId={selectedId}
                  onSelect={openConversation} presence={presence} inCall={inCall}
                  onToggleFavourite={toggleFavourite} />
                <ChannelGroup label="Direct messages" rows={groups.direct} selectedId={selectedId}
                  onSelect={openConversation} presence={presence} inCall={inCall}
                  onToggleFavourite={toggleFavourite} />
              </>
            )}
          </ScrollArea>
        </>
      )}

      {view === 'meetings' && (
        <div className="flex-1 px-4 py-2 text-sm text-muted-foreground">
          <p>
            {meetings.length === 0
              ? 'No meetings yet.'
              : `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`}
          </p>
          {liveMeetings > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-destructive">
              <Radio className="size-3.5" /> {liveMeetings} happening now
            </p>
          )}
        </div>
      )}

      <div className="border-t px-3 py-2">
        <button
          type="button"
          onClick={() => setSavedOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bookmark className="size-4 shrink-0" /> Saved
        </button>
        <p className="px-1.5 pt-1.5 text-xs text-muted-foreground">
          <span className={cn('mr-1.5 inline-block size-2 rounded-full',
            onlineCount > 0 ? 'bg-brand' : 'bg-muted-foreground/40')} />
          {onlineCount} online
        </p>
        {/* Said plainly rather than hidden. Somebody who knows updates are on
            a timer waits differently from somebody who believes nothing has
            been said. */}
        {degraded && (
          <p className="mt-1 flex items-center gap-1.5 px-1.5 text-[11px] text-warning">
            <Radio className="size-3 shrink-0" />
            Live updates are blocked here. Checking every few seconds instead.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div ref={moduleRef} className="flex h-full overflow-hidden">
      {isMobile && showSidebar && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowSidebar(false)} />
      )}

      <aside
        className={cn(
          'flex w-72 shrink-0 flex-col border-r bg-card',
          isMobile && 'fixed inset-y-0 left-0 z-50 transition-transform',
          isMobile && !showSidebar && '-translate-x-full',
          isMobile && showSidebar && 'translate-x-0',
        )}
      >
        {sidebar}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {view === 'home' ? (
          <Home
            channels={channels}
            meetings={meetings}
            presence={presence}
            inCall={inCall}
            reloadKey={homeKey}
            greeting={firstName}
            onOpenChannel={openConversation}
            onOpenMessage={openMessage}
            onOpenMeeting={(m) => {
              // A meeting that is running is joined; one that is not is read
              // about in the list, where its agenda and guests are.
              if (m.status === 'live') setActiveMeetingId(m.meetingId);
              else setView('meetings');
            }}
            onOpenMeetings={() => setView('meetings')}
            onNewChannel={() => setCreateOpen(true)}
            onNewDirect={() => setDmOpen(true)}
            onSchedule={() => setScheduleOpen(true)}
            onSearch={(seed) => { setSearchSeed(seed ?? ''); setSearchOpen(true); }}
            onOpenSaved={() => setSavedOpen(true)}
          />
        ) : view === 'meetings' ? (
          <MeetingsView
            meetings={meetings}
            channels={channels}
            directory={directory}
            loading={meetingsLoading}
            currentMemberId={currentMemberId}
            onRefresh={refreshMeetings}
            onOpenRoom={openMeetingRoom}
            onOpenChannel={openConversation}
          />
        ) : !selected ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              title="No conversation open"
              description="Choose one from the sidebar, start a channel, or message a colleague."
              action={{ label: 'New channel', onClick: () => setCreateOpen(true) }}
            />
          </div>
        ) : (
          <>
            {/*
              ─── Header ───

              Two headers in one, and the difference is the point. A direct
              conversation is with a *person*, so it leads with their face,
              their presence and what they do; a channel is a *place*, so it
              leads with its glyph, its topic and who is in it. Drawing both
              the same way was the single largest reason a direct message
              looked plain: it wore a channel's chrome and had none of a
              channel's information to put in it.
            */}
            <div className="flex items-center justify-between gap-2 border-b bg-card/40 px-3 py-2.5 sm:px-4">
              {isMobile && (
                <Button variant="ghost" size="icon" className="-ml-1 size-9 shrink-0"
                  onClick={() => setShowSidebar(true)} aria-label="Conversations">
                  <Menu className="size-4" />
                </Button>
              )}
              <button
                onClick={() => setPanelOpen(v => !v)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-0.5 pr-2 text-left transition-colors hover:bg-accent/60"
                aria-label="Show conversation details"
                aria-expanded={panelOpen}
              >
                {isDirect && counterpartId ? (
                  <PersonAvatar
                    id={counterpartId}
                    name={selected.counterpartName}
                    src={selected.counterpartAvatar}
                    size="md"
                    presence={presence[counterpartId]?.presence ?? 'offline'}
                    lastSeenAt={presence[counterpartId]?.lastSeenAt}
                    inCall={inCall.includes(counterpartId)}
                    decorative
                  />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <ChannelGlyph type={selected.type} className="size-4" />
                  </span>
                )}

                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <h3 className="truncate text-sm font-semibold">{channelLabel(selected)}</h3>
                    {selected.isFavourite && (
                      <Star className="size-3 shrink-0 fill-current text-brand" />
                    )}
                    {selected.isMuted && (
                      <BellOff className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    {selected.isArchived && (
                      <Badge variant="outline" className="h-4 gap-1 px-1 text-[9px]">
                        <Archive className="size-2.5" /> Archived
                      </Badge>
                    )}
                  </span>

                  {/*
                    The second line. For a person it is who they are and
                    whether they are there; for a room it is how many people
                    and what it is for.
                  */}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {isDirect ? (
                      <>
                        {counterpart?.jobTitle && (
                          <span className="truncate">{counterpart.jobTitle}</span>
                        )}
                        {counterpart?.jobTitle && <span aria-hidden>·</span>}
                        <span className="shrink-0">
                          {counterpartId && inCall.includes(counterpartId)
                            ? 'In a meeting'
                            : presenceWords(
                                presence[counterpartId ?? '']?.presence,
                                presence[counterpartId ?? '']?.lastSeenAt,
                              )}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex shrink-0 items-center gap-1">
                          <Users className="size-3" />{selected.memberCount}
                        </span>
                        {(selected.topic || selected.description) && (
                          <span className="truncate">
                            · {selected.topic || selected.description}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </span>
              </button>

              <div className="flex shrink-0 items-center">
                {/*
                  What this conversation is about.

                  Clicking opens the record in its own module. This is the
                  whole point of the module being part of an operating system
                  rather than beside one: the discussion and the work are one
                  click apart in both directions.
                */}
                <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
                  {selected.projectName && selected.projectId && (
                    <ContextChip
                      icon={<FolderKanban className="size-3" />}
                      label={selected.projectName}
                      onClick={() => openRecord('projects', 'project', selected.projectId!)}
                    />
                  )}
                  {selected.companyName && selected.companyId && (
                    <ContextChip
                      icon={<Building2 className="size-3" />}
                      label={selected.companyName}
                      onClick={() => openRecord('crm', 'company', selected.companyId!)}
                    />
                  )}
                  {selected.departmentName && (
                    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {selected.departmentName}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {/* A live meeting in this channel is the most useful thing the
                    header can say, so it displaces the ordinary call button. */}
                {selected.liveMeetingId ? (
                  <Button
                    size="sm"
                    className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
                    onClick={() => {
                      // The channel row can know about a meeting before the
                      // list has caught up with it, so the id is taken on trust
                      // and the list is asked to catch up - the click is never
                      // dropped, which is what the old `if (found)` did.
                      setActiveMeetingId(selected.liveMeetingId);
                      void loadMeetings();
                    }}
                  >
                    <Radio className="size-3.5" /> Join call
                  </Button>
                ) : canPost && (
                  <TooltipProvider delayDuration={400}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8"
                          disabled={busy} onClick={() => void startChannelMeeting()}>
                          <Video className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Start a call in this conversation</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {/*
                  The details rail, in place of the old pinned-messages toggle.

                  That toggle filtered the forty messages already loaded, so a
                  channel reporting "4 pinned" could show two of them and give
                  no sign that the others existed. The rail's Pinned tab asks
                  the endpoint for the pinned messages, which is the only
                  version of that feature that is true.
                */}
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={panelOpen ? 'secondary' : 'ghost'}
                        size="icon" className="relative size-8"
                        aria-pressed={panelOpen}
                        onClick={() => setPanelOpen(v => !v)}
                      >
                        <PanelRight className="size-4" />
                        {selected.pinnedCount > 0 && !panelOpen && (
                          <span className="absolute right-0.5 top-0.5 flex size-1.5 rounded-full bg-warning" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {panelOpen ? 'Hide details' : 'People, pinned and files'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => setMembersOpen(true)}>
                      <Users className="mr-2 size-4" /> Participants
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                      <Video className="mr-2 size-4" /> Schedule a meeting
                    </DropdownMenuItem>
                    {selected.isMember && (
                      <DropdownMenuItem onClick={() => void toggleMute(selected)}>
                        {selected.isMuted
                          ? <><Bell className="mr-2 size-4" /> Unmute</>
                          : <><BellOff className="mr-2 size-4" /> Mute this conversation</>}
                      </DropdownMenuItem>
                    )}
                    {selected.isAdmin && selected.type !== 'direct' && (
                      <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                        <Settings className="mr-2 size-4" /> Channel settings
                      </DropdownMenuItem>
                    )}
                    {!selected.isMember && selected.joinPolicy === 'open' && selected.type !== 'direct' && (
                      <DropdownMenuItem onClick={() => void joinChannel(selected)}>
                        <UserPlus className="mr-2 size-4" /> Join channel
                      </DropdownMenuItem>
                    )}
                    {selected.isMember && selected.type !== 'direct' && (
                      <DropdownMenuItem onClick={() => setLeaveTarget(selected)}>
                        <LogOut className="mr-2 size-4" /> Leave channel
                      </DropdownMenuItem>
                    )}
                    {selected.isAdmin && selected.type !== 'direct' && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(selected)}>
                          <Trash2 className="mr-2 size-4" /> Delete channel
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* ─── Messages ─── */}
            <div className="relative min-h-0 flex-1">
              {messagesLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : shown.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    icon={MessageSquare}
                    title="No messages yet"
                    description={canPost
                      ? 'Be the first to say something.'
                      : 'Nothing has been posted here yet.'}
                  />
                </div>
              ) : (
                <div
                  ref={scrollRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
                    // Reaching the top asks for the previous page. A sentinel
                    // and an IntersectionObserver would be the tidier version
                    // and buys nothing here - this fires at most once per
                    // scroll gesture, and `loadingOlder` guards the rest.
                    if (el.scrollTop < 80 && olderCursor && !loadingOlder) void loadOlder();
                  }}
                  className="h-full overflow-y-auto"
                >
                  <div className="flex flex-col gap-0.5 p-4">
                    {olderCursor && (
                      <div className="flex justify-center py-2">
                        <Button variant="ghost" size="sm" className="gap-1.5 text-xs"
                          disabled={loadingOlder} onClick={() => void loadOlder()}>
                          {loadingOlder
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <ChevronDown className="size-3.5 rotate-180" />}
                          Earlier messages
                        </Button>
                      </div>
                    )}
                    {!olderCursor && messages.length > 0 && (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        This is the beginning of {channelLabel(selected)}.
                      </p>
                    )}

                    {shown.map((message, index) => {
                      const previous = shown[index - 1];
                      const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
                      /**
                       * Grouped when the same person says two things in a row
                       * within a few minutes. Any longer and they are separate
                       * thoughts that deserve their own header - a reply four
                       * hours later reading as part of the previous message is
                       * how a conversation becomes hard to follow.
                       */
                      const consecutive = !newDay
                        && previous?.senderId === message.senderId
                        && new Date(message.createdAt).getTime()
                           - new Date(previous.createdAt).getTime() < 5 * 60_000;
                      const isFirstUnread = !!unreadFrom
                        && message.createdAt > unreadFrom
                        && (!previous || previous.createdAt <= unreadFrom);

                      return (
                        <div key={message.id}>
                          {newDay && <DaySeparator label={dayLabel(message.createdAt)} />}
                          {isFirstUnread && <NewMessagesDivider />}
                          <MessageBubble
                            message={message}
                            channel={selected}
                            thread={threads[message.id]}
                            isSaved={savedIds.has(message.id)}
                            onToggleSave={() => void toggleSave(message)}
                            onTurnInto={(destination) => {
                              setActionTarget({
                                message,
                                channel: selected,
                                senderName: message.sender?.profiles?.fullName || 'Someone',
                              });
                              setActionDestination(destination);
                            }}
                            onScheduleMeeting={() => {
                              // The message becomes the meeting's agenda, so
                              // the invitation says what it is about without
                              // anybody retyping the sentence that prompted it.
                              const plain = plainPreview(message.body).trim();
                              setMeetingSeed({
                                title: truncate(plain.split('\n')[0] || `${channelLabel(selected)} call`, 80),
                                agenda: plain
                                  ? `From ${message.sender?.profiles?.fullName || 'a message'} in ${channelLabel(selected)}:\n\n${plain}`
                                  : '',
                              });
                              setScheduleOpen(true);
                            }}
                            isOwn={!!currentMemberId && message.senderId === currentMemberId}
                            isConsecutive={consecutive && !isFirstUnread}
                            currentMemberId={currentMemberId}
                            canModerate={selected.isAdmin || isOrgAdmin}
                            canEdit={policy.allowMessageEdit && (
                              policy.editWindowMinutes === 0
                              || (Date.now() - new Date(message.createdAt).getTime())
                                 / 60_000 <= policy.editWindowMinutes)}
                            canDelete={policy.allowMessageDelete}
                            members={members}
                            highlighted={highlightId === message.id}
                            onTogglePin={() => void togglePin(message)}
                            onReact={(emoji) => void react(message, emoji)}
                            onDelete={() => void deleteMessage(message)}
                            onReply={() => setReplyTo(message)}
                            onEdit={(body) => editMessage(message, body)}
                            onToggleThread={() => void toggleThread(message)}
                            threadOpen={openThread === message.id}
                            replies={threadReplies[message.id]}
                          />
                        </div>
                      );
                    })}
                    <div ref={endRef} />
                  </div>
                </div>
              )}

              {/* Back to the newest. Appears only when the reader has scrolled
                  away, because a button that is always there is a button that
                  means nothing. */}
              {!atBottom && !messagesLoading && shown.length > 0 && (
                <Button
                  size="sm"
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 gap-1.5 rounded-full shadow-lg"
                  onClick={() => { setAtBottom(true); endRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
                >
                  <ArrowDown className="size-3.5" /> Latest
                </Button>
              )}
            </div>

            {/* Who is typing. Above the composer and outside it, so the input
                does not move when somebody starts or stops - a text box that
                jumps while you are typing in it is worse than no indicator. */}
            <div className="h-5 px-4 text-xs text-muted-foreground" aria-live="polite">
              {typing.length > 0 && (
                <span className="italic">
                  {typing.length === 1
                    ? `${typing[0].name} is typing…`
                    : typing.length === 2
                      ? `${typing[0].name} and ${typing[1].name} are typing…`
                      : `${typing.length} people are typing…`}
                </span>
              )}
            </div>

            {canPost ? (
              <Composer
                /*
                  Remounted per conversation, which is what makes the draft map
                  work and what stops half a sentence typed in one channel
                  being one Return away from posting in another.
                */
                key={selected.channelId}
                channel={selected}
                members={members}
                currentMemberId={currentMemberId}
                organizationId={organizationId}
                maxAttachmentMb={policy.maxAttachmentMb}
                drafts={drafts}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onSend={send}
                onTyping={signalTyping}
              />
            ) : (
              <div className="border-t p-4">
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {selected.isArchived
                      ? 'This channel is archived. Its history stays readable.'
                      : selected.postPolicy === 'admins'
                        ? 'Only administrators can post in this channel.'
                        : 'Join this channel to take part.'}
                  </p>
                  {!selected.isMember && !selected.isArchived
                    && selected.joinPolicy === 'open' && selected.type !== 'direct' && (
                    <Button size="sm" variant="outline" className="gap-1.5"
                      onClick={() => void joinChannel(selected)}>
                      <UserPlus className="size-3.5" /> Join
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/*
        The details rail.

        Rendered beside the conversation on a wide screen and over it on a
        phone, which is the same component either way: a second navigation
        concept for small screens is how a module ends up with two behaviours
        to maintain and one of them broken.
      */}
      {view === 'messages' && selected && panelOpen && (
        <ConversationPanel
          channel={selected}
          members={members}
          presence={presence}
          currentMemberId={currentMemberId}
          isMobile={isMobile}
          onClose={() => setPanelOpen(false)}
          onOpenMessage={(id) => openMessage(selected.channelId, id)}
          onManageMembers={() => setMembersOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onToggleFavourite={() => void toggleFavourite(selected)}
          onToggleMute={() => void toggleMute(selected)}
        />
      )}

      {/* --- Dialogs --- */}
      <CreateChannelDialog
        key={createOpen ? 'create-open' : 'create-closed'}
        open={createOpen}
        onOpenChange={setCreateOpen}
        directory={directory.filter(d => d.memberId !== currentMemberId)}
        isOrgAdmin={isOrgAdmin}
        projects={projects}
        companies={companies}
        onSubmit={createChannel}
        isSaving={busy}
      />

      <DirectMessageDialog
        key={dmOpen ? 'dm-open' : 'dm-closed'}
        open={dmOpen}
        onOpenChange={setDmOpen}
        directory={directory.filter(d => d.memberId !== currentMemberId)}
        onPick={startDirect}
        isSaving={busy}
      />

      <MembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        channel={selected}
        members={members}
        candidates={notInChannel}
        currentMemberId={currentMemberId}
        onAdd={addMembers}
        onRemove={removeMember}
        onSetRole={setMemberRole}
        onMessage={startDirect}
        isSaving={busy}
      />

      <ChannelSettingsDialog
        key={selected ? `settings-${selected.channelId}-${settingsOpen}` : 'settings-closed'}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        channel={selected}
        isOrgAdmin={isOrgAdmin}
        projects={projects}
        companies={companies}
        onSubmit={saveChannelSettings}
        isSaving={busy}
      />

      <SearchDialog
        // Remounted per opening, so the seed from Home's field lands once.
        key={searchOpen ? `search-${searchSeed}` : 'search-closed'}
        open={searchOpen}
        onOpenChange={(open) => { setSearchOpen(open); if (!open) setSearchSeed(''); }}
        seed={searchSeed}
        channels={channels}
        directory={directory}
        onJump={jumpTo}
        onOpenChannel={openConversation}
        onStartDirect={startDirect}
      />

      <ScheduleMeetingDialog
        key={scheduleOpen ? 'schedule-open' : 'schedule-closed'}
        open={scheduleOpen}
        onOpenChange={(open) => { setScheduleOpen(open); if (!open) setMeetingSeed(null); }}
        channels={channels}
        directory={directory.filter(d => d.memberId !== currentMemberId)}
        defaultChannelId={selectedId}
        seed={meetingSeed}
        onCreated={() => {
          setScheduleOpen(false);
          setMeetingSeed(null);
          void loadMeetings();
          setView('meetings');
        }}
      />

      {/*
        Turning a message into work, and the shelf.

        Both mounted once by the module rather than once per message: forty
        bubbles each carrying a form is forty components with state and effects
        for a panel almost nobody has open.
      */}
      <MessageActionDialog
        target={actionTarget}
        destination={actionDestination}
        onOpenChange={(open) => {
          if (!open) { setActionTarget(null); setActionDestination(null); }
        }}
      />

      <SavedPanel
        open={savedOpen}
        onOpenChange={(open) => { setSavedOpen(open); if (!open) void loadSaved(); }}
        onOpenMessage={openMessage}
      />

      <ConfirmDialog
        open={!!leaveTarget}
        onOpenChange={(open) => !open && setLeaveTarget(null)}
        title="Leave channel"
        description={`Leave ${leaveTarget ? channelLabel(leaveTarget) : ''}? You can rejoin if it is open to everyone.`}
        confirmLabel="Leave"
        onConfirm={confirmLeave}
        isLoading={busy}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete channel"
        description={`Delete ${deleteTarget ? channelLabel(deleteTarget) : ''} and every message in it? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={busy}
      />

      {/*
        The room takes an id, not a row.

        It used to be rendered only while `meetings` happened to contain the
        row, which made every background refetch of that list able to unmount a
        meeting somebody was sitting in - closing their peer connections and
        stopping their camera. The room fetches its own row now; the one below
        is a seed so that opening from the list is instant.
      */}
      {activeMeetingId && (
        <MeetingRoom
          // Keyed by the meeting, so leaving one and joining another is a fresh
          // room rather than the previous room's state re-labelled.
          key={activeMeetingId}
          meetingId={activeMeetingId}
          initial={activeMeeting ?? undefined}
          currentMemberId={currentMemberId}
          directory={directory}
          autoJoin={startedByMe.current === activeMeetingId}
          onClose={closeMeeting}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sidebar
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Presence as a sentence, for a conversation header.
 *
 * The dot on the avatar is the glanceable version and this is the one you can
 * read: "Away" on its own invites the question this answers. Deliberately the
 * same three states the shared `PresenceDot` uses, worded rather than coloured,
 * so nothing here can drift from what the dot beside it claims.
 */
function presenceWords(
  presence: 'online' | 'away' | 'offline' | undefined,
  lastSeenAt: string | null | undefined,
): string {
  if (presence === 'online') return 'Online';
  if (presence === 'away') return 'Away';
  return lastSeenAt ? `Last seen ${formatRelativeTime(lastSeenAt)}` : 'Offline';
}

function ContextChip({
  icon, label, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex max-w-[10rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function ChannelGroup({
  label, rows, selectedId, onSelect, presence, inCall, onToggleFavourite,
}: {
  label: string;
  rows: ChannelRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Presence by member id, for direct messages.
   *
   * A direct conversation is with a person, so whether that person is at their
   * desk is the single most useful thing the sidebar row can say: it is the
   * difference between asking now and leaving a note.
   */
  presence: Record<string, PresenceRow>;
  /** Membership ids currently joined to a live meeting. */
  inCall: string[];
  onToggleFavourite: (channel: ChannelRow) => void;
}) {
  if (!rows.length) return null;

  return (
    <div className="mb-3">
      <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      {rows.map(channel => {
        const active = channel.channelId === selectedId;
        const unread = channel.unreadCount > 0 || channel.mentionCount > 0;
        /**
         * The other person is on a call.
         *
         * Not a presence state, on purpose: this is derived from
         * `meeting_participants` and shown only in this module, so the shared
         * dot keeps meaning one thing everywhere else in the product.
         */
        const busy = channel.type === 'direct'
          && !!channel.counterpartId
          && inCall.includes(channel.counterpartId);

        return (
          <div
            key={channel.channelId}
            className={cn(
              'group relative flex items-center rounded-md transition-colors',
              // A neutral fill for the selected row, as the shell's navigation
              // uses: an accent-filled row in a list of forty is the fastest
              // way to lose the one accent the module is allowed.
              active ? 'bg-accent' : 'hover:bg-muted',
            )}
          >
            <button
              onClick={() => onSelect(channel.channelId)}
              aria-current={active ? 'true' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm"
            >
              {/* A direct message shows the other person's presence in place of
                  the generic person icon; everything else keeps its glyph. */}
              {channel.type === 'direct' && channel.counterpartId ? (
                <PresenceDot
                  presence={presence[channel.counterpartId]?.presence ?? 'offline'}
                  lastSeenAt={presence[channel.counterpartId]?.lastSeenAt}
                  className="ml-0.5 mr-0.5"
                />
              ) : (
                <ChannelGlyph type={channel.type}
                  className={active ? 'text-foreground' : undefined} />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn(
                    'flex min-w-0 items-center gap-1 truncate',
                    unread ? 'font-semibold text-foreground' : 'font-medium',
                    !unread && !active && 'text-muted-foreground',
                  )}>
                    <span className="truncate">{channelLabel(channel)}</span>
                    {channel.isMuted && <BellOff className="size-3 shrink-0 opacity-60" />}
                    {channel.liveMeetingId && <LivePip />}
                  </span>
                  {channel.lastMessageAt && (
                    <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden">
                      {formatRelativeTime(channel.lastMessageAt)}
                    </span>
                  )}
                </div>
                {(busy || channel.lastMessage !== null) && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {busy ? (
                      <span className="text-destructive">In a call</span>
                    ) : (
                      <>
                        {channel.lastSender && (
                          <span className="font-medium">{channel.lastSender}: </span>
                        )}
                        {truncate(plainPreview(channel.lastMessage ?? '') || 'Shared a file', 40)}
                      </>
                    )}
                  </p>
                )}
              </div>

              <UnreadPill
                unread={channel.unreadCount}
                mentions={channel.mentionCount}
                muted={channel.isMuted}
              />
            </button>

            {/*
              Starring, on the row itself.

              Revealed on hover and always reachable by keyboard, in the space
              the timestamp occupies when the pointer is elsewhere. Putting it
              in a menu would mean two clicks for the gesture that decides how
              the whole sidebar is ordered.
            */}
            {channel.isMember && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFavourite(channel); }}
                aria-label={channel.isFavourite ? 'Unstar this conversation' : 'Star this conversation'}
                aria-pressed={channel.isFavourite}
                className={cn(
                  'absolute right-1.5 rounded p-1 transition-opacity',
                  'hover:bg-background focus-visible:opacity-100',
                  channel.isFavourite
                    ? 'opacity-0 group-hover:opacity-100'
                    : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <Star className={cn(
                  'size-3.5',
                  channel.isFavourite ? 'fill-current text-brand' : 'text-muted-foreground',
                )} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
