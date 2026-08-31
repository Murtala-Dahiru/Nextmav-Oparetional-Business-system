'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  UserPlus, Loader2, Shield, X, MoreHorizontal, Search, Hash, Lock, Megaphone,
  User as UserIcon, FolderKanban, Building2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { PersonAvatar } from '@/components/shared/person-avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AvatarPresence, PresenceLabel } from '@/components/shared/presence-dot';
import { formatRelativeTime, initialsOf } from '@/lib/format';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

import {
  type ChannelMember, type ChannelRow, type DirectoryMember, type SearchHit,
  api, channelLabel,
} from './types';
import { plainPreview } from './rich-text';

/** A project or client a conversation can be attached to. */
export interface LinkOption { id: string; name: string }

// ═══════════════════════════════════════════════════════════════════════════
//  New channel
// ═══════════════════════════════════════════════════════════════════════════

export function CreateChannelDialog({
  open, onOpenChange, directory, isOrgAdmin, projects, companies, onSubmit, isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: DirectoryMember[];
  isOrgAdmin: boolean;
  projects: LinkOption[];
  companies: LinkOption[];
  onSubmit: (values: {
    displayName: string; description: string; type: string;
    postPolicy: string; joinPolicy: string; memberIds: string[];
    projectId: string | null; companyId: string | null;
  }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('public');
  const [postPolicy, setPostPolicy] = useState('everyone');
  const [projectId, setProjectId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const shown = directory.filter(d =>
    d.fullName.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            A channel is for a topic, a team, a project or a client. Everyone in the company
            can find a public one; a private channel is visible only to the people in it.
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
                  <SelectItem value="public">Public - anyone can find and join</SelectItem>
                  <SelectItem value="private">Private - invitation only</SelectItem>
                  {isOrgAdmin && (
                    <SelectItem value="announcement">Announcements - admins post, everyone reads</SelectItem>
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

          {/*
            What the conversation is about.

            Not a permission - a private project channel is still private, and a
            public one is still public. What it buys is that the channel can be
            opened from the project and the project from the channel, which is
            the difference between a chat tool that sits beside the work and one
            that is part of it.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <FolderKanban className="size-3.5 text-muted-foreground" /> Project
              </Label>
              <Select value={projectId || 'none'}
                onValueChange={(v) => setProjectId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Not about a project" /></SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">Not about a project</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Building2 className="size-3.5 text-muted-foreground" /> Client
              </Label>
              <Select value={companyId || 'none'}
                onValueChange={(v) => setCompanyId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Not about a client" /></SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">Not about a client</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Add people <span className="text-muted-foreground">({picked.length} selected)</span></Label>
            <Input placeholder="Filter colleagues…" value={filter}
              onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
            <ScrollArea className="h-40 rounded-md border">
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
                    <PersonAvatar id={person.memberId} name={person.fullName}
                      src={person.avatarUrl} size="xs" decorative />
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

            disabled={!name.trim() || isSaving}
            onClick={() => onSubmit({
              displayName: name.trim(),
              description,
              type,
              postPolicy,
              joinPolicy: type === 'private' ? 'invite' : 'open',
              memberIds: picked,
              projectId: projectId || null,
              companyId: companyId || null,
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

// ═══════════════════════════════════════════════════════════════════════════
//  Message a colleague
// ═══════════════════════════════════════════════════════════════════════════

export function DirectMessageDialog({
  open, onOpenChange, directory, onPick, isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: DirectoryMember[];
  onPick: (memberId: string) => void;
  isSaving: boolean;
}) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = directory.filter(d =>
    d.fullName.toLowerCase().includes(q)
    || d.email.toLowerCase().includes(q)
    || (d.departmentName ?? '').toLowerCase().includes(q));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Message a colleague</DialogTitle>
          <DialogDescription>
            Opens your existing conversation with them, or starts one.
          </DialogDescription>
        </DialogHeader>

        <Input placeholder="Search by name, email or department…" value={filter} autoFocus
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
                <PersonAvatar id={person.memberId} name={person.fullName}
                  src={person.avatarUrl} size="sm" decorative />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[person.jobTitle, person.departmentName].filter(Boolean).join(' · ') || person.email}
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

// ═══════════════════════════════════════════════════════════════════════════
//  Participants
// ═══════════════════════════════════════════════════════════════════════════

export function MembersDialog({
  open, onOpenChange, channel, members, candidates, currentMemberId,
  onAdd, onRemove, onSetRole, onMessage, isSaving,
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
  onMessage: (id: string) => void;
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
                  header use - so a person cannot read as online here and away
                  two panels over.
                */}
                <AvatarPresence presence={member.presence} lastSeenAt={member.lastSeenAt}>
                  <PersonAvatar id={member.memberId} name={member.fullName}
                    src={member.avatarUrl} size="sm" decorative />
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
                {member.memberId !== currentMemberId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-6 shrink-0">
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onMessage(member.memberId)}>
                        <UserIcon className="mr-2 size-4" /> Message directly
                      </DropdownMenuItem>
                      {canManage && (
                        <>
                          <DropdownMenuSeparator />
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
                        </>
                      )}
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

// ═══════════════════════════════════════════════════════════════════════════
//  Channel settings
// ═══════════════════════════════════════════════════════════════════════════

export function ChannelSettingsDialog({
  open, onOpenChange, channel, isOrgAdmin, projects, companies, onSubmit, isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChannelRow | null;
  isOrgAdmin: boolean;
  projects: LinkOption[];
  companies: LinkOption[];
  onSubmit: (values: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(channel?.displayName || channel?.name || '');
  const [description, setDescription] = useState(channel?.description ?? '');
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [postPolicy, setPostPolicy] = useState(channel?.postPolicy ?? 'everyone');
  const [joinPolicy, setJoinPolicy] = useState(channel?.joinPolicy ?? 'open');
  const [projectId, setProjectId] = useState(channel?.projectId ?? '');
  const [companyId, setCompanyId] = useState(channel?.companyId ?? '');
  const [archived, setArchived] = useState(channel?.isArchived ?? false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <FolderKanban className="size-3.5 text-muted-foreground" /> Project
              </Label>
              <Select value={projectId || 'none'}
                onValueChange={(v) => setProjectId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">Not about a project</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Building2 className="size-3.5 text-muted-foreground" /> Client
              </Label>
              <Select value={companyId || 'none'}
                onValueChange={(v) => setCompanyId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">Not about a client</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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

            disabled={!name.trim() || isSaving}
            onClick={() => onSubmit({
              displayName: name.trim(),
              description, topic,
              postPolicy, joinPolicy,
              projectId: projectId || null,
              companyId: companyId || null,
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

// ═══════════════════════════════════════════════════════════════════════════
//  Search across every conversation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * A filter over the hundred messages the open conversation happened to have
 * loaded. Anything older, or anywhere else, could not be found - which is not
 * a limitation people discover until the moment they need it.
 *
 * `/api/communication/search` is a full-text query whose visibility is decided
 * by `messages_select`, so what comes back is exactly what the caller may
 * read, and the last word is matched as a prefix so results narrow while
 * somebody is still typing.
 */
export function SearchDialog({
  open, onOpenChange, onJump, seed, channels, directory, onOpenChannel, onStartDirect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJump: (hit: SearchHit) => void;
  /** What Home's field was carrying when it handed over. */
  seed?: string;
  channels: ChannelRow[];
  directory: DirectoryMember[];
  onOpenChannel: (channelId: string) => void;
  onStartDirect: (memberId: string) => void;
}) {
  /**
   * The field starts with whatever the caller was typing.
   *
   * An initial value rather than an effect that writes state when `open`
   * changes. The module remounts this component by key when the panel opens,
   * so the seed lands once and nothing overwrites what somebody is typing
   * afterwards. Setting state inside an effect would also cascade an extra
   * render, which this file already went out of its way to avoid for the
   * results below.
   */
  const [query, setQuery] = useState(seed ?? '');
  /**
   * The results, tagged with the query that produced them.
   *
   * ── Why not a plain array plus a loading flag ────────────────────────────
   *
   * Because clearing them would mean `setHits([])` and `setLoading(true)` in
   * the effect body - a synchronous setState inside an effect, which cascades
   * an extra render on every keystroke and is what `react-hooks/set-state-in-
   * effect` exists to catch. Carrying the query alongside the rows lets both
   * "these are stale" and "a request is in flight" be *derived* instead, with
   * no second piece of state to keep in step.
   */
  const [answered, setAnswered] = useState<{ q: string; rows: SearchHit[] }>({ q: '', rows: [] });
  const debounced = useDebounce(query, 220);

  const trimmed = debounced.trim();
  const hits = answered.q === trimmed ? answered.rows : [];
  const loading = trimmed.length >= 2 && answered.q !== trimmed;

  useEffect(() => {
    if (!open || trimmed.length < 2) return;
    let cancelled = false;
    api<SearchHit[]>(`/api/communication/search?q=${encodeURIComponent(trimmed)}`)
      .then(rows => { if (!cancelled) setAnswered({ q: trimmed, rows: rows ?? [] }); })
      .catch(() => { if (!cancelled) setAnswered({ q: trimmed, rows: [] }); });
    return () => { cancelled = true; };
  }, [trimmed, open]);

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; type: SearchHit['channelType']; rows: SearchHit[] }>();
    for (const hit of hits) {
      const entry = map.get(hit.channelId)
        ?? { label: hit.channelLabel, type: hit.channelType, rows: [] };
      entry.rows.push(hit);
      map.set(hit.channelId, entry);
    }
    return [...map.values()];
  }, [hits]);

  /**
   * Conversations and people, matched in the browser.
   *
   * -- Why these two are not a request ---------------------------------------
   *
   * Because the module already holds both lists, permission-filtered by the
   * endpoints that produced them, and they are tens of rows rather than
   * thousands. A round trip to filter an array that is already in memory would
   * add latency to the fastest half of the answer and give the reader a search
   * that gets slower the more precisely they type.
   *
   * Messages go to Postgres because a full-text index over the organisation's
   * whole history is not something a browser can hold.
   */
  const matchedChannels = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (q.length < 2) return [];
    return channels
      .filter(c => channelLabel(c).toLowerCase().includes(q)
        || (c.topic ?? '').toLowerCase().includes(q)
        || (c.projectName ?? '').toLowerCase().includes(q)
        || (c.companyName ?? '').toLowerCase().includes(q))
      .slice(0, 5);
  }, [channels, trimmed]);

  const matchedPeople = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (q.length < 2) return [];
    return directory
      .filter(d => d.fullName.toLowerCase().includes(q)
        || d.email.toLowerCase().includes(q)
        || (d.jobTitle ?? '').toLowerCase().includes(q))
      .slice(0, 5);
  }, [directory, trimmed]);

  const nothingAtAll = !loading && !hits.length && !matchedChannels.length && !matchedPeople.length;

  const close = () => { onOpenChange(false); setQuery(''); };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setQuery(''); }}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Search communication</DialogTitle>
          <DialogDescription>
            Find a message, a conversation or a colleague. Only what you can already read.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Messages, conversations, people"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        <ScrollArea className="max-h-[60vh]">
          {query.trim().length < 2 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Type at least two letters.
            </p>
          )}
          {query.trim().length >= 2 && nothingAtAll && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}

          {/*
            Conversations and people first.

            They are exact, they are instant, and they are usually what
            somebody typing two words is after. Messages take a round trip and
            arrive underneath, which is also the order of confidence.
          */}
          {matchedChannels.length > 0 && (
            <div className="border-b">
              <p className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Conversations
              </p>
              {matchedChannels.map(channel => (
                <button
                  key={channel.channelId}
                  onClick={() => { onOpenChannel(channel.channelId); close(); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-accent"
                >
                  {channel.type === 'direct' ? <UserIcon className="size-3.5 text-muted-foreground" />
                    : channel.type === 'private' ? <Lock className="size-3.5 text-muted-foreground" />
                    : channel.type === 'announcement' ? <Megaphone className="size-3.5 text-muted-foreground" />
                    : <Hash className="size-3.5 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{channelLabel(channel)}</span>
                    {(channel.topic || channel.projectName || channel.companyName) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {channel.topic || channel.projectName || channel.companyName}
                      </span>
                    )}
                  </span>
                  {!channel.isMember && (
                    <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">Not joined</Badge>
                  )}
                </button>
              ))}
            </div>
          )}

          {matchedPeople.length > 0 && (
            <div className="border-b">
              <p className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                People
              </p>
              {matchedPeople.map(person => (
                <button
                  key={person.memberId}
                  onClick={() => { onStartDirect(person.memberId); close(); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-accent"
                >
                  <PersonAvatar id={person.memberId} name={person.fullName}
                    src={person.avatarUrl} size="xs" decorative />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{person.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {person.jobTitle || person.departmentName || person.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">Message</span>
                </button>
              ))}
            </div>
          )}

          {grouped.length > 0 && (
            <p className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Messages
            </p>
          )}

          {grouped.map(group => (
            <div key={group.label} className="border-b last:border-0">
              <p className="flex items-center gap-1.5 bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                {group.type === 'direct' ? <UserIcon className="size-3" />
                  : group.type === 'private' ? <Lock className="size-3" />
                  : group.type === 'announcement' ? <Megaphone className="size-3" />
                  : <Hash className="size-3" />}
                {group.label}
              </p>
              {group.rows.map(hit => (
                <button
                  key={hit.messageId}
                  onClick={() => { onJump(hit); onOpenChange(false); setQuery(''); }}
                  className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-accent/40"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold">{hit.senderName || 'Unknown member'}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(hit.createdAt)}
                    </span>
                    {hit.parentId && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">in a thread</Badge>
                    )}
                  </span>
                  <span className="line-clamp-2 text-sm text-foreground/80">
                    {plainPreview(hit.body)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
