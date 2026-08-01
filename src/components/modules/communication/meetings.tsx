'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff, Hand, Users, Lock, Unlock,
  Calendar, Plus, Loader2, DoorOpen, ShieldCheck, NotebookPen, UserX, Radio,
  Clock, MoreHorizontal, Link2, X, CheckCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/shared/empty-state';
import { formatDateTime, formatRelativeTime, initialsOf } from '@/lib/format';
import { useMeeting } from '@/hooks/use-meeting';
import { useRealtime } from '@/hooks/use-realtime';
import { cn } from '@/lib/utils';

import {
  type ChannelRow, type DirectoryMember, type MeetingParticipant, type MeetingRow,
  api, avatarColor, channelLabel,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
//  The list
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── Why meetings live inside Communication ───────────────────────────────
 *
 * Because a meeting is a conversation with a time attached. Putting them in
 * Calendar would make them an appointment that happens to have a video link,
 * which is the arrangement that leaves everybody reaching for a different
 * application at five to the hour. Here, the channel a team already talks in
 * is the channel they meet in, the meeting's notes land back in it, and the
 * scheduled ones still appear in everybody's calendar because the row writes a
 * `calendar_events` entry through a trigger.
 */
export function MeetingsView({
  meetings, channels, directory, loading, currentMemberId, onRefresh, onOpenRoom, onOpenChannel,
}: {
  meetings: MeetingRow[];
  channels: ChannelRow[];
  directory: DirectoryMember[];
  loading: boolean;
  currentMemberId: string | null;
  onRefresh: () => void;
  onOpenRoom: (meeting: MeetingRow) => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  /**
   * A meeting that has just been started, waiting for the list to carry it.
   *
   * The room needs a row of `meeting_overview()`; the create endpoint answers
   * with the `meetings` row, which is a narrower and differently shaped thing.
   * Rather than assemble the missing half by hand — and have every invented
   * field disagree with the server — the id is held here and the room opens
   * when the refreshed list contains it.
   *
   * A ref rather than state: nothing renders differently while it is set, and
   * clearing it from the effect that consumes it would be a synchronous
   * setState inside an effect — an extra render for a value nobody displays.
   */
  const openWhenLoaded = useRef<string | null>(null);

  useEffect(() => {
    const wanted = openWhenLoaded.current;
    if (!wanted) return;
    const row = meetings.find(m => m.meetingId === wanted);
    if (!row) return;
    openWhenLoaded.current = null;
    onOpenRoom(row);
  }, [meetings, onOpenRoom]);

  const groups = useMemo(() => ({
    live: meetings.filter(m => m.status === 'live'),
    upcoming: meetings.filter(m => m.status === 'scheduled'),
    past: meetings.filter(m => m.status === 'ended' || m.status === 'cancelled'),
  }), [meetings]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-3.5">
        <div>
          <h2 className="text-base font-semibold">Meetings</h2>
          <p className="text-xs text-muted-foreground">
            Voice and video, in the conversation the work already lives in.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => setScheduleOpen(true)}>
          <Plus className="size-3.5" /> New meeting
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-5">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && meetings.length === 0 && (
            <div className="py-10">
              <EmptyState
                icon={Video}
                title="No meetings yet"
                description="Start a call in a channel, or schedule one — it will appear in everybody's calendar."
                action={{ label: 'New meeting', onClick: () => setScheduleOpen(true) }}
              />
            </div>
          )}

          {groups.live.length > 0 && (
            <Section
              title="Happening now"
              accent
              rows={groups.live}
              currentMemberId={currentMemberId}
              onOpenRoom={onOpenRoom}
              onOpenChannel={onOpenChannel}
              onRefresh={onRefresh}
            />
          )}
          {groups.upcoming.length > 0 && (
            <Section
              title="Coming up"
              rows={groups.upcoming}
              currentMemberId={currentMemberId}
              onOpenRoom={onOpenRoom}
              onOpenChannel={onOpenChannel}
              onRefresh={onRefresh}
            />
          )}
          {groups.past.length > 0 && (
            <Section
              title="Past"
              rows={groups.past}
              currentMemberId={currentMemberId}
              onOpenRoom={onOpenRoom}
              onOpenChannel={onOpenChannel}
              onRefresh={onRefresh}
            />
          )}
        </div>
      </ScrollArea>

      <ScheduleMeetingDialog
        key={scheduleOpen ? 'open' : 'closed'}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        channels={channels}
        directory={directory.filter(d => d.memberId !== currentMemberId)}
        onCreated={(meeting) => {
          setScheduleOpen(false);
          onRefresh();
          /**
           * A meeting started now opens its room — but on the row the list
           * comes back with, not on the insert's own shape. The room reads a
           * row of `meeting_overview()`, which carries the host's name, the
           * channel label and the counts; assembling one from the insert would
           * mean inventing those, and every invented field disagrees with the
           * server the moment either changes.
           */
          if (meeting.status === 'live') openWhenLoaded.current = meeting.meetingId;
        }}
      />
    </div>
  );
}

function Section({
  title, rows, accent, currentMemberId, onOpenRoom, onOpenChannel, onRefresh,
}: {
  title: string;
  rows: MeetingRow[];
  accent?: boolean;
  currentMemberId: string | null;
  onOpenRoom: (m: MeetingRow) => void;
  onOpenChannel: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {accent && <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
        </span>}
        {title}
        <span className="font-normal normal-case">({rows.length})</span>
      </h3>
      <div className="grid gap-2.5">
        {rows.map(m => (
          <MeetingCard
            key={m.meetingId}
            meeting={m}
            currentMemberId={currentMemberId}
            onOpenRoom={() => onOpenRoom(m)}
            onOpenChannel={onOpenChannel}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </section>
  );
}

function MeetingCard({
  meeting, onOpenRoom, onOpenChannel, onRefresh,
}: {
  meeting: MeetingRow;
  currentMemberId: string | null;
  onOpenRoom: () => void;
  onOpenChannel: (id: string) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const live = meeting.status === 'live';
  const ended = meeting.status === 'ended';

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(`/api/communication/meetings/${meeting.meetingId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Could not update that meeting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(
      'flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors sm:flex-row sm:items-center',
      live && 'border-rose-300 bg-rose-50/40 dark:border-rose-900 dark:bg-rose-950/10',
      ended && 'opacity-75',
    )}>
      <div className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg',
        live ? 'bg-rose-500/15 text-rose-600' : 'bg-muted text-muted-foreground',
      )}>
        {meeting.mode === 'audio' ? <Mic className="size-5" /> : <Video className="size-5" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-sm font-semibold">{meeting.title}</h4>
          {live && (
            <Badge className="h-5 gap-1 bg-rose-500 px-1.5 text-[10px] text-white hover:bg-rose-500">
              <Radio className="size-2.5" /> Live
            </Badge>
          )}
          {meeting.isLocked && (
            <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
              <Lock className="size-2.5" /> Locked
            </Badge>
          )}
          {meeting.knockingCount > 0 && meeting.amHost && (
            <Badge className="h-5 gap-1 bg-amber-500 px-1.5 text-[10px] text-white hover:bg-amber-500">
              <DoorOpen className="size-2.5" /> {meeting.knockingCount} waiting
            </Badge>
          )}
        </div>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {live && meeting.startedAt
              ? `Started ${formatRelativeTime(meeting.startedAt)}`
              : meeting.scheduledAt
                ? formatDateTime(meeting.scheduledAt)
                : meeting.startedAt
                  ? formatDateTime(meeting.startedAt)
                  : 'Not scheduled'}
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {live ? `${meeting.presentCount} in the room` : `${meeting.invitedCount} invited`}
          </span>
          {meeting.hostName && <><span>·</span><span>Hosted by {meeting.hostName}</span></>}
        </p>

        {(meeting.channelLabel || meeting.projectName) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {meeting.channelLabel && meeting.channelId && (
              <button
                onClick={() => onOpenChannel(meeting.channelId!)}
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent"
              >
                <Link2 className="size-2.5" /> {meeting.channelLabel}
              </button>
            )}
            {meeting.projectName && (
              <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {meeting.projectName}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!ended && meeting.status !== 'cancelled' && (
          <Button
            size="sm"
            disabled={busy}
            onClick={onOpenRoom}
            className={cn('gap-1.5', live
              ? 'bg-rose-600 text-white hover:bg-rose-700'
              : 'bg-emerald-600 text-white hover:bg-emerald-700')}
          >
            <Video className="size-3.5" /> {live ? 'Join' : 'Start'}
          </Button>
        )}

        {meeting.amHost && !ended && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" disabled={busy}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Host</DropdownMenuLabel>
              {live && (
                <DropdownMenuItem onClick={() => void act({ status: 'ended' })}>
                  <PhoneOff className="mr-2 size-4" /> End for everyone
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void act({ isLocked: !meeting.isLocked })}>
                {meeting.isLocked ? <Unlock className="mr-2 size-4" /> : <Lock className="mr-2 size-4" />}
                {meeting.isLocked ? 'Unlock' : 'Lock the room'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void act({ waitingRoom: !meeting.waitingRoom })}>
                <DoorOpen className="mr-2 size-4" />
                {meeting.waitingRoom ? 'Turn off the waiting room' : 'Turn on the waiting room'}
              </DropdownMenuItem>
              {meeting.status === 'scheduled' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={async () => {
                      try {
                        await api(`/api/communication/meetings/${meeting.meetingId}`, { method: 'DELETE' });
                        toast.success('Meeting cancelled');
                        onRefresh();
                      } catch (err: any) {
                        toast.error(err.message || 'Could not cancel that');
                      }
                    }}
                  >
                    <X className="mr-2 size-4" /> Cancel meeting
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Scheduling
// ═══════════════════════════════════════════════════════════════════════════

export function ScheduleMeetingDialog({
  open, onOpenChange, channels, directory, defaultChannelId, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: ChannelRow[];
  directory: DirectoryMember[];
  defaultChannelId?: string | null;
  onCreated: (meeting: { meetingId: string; status: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [duration, setDuration] = useState('30');
  const [channelId, setChannelId] = useState(defaultChannelId ?? '');
  const [waitingRoom, setWaitingRoom] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const invitable = channels.filter(c => c.type !== 'direct' && !c.isArchived);
  const shown = directory.filter(d =>
    d.fullName.toLowerCase().includes(filter.trim().toLowerCase()));

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await api<any>('/api/communication/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          agenda,
          mode,
          channelId: channelId || null,
          scheduledAt: when === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
          durationMinutes: Number(duration) || 30,
          waitingRoom,
          memberIds: picked,
        }),
      });
      toast.success(when === 'now' ? 'Meeting started' : 'Meeting scheduled — it is on the calendar');
      onCreated({ meetingId: created.id, status: created.status });
    } catch (err: any) {
      toast.error(err.message || 'Could not create that meeting');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
          <DialogDescription>
            Start now, or put it in everyone&apos;s calendar. Attach it to a channel and
            that channel is invited automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="meeting-title">What is it about?</Label>
            <Input id="meeting-title" autoFocus value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q3 launch check-in" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>When</Label>
              <Select value={when} onValueChange={(v) => setWhen(v as 'now' | 'later')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="now">Start now</SelectItem>
                  <SelectItem value="later">Schedule it</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as 'video' | 'audio')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video meeting</SelectItem>
                  <SelectItem value="audio">Voice call</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {when === 'later' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="meeting-at">Date and time</Label>
                <Input id="meeting-at" type="datetime-local" value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meeting-len">Length</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="meeting-len"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['15', '30', '45', '60', '90', '120'].map(v => (
                      <SelectItem key={v} value={v}>{v} minutes</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Attach to a conversation</Label>
            <Select value={channelId || 'none'} onValueChange={(v) => setChannelId(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-56">
                <SelectItem value="none">No channel — invite people individually</SelectItem>
                {invitable.map(c => (
                  <SelectItem key={c.channelId} value={c.channelId}>{channelLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {channelId && (
              <p className="text-xs text-muted-foreground">
                Everyone in that channel will be invited, and the meeting will show in it.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>
              Invite people <span className="text-muted-foreground">({picked.length} selected)</span>
            </Label>
            <Input placeholder="Filter colleagues…" value={filter}
              onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
            <ScrollArea className="h-40 rounded-md border">
              <div className="divide-y">
                {shown.map(person => (
                  <label key={person.memberId}
                    className="flex cursor-pointer items-center gap-2.5 p-2.5 hover:bg-accent/40">
                    <Checkbox
                      checked={picked.includes(person.memberId)}
                      onCheckedChange={(checked) => setPicked(prev => checked
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

          <div className="space-y-2">
            <Label htmlFor="meeting-agenda">Agenda</Label>
            <Textarea id="meeting-agenda" rows={2} value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="Optional. Sent with the invitation." />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border p-3">
            <Checkbox checked={waitingRoom} onCheckedChange={(v) => setWaitingRoom(v === true)} />
            <span>
              <span className="block text-sm font-medium">Use a waiting room</span>
              <span className="block text-xs text-muted-foreground">
                People wait at the door until you let them in.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!title.trim() || saving || (when === 'later' && !scheduledAt)}
            onClick={() => void submit()}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {when === 'now' ? 'Start meeting' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  The room
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── What the server decides, and what this component decides ─────────────
 *
 * This component decides nothing about who may be here. It asks to join, the
 * endpoint answers with a state — `joined`, or `knocking` if there is a
 * waiting room — and it renders that answer. The peer connections are then
 * offered only to the membership ids the participant list says are in the
 * room, so a client that lied about being admitted is still connected to
 * nobody: every other browser is consulting the same list.
 */
export function MeetingRoom({
  meeting, currentMemberId, onClose, onRefresh,
}: {
  meeting: MeetingRow;
  currentMemberId: string | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [state, setState] = useState<MeetingParticipant['state'] | null>(null);
  const [joining, setJoining] = useState(true);
  const [showPeople, setShowPeople] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(meeting.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [handUp, setHandUp] = useState(false);

  const me = participants.find(p => p.memberId === currentMemberId) ?? null;
  const amHost = meeting.amHost || ['host', 'cohost'].includes(me?.role ?? '');

  const loadParticipants = useCallback(async () => {
    try {
      setParticipants(await api<MeetingParticipant[]>(
        `/api/communication/meetings/${meeting.meetingId}/participants`,
      ));
    } catch {
      // A failed refresh leaves the last known list, which is better than an
      // empty room mid-meeting.
    }
  }, [meeting.meetingId]);

  /**
   * The host opening a scheduled meeting is what starts it.
   *
   * Not a separate button. "Start" and "join" are the same gesture from the
   * host's side, and a meeting that had to be started and then joined would
   * leave everybody else looking at a room the host is standing outside.
   */
  useEffect(() => {
    if (!meeting.amHost || meeting.status !== 'scheduled') return;
    void api(`/api/communication/meetings/${meeting.meetingId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'live' }),
    }).then(onRefresh).catch(() => undefined);
  }, [meeting.amHost, meeting.status, meeting.meetingId, onRefresh]);

  // Knock, or walk in.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, meta } = await (async () => {
          const res = await fetch(
            `/api/communication/meetings/${meeting.meetingId}/participants`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          );
          const json = await res.json();
          if (json.error) throw new Error(json.error.message);
          return { data: json.data, meta: json.meta ?? {} };
        })();
        if (cancelled) return;
        setState(meta.waiting ? 'knocking' : (data?.state ?? 'joined'));
      } catch (err: any) {
        toast.error(err.message || 'Could not join that meeting');
        onClose();
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meeting.meetingId, onClose]);

  useEffect(() => { void loadParticipants(); }, [loadParticipants]);

  /**
   * The room is live.
   *
   * A hand going up, somebody being admitted or the host ending the meeting
   * are all UPDATEs on `meeting_participants` and `meetings`, both of which
   * were added to the realtime publication in 0023 with REPLICA IDENTITY FULL
   * so a filtered UPDATE is actually delivered.
   */
  useRealtime({
    name: `meeting-room:${meeting.meetingId}`,
    debounceMs: 150,
    tables: [
      { table: 'meeting_participants', filter: `meeting_id=eq.${meeting.meetingId}` },
      { table: 'meetings', filter: `id=eq.${meeting.meetingId}` },
    ],
    onChange: () => { void loadParticipants(); onRefresh(); },
  });

  /** Who is actually in the room, as the server sees it. */
  const inRoom = useMemo(
    () => participants.filter(p => p.state === 'joined' && p.memberId !== currentMemberId)
      .map(p => p.memberId),
    [participants, currentMemberId],
  );

  const media = useMeeting({
    meetingId: meeting.meetingId,
    memberId: currentMemberId,
    admitted: inRoom,
    audioOnly: meeting.mode === 'audio',
    // Nothing is captured, and no connection is offered, until the server has
    // said this person is in the room. A waiting room that still turned your
    // camera on would not be a waiting room.
    enabled: state === 'joined',
  });

  /**
   * The host's mute is enforced locally too.
   *
   * The row is the authority — everybody in the room can see that this person
   * is muted — but the muted browser also has to stop transmitting, or the
   * flag is a label on a microphone that is still open.
   */
  const forceMute = media.forceMute;
  useEffect(() => {
    if (me?.isMuted) forceMute();
  }, [me?.isMuted, forceMute]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    try {
      await api(`/api/communication/meetings/${meeting.meetingId}/participants`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      void loadParticipants();
    } catch (err: any) {
      toast.error(err.message || 'That did not work');
    }
  }, [meeting.meetingId, loadParticipants]);

  const leave = useCallback(async () => {
    try {
      await fetch(`/api/communication/meetings/${meeting.meetingId}/participants`, { method: 'DELETE' });
    } catch { /* leaving should never fail in front of somebody */ }
    onRefresh();
    onClose();
  }, [meeting.meetingId, onClose, onRefresh]);

  const knocking = participants.filter(p => p.state === 'knocking');
  const present = participants.filter(p => p.state === 'joined');

  // ── Waiting room ──
  if (state === 'knocking') {
    return (
      <RoomShell title={meeting.title} onClose={() => void leave()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-white/10">
            <DoorOpen className="size-7 text-white/80" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Waiting to be let in</h3>
            <p className="mt-1 max-w-sm text-sm text-white/60">
              {meeting.hostName ? `${meeting.hostName} will admit you shortly.` : 'The host will admit you shortly.'}
              {' '}Your camera and microphone are off until then.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void leave()}>Cancel</Button>
        </div>
      </RoomShell>
    );
  }

  if (joining || state === null) {
    return (
      <RoomShell title={meeting.title} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-white/60" />
        </div>
      </RoomShell>
    );
  }

  return (
    <RoomShell
      title={meeting.title}
      subtitle={`${present.length} in the room${meeting.channelLabel ? ` · ${meeting.channelLabel}` : ''}`}
      onClose={() => void leave()}
      badge={meeting.isLocked ? 'Locked' : undefined}
    >
      {/* `relative`, so the side panel can cover the room on a phone. */}
      <div className="relative flex min-h-0 flex-1">
        {/* ── The grid ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {media.mediaError && (
            <div className="mx-4 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {media.mediaError}
            </div>
          )}

          <div className={cn(
            'grid flex-1 content-center gap-3 p-4',
            media.peers.length === 0 ? 'grid-cols-1'
              : media.peers.length <= 1 ? 'grid-cols-1 sm:grid-cols-2'
              : media.peers.length <= 3 ? 'grid-cols-2'
              : 'grid-cols-2 lg:grid-cols-3',
          )}>
            <VideoTile
              stream={media.localStream}
              label="You"
              muted
              mirrored={!media.sharing}
              cameraOff={!media.camOn}
              micOff={!media.micOn}
              sharing={media.sharing}
              memberId={currentMemberId ?? 'me'}
            />
            {media.peers.map(peer => {
              const person = participants.find(p => p.memberId === peer.memberId);
              return (
                <VideoTile
                  key={peer.memberId}
                  stream={peer.stream}
                  label={person?.fullName ?? 'Someone'}
                  cameraOff={!person?.cameraOn && !peer.hasVideo}
                  micOff={!!person?.isMuted}
                  handUp={!!person?.handRaisedAt}
                  sharing={!!person?.isSharing}
                  memberId={peer.memberId}
                />
              );
            })}

            {/* Somebody who has joined but has not connected yet gets a tile
                rather than being missing: "is Ada here?" should be answerable
                from the grid, not from the participant panel. */}
            {present
              .filter(p => p.memberId !== currentMemberId
                && !media.peers.some(peer => peer.memberId === p.memberId))
              .map(p => (
                <VideoTile
                  key={p.memberId}
                  stream={null}
                  label={p.fullName}
                  connecting
                  cameraOff
                  micOff={p.isMuted}
                  handUp={!!p.handRaisedAt}
                  memberId={p.memberId}
                />
              ))}
          </div>

          {/* ── Controls ── */}
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 px-4 py-3">
            <TooltipProvider delayDuration={300}>
              <ControlButton
                active={media.micOn}
                disabled={!!me?.isMuted}
                onClick={media.toggleMic}
                on={<Mic className="size-4" />}
                off={<MicOff className="size-4" />}
                label={me?.isMuted ? 'The host has muted you' : media.micOn ? 'Mute' : 'Unmute'}
              />
              {meeting.mode !== 'audio' && (
                <ControlButton
                  active={media.camOn}
                  onClick={media.toggleCam}
                  on={<Video className="size-4" />}
                  off={<VideoOff className="size-4" />}
                  label={media.camOn ? 'Turn camera off' : 'Turn camera on'}
                />
              )}
              <ControlButton
                active={media.sharing}
                activeClass="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => void media.toggleShare()}
                on={<MonitorUp className="size-4" />}
                off={<MonitorUp className="size-4" />}
                label={media.sharing ? 'Stop sharing' : 'Share your screen'}
              />
              <ControlButton
                active={handUp}
                activeClass="bg-amber-500 hover:bg-amber-600"
                onClick={() => { setHandUp(v => !v); void patch({ handRaised: !handUp }); }}
                on={<Hand className="size-4" />}
                off={<Hand className="size-4" />}
                label={handUp ? 'Lower your hand' : 'Raise your hand'}
              />

              <Separator orientation="vertical" className="mx-1 h-8 bg-white/15" />

              <ControlButton
                active={showPeople}
                onClick={() => { setShowPeople(v => !v); setShowNotes(false); }}
                on={<Users className="size-4" />}
                off={<Users className="size-4" />}
                label="Participants"
                badge={amHost && knocking.length ? knocking.length : undefined}
              />
              <ControlButton
                active={showNotes}
                onClick={() => { setShowNotes(v => !v); setShowPeople(false); }}
                on={<NotebookPen className="size-4" />}
                off={<NotebookPen className="size-4" />}
                label="Meeting notes"
              />

              <Separator orientation="vertical" className="mx-1 h-8 bg-white/15" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    className="gap-1.5 rounded-full bg-rose-600 px-4 text-white hover:bg-rose-700"
                    onClick={() => void leave()}
                  >
                    <PhoneOff className="size-4" /> Leave
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Leave the meeting</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* ── Side panel ──
            Full width on a phone, a column on a desktop. A fixed 320px panel
            beside a video grid on a 390px screen leaves 70px for the meeting,
            which is not a smaller version of the layout — it is a broken one.
            On a phone the panel is the screen while it is open, and the grid is
            one tap away. */}
        {(showPeople || showNotes) && (
          <aside className="absolute inset-0 z-10 flex flex-col border-l border-white/10 bg-slate-950/95 sm:relative sm:z-0 sm:w-80 sm:shrink-0 sm:bg-black/30">
            {showPeople && (
              <ParticipantPanel
                participants={participants}
                knocking={knocking}
                amHost={amHost}
                currentMemberId={currentMemberId}
                meetingId={meeting.meetingId}
                onChanged={loadParticipants}
              />
            )}
            {showNotes && (
              <div className="flex flex-1 flex-col p-4">
                <h4 className="mb-2 text-sm font-semibold text-white">Meeting notes</h4>
                <p className="mb-3 text-xs text-white/50">
                  Kept with the meeting, visible to everyone who was in it.
                </p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={14}
                  placeholder="Decisions, actions, who is doing what…"
                  className="flex-1 resize-none border-white/15 bg-white/5 text-sm text-white placeholder:text-white/30"
                />
                <Button
                  size="sm"
                  className="mt-3 gap-1.5"
                  disabled={savingNotes || notes === meeting.notes}
                  onClick={async () => {
                    setSavingNotes(true);
                    try {
                      await api(`/api/communication/meetings/${meeting.meetingId}`, {
                        method: 'PATCH', body: JSON.stringify({ notes }),
                      });
                      toast.success('Notes saved');
                      onRefresh();
                    } catch (err: any) {
                      toast.error(err.message || 'Could not save the notes');
                    } finally {
                      setSavingNotes(false);
                    }
                  }}
                >
                  {savingNotes ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                  Save notes
                </Button>
              </div>
            )}
          </aside>
        )}
      </div>
    </RoomShell>
  );
}

function RoomShell({
  title, subtitle, badge, children, onClose,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
          {subtitle && <p className="truncate text-xs text-white/50">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {badge && (
            <Badge variant="outline" className="border-white/20 text-[10px] text-white/70">
              <Lock className="mr-1 size-2.5" /> {badge}
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="size-8 text-white/70 hover:text-white"
            onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}

function ControlButton({
  active, activeClass, disabled, onClick, on, off, label, badge,
}: {
  active: boolean;
  activeClass?: string;
  disabled?: boolean;
  onClick: () => void;
  on: React.ReactNode;
  off: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'relative size-10 rounded-full',
            active
              ? (activeClass ?? 'bg-white/15 text-white hover:bg-white/25')
              : 'bg-rose-600/90 text-white hover:bg-rose-600',
          )}
          aria-label={label}
        >
          {active ? on : off}
          {!!badge && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
              {badge}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * One tile.
 *
 * The stream is attached in an effect rather than through a `src`: a
 * `MediaStream` is an object, not a URL, and `srcObject` is the only way to
 * give one to a `<video>`. Muted on the local tile without exception —
 * playing your own microphone back through your own speakers is a feedback
 * loop, and every call that has ever howled has done it for this reason.
 */
function VideoTile({
  stream, label, muted, mirrored, cameraOff, micOff, handUp, sharing, connecting, memberId,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirrored?: boolean;
  cameraOff?: boolean;
  micOff?: boolean;
  handUp?: boolean;
  sharing?: boolean;
  connecting?: boolean;
  memberId: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);

  const showVideo = !!stream && !cameraOff;

  return (
    <div className={cn(
      'relative aspect-video overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10',
      handUp && 'ring-2 ring-amber-400',
      sharing && 'ring-2 ring-emerald-400',
    )}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn(
          'size-full object-cover',
          !showVideo && 'invisible',
          mirrored && 'scale-x-[-1]',
        )}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          {connecting ? (
            <Loader2 className="size-6 animate-spin text-white/40" />
          ) : (
            <Avatar className="size-16">
              <AvatarFallback className={cn('text-lg font-medium text-white', avatarColor(memberId))}>
                {initialsOf(label)}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6">
        <span className="truncate text-xs font-medium text-white">{label}</span>
        {micOff && <MicOff className="size-3 shrink-0 text-rose-400" />}
        {handUp && <Hand className="size-3 shrink-0 text-amber-400" />}
        {sharing && <MonitorUp className="size-3 shrink-0 text-emerald-400" />}
      </div>
    </div>
  );
}

function ParticipantPanel({
  participants, knocking, amHost, currentMemberId, meetingId, onChanged,
}: {
  participants: MeetingParticipant[];
  knocking: MeetingParticipant[];
  amHost: boolean;
  currentMemberId: string | null;
  meetingId: string;
  onChanged: () => void;
}) {
  const act = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/communication/meetings/${meetingId}/participants`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      onChanged();
    } catch (err: any) {
      toast.error(err.message || 'That did not work');
    }
  };

  const inRoom = participants.filter(p => p.state === 'joined');
  const invited = participants.filter(p => ['invited', 'admitted'].includes(p.state));

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-5 p-4">
        {amHost && knocking.length > 0 && (
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
              <DoorOpen className="size-3.5" /> Waiting ({knocking.length})
            </h4>
            <div className="space-y-1.5">
              {knocking.map(p => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg bg-white/5 p-2">
                  <Avatar className="size-7">
                    <AvatarFallback className={cn('text-[10px] text-white', avatarColor(p.memberId))}>
                      {initialsOf(p.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{p.fullName}</span>
                  <Button size="sm" className="h-7 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-700"
                    onClick={() => void act({ memberId: p.memberId, state: 'admitted' })}>
                    Admit
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7 text-white/60 hover:text-white"
                    onClick={() => void act({ memberId: p.memberId, state: 'removed' })}
                    aria-label={`Refuse ${p.fullName}`}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
            In the room ({inRoom.length})
          </h4>
          <div className="space-y-1">
            {inRoom.map(p => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                <Avatar className="size-7">
                  <AvatarFallback className={cn('text-[10px] text-white', avatarColor(p.memberId))}>
                    {initialsOf(p.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">
                    {p.fullName}
                    {p.memberId === currentMemberId && <span className="text-white/40"> (you)</span>}
                  </span>
                  {p.role !== 'attendee' && (
                    <span className="flex items-center gap-1 text-[10px] capitalize text-emerald-400">
                      <ShieldCheck className="size-2.5" /> {p.role}
                    </span>
                  )}
                </span>
                {p.handRaisedAt && <Hand className="size-3.5 shrink-0 text-amber-400" />}
                {p.isMuted && <MicOff className="size-3.5 shrink-0 text-rose-400" />}

                {amHost && p.memberId !== currentMemberId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-6 text-white/50 hover:text-white">
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void act({ memberId: p.memberId, isMuted: !p.isMuted })}>
                        {p.isMuted ? <Mic className="mr-2 size-4" /> : <MicOff className="mr-2 size-4" />}
                        {p.isMuted ? 'Allow them to unmute' : 'Mute them'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void act({
                        memberId: p.memberId, role: p.role === 'cohost' ? 'attendee' : 'cohost',
                      })}>
                        <ShieldCheck className="mr-2 size-4" />
                        {p.role === 'cohost' ? 'Remove co-host' : 'Make co-host'}
                      </DropdownMenuItem>
                      {p.handRaisedAt && (
                        <DropdownMenuItem onClick={() => void act({ memberId: p.memberId, handRaised: false })}>
                          <Hand className="mr-2 size-4" /> Lower their hand
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive"
                        onClick={() => void act({ memberId: p.memberId, state: 'removed' })}>
                        <UserX className="mr-2 size-4" /> Remove from meeting
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        </section>

        {invited.length > 0 && (
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/40">
              <Calendar className="size-3" /> Invited, not here ({invited.length})
            </h4>
            <div className="space-y-1">
              {invited.map(p => (
                <div key={p.id} className="flex items-center gap-2 px-2 py-1 opacity-60">
                  <Avatar className="size-6">
                    <AvatarFallback className={cn('text-[10px] text-white', avatarColor(p.memberId))}>
                      {initialsOf(p.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-xs text-white/70">{p.fullName}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </ScrollArea>
  );
}
