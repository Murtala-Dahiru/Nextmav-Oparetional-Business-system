'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Hash, Lock, User, Settings, Search, Send, Pin, PinOff, Plus,
  MoreHorizontal, SmilePlus, Menu, Loader2, MessageSquare, Users,
  UserPlus, LogOut, Megaphone, Trash2, Shield, X, Archive,
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
  fullName: string;
  avatarUrl: string | null;
  email: string;
  jobTitle: string | null;
  lastSeenAt: string | null;
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

  // ── Input ──
  const [draft, setDraft] = useState('');
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

  useEffect(() => {
    api<DirectoryMember[]>('/api/directory').then(setDirectory).catch(() => setDirectory([]));
  }, []);

  /**
   * Who is here.
   *
   * `online_members()` counts people whose presence heartbeat landed in the
   * last five minutes. The figure used to be the literal `4`.
   */
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch('/api/directory?online=true')
        .then(r => r.json())
        .then(j => {
          if (cancelled) return;
          const rows: { lastSeenAt?: string | null }[] = j?.data ?? [];
          const cutoff = Date.now() - 5 * 60_000;
          setOnlineCount(rows.filter(m => m.lastSeenAt && new Date(m.lastSeenAt).getTime() > cutoff).length);
        })
        .catch(() => undefined);
    };
    tick();
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !selectedId || sending) return;

    setSending(true);
    setDraft('');
    try {
      const created = await api<Message>('/api/communication/messages', {
        method: 'POST',
        body: JSON.stringify({ body, channelId: selectedId }),
      });
      setMessages(prev => [...prev, created]);
      setChannels(prev => prev.map(c => c.channelId === selectedId
        ? { ...c, lastMessage: body, lastMessageAt: created.createdAt, messageCount: c.messageCount + 1 }
        : c));
    } catch (err: any) {
      toast.error(err.message || 'Could not send that');
      setDraft(body);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft, selectedId, sending]);

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
              selectedId={selectedId} onSelect={setSelectedId} />
            <ChannelGroup label="Private" rows={groups.private}
              selectedId={selectedId} onSelect={setSelectedId} />
            <ChannelGroup label="Direct messages" rows={groups.direct}
              selectedId={selectedId} onSelect={setSelectedId} />
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
                        onTogglePin={() => togglePin(message)}
                        onReact={(emoji) => react(message, emoji)}
                        onDelete={() => deleteMessage(message)}
                      />
                    ))}
                    <div ref={endRef} />
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* ─── Composer ─── */}
            <div className="border-t p-4">
              {canPost ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={inputRef}
                    placeholder={`Message ${channelLabel(selected)}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
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
  label, rows, selectedId, onSelect,
}: {
  label: string;
  rows: ChannelRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
            <ChannelTypeIcon type={channel.type}
              className={active ? 'text-emerald-600' : undefined} />
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
  message, isOwn, isConsecutive, currentMemberId, canModerate,
  onTogglePin, onReact, onDelete,
}: {
  message: Message;
  isOwn: boolean;
  isConsecutive: boolean;
  currentMemberId: string | null;
  canModerate: boolean;
  onTogglePin: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  // Falls back rather than rendering 'undefined': a profile can legitimately
  // have no name yet, and a chat line is still readable without one.
  const senderName = message.sender?.profiles?.fullName || 'Unknown member';
  const initials = initialsOf(message.sender?.profiles?.fullName);

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
        <p className="break-words text-sm leading-relaxed text-foreground/90">{message.body}</p>

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
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className={cn('text-[10px] text-white', avatarColor(member.memberId))}>
                    {initialsOf(member.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.fullName}
                    {member.memberId === currentMemberId && (
                      <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.jobTitle || member.departmentName || member.email}
                  </p>
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
