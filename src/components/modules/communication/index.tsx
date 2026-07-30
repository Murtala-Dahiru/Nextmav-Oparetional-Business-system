'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Hash, Lock, User, Settings, Search, Send, Pin, PinOff, Plus,
  MoreHorizontal, SmilePlus, Menu, Loader2, MessageSquare, Users,
  UserPlus, LogOut, Megaphone, Trash2, Shield, X, Archive, Pencil,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatRelativeTime, initialsOf, truncate } from '@/lib/format';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/store/app-store';
import { useModuleRealtime, useRealtime, useTyping } from '@/hooks/use-realtime';
import { type PresenceRow } from '@/hooks/use-presence';
import { PresenceDot, AvatarPresence, PresenceLabel } from '@/components/shared/presence-dot';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Internal communication.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was missing ─────────────────────────────────────────────────────
 *
 *  The module could list channels and post to them, and nothing else. There
 *  was no way to create a channel, start a direct message, add or remove a
 *  participant, or see who was in a conversation. The unread badge was
 *  hard-coded to zero and "4 online" was a literal. Every channel in the
 *  organisation appeared in every sidebar — including direct messages between
 *  two colleagues, because the row-level policy protected the *messages* but
 *  not the channel row.
 *
 *  ── What this does ───────────────────────────────────────────────────────
 *
 *  The whole sidebar comes from one `channel_overview()` call: what the caller
 *  may see, the last message in each, the unread count from their own read
 *  marker, and for a direct message the other person rather than a slug. The
 *  module never decides who may see a channel — that is `channels_select`,
 *  which is why a client account, which has no communication grant at all,
 *  cannot reach any of this.
 */

// ─── Types ───────────────────────────────────────────────────────────────

/** A row of `channel_overview()`. */
interface ChannelRow {
  channelId: string;
  name: string;
  displayName: string | null;
  description: string;
  topic: string;
  type: 'public' | 'private' | 'direct' | 'announcement';
  postPolicy: 'everyone' | 'members' | 'admins';
  joinPolicy: 'open' | 'invite';
  isArchived: boolean;
  createdBy: string | null;
  memberCount: number;
  messageCount: number;
  unreadCount: number;
  isMember: boolean;
  isAdmin: boolean;
  myRole: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSender: string | null;
  counterpartId: string | null;
  counterpartName: string | null;
  counterpartAvatar: string | null;
}

/**
 * The message author, as the endpoint returns them.
 *
 * The sender is a membership with the name on its joined profile — a flat
 * `firstName`/`lastName` was never carried, which is how every message once
 * rendered its author as "undefined undefined".
 */
interface Sender {
  id: string;
  profiles?: { fullName: string; avatarUrl: string | null };
}

interface Message {
  id: string;
  body: string;
  senderId: string;
  channelId: string;
  isPinned: boolean;
  editedAt: string | null;
  createdAt: string;
  sender: Sender;
  reactions?: { emoji: string; memberId: string }[];
}

interface ChannelMember {
  id: string;
  channelId: string;
  memberId: string;
  role: 'owner' | 'admin' | 'member';
  /**
   * How far this member has read.
   *
   * The same marker `channel_overview()` computes the unread badge from — which
   * is why a read receipt derived from it can never disagree with the count.
   */
  lastReadAt: string | null;
  fullName: string;
  avatarUrl: string | null;
  email: string;
  jobTitle: string | null;
  lastSeenAt: string | null;
  lastActiveAt: string | null;
  /** Derived by `v_channel_members` through `presence_of()`. */
  presence: 'online' | 'away' | 'offline';
  orgRole: string;
  departmentName: string | null;
}

interface DirectoryMember {
  memberId: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  departmentName: string | null;
}

// ─── Presentation helpers ────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * What a conversation is called on screen.
 *
 * A direct message has no name of its own — the row's `name` is a stable slug
 * built from two membership ids, which is exactly what should never be shown
 * to anybody. The other participant's name comes back on the overview row.
 */
function channelLabel(channel: ChannelRow): string {
  if (channel.type === 'direct') return channel.counterpartName || 'Direct message';
  return channel.displayName || `#${channel.name}`;
}

function ChannelTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = cn('size-4 shrink-0', className);
  switch (type) {
    case 'private': return <Lock className={cn(cls, 'text-amber-500')} />;
    case 'direct': return <User className={cn(cls, 'text-emerald-500')} />;
    case 'announcement': return <Megaphone className={cn(cls, 'text-violet-500')} />;
    default: return <Hash className={cn(cls, 'text-slate-400')} />;
  }
}

const QUICK_REACTIONS = ['👍', '🎉', '👀', '✅', '❤️'];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.data as T;
}

// ═══════════════════════════════════════════════════════════════════════════

export default function CommunicationModule() {
  const isMobile = useIsMobile();
  // The membership id, not the account id: messages.sender_id references the
  // membership, so that is what an "is this mine?" comparison has to use.
  const currentMemberId = useAppStore(s => s.user?.memberId ?? null);
  const role = useAppStore(s => s.user?.role ?? 'employee');
  const isOrgAdmin = ['owner', 'administrator', 'super_admin', 'admin'].includes(role);

  const [showSidebar, setShowSidebar] = useState(false);

  // ── Data ──
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [directory, setDirectory] = useState<DirectoryMember[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  /**
   * Presence by member id, for the dots on avatars.
   *
   * Kept as a map rather than merged into `members`, because the roster is
   * refetched when a channel is opened and presence is refetched on its own
   * schedule — merging would mean one of them clobbering the other's freshness
   * depending on which request happened to land last.
   */
  const [presence, setPresence] = useState<Record<string, PresenceRow>>({});

  // ── Input ──
  const [draft, setDraft] = useState('');
  /**
   * The message this draft is answering, if any.
   *
   * `messages.parent_id` and the endpoint's `?parent_id=` filter have both
   * existed from the start — the main timeline is already `parent_id IS NULL`
   * — so a reply had somewhere to go and no way to be sent. This is the only
   * missing piece.
   */
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  /** Which message's thread is expanded, and the replies loaded for it. */
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [threadReplies, setThreadReplies] = useState<Record<string, Message[]>>({});
  const [search, setSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);

  // ── Loading ──
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // ── Dialogs ──
  const [createOpen, setCreateOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<ChannelRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelRow | null>(null);
  const [busy, setBusy] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = channels.find(c => c.channelId === selectedId) ?? null;

  // ─── Loading ─────────────────────────────────────────────────────────────

  const loadChannels = useCallback(async (preferId?: string) => {
    try {
      const data = await api<ChannelRow[]>('/api/communication/channels');
      setChannels(data ?? []);
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
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  /**
   * The channel list itself is live.
   *
   * `channels` covers one being created, renamed or archived; `channel_members`
   * covers being added to or removed from one, which is what makes a channel
   * appear in the sidebar without a reload. Message arrival is handled by the
   * per-channel subscription in the thread below — subscribing to `messages`
   * here as well would refetch the whole channel list on every message sent
   * anywhere in the organisation.
   */
  useModuleRealtime('channels', ['channels', 'channel_members'], () => loadChannels());

  /**
   * Presence, live.
   *
   * A dot that only changes on reload is worse than no dot: it makes a
   * confident claim about somebody who left an hour ago. `profiles` carries the
   * heartbeat, so a colleague going idle or closing their laptop reaches this
   * sidebar within a beat.
   *
   * Debounced heavily — in a company of any size the heartbeats are constant,
   * and a refetch per beat would be a request every second or two for a set of
   * coloured dots. Two seconds collapses a burst into one.
   */
  useRealtime({
    name: 'presence',
    tables: [{ table: 'profiles', event: 'UPDATE' }],
    debounceMs: 2000,
    onChange: () => {
      fetch('/api/presence')
        .then(r => r.json())
        .then(j => {
          setOnlineCount(j?.meta?.online ?? 0);
          setPresence(Object.fromEntries(
            (j?.data ?? []).map((r: PresenceRow) => [r.memberId, r]),
          ));
        })
        .catch(() => undefined);
    },
  });

  useEffect(() => {
    api<DirectoryMember[]>('/api/directory').then(setDirectory).catch(() => setDirectory([]));
  }, []);

  /**
   * Who is here.
   *
   * ── Why this no longer computes its own cutoff ────────────────────────────
   *
   * It fetched the directory and counted rows whose `lastSeenAt` was within
   * five minutes. Two things were wrong with that:
   *
   *   · `last_seen_at` was never updated by anything. It defaults to `now()`
   *     when the profile row is created and `touch_presence()` — the function
   *     written to maintain it — was called from nowhere. So the count was the
   *     number of people who had signed up in the last five minutes, which is
   *     almost always nobody. Before that it was the literal `4`.
   *
   *   · Even with the column maintained, a cutoff written here is a second
   *     definition of "online". The chat header and the employee directory
   *     would drift apart the first time either number was tuned.
   *
   * `/api/presence` returns the verdict from `v_presence`, which is where the
   * rule now lives, and the count comes back in the response meta rather than
   * being derived a third time.
   */
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch('/api/presence')
        .then(r => r.json())
        .then(j => {
          if (cancelled) return;
          setOnlineCount(j?.meta?.online ?? 0);
          setPresence(
            Object.fromEntries(
              (j?.data ?? []).map((r: PresenceRow) => [r.memberId, r]),
            ),
          );
        })
        .catch(() => undefined);
    };
    tick();
    /**
     * A minute, matched to nothing in particular — presence changes are pushed
     * over the socket below, and this is the fallback for a tab whose
     * subscription could not connect.
     */
    const timer = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  /**
   * Open a conversation: its messages, its participants, and its read marker.
   *
   * Marking read is an explicit call rather than a side effect of the GET, so
   * that reading a channel is a deliberate act the client can decide about —
   * a prefetch should not clear somebody's unread badge.
   */
  const openChannel = useCallback(async (channelId: string) => {
    setMessagesLoading(true);
    setShowPinnedOnly(false);
    try {
      const [msgs, mem] = await Promise.all([
        api<Message[]>(`/api/communication/messages?channelId=${channelId}&pageSize=100`),
        api<ChannelMember[]>(`/api/communication/channels/${channelId}/members`),
      ]);
      // Newest-first from the API, which is how a scrollback loads; reversed
      // for display.
      setMessages([...(msgs ?? [])].reverse());
      setMembers(mem ?? []);

      await fetch(`/api/communication/channels/${channelId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markRead: true }),
      }).catch(() => undefined);

      setChannels(prev => prev.map(c => c.channelId === channelId ? { ...c, unreadCount: 0 } : c));
    } catch (err: any) {
      toast.error(err.message || 'Could not open that conversation');
      setMessages([]);
      setMembers([]);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    openChannel(selectedId);
    if (isMobile) setShowSidebar(false);
  }, [selectedId, openChannel, isMobile]);

  /**
   * Reload the open conversation's messages, without reopening it.
   *
   * Deliberately not `openChannel`: that shows the loading state, refetches the
   * member list and marks the channel read. Called on every incoming message
   * that would blank the thread mid-read, re-request the roster for no reason,
   * and clear the unread marker of a channel the reader may have scrolled away
   * from.
   */
  const refreshMessages = useCallback(async (channelId: string) => {
    try {
      const msgs = await api<Message[]>(
        `/api/communication/messages?channelId=${channelId}&pageSize=100`,
      );
      setMessages([...(msgs ?? [])].reverse());
    } catch {
      // The thread still holds what it had; a failed background refresh is not
      // worth interrupting a conversation over.
    }
  }, []);

  /**
   * "Message sent — appears instantly."
   *
   * Filtered to the open channel, which is the case a filter is most clearly
   * worth having: without it every message anywhere in the organisation would
   * refetch this thread. `message_reactions` is watched too — a reaction is a
   * change to a message that is on screen, and it carries no `channel_id` to
   * filter on, so it is subscribed unfiltered and costs a discarded event.
   *
   * Both this and the channel-list subscription exist because they answer
   * different questions: this one is "what is in the conversation I am reading",
   * the other is "which conversations do I have".
   */
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

  useRealtime({
    name: `channel:${selectedId ?? 'none'}`,
    enabled: !!selectedId,
    debounceMs: 200,
    tables: selectedId
      ? [
          { table: 'messages', filter: `channel_id=eq.${selectedId}` },
          { table: 'message_reactions' },
        ]
      : [],
    onChange: () => { if (selectedId) void refreshMessages(selectedId); },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  /**
   * Open or close a thread, loading its replies the first time.
   *
   * On demand rather than with the timeline: most messages have no replies, and
   * fetching every thread to render a hundred messages would be a hundred
   * queries to display nothing. Cached per message so collapsing and reopening
   * is free, and refetched after posting so the new reply appears.
   */
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

  /**
   * Resolve `@Name` in the draft to the membership ids the trigger expects.
   *
   * ── Why this is here at all ───────────────────────────────────────────────
   *
   * `messages.mentions` is a uuid array, the endpoint has always accepted it,
   * and `notify_message_mentions` has notified everyone in it since 0016. The
   * composer never sent the field, so the column was empty on every message ever
   * posted and that trigger had never fired — a whole notification path, wired
   * end to end in the database, unreachable from the product.
   *
   * Names are matched longest-first so "@Ada Lovelace" wins over "@Ada" when
   * both are in the channel; otherwise the shorter match consumes the prefix and
   * the wrong person is notified. Matching is case-insensitive because nobody
   * capitalises consistently while typing, and restricted to the channel's own
   * members: mentioning somebody who cannot see the channel would notify them
   * about a message they will never be able to open.
   */
  const resolveMentions = useCallback((text: string): string[] => {
    const candidates = [...members]
      .sort((a, b) => b.fullName.length - a.fullName.length);

    const haystack = text.toLowerCase();
    const found = new Set<string>();

    for (const m of candidates) {
      if (!m.fullName) continue;
      if (haystack.includes(`@${m.fullName.toLowerCase()}`)) found.add(m.memberId);
    }
    // Never notify yourself for typing your own name.
    if (currentMemberId) found.delete(currentMemberId);
    return [...found];
  }, [members, currentMemberId]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !selectedId || sending) return;

    setSending(true);
    setDraft('');
    try {
      const mentions = resolveMentions(body);
      const created = await api<Message>('/api/communication/messages', {
        method: 'POST',
        body: JSON.stringify({
          body,
          channelId: selectedId,
          mentions,
          // A reply carries the message it answers. `parent_id` has been on the
          // table and accepted by the endpoint since the start; the GET already
          // separates roots from replies, so nothing else had to change to make
          // threads work — only the composer had to say which it was sending.
          parentId: replyTo?.id ?? null,
        }),
      });
      // A reply belongs in its thread, not at the end of the main timeline —
      // which is what the endpoint's `parent_id IS NULL` filter already means.
      if (!replyTo) setMessages(prev => [...prev, created]);
      setChannels(prev => prev.map(c => c.channelId === selectedId
        ? { ...c, lastMessage: body, lastMessageAt: created.createdAt, messageCount: c.messageCount + 1 }
        : c));
      // The reply belongs in the thread it answers, so that is what is reloaded.
      if (replyTo) await toggleThread(replyTo, true);
      setReplyTo(null);
    } catch (err: any) {
      toast.error(err.message || 'Could not send that');
      setDraft(body);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft, selectedId, sending, resolveMentions, replyTo, toggleThread]);

  const editMessage = useCallback(async (message: Message, body: string) => {
    try {
      await api(`/api/communication/messages/${message.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      /**
       * Patched in place rather than refetched.
       *
       * The exception to this file's usual rule: the endpoint returns nothing
       * derived, the author is looking straight at the line they just changed,
       * and a refetch would rebuild the whole thread and lose their scroll
       * position for a one-word correction. The realtime subscription still
       * carries the change to everyone else.
       */
      setMessages(prev => prev.map(m =>
        m.id === message.id
          ? { ...m, body, editedAt: new Date().toISOString() }
          : m));
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
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isPinned: !m.isPinned } : m));
    } catch (err: any) {
      toast.error(err.message || 'Could not update the pin');
    }
  }, []);

  const react = useCallback(async (message: Message, emoji: string) => {
    try {
      const result = await api<{ reactions: { emoji: string; memberId: string }[] }>(
        `/api/communication/messages/${message.id}/reactions`,
        { method: 'POST', body: JSON.stringify({ emoji }) },
      );
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, reactions: result.reactions } : m));
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

  const createChannel = useCallback(async (values: {
    displayName: string; description: string; type: string;
    postPolicy: string; joinPolicy: string; memberIds: string[];
  }) => {
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
      const mem = await api<ChannelMember[]>(`/api/communication/channels/${selectedId}/members`);
      setMembers(mem ?? []);
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

  // ─── Derived ─────────────────────────────────────────────────────────────

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(c => channelLabel(c).toLowerCase().includes(q));
  }, [channels, search]);

  const groups = useMemo(() => ({
    channels: visible.filter(c => c.type === 'public' || c.type === 'announcement'),
    private: visible.filter(c => c.type === 'private'),
    direct: visible.filter(c => c.type === 'direct'),
  }), [visible]);

  const shown = useMemo(() => {
    let list = messages;
    if (showPinnedOnly) list = list.filter(m => m.isPinned);
    const q = messageSearch.trim().toLowerCase();
    if (q) list = list.filter(m => m.body.toLowerCase().includes(q));
    return list;
  }, [messages, showPinnedOnly, messageSearch]);

  // Whether the composer is offered at all. The server decides for real; this
  // is so a read-only channel does not present a box that will be refused.
  const canPost = !!selected && !selected.isArchived && (
    selected.postPolicy === 'everyone' ? (selected.type === 'public' || selected.isMember)
      : selected.postPolicy === 'members' ? selected.isMember
      : selected.isAdmin
  );

  const notInChannel = directory.filter(
    d => !members.some(m => m.memberId === d.memberId),
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4 pb-2">
        <h2 className="text-lg font-semibold">Messages</h2>
        <div className="flex items-center gap-0.5">
          <TooltipProvider>
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

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-9 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2">
        {channelsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {search ? 'Nothing matches that.' : 'No conversations yet.'}
            </p>
            {!search && (
              <Button variant="outline" size="sm" className="mt-3 gap-1.5"
                onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" /> New channel
              </Button>
            )}
          </div>
        ) : (
          <>
            <ChannelGroup label="Channels" rows={groups.channels}
              selectedId={selectedId} onSelect={setSelectedId} presence={presence} />
            <ChannelGroup label="Private" rows={groups.private}
              selectedId={selectedId} onSelect={setSelectedId} presence={presence} />
            <ChannelGroup label="Direct messages" rows={groups.direct}
              selectedId={selectedId} onSelect={setSelectedId} presence={presence} />
          </>
        )}
      </ScrollArea>

      <div className="border-t px-4 py-2">
        <p className="text-xs text-muted-foreground">
          <span className={cn('mr-1.5 inline-block size-2 rounded-full',
            onlineCount > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
          {onlineCount} online
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
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
        {!selected ? (
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
            {/* ─── Header ─── */}
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {isMobile && (
                  <Button variant="ghost" size="icon" className="size-8 shrink-0"
                    onClick={() => setShowSidebar(true)}>
                    <Menu className="size-4" />
                  </Button>
                )}
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                  <ChannelTypeIcon type={selected.type} className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{channelLabel(selected)}</h3>
                  {(selected.topic || selected.description) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {selected.topic || selected.description}
                    </p>
                  )}
                </div>
                <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
                <button
                  onClick={() => setMembersOpen(true)}
                  className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:flex"
                >
                  <Users className="size-3.5" />
                  {selected.memberCount}
                </button>
                {selected.postPolicy === 'admins' && (
                  <Badge variant="outline" className="hidden gap-1 text-[10px] sm:flex">
                    <Megaphone className="size-3" /> Announcements
                  </Badge>
                )}
                {selected.isArchived && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Archive className="size-3" /> Archived
                  </Badge>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant={searchOpen ? 'secondary' : 'ghost'} size="icon" className="size-8"
                        onClick={() => { setSearchOpen(o => !o); setMessageSearch(''); }}>
                        <Search className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Search this conversation</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant={showPinnedOnly ? 'secondary' : 'ghost'} size="icon" className="size-8"
                        onClick={() => setShowPinnedOnly(v => !v)}>
                        <Pin className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{showPinnedOnly ? 'Show everything' : 'Pinned only'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setMembersOpen(true)}>
                      <Users className="mr-2 size-4" /> Participants
                    </DropdownMenuItem>
                    {selected.isAdmin && selected.type !== 'direct' && (
                      <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                        <Settings className="mr-2 size-4" /> Channel settings
                      </DropdownMenuItem>
                    )}
                    {!selected.isMember && selected.joinPolicy === 'open' && selected.type !== 'direct' && (
                      <DropdownMenuItem onClick={() => joinChannel(selected)}>
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

            {searchOpen && (
              <div className="border-b px-4 py-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Find a message in this conversation…"
                    value={messageSearch}
                    onChange={(e) => setMessageSearch(e.target.value)}
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>
            )}

            {/* ─── Messages ─── */}
            <div className="flex-1 overflow-hidden">
              {messagesLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : shown.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    icon={MessageSquare}
                    title={messageSearch || showPinnedOnly ? 'Nothing to show' : 'No messages yet'}
                    description={
                      messageSearch ? 'No message in this conversation matches that.'
                        : showPinnedOnly ? 'Nothing has been pinned here.'
                        : canPost ? 'Be the first to say something.'
                        : 'Nothing has been posted here yet.'}
                  />
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-1 p-4">
                    {shown.map((message, index) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        isOwn={!!currentMemberId && message.senderId === currentMemberId}
                        isConsecutive={index > 0 && shown[index - 1]?.senderId === message.senderId}
                        currentMemberId={currentMemberId}
                        canModerate={selected.isAdmin || isOrgAdmin}
                        members={members}
                        /**
                         * Who has seen it.
                         *
                         * Derived from `channel_members.last_read_at`, which
                         * has existed since the first communication migration
                         * and already drives the unread badge — a member whose
                         * marker is at or past this message has read it. No new
                         * table, no per-message receipt row, and by construction
                         * it cannot disagree with the unread count.
                         *
                         * Only computed for your own messages: "who has read
                         * this" is a question people ask about what they sent,
                         * and rendering it on every line would put a row of
                         * avatars under a colleague's message answering nothing
                         * anybody asked.
                         */
                        readBy={
                          !!currentMemberId && message.senderId === currentMemberId
                            ? members.filter(
                                m => m.memberId !== currentMemberId
                                  && m.lastReadAt
                                  && m.lastReadAt >= message.createdAt,
                              )
                            : []
                        }
                        onTogglePin={() => togglePin(message)}
                        onReact={(emoji) => react(message, emoji)}
                        onDelete={() => deleteMessage(message)}
                        onReply={() => { setReplyTo(message); inputRef.current?.focus(); }}
                        onEdit={(body) => editMessage(message, body)}
                        onToggleThread={() => void toggleThread(message)}
                        threadOpen={openThread === message.id}
                        replies={threadReplies[message.id]}
                      />
                    ))}
                    <div ref={endRef} />
                  </div>
                </ScrollArea>
              )}
            </div>

            {/*
              Who is typing.

              Above the composer and outside it, so the input does not move
              when somebody starts or stops — a text box that jumps while you
              are typing in it is worse than no indicator. The row keeps its
              height for the same reason.
            */}
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

            {/* ─── Composer ─── */}
            <div className="border-t p-4">
              {canPost ? (
                <div className="flex flex-col gap-2">
                  {/*
                    What this draft is answering. Without it, "Reply in thread"
                    and a normal send look identical from the composer, and the
                    message lands somewhere the sender did not expect.
                  */}
                  {replyTo && (
                    <div className="flex items-center gap-2 rounded-md border-l-2 border-emerald-500 bg-muted/50 px-2.5 py-1.5">
                      <MessageSquare className="size-3.5 shrink-0 text-emerald-600" />
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        Replying to{' '}
                        <span className="font-medium text-foreground">
                          {replyTo.sender?.profiles?.fullName || 'Unknown member'}
                        </span>
                        {' — '}{truncate(replyTo.body, 60)}
                      </p>
                      <Button
                        variant="ghost" size="icon" className="size-5 shrink-0"
                        onClick={() => setReplyTo(null)}
                        aria-label="Cancel reply"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                  <Input
                    ref={inputRef}
                    placeholder={
                      replyTo
                        ? 'Reply in thread…'
                        : `Message ${channelLabel(selected)} — @name to notify someone`
                    }
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); signalTyping(); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                      // Escape drops out of a reply rather than leaving the
                      // draft silently bound to a thread.
                      if (e.key === 'Escape' && replyTo) setReplyTo(null);
                    }}
                    disabled={sending}
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={send}
                    disabled={!draft.trim() || sending}
                  >
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {selected.isArchived
                      ? 'This channel is archived.'
                      : selected.postPolicy === 'admins'
                        ? 'Only administrators can post in this channel.'
                        : 'Join this channel to take part.'}
                  </p>
                  {!selected.isMember && !selected.isArchived
                    && selected.joinPolicy === 'open' && selected.type !== 'direct' && (
                    <Button size="sm" variant="outline" className="gap-1.5"
                      onClick={() => joinChannel(selected)}>
                      <UserPlus className="size-3.5" /> Join
                    </Button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ─── Dialogs ─── */}
      <CreateChannelDialog
        key={createOpen ? 'create-open' : 'create-closed'}
        open={createOpen}
        onOpenChange={setCreateOpen}
        directory={directory}
        isOrgAdmin={isOrgAdmin}
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
        isSaving={busy}
      />

      <ChannelSettingsDialog
        key={selected ? `settings-${selected.channelId}-${settingsOpen}` : 'settings-closed'}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        channel={selected}
        isOrgAdmin={isOrgAdmin}
        onSubmit={saveChannelSettings}
        isSaving={busy}
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sidebar group
// ═══════════════════════════════════════════════════════════════════════════

function ChannelGroup({
  label, rows, selectedId, onSelect, presence,
}: {
  label: string;
  rows: ChannelRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Presence by member id, for direct messages.
   *
   * A direct conversation is with a person, so whether that person is at their
   * desk is the single most useful thing the sidebar row can say — it is the
   * difference between asking now and leaving a note.
   */
  presence: Record<string, PresenceRow>;
}) {
  if (!rows.length) return null;

  return (
    <div className="mb-3">
      <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {rows.map(channel => {
        const active = channel.channelId === selectedId;
        const unread = channel.unreadCount > 0;

        return (
          <button
            key={channel.channelId}
            onClick={() => onSelect(channel.channelId)}
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-emerald-500/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {/*
              A direct message shows the other person's presence in place of
              the generic person icon; everything else keeps its channel glyph.
            */}
            {channel.type === 'direct' && channel.counterpartId ? (
              <PresenceDot
                presence={presence[channel.counterpartId]?.presence ?? 'offline'}
                lastSeenAt={presence[channel.counterpartId]?.lastSeenAt}
                className="ml-0.5 mr-0.5"
              />
            ) : (
              <ChannelTypeIcon type={channel.type}
                className={active ? 'text-emerald-600' : undefined} />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={cn('truncate',
                  unread ? 'font-semibold text-foreground' : 'font-medium',
                  active && 'text-emerald-700 dark:text-emerald-400')}>
                  {channelLabel(channel)}
                </span>
                {channel.lastMessageAt && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(channel.lastMessageAt)}
                  </span>
                )}
              </div>
              {channel.lastMessage && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {channel.lastSender && <span className="font-medium">{channel.lastSender}: </span>}
                  {truncate(channel.lastMessage, 40)}
                </p>
              )}
            </div>
            {unread && (
              <Badge className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] text-white">
                {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Message
// ═══════════════════════════════════════════════════════════════════════════

function MessageBubble({
  message, isOwn, isConsecutive, currentMemberId, canModerate, members, readBy,
  onTogglePin, onReact, onDelete, onReply, onToggleThread, onEdit,
  threadOpen, replies,
}: {
  message: Message;
  isOwn: boolean;
  isConsecutive: boolean;
  currentMemberId: string | null;
  canModerate: boolean;
  members: ChannelMember[];
  /** Colleagues whose read marker has passed this message. Own messages only. */
  readBy: ChannelMember[];
  onTogglePin: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onReply: () => void;
  onToggleThread: () => void;
  onEdit: (body: string) => Promise<void>;
  threadOpen: boolean;
  replies: Message[] | undefined;
}) {
  const [hovered, setHovered] = useState(false);

  /**
   * Editing happens in place.
   *
   * The endpoint has always accepted a new body and stamped `edited_at`, and
   * this bubble already renders an "(edited)" marker from it — there was simply
   * no way to trigger one. Inline rather than a dialog: almost every message
   * edit is a one-line correction, and a modal for that is a interruption.
   */
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);
  const [savingEdit, setSavingEdit] = useState(false);

  const commitEdit = async () => {
    const next = editDraft.trim();
    // An unchanged body must not stamp `edited_at` and label the message as
    // edited when nothing was.
    if (!next || next === message.body) { setEditing(false); return; }
    setSavingEdit(true);
    try {
      await onEdit(next);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  // Falls back rather than rendering 'undefined': a profile can legitimately
  // have no name yet, and a chat line is still readable without one.
  const senderName = message.sender?.profiles?.fullName || 'Unknown member';
  const initials = initialsOf(message.sender?.profiles?.fullName);

  /**
   * Render `@Name` as a mention chip, and say when it is you.
   *
   * Driven by the names of the channel's members rather than by a regex over
   * `@\w+`: a bare pattern cannot span "@Ada Lovelace" without also colouring
   * "@lunch", and it would disagree with what the composer actually resolved.
   * Matching the same list the composer matches means what is highlighted is
   * exactly what was notified.
   *
   * A mention of *you* is emphasised more strongly, because the one thing
   * anybody scans a channel for is whether they were named in it.
   */
  const rendered = useMemo(() => {
    const names = members
      .map(m => m.fullName)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (!names.length) return [message.body] as (string | { name: string; isMe: boolean })[];

    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${escaped.join('|')})`, 'gi');

    const myName = members.find(m => m.memberId === currentMemberId)?.fullName?.toLowerCase();
    const parts: (string | { name: string; isMe: boolean })[] = [];
    let last = 0;
    for (const m of message.body.matchAll(re)) {
      const at = m.index ?? 0;
      if (at > last) parts.push(message.body.slice(last, at));
      parts.push({ name: m[1], isMe: m[1].toLowerCase() === myName });
      last = at + m[0].length;
    }
    if (last < message.body.length) parts.push(message.body.slice(last));
    return parts.length ? parts : [message.body];
  }, [message.body, members, currentMemberId]);

  // Reactions arrive as one row per person per emoji; the bubble shows one
  // chip per emoji with a count, and highlights the ones you added.
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of message.reactions ?? []) {
      const entry = map.get(r.emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (r.memberId === currentMemberId) entry.mine = true;
      map.set(r.emoji, entry);
    }
    return [...map.entries()];
  }, [message.reactions, currentMemberId]);

  return (
    <div
      className={cn(
        'group relative flex gap-2.5 rounded-lg px-3 py-1.5 transition-colors',
        message.isPinned && 'border-l-2 border-amber-400 bg-amber-50/50 dark:bg-amber-950/10',
        isOwn && !message.isPinned && 'bg-emerald-50/60 dark:bg-emerald-950/20',
        hovered && 'bg-muted/50',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isConsecutive ? (
        <Avatar className="mt-0.5 size-8 shrink-0">
          <AvatarFallback className={cn('text-xs font-medium text-white', avatarColor(message.senderId))}>
            {initials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="w-8 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        {!isConsecutive && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-sm font-semibold">{senderName}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(message.createdAt)}
            </span>
            {message.editedAt && <span className="text-[10px] text-muted-foreground">(edited)</span>}
            {message.isPinned && <Pin className="size-3 text-amber-500" />}
          </div>
        )}
        {editing ? (
          <div className="flex flex-col gap-1.5 py-1">
            <Input
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
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Enter to save · Escape to cancel
            </p>
          </div>
        ) : (
        <p className="break-words text-sm leading-relaxed text-foreground/90">
          {rendered.map((part, i) =>
            typeof part === 'string' ? (
              <span key={i}>{part}</span>
            ) : (
              <span
                key={i}
                className={cn(
                  'rounded px-1 font-medium',
                  part.isMe
                    ? 'bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-200'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
                )}
              >
                @{part.name}
              </span>
            ),
          )}
        </p>
        )}

        {/*
          Who has read it.

          Names rather than a row of avatars: three initials tell you nothing
          you can act on, and this appears only under your own messages, where
          the question "did they see it" is the one actually being asked.
        */}
        {readBy.length > 0 && !editing && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Read by {readBy.length <= 3
              ? readBy.map(m => m.fullName).join(', ')
              : `${readBy.slice(0, 2).map(m => m.fullName).join(', ')} and ${readBy.length - 2} others`}
          </p>
        )}

        {grouped.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {grouped.map(([emoji, { count, mine }]) => (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors',
                  mine ? 'border-emerald-500 bg-emerald-500/10' : 'hover:bg-accent',
                )}
              >
                <span>{emoji}</span>
                <span className="text-[10px] text-muted-foreground">{count}</span>
              </button>
            ))}
          </div>
        )}

        {/*
          The thread. Shown only when it has replies or has been opened — a
          "0 replies" affordance on every message is noise, and the count is not
          known until the thread is fetched.
        */}
        {(threadOpen || (replies?.length ?? 0) > 0) && (
          <div className="mt-1.5">
            <button
              onClick={onToggleThread}
              className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              {replies === undefined
                ? 'Loading replies…'
                : replies.length === 0
                  ? 'No replies yet'
                  : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
              {threadOpen ? ' · hide' : ''}
            </button>

            {threadOpen && !!replies?.length && (
              <div className="mt-1.5 flex flex-col gap-2 border-l-2 border-border pl-3">
                {replies.map(r => (
                  <div key={r.id} className="flex gap-2">
                    <Avatar className="mt-0.5 size-6 shrink-0">
                      <AvatarFallback className={cn('text-[10px] font-medium text-white', avatarColor(r.senderId))}>
                        {initialsOf(r.sender?.profiles?.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold">
                          {r.sender?.profiles?.fullName || 'Unknown member'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(r.createdAt)}
                        </span>
                      </div>
                      <p className="break-words text-sm text-foreground/90">{r.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {hovered && (
        <div className="absolute -top-2 right-2 flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-sm">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6">
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

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6" onClick={onReply}>
                  <MessageSquare className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reply in thread</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6" onClick={onTogglePin}>
                  {message.isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{message.isPinned ? 'Unpin' : 'Pin'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {(isOwn || canModerate) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/*
                  Only the author edits. Moderation can remove a message but not
                  rewrite it — putting words in somebody's mouth is a different
                  power from taking them away, and the RLS policy allows an
                  UPDATE only to rows whose sender is the caller, so this is the
                  UI agreeing with the boundary rather than inventing one.
                */}
                {isOwn && (
                  <DropdownMenuItem onClick={() => { setEditDraft(message.body); setEditing(true); }}>
                    <Pencil className="mr-2 size-4" /> Edit message
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 size-4" /> Delete message
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dialogs
// ═══════════════════════════════════════════════════════════════════════════

function CreateChannelDialog({
  open, onOpenChange, directory, isOrgAdmin, onSubmit, isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: DirectoryMember[];
  isOrgAdmin: boolean;
  onSubmit: (values: {
    displayName: string; description: string; type: string;
    postPolicy: string; joinPolicy: string; memberIds: string[];
  }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('public');
  const [postPolicy, setPostPolicy] = useState('everyone');
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const shown = directory.filter(d =>
    d.fullName.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            A channel is for a topic or a team. Everyone in the company can find a public one;
            a private channel is visible only to the people in it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input id="channel-name" value={name} autoFocus
              onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Launch Team" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-desc">What is it for?</Label>
            <Textarea id="channel-desc" rows={2} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional. Shown under the channel name." />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select value={type} onValueChange={(v) => {
                setType(v);
                if (v === 'announcement') setPostPolicy('admins');
                else if (postPolicy === 'admins') setPostPolicy('everyone');
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — anyone can find and join</SelectItem>
                  <SelectItem value="private">Private — invitation only</SelectItem>
                  {isOrgAdmin && (
                    <SelectItem value="announcement">Announcements — admins post, everyone reads</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Who can post</Label>
              <Select value={postPolicy} onValueChange={setPostPolicy}
                disabled={type === 'announcement'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone who can see it</SelectItem>
                  <SelectItem value="members">Members only</SelectItem>
                  {isOrgAdmin && <SelectItem value="admins">Channel admins only</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Add people <span className="text-muted-foreground">({picked.length} selected)</span></Label>
            <Input placeholder="Filter colleagues…" value={filter}
              onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
            <ScrollArea className="h-44 rounded-md border">
              <div className="divide-y">
                {shown.map(person => (
                  <label key={person.memberId}
                    className="flex cursor-pointer items-center gap-2.5 p-2.5 hover:bg-accent/40">
                    <Checkbox
                      checked={picked.includes(person.memberId)}
                      onCheckedChange={(checked) =>
                        setPicked(prev => checked
                          ? [...prev, person.memberId]
                          : prev.filter(id => id !== person.memberId))}
                    />
                    <Avatar className="size-6">
                      <AvatarFallback className={cn('text-[10px] text-white', avatarColor(person.memberId))}>
                        {initialsOf(person.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{person.fullName}</span>
                      {person.jobTitle && (
                        <span className="block truncate text-xs text-muted-foreground">{person.jobTitle}</span>
                      )}
                    </span>
                  </label>
                ))}
                {shown.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">No colleagues match that.</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!name.trim() || isSaving}
            onClick={() => onSubmit({
              displayName: name.trim(),
              description,
              type,
              postPolicy,
              joinPolicy: type === 'private' ? 'invite' : 'open',
              memberIds: picked,
            })}
          >
            {isSaving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Create channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DirectMessageDialog({
  open, onOpenChange, directory, onPick, isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: DirectoryMember[];
  onPick: (memberId: string) => void;
  isSaving: boolean;
}) {
  const [filter, setFilter] = useState('');
  const shown = directory.filter(d =>
    d.fullName.toLowerCase().includes(filter.trim().toLowerCase())
    || d.email.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Message a colleague</DialogTitle>
          <DialogDescription>
            Opens your existing conversation with them, or starts one.
          </DialogDescription>
        </DialogHeader>

        <Input placeholder="Search by name or email…" value={filter} autoFocus
          onChange={(e) => setFilter(e.target.value)} />

        <ScrollArea className="h-64 rounded-md border">
          <div className="divide-y">
            {shown.map(person => (
              <button
                key={person.memberId}
                disabled={isSaving}
                onClick={() => onPick(person.memberId)}
                className="flex w-full items-center gap-2.5 p-2.5 text-left hover:bg-accent/40 disabled:opacity-60"
              >
                <Avatar className="size-7">
                  <AvatarFallback className={cn('text-[10px] text-white', avatarColor(person.memberId))}>
                    {initialsOf(person.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {person.jobTitle || person.email}
                  </span>
                </span>
              </button>
            ))}
            {shown.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">Nobody matches that.</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function MembersDialog({
  open, onOpenChange, channel, members, candidates, currentMemberId,
  onAdd, onRemove, onSetRole, isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChannelRow | null;
  members: ChannelMember[];
  candidates: DirectoryMember[];
  currentMemberId: string | null;
  onAdd: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onSetRole: (id: string, role: string) => void;
  isSaving: boolean;
}) {
  const [adding, setAdding] = useState('');
  const canManage = !!channel?.isAdmin && channel.type !== 'direct';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Participants</DialogTitle>
          <DialogDescription>
            {channel ? `${members.length} in ${channelLabel(channel)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <div className="flex gap-2">
            <Select value={adding || undefined} onValueChange={setAdding}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Add somebody" /></SelectTrigger>
              <SelectContent className="max-h-56">
                {candidates.map(c => (
                  <SelectItem key={c.memberId} value={c.memberId}>{c.fullName}</SelectItem>
                ))}
                {candidates.length === 0 && (
                  <div className="p-2 text-xs text-muted-foreground">Everybody is already in.</div>
                )}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" disabled={!adding || isSaving}
              onClick={() => { onAdd([adding]); setAdding(''); }}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            </Button>
          </div>
        )}

        <ScrollArea className="max-h-72">
          <div className="divide-y rounded-md border">
            {members.map(member => (
              <div key={member.id} className="flex items-center gap-2.5 p-2.5">
                {/*
                  The dot comes from `v_channel_members`, which derives it
                  through the same `presence_of()` the directory and the chat
                  header use — so a person cannot read as online here and away
                  two panels over.
                */}
                <AvatarPresence presence={member.presence} lastSeenAt={member.lastSeenAt}>
                  <Avatar className="size-7 shrink-0">
                    <AvatarFallback className={cn('text-[10px] text-white', avatarColor(member.memberId))}>
                      {initialsOf(member.fullName)}
                    </AvatarFallback>
                  </Avatar>
                </AvatarPresence>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.fullName}
                    {member.memberId === currentMemberId && (
                      <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  {/*
                    Presence in words under the name, not only as a colour.
                    "Last seen 3 hours ago" is the thing somebody actually wants
                    before deciding whether to wait for a reply.
                  */}
                  <div className="flex items-center gap-1.5">
                    <PresenceLabel presence={member.presence} lastSeenAt={member.lastSeenAt} />
                    <span className="truncate text-xs text-muted-foreground">
                      · {member.jobTitle || member.departmentName || member.email}
                    </span>
                  </div>
                </div>
                {member.role !== 'member' && (
                  <Badge variant="outline" className="shrink-0 gap-1 text-[10px] capitalize">
                    <Shield className="size-3" /> {member.role}
                  </Badge>
                )}
                {canManage && member.memberId !== currentMemberId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-6 shrink-0">
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel className="text-xs">Role in this channel</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onSetRole(member.memberId, 'admin')}>
                        Make admin
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSetRole(member.memberId, 'member')}>
                        Make member
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive"
                        onClick={() => onRemove(member.memberId)}>
                        <X className="mr-2 size-4" /> Remove from channel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
            {members.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">Nobody has joined yet.</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ChannelSettingsDialog({
  open, onOpenChange, channel, isOrgAdmin, onSubmit, isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChannelRow | null;
  isOrgAdmin: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(channel?.displayName || channel?.name || '');
  const [description, setDescription] = useState(channel?.description ?? '');
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [postPolicy, setPostPolicy] = useState(channel?.postPolicy ?? 'everyone');
  const [joinPolicy, setJoinPolicy] = useState(channel?.joinPolicy ?? 'open');
  const [archived, setArchived] = useState(channel?.isArchived ?? false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Channel settings</DialogTitle>
          <DialogDescription>
            These take effect immediately for everyone in the channel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cs-name">Name</Label>
            <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-topic">Topic</Label>
            <Input id="cs-topic" value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder="A line shown next to the channel name" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-desc">Description</Label>
            <Textarea id="cs-desc" rows={2} value={description}
              onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Who can post</Label>
              <Select value={postPolicy} onValueChange={(v) => setPostPolicy(v as ChannelRow['postPolicy'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone who can see it</SelectItem>
                  <SelectItem value="members">Members only</SelectItem>
                  {/*
                    Restricting a channel to administrators is an organisation
                    level act; the endpoint refuses it from anybody else, so the
                    option is not offered where it would only produce a 403.
                  */}
                  {isOrgAdmin && <SelectItem value="admins">Channel admins only</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Who can join</Label>
              <Select value={joinPolicy} onValueChange={(v) => setJoinPolicy(v as ChannelRow['joinPolicy'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Anyone can join</SelectItem>
                  <SelectItem value="invite">By invitation only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border p-3">
            <Checkbox checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
            <span>
              <span className="block text-sm font-medium">Archive this channel</span>
              <span className="block text-xs text-muted-foreground">
                History stays readable; nobody can post any more.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!name.trim() || isSaving}
            onClick={() => onSubmit({
              displayName: name.trim(),
              description, topic,
              postPolicy, joinPolicy,
              isArchived: archived,
            })}
          >
            {isSaving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
