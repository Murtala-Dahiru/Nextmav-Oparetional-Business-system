'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Hash, Lock, User, Search, Send, Paperclip, SmilePlus,
  Pin, Users, ChevronDown, MoreVertical, AtSign, Phone,
  Video, ChevronRight, Circle, Bell, BellOff, Settings, PlusCircle,
} from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { channels, messages } from '@/lib/mock-data';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const channelTypeIcon = {
  public: Hash,
  private: Lock,
  direct: User,
} as const;

const channelTypeColor = {
  public: 'text-slate-400',
  private: 'text-amber-500',
  direct: 'text-teal-500',
} as const;

const avatarColors = [
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-indigo-500',
  'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CommunicationModule() {
  const [activeChannelId, setActiveChannelId] = useState(channels[0].id);
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChannel = channels.find((c) => c.id === activeChannelId)!;
  const channelMessages = messages.filter((m) => m.channelId === activeChannelId);
  const pinnedMessages = channelMessages.filter((m) => m.isPinned);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChannelId]);

  const ChannelIcon = channelTypeIcon[activeChannel.type];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full bg-background">
        {/* ── Left Panel: Channel List ──────────────────────────────────── */}
        <motion.div
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-72 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col"
        >
          {/* Header */}
          <div className="p-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-lg text-foreground">Messages</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search channels..."
                className="h-8 pl-8 text-sm bg-background border-border"
              />
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* Channel list */}
          <ScrollArea className="flex-1">
            <div className="p-2">
              <button className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors w-full">
                <ChevronDown className="h-3 w-3" />
                Channels
              </button>

              {channels.map((channel) => {
                const Icon = channelTypeIcon[channel.type];
                const isActive = channel.id === activeChannelId;
                return (
                  <motion.button
                    key={channel.id}
                    whileHover={{ x: 2 }}
                    onClick={() => setActiveChannelId(channel.id)}
                    className={cn(
                      'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left transition-all group relative',
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 mt-0.5 flex-shrink-0',
                        isActive ? 'text-emerald-600 dark:text-emerald-400' : channelTypeColor[channel.type]
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn(
                          'text-sm truncate',
                          channel.type === 'direct' ? 'font-medium' : 'font-medium'
                        )}>
                          {channel.type === 'direct'
                            ? channel.name.split('-').map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(' ')
                            : channel.name}
                        </span>
                        {channel.unreadCount > 0 && (
                          <Badge
                            className="h-4 min-w-4 px-1 text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white border-0 flex-shrink-0"
                          >
                            {channel.unreadCount}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-[11px] text-muted-foreground truncate pr-2">
                          {channel.lastMessage}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground/70">
                          {channel.lastMessageTime}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
                          <Users className="h-2.5 w-2.5" />
                          {channel.memberCount}
                        </span>
                      </div>
                    </div>
                    {isActive && (
                      <motion.div
                        layoutId="channel-indicator"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full bg-emerald-500"
                      />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </ScrollArea>

          {/* Bottom user info */}
          <div className="p-3 border-t border-border">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-emerald-600 text-white text-xs font-semibold">
                  AJ
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">Alex Johnson</p>
                <div className="flex items-center gap-1">
                  <Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" />
                  <span className="text-[11px] text-muted-foreground">Online</span>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Notifications</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </motion.div>

        {/* ── Right Panel: Chat View ────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat Header */}
          <div className="h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <ChannelIcon className="h-4.5 w-4.5 text-emerald-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-foreground truncate">
                    {activeChannel.type === 'direct'
                      ? activeChannel.name.split('-').map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(' ')
                      : activeChannel.name}
                  </h3>
                  {pinnedMessages.length > 0 && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] gap-0.5">
                      <Pin className="h-2.5 w-2.5" />
                      {pinnedMessages.length}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {activeChannel.description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Search className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search messages</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Start call</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Video className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Start video call</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-center">
                    <p className="font-medium">{activeChannel.memberCount} members</p>
                    <p className="text-xs text-muted-foreground">View members</p>
                  </div>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>More options</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Pinned messages banner */}
          <AnimatePresence>
            {pinnedMessages.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-b border-border"
              >
                <div className="px-4 py-2 bg-amber-50/50 dark:bg-amber-950/20 flex items-center gap-2">
                  <Pin className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 truncate">
                    <span className="font-medium">{pinnedMessages.length} pinned message{pinnedMessages.length > 1 ? 's' : ''}</span>
                    {' — '}
                    {pinnedMessages[0].content.slice(0, 80)}{pinnedMessages[0].content.length > 80 ? '...' : ''}
                  </p>
                  <ChevronRight className="h-3.5 w-3.5 text-amber-500 ml-auto flex-shrink-0" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages Area */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-1">
              {/* Channel welcome */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mb-6 pb-4 border-b border-border/50"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                    <ChannelIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-foreground">
                      {activeChannel.type === 'direct'
                        ? activeChannel.name.split('-').map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(' ')
                        : activeChannel.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {activeChannel.description}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  This is the very beginning of the{' '}
                  <strong className="text-foreground">
                    {activeChannel.type === 'direct' ? 'direct message' : `#${activeChannel.name}`}
                  </strong>{' '}
                  channel. {activeChannel.memberCount} members are here.
                </p>
              </motion.div>

              {/* Messages */}
              {channelMessages.map((msg, idx) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * idx, duration: 0.25 }}
                  className={cn(
                    'group flex gap-3 px-2 py-1.5 rounded-md relative',
                    msg.isPinned && 'bg-amber-50/60 dark:bg-amber-950/15'
                  )}
                >
                  {msg.isPinned && (
                    <Pin className="absolute -left-0.5 top-2 h-3 w-3 text-amber-400 opacity-60" />
                  )}
                  <Avatar className="h-8 w-8 mt-0.5 flex-shrink-0">
                    <AvatarFallback
                      className={cn(
                        'text-white text-xs font-medium',
                        getAvatarColor(msg.senderName)
                      )}
                    >
                      {getInitials(msg.senderName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-sm text-foreground hover:underline cursor-pointer">
                        {msg.senderName}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatTime(msg.createdAt)}
                      </span>
                      {msg.isPinned && (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[9px] gap-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0">
                          <Pin className="h-2 w-2" />
                          Pinned
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed mt-0.5">
                      {msg.content}
                    </p>
                  </div>
                  {/* Hover actions */}
                  <div className="absolute -top-4 right-2 hidden group-hover:flex items-center gap-0.5 bg-background border border-border rounded-md shadow-sm px-0.5 py-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>React</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Mention</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <Pin className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{msg.isPinned ? 'Unpin' : 'Pin'}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>More</TooltipContent>
                    </Tooltip>
                  </div>
                </motion.div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Message Input */}
          <div className="p-3 border-t border-border bg-background flex-shrink-0">
            <div className="relative flex items-end gap-2 rounded-lg border border-border bg-muted/40 p-1.5 focus-within:ring-2 focus-within:ring-emerald-500/40 focus-within:border-emerald-500/50 transition-all">
              <div className="flex items-center gap-0.5 pb-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                      <PlusCircle className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Attach file or create</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex-1 min-w-0">
                <Input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={`Message #${activeChannel.name}`}
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-8 text-sm p-0 placeholder:text-muted-foreground/60"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (messageInput.trim()) setMessageInput('');
                    }
                  }}
                />
              </div>
              <div className="flex items-center gap-0.5 pb-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                      <AtSign className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Mention someone</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                      <SmilePlus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Add emoji</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Attach file</TooltipContent>
                </Tooltip>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    size="icon"
                    className="h-7 w-7 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md"
                    onClick={() => { if (messageInput.trim()) setMessageInput(''); }}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </motion.div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">
                    {activeChannel.memberCount} online
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/50">
                Press <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">Shift+Enter</kbd> for new line
              </p>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}