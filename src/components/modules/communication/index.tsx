'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Hash, Lock, User, Settings, Search, Send, Pin, PinOff,
  MoreHorizontal, SmilePlus, Menu, Loader2, MessageSquare,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shared/empty-state';
import { formatRelativeTime, getInitials, truncate } from '@/lib/format';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────

interface Channel {
  id: string;
  name: string;
  type: 'public' | 'private' | 'direct';
  description: string;
  _count: { messages: number };
  updatedAt: string;
}

interface Sender {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string;
}

interface Message {
  id: string;
  body: string;
  senderId: string;
  channelId: string;
  isPinned: boolean;
  createdAt: string;
  sender: Sender;
}

interface ChannelWithLastMessage extends Channel {
  lastMessage?: string;
  lastMessageSender?: string;
  unreadCount?: number;
}

// ─── Color Utilities ─────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500',
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getChannelIconColor(type: string) {
  switch (type) {
    case 'public': return 'text-slate-400';
    case 'private': return 'text-amber-500';
    case 'direct': return 'text-emerald-500';
    default: return 'text-slate-400';
  }
}

function ChannelTypeIcon({ type, className }: { type: string; className?: string }) {
  const iconColor = getChannelIconColor(type);
  const cls = cn('size-4 shrink-0', iconColor, className);
  switch (type) {
    case 'private': return <Lock className={cls} />;
    case 'direct': return <User className={cls} />;
    default: return <Hash className={cls} />;
  }
}

// ─── Current User ────────────────────────────────────────────────────
//
// Read from the session rather than assumed. This was the literal string 'u1',
// which matched no member, so every message — including your own — rendered as
// somebody else's: wrong side, wrong colour, no distinction in the thread.

// ─── Component ───────────────────────────────────────────────────────

export default function CommunicationModule() {
  const isMobile = useIsMobile();
  // The membership id, not the account id: messages.sender_id references the
  // membership, so that is what an "is this mine?" comparison has to use.
  const currentMemberId = useAppStore((s) => s.user?.memberId ?? null);
  const [showSidebar, setShowSidebar] = useState(false);

  // ── Data state ──
  const [channels, setChannels] = useState<ChannelWithLastMessage[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Loading states ──
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // ── Refs ──
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Derived ──
  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  // ─── Fetch channels ──────────────────────────────────────────────
  const fetchChannels = useCallback(async () => {
    setChannelsLoading(true);
    try {
      const res = await fetch('/api/communication/channels?pageSize=100');
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }
      const data: Channel[] = json.data ?? [];

      // Fetch last message for each channel
      const enriched: ChannelWithLastMessage[] = await Promise.all(
        data.map(async (ch) => {
          try {
            const msgRes = await fetch(`/api/communication/messages?channelId=${ch.id}&pageSize=1`);
            const msgJson = await msgRes.json();
            const msgs: Message[] = msgJson.data ?? [];
            return {
              ...ch,
              lastMessage: msgs[0]?.body,
              lastMessageSender: msgs[0]?.sender
                ? `${msgs[0].sender.firstName} ${msgs[0].sender.lastName}`
                : undefined,
              unreadCount: 0,
            };
          } catch {
            return { ...ch, unreadCount: 0 };
          }
        }),
      );
      setChannels(enriched);

      // Auto-select first channel
      if (!selectedChannelId && enriched.length > 0) {
        setSelectedChannelId(enriched[0].id);
      }
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setChannelsLoading(false);
    }
  }, [selectedChannelId]);

  // ─── Fetch messages ──────────────────────────────────────────────
  const fetchMessages = useCallback(async (channelId: string) => {
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/communication/messages?channelId=${channelId}&pageSize=100`);
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }
      const data: Message[] = json.data ?? [];
      // Messages come newest-first from API; reverse for chat display
      setMessages([...data].reverse());
    } catch {
      toast.error('Failed to load messages');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // ─── Effects ─────────────────────────────────────────────────────
  useEffect(() => {
    fetchChannels();
  }, []);

  useEffect(() => {
    if (selectedChannelId) {
      fetchMessages(selectedChannelId);
      if (isMobile) setShowSidebar(false);
    }
  }, [selectedChannelId, fetchMessages, isMobile]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Send message ────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const content = messageInput.trim();
    if (!content || !selectedChannelId || sending) return;

    setSending(true);
    setMessageInput('');
    try {
      const res = await fetch('/api/communication/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The endpoint reads `body`. `content` is the pre-migration name and
          // matched nothing, so the server saw an empty message and refused
          // every send with "A message needs text or an attachment".
          body: content,
          // sender_id is taken from the session server-side; sending one here
          // was ignored at best and spoofable at worst.
          channelId: selectedChannelId,
        }),
      });
      const json = await res.json();
      if (json.error) {
        toast.error(json.error.message);
        setMessageInput(content); // restore input on error
        return;
      }
      // Prepend new message to local list
      const newMsg: Message = json.data;
      setMessages((prev) => [...prev, newMsg]);
      toast.success('Message sent');
    } catch {
      toast.error('Failed to send message');
      setMessageInput(content);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [messageInput, selectedChannelId, sending]);

  // ─── Pin/unpin message ───────────────────────────────────────────
  const handleTogglePin = useCallback(async (message: Message) => {
    try {
      const res = await fetch(`/api/communication/messages/${message.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: !message.isPinned }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error.message); return; }
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, isPinned: !m.isPinned } : m)),
      );
      toast.success(message.isPinned ? 'Message unpinned' : 'Message pinned');
    } catch {
      toast.error('Failed to update pin');
    }
  }, []);

  // ─── Keyboard handler ────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ─── Filter channels ─────────────────────────────────────────────
  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // ─── Group channels ──────────────────────────────────────────────
  const publicChannels = filteredChannels.filter((c) => c.type === 'public');
  const privateChannels = filteredChannels.filter((c) => c.type === 'private');
  const directMessages = filteredChannels.filter((c) => c.type === 'direct');

  // ─── Render helpers ──────────────────────────────────────────────
  const onlineCount = 4;

  // ─── Sidebar content ─────────────────────────────────────────────
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <h2 className="text-lg font-semibold text-foreground">Messages</h2>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <Settings className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search channels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
      </div>

      {/* Channel list */}
      <ScrollArea className="flex-1 px-2">
        {channelsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : filteredChannels.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-muted-foreground text-sm">No channels found</p>
          </div>
        ) : (
          <>
            {publicChannels.length > 0 && (
              <ChannelGroup
                label="Public Channels"
                channels={publicChannels}
                selectedChannelId={selectedChannelId}
                onSelect={(id) => setSelectedChannelId(id)}
              />
            )}
            {privateChannels.length > 0 && (
              <ChannelGroup
                label="Private Channels"
                channels={privateChannels}
                selectedChannelId={selectedChannelId}
                onSelect={(id) => setSelectedChannelId(id)}
              />
            )}
            {directMessages.length > 0 && (
              <ChannelGroup
                label="Direct Messages"
                channels={directMessages}
                selectedChannelId={selectedChannelId}
                onSelect={(id) => setSelectedChannelId(id)}
              />
            )}
          </>
        )}
      </ScrollArea>

      {/* Online count */}
      <div className="px-4 py-2 border-t">
        <p className="text-muted-foreground text-xs">
          <span className="inline-block size-2 rounded-full bg-emerald-500 mr-1.5" />
          {onlineCount} online
        </p>
      </div>
    </div>
  );

  // ─── Main render ─────────────────────────────────────────────────
  return (
    <div className="flex h-full">
      {/* Mobile sidebar overlay */}
      {isMobile && showSidebar && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'w-72 shrink-0 border-r bg-card flex flex-col',
          isMobile && 'fixed inset-y-0 left-0 z-50 transition-transform',
          isMobile && !showSidebar && '-translate-x-full',
          isMobile && showSidebar && 'translate-x-0',
        )}
      >
        {sidebarContent}
      </aside>

      {/* Chat area */}
      <main className="flex-1 flex flex-col min-w-0 bg-background">
        {!selectedChannel ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              title="Select a channel"
              description="Choose a channel from the sidebar to start chatting"
            />
          </div>
        ) : (
          <>
            {/* Chat header */}
            <ChatHeader
              channel={selectedChannel}
              memberCount={selectedChannel._count?.messages ?? 0}
              onMobileToggle={() => setShowSidebar(true)}
              isMobile={isMobile}
            />

            {/* Messages */}
            <div className="flex-1 overflow-hidden">
              {messagesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="text-muted-foreground size-6 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <EmptyState
                    icon={MessageSquare}
                    title="No messages yet"
                    description="Be the first to send a message in this channel"
                  />
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-1 p-4">
                    {messages.map((msg, idx) => (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        isOwn={!!currentMemberId && msg.senderId === currentMemberId}
                        isConsecutive={idx > 0 && messages[idx - 1]?.senderId === msg.senderId}
                        onTogglePin={() => handleTogglePin(msg)}
                      />
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* Message input */}
            <div className="border-t p-4">
              <div className="flex items-center gap-2">
                {isMobile && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => setShowSidebar(true)}
                        >
                          <Menu className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Channels</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <Input
                  ref={inputRef}
                  placeholder={`Message #${selectedChannel.name}`}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending}
                  className="flex-1"
                />
                <Button
                  size="icon"
                  className="bg-emerald-600 text-white hover:bg-emerald-700 shrink-0"
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sending}
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function ChannelGroup({
  label,
  channels,
  selectedChannelId,
  onSelect,
}: {
  label: string;
  channels: ChannelWithLastMessage[];
  selectedChannelId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mb-3">
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      {channels.map((channel) => {
        const isActive = channel.id === selectedChannelId;

        return (
          <button
            key={channel.id}
            onClick={() => onSelect(channel.id)}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors group',
              isActive
                ? 'bg-emerald-500/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <ChannelTypeIcon type={channel.type} className={isActive ? 'text-emerald-600' : undefined} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={cn('font-medium truncate', isActive && 'text-emerald-700 dark:text-emerald-400')}>
                  {channel.type === 'direct' ? channel.name.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : channel.name}
                </span>
                {channel.lastMessage && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(channel.updatedAt)}
                  </span>
                )}
              </div>
              {channel.lastMessage && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {channel.lastMessageSender && (
                    <span className="font-medium">{channel.lastMessageSender}: </span>
                  )}
                  {truncate(channel.lastMessage, 40)}
                </p>
              )}
            </div>
            {(channel.unreadCount ?? 0) > 0 && (
              <Badge className="shrink-0 h-5 min-w-[20px] flex items-center justify-center bg-emerald-600 text-white text-[10px] px-1.5 rounded-full">
                {channel.unreadCount}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ChatHeader({
  channel,
  memberCount,
  onMobileToggle,
  isMobile,
}: {
  channel: ChannelWithLastMessage;
  memberCount: number;
  onMobileToggle: () => void;
  isMobile: boolean;
}) {
  const iconColor = getChannelIconColor(channel.type);

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {isMobile && (
          <Button variant="ghost" size="icon" className="shrink-0 size-8" onClick={onMobileToggle}>
            <Menu className="size-4" />
          </Button>
        )}
        <div className={cn('flex items-center justify-center size-7 rounded-md bg-muted', iconColor)}>
          <ChannelTypeIcon type={channel.type} className="size-3.5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-foreground truncate">
            {channel.type === 'direct'
              ? channel.name.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
              : `#${channel.name}`}
          </h3>
          {channel.description && (
            <p className="text-xs text-muted-foreground truncate">{channel.description}</p>
          )}
        </div>
        <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {memberCount} messages
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <Search className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search messages</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <Pin className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Pinned messages</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isOwn,
  isConsecutive,
  onTogglePin,
}: {
  message: Message;
  isOwn: boolean;
  isConsecutive: boolean;
  onTogglePin: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const avatarColor = getAvatarColor(message.senderId);
  const senderName = `${message.sender.firstName} ${message.sender.lastName}`;
  const initials = getInitials(message.sender.firstName, message.sender.lastName);

  return (
    <div
      className={cn(
        'group relative flex gap-2.5 rounded-lg px-3 py-1.5 transition-colors',
        message.isPinned && 'border-l-2 border-amber-400 bg-amber-50/50 dark:bg-amber-950/10',
        isOwn && !message.isPinned && 'bg-emerald-50/60 dark:bg-emerald-950/20',
        hovered && 'bg-muted/50',
        message.isPinned && hovered && 'bg-amber-100/60 dark:bg-amber-950/20',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      {!isConsecutive ? (
        <Avatar className="size-8 shrink-0 mt-0.5">
          <AvatarFallback className={cn('text-white text-xs font-medium', avatarColor)}>
            {initials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="w-8 shrink-0" />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        {!isConsecutive && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="font-semibold text-sm text-foreground">{senderName}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(message.createdAt)}
            </span>
            {message.isPinned && (
              <Pin className="size-3 text-amber-500" />
            )}
          </div>
        )}
        <p className="text-sm text-foreground/90 break-words leading-relaxed">
          {message.body}
        </p>
      </div>

      {/* Hover actions */}
      {hovered && (
        <div className="absolute -top-2 right-2 flex items-center gap-0.5 bg-background border rounded-md shadow-sm p-0.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6">
                  <SmilePlus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>React</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6" onClick={onTogglePin}>
                  {message.isPinned ? (
                    <PinOff className="size-3.5" />
                  ) : (
                    <Pin className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{message.isPinned ? 'Unpin' : 'Pin'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>More</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}