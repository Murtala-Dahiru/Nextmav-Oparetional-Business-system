'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  X, Pin, Paperclip, Info, Loader2, Download, FolderKanban, Building2,
  UserPlus, Settings, Star, BellOff, Bell, ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/shared/person-avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PresenceDot } from '@/components/shared/presence-dot';
import { formatFileSize, formatRelativeTime, initialsOf, truncate } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

import {
  type ChannelFile, type ChannelMember, type ChannelRow, type Message,
  api, channelLabel, isImage,
} from './types';
import { plainPreview } from './rich-text';
import { Nothing } from './ui';

/**
 * ===========================================================================
 *  What a conversation is, beside the conversation
 * ===========================================================================
 *
 *  -- The problem ----------------------------------------------------------
 *
 *  Everything a channel knows about itself was behind a dropdown: who is in
 *  it, what it is about, what has been pinned and what has been shared. Four
 *  dialogs, each of which covered the conversation to answer a question about
 *  it. And two of them were lying by omission - the pinned view filtered the
 *  forty messages already loaded, and there was no file list at all, so a
 *  contract sent last month could only be found by scrolling to the day it was
 *  sent.
 *
 *  -- Why a rail and not more dialogs --------------------------------------
 *
 *  Because these are all the same question ("what is this room?") asked four
 *  ways, and because the answer is worth having open while you read. A rail is
 *  also the only shape that works on a phone without a second navigation
 *  concept: below `lg` it is the same panel as a full-height sheet.
 *
 *  It is closed by default. A details panel that opens with the module is a
 *  third of the screen spent on something almost nobody needs at that moment.
 */

type Tab = 'about' | 'people' | 'pinned' | 'files';

export function ConversationPanel({
  channel, members, presence, currentMemberId, isMobile,
  onClose, onOpenMessage, onManageMembers, onSettings, onToggleFavourite, onToggleMute,
}: {
  channel: ChannelRow;
  members: ChannelMember[];
  presence: Record<string, { presence: 'online' | 'away' | 'offline'; lastSeenAt: string | null }>;
  currentMemberId: string | null;
  isMobile: boolean;
  onClose: () => void;
  onOpenMessage: (messageId: string) => void;
  onManageMembers: () => void;
  onSettings: () => void;
  onToggleFavourite: () => void;
  onToggleMute: () => void;
}) {
  const openRecord = useAppStore(s => s.openRecord);
  const allows = useAppStore(s => s.allows);
  const [tab, setTab] = React.useState<Tab>('about');
  const [pinned, setPinned] = React.useState<Message[] | null>(null);
  const [files, setFiles] = React.useState<ChannelFile[] | null>(null);

  // Reset when the reader moves to another conversation: a panel that keeps
  // the previous room's tab open is a panel that shows the wrong file list for
  // a moment, which is worse than showing none.
  React.useEffect(() => { setTab('about'); setPinned(null); setFiles(null); }, [channel.channelId]);

  /**
   * Fetched when the tab is opened, not when the panel is.
   *
   * Two lists nobody has asked for is two requests per conversation opened, on
   * a module people leave open all day.
   */
  React.useEffect(() => {
    if (tab === 'pinned' && pinned === null) {
      void api<Message[]>(
        `/api/communication/messages?channelId=${channel.channelId}&pinned=true&pageSize=50`)
        .then(rows => setPinned(rows ?? []))
        .catch(() => setPinned([]));
    }
    if (tab === 'files' && files === null) {
      void api<ChannelFile[]>(`/api/communication/files?channelId=${channel.channelId}`)
        .then(rows => setFiles(rows ?? []))
        .catch(() => setFiles([]));
    }
  }, [tab, pinned, files, channel.channelId]);

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'about', label: 'About' },
    { id: 'people', label: 'People', count: channel.memberCount },
    { id: 'pinned', label: 'Pinned', count: channel.pinnedCount },
    { id: 'files', label: 'Files' },
  ];

  return (
    <aside
      className={cn(
        'flex flex-col border-l bg-card',
        isMobile
          ? 'fixed inset-0 z-50 w-full'
          : 'w-80 shrink-0',
      )}
      aria-label={`${channelLabel(channel)} details`}
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">{channelLabel(channel)}</h2>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onClose}
          aria-label="Close details">
          <X className="size-4" />
        </Button>
      </header>

      <nav className="flex items-center gap-4 border-b px-4" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative -mb-px border-b-2 py-2 text-xs font-medium transition-colors',
              tab === t.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {!!t.count && (
              <span className="ml-1 tabular-nums text-muted-foreground/70">{t.count}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'about' && (
          <div className="space-y-5 px-4 py-4">
            {channel.topic && (
              <Field label="Topic">{channel.topic}</Field>
            )}
            {channel.description && (
              <Field label="Description">{channel.description}</Field>
            )}
            {!channel.topic && !channel.description && (
              <p className="text-sm text-muted-foreground">
                {channel.isAdmin
                  ? 'No description yet. A line here tells people what belongs in this room.'
                  : 'No description yet.'}
              </p>
            )}

            {/*
              What the conversation is about, and the click that opens it.

              This is the whole argument for a communication module living
              inside an operating system: the discussion and the work are one
              click apart, in both directions.
            */}
            {(channel.projectId || channel.companyId || channel.departmentName) && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Connected to
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {channel.projectId && channel.projectName && allows('projects') && (
                    <LinkChip
                      icon={<FolderKanban className="size-3" />}
                      label={channel.projectName}
                      onClick={() => openRecord('projects', 'project', channel.projectId!)}
                    />
                  )}
                  {channel.companyId && channel.companyName && allows('crm') && (
                    <LinkChip
                      icon={<Building2 className="size-3" />}
                      label={channel.companyName}
                      onClick={() => openRecord('crm', 'company', channel.companyId!)}
                    />
                  )}
                  {channel.departmentName && (
                    <span className="inline-flex items-center rounded-md border px-2 py-1 text-[11px] text-muted-foreground">
                      {channel.departmentName}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2 border-t pt-4">
              <PanelAction
                icon={channel.isFavourite ? Star : Star}
                label={channel.isFavourite ? 'Starred' : 'Star this conversation'}
                hint={channel.isFavourite ? 'It sits at the top of your list.' : undefined}
                active={channel.isFavourite}
                onClick={onToggleFavourite}
              />
              {channel.isMember && (
                <PanelAction
                  icon={channel.isMuted ? BellOff : Bell}
                  label={channel.isMuted ? 'Muted' : 'Mute this conversation'}
                  hint={channel.isMuted ? 'You are still told when you are named.' : undefined}
                  active={channel.isMuted}
                  onClick={onToggleMute}
                />
              )}
              {channel.isAdmin && channel.type !== 'direct' && (
                <PanelAction icon={Settings} label="Channel settings" onClick={onSettings} />
              )}
            </div>

            <dl className="space-y-2 border-t pt-4 text-xs">
              <Meta term="Type" value={typeWord(channel)} />
              <Meta term="Who can post" value={postWord(channel)} />
              <Meta term="Messages" value={channel.messageCount.toLocaleString()} />
            </dl>
          </div>
        )}

        {tab === 'people' && (
          <div>
            {channel.type !== 'direct' && (
              <div className="border-b px-4 py-2.5">
                <Button variant="outline" size="sm" className="w-full gap-1.5"
                  onClick={onManageMembers}>
                  <UserPlus className="size-3.5" /> Add people
                </Button>
              </div>
            )}
            {members.length === 0 ? (
              <Nothing>Nobody has joined yet.</Nothing>
            ) : (
              members.map(member => (
                <div key={member.memberId} className="flex items-center gap-2.5 border-b px-4 py-2.5">
                  <PersonAvatar
                    id={member.memberId}
                    name={member.fullName}
                    src={member.avatarUrl}
                    size="md"
                    decorative
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {member.fullName}
                      {member.memberId === currentMemberId && (
                        <span className="text-[11px] font-normal text-muted-foreground">you</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.jobTitle || member.departmentName || member.email}
                    </p>
                  </div>
                  <PresenceDot
                    presence={presence[member.memberId]?.presence ?? member.presence}
                    lastSeenAt={presence[member.memberId]?.lastSeenAt ?? member.lastSeenAt}
                  />
                  {member.role !== 'member' && (
                    <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                      {member.role}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'pinned' && (
          pinned === null ? <Spinner />
            : pinned.length === 0 ? (
              <Nothing>
                Nothing pinned. Pin a message and it stays here: the decisions, not the chatter.
              </Nothing>
            ) : (
              pinned.map(message => (
                <button
                  key={message.id}
                  onClick={() => onOpenMessage(message.id)}
                  className="block w-full border-b px-4 py-3 text-left transition-colors hover:bg-accent"
                >
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Pin className="size-3" />
                    {message.sender?.profiles?.fullName || 'Unknown member'}
                    {' · '}{formatRelativeTime(message.createdAt)}
                  </p>
                  <p className="mt-1 line-clamp-3 text-sm text-foreground/90">
                    {plainPreview(message.body) || 'Shared a file'}
                  </p>
                </button>
              ))
            )
        )}

        {tab === 'files' && (
          files === null ? <Spinner />
            : files.length === 0 ? (
              <Nothing>Nothing has been shared here yet.</Nothing>
            ) : (
              files.map(file => <FileRow key={file.id} file={file} onOpenMessage={onOpenMessage} />)
            )
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground/90">{children}</p>
    </div>
  );
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function LinkChip({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-accent"
    >
      {icon}
      <span className="truncate">{label}</span>
      <ExternalLink className="size-2.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function PanelAction({
  icon: Icon, label, hint, active, onClick,
}: {
  icon: React.ElementType;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'fill-current text-brand' : 'text-muted-foreground')} />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * A shared file, and the two things a person wants to do with it.
 *
 * The link is minted one at a time, on click, because it expires in ten
 * minutes: signing every row to draw the list would mean sixty requests for a
 * panel somebody glanced at, and the links would be stale before they were
 * used.
 */
function FileRow({
  file, onOpenMessage,
}: {
  file: ChannelFile;
  onOpenMessage: (messageId: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);

  const open = React.useCallback(async () => {
    setBusy(true);
    try {
      const signed = await api<{ url: string | null }>(`/api/communication/files/${file.id}`);
      if (!signed?.url) throw new Error('That file could not be opened.');
      window.open(signed.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e.message || 'That file could not be opened');
    } finally {
      setBusy(false);
    }
  }, [file.id]);

  return (
    <div className="group flex items-center gap-2.5 border-b px-4 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
        <Paperclip className="size-3.5 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{truncate(file.filename, 40)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {file.uploader?.profiles?.fullName ?? 'Someone'}
          {' · '}{formatFileSize(file.sizeBytes)}
          {' · '}{formatRelativeTime(file.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {file.messageId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7"
                onClick={() => onOpenMessage(file.messageId!)} aria-label="Go to the message">
                <Info className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Go to the message</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" disabled={busy}
              onClick={() => void open()} aria-label={`Open ${file.filename}`}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isImage(file.mimeType) ? 'View' : 'Download'}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function typeWord(channel: ChannelRow): string {
  if (channel.type === 'direct') return 'Direct message';
  if (channel.type === 'private') return 'Private channel';
  if (channel.type === 'announcement') return 'Announcements';
  return 'Open to everyone';
}

function postWord(channel: ChannelRow): string {
  if (channel.postPolicy === 'admins') return 'Administrators';
  if (channel.postPolicy === 'members') return 'Members';
  return 'Everyone';
}

