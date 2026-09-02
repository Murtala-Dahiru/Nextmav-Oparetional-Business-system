'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff, Hand, Users, Lock, Unlock,
  Calendar, Plus, Loader2, DoorOpen, ShieldCheck, NotebookPen, UserX, Radio,
  Clock, MoreHorizontal, Link2, X, CheckCheck, RefreshCw, TriangleAlert,
  UserCheck, FileText, UserPlus, WifiOff, ListPlus, ChevronDown, Check,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { PersonAvatar } from '@/components/shared/person-avatar';
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
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDateTime, formatRelativeTime, initialsOf } from '@/lib/format';
import { useMeeting, type PeerHealth } from '@/hooks/use-meeting';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRealtime } from '@/hooks/use-realtime';
import { useAppStore } from '@/store/app-store';
import { intakeBody } from '@/lib/mywork';
import { cn } from '@/lib/utils';

import {
  type ChannelRow, type DirectoryMember, type MeetingParticipant, type MeetingRow,
  api, apiWithMeta, channelLabel,
} from './types';
import { SOLO_MAX, TILE_GAP, TILE_MIN, fitTiles } from './stage-layout';

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
   * Rather than assemble the missing half by hand - and have every invented
   * field disagree with the server - the id is held here and the room opens
   * when the refreshed list contains it.
   *
   * A ref rather than state: nothing renders differently while it is set, and
   * clearing it from the effect that consumes it would be a synchronous
   * setState inside an effect - an extra render for a value nobody displays.
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

  /**
   * How many past meetings are drawn before the reader asks for more.
   *
   * The history is genuinely scrollable now - it was inside a `flex-1`
   * `ScrollArea` with no `min-h-0`, so the viewport grew to its content and
   * nothing ever scrolled, which is why older meetings could not be reached at
   * all. But an organisation two years in has thousands of them, and rendering
   * every card to prove the point would make opening this tab slow for
   * everybody. So: a page at a time, and a control that says how many are
   * left rather than hiding the fact.
   */
  const PAST_PAGE = 25;
  const [pastShown, setPastShown] = useState(PAST_PAGE);

  const groups = useMemo(() => ({
    live: meetings.filter(m => m.status === 'live'),
    /**
     * Soonest first.
     *
     * `meeting_overview()` orders everything by time descending, which is right
     * for what has happened and exactly wrong for what is about to: it put the
     * meeting furthest in the future at the top of "Coming up", so the one
     * starting in ten minutes was at the bottom of the list. Sorted here rather
     * than in SQL because it is a presentation decision and the function has
     * other callers.
     */
    upcoming: meetings
      .filter(m => m.status === 'scheduled')
      .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    past: meetings.filter(m => m.status === 'ended' || m.status === 'cancelled'),
  }), [meetings]);

  // Nothing resets `pastShown` deliberately: this view unmounts when the
  // reader leaves the Meetings tab, so the count starts fresh next time
  // without an effect writing state on every change to the list.

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-3.5">
        <div>
          <h2 className="text-base font-semibold">Meetings</h2>
          <p className="text-xs text-muted-foreground">
            Voice and video, in the conversation the work already lives in.
          </p>
        </div>
        <Button size="sm" className="gap-1.5"
          onClick={() => setScheduleOpen(true)}>
          <Plus className="size-3.5" /> New meeting
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
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
                description="Start a call in a channel, or schedule one - it will appear in everybody's calendar."
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
            <>
              <Section
                title="Earlier"
                rows={groups.past.slice(0, pastShown)}
                total={groups.past.length}
                currentMemberId={currentMemberId}
                onOpenRoom={onOpenRoom}
                onOpenChannel={onOpenChannel}
                onRefresh={onRefresh}
              />
              {groups.past.length > pastShown && (
                <div className="flex justify-center pb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setPastShown(n => n + PAST_PAGE)}
                  >
                    <ChevronDown className="size-3.5" />
                    Show {Math.min(PAST_PAGE, groups.past.length - pastShown)} more
                    <span className="text-muted-foreground">
                      of {groups.past.length - pastShown}
                    </span>
                  </Button>
                </div>
              )}
            </>
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
           * A meeting started now opens its room - but on the row the list
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
  title, rows, accent, total, currentMemberId, onOpenRoom, onOpenChannel, onRefresh,
}: {
  title: string;
  rows: MeetingRow[];
  accent?: boolean;
  /** The size of the whole group, when only part of it is drawn. */
  total?: number;
  currentMemberId: string | null;
  onOpenRoom: (m: MeetingRow) => void;
  onOpenChannel: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {accent && <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        </span>}
        {title}
        <span className="font-normal normal-case tabular-nums text-muted-foreground/70">
          {total && total > rows.length ? `${rows.length} of ${total}` : rows.length}
        </span>
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
  const [notesOpen, setNotesOpen] = useState(false);
  const live = meeting.status === 'live';
  const ended = meeting.status === 'ended';
  const hasNotes = !!(meeting.notes ?? '').trim();

  /**
   * Answer the invitation.
   *
   * `PATCH .../participants` with no `memberId` means "me", which is the
   * only person whose answer this control may change - the endpoint refuses
   * anything else and says so.
   */
  const rsvp = async (state: string) => {
    setBusy(true);
    try {
      await api(`/api/communication/meetings/${meeting.meetingId}/participants`, {
        method: 'PATCH', body: JSON.stringify({ state }),
      });
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Could not send your answer');
    } finally {
      setBusy(false);
    }
  };
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
      live && 'border-destructive/40 bg-destructive/[0.04]',
      ended && 'opacity-75',
    )}>
      <div className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg',
        live ? 'bg-destructive/12 text-destructive' : 'bg-muted text-muted-foreground',
      )}>
        {meeting.mode === 'audio' ? <Mic className="size-5" /> : <Video className="size-5" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-sm font-semibold">{meeting.title}</h4>
          {live && (
            <Badge className="h-5 gap-1 bg-destructive px-1.5 text-[10px] text-white hover:bg-destructive">
              <Radio className="size-2.5" /> Live
            </Badge>
          )}
          {meeting.isLocked && (
            <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
              <Lock className="size-2.5" /> Locked
            </Badge>
          )}
          {meeting.knockingCount > 0 && meeting.amHost && (
            <Badge variant="outline" className="h-5 gap-1 border-warning/50 px-1.5 text-[10px] text-warning">
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

        {(meeting.channelLabel || meeting.projectName || hasNotes) && (
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
            {/* Whether this meeting produced a record is worth knowing from the
                list - it is the difference between opening it and not. */}
            {hasNotes && (
              <button
                onClick={() => setNotesOpen(true)}
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <FileText className="size-2.5" /> Notes
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/*
          Answering an invitation, where the invitation is.

          Offered only while there is something to answer: a scheduled
          meeting the caller has been invited to and has not replied about.
          Once answered it becomes a quiet label, because the useful thing
          afterwards is knowing what you said, not being asked again.
        */}
        {meeting.status === 'scheduled' && meeting.myRole !== 'host' && (
          meeting.myState === 'invited' ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
                disabled={busy} onClick={() => void rsvp('accepted')}>
                <Check className="size-3" /> Going
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                disabled={busy} onClick={() => void rsvp('tentative')}>
                Maybe
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground"
                disabled={busy} onClick={() => void rsvp('declined')}>
                No
              </Button>
            </div>
          ) : ['accepted', 'tentative', 'declined'].includes(meeting.myState ?? '') ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void rsvp('invited')}
              className="rounded border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Change your answer"
            >
              {meeting.myState === 'accepted' ? 'Going'
                : meeting.myState === 'tentative' ? 'Maybe' : 'Not going'}
            </button>
          ) : null
        )}

        {!ended && meeting.status !== 'cancelled' && (
          <Button
            size="sm"
            disabled={busy}
            onClick={onOpenRoom}
            className={cn('gap-1.5', live
              ? 'bg-destructive text-white hover:bg-destructive/90'
              : '')}
          >
            <Video className="size-3.5" /> {live ? 'Join' : 'Start'}
          </Button>
        )}

        {/*
          Notes, on every card, whatever the meeting's state.

          They used to live only inside the room, and the room could only be
          opened while the meeting was still running - so the moment a meeting
          ended, everything written in it became unreachable. That is the dead
          end this button removes: a meeting that has happened is exactly when
          somebody goes looking for what was decided.
        */}
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={ended || hasNotes ? 'outline' : 'ghost'}
                className="gap-1.5"
                onClick={() => setNotesOpen(true)}
              >
                <NotebookPen className="size-3.5" />
                <span className={cn(!ended && !hasNotes && 'sr-only')}>Notes</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {hasNotes ? 'Read the meeting notes'
                : meeting.amHost ? 'Write up this meeting'
                : 'No notes yet'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

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

      {/* Deliberately not keyed to `notesOpen`: remounting on close would
          discard a draft somebody had typed, and the notes of a meeting are
          usually written once. The draft lives until it is saved. */}
      <MeetingNotesDialog
        meeting={meeting}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        onOpenChannel={onOpenChannel}
        onSaved={onRefresh}
      />
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What was decided
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the notes needed a home outside the room ──────────────────────────
 *
 * `meetings.notes` has been written since 0023 and could only ever be read
 * from the side panel of a running meeting. A meeting that ended took its own
 * record with it: the card no longer offered a way in, and there was no other
 * screen that showed the column at all. Everything that had been typed was
 * still in the database and nothing could reach it - the same shape of defect
 * as `is_muted` and `department_id` before it.
 *
 * So this is the reading surface, and it carries the context that makes a note
 * mean something a month later: when the meeting ran, who hosted it, and the
 * conversation and project it belongs to - each of which opens.
 *
 * Editing is offered to the host and co-hosts, which is what `meetings_update`
 * permits; for everybody else it is the record, read-only, rather than a box
 * whose Save button returns 403.
 */
function MeetingNotesDialog({
  meeting, open, onOpenChange, onOpenChannel, onSaved,
}: {
  meeting: MeetingRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChannel: (id: string) => void;
  onSaved: () => void;
}) {
  const saved = meeting.notes ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notes = draft ?? saved;
  const canEdit = meeting.amHost && meeting.status !== 'cancelled';
  const dirty = draft !== null && draft !== saved;

  const when = meeting.startedAt ?? meeting.scheduledAt;

  const [filing, setFiling] = useState(false);
  const allows = useAppStore(st => st.allows);

  /**
   * Write the notes into the workspace as a document.
   *
   * The header is assembled here rather than left to the reader because a
   * page called "Weekly delivery review" with no date and no attendee list is
   * the thing people find in a year and cannot use. Everything in it is a
   * fact the meeting already carries; nothing is invented.
   */
  const fileToWorkspace = async () => {
    setFiling(true);
    try {
      const when = meeting.startedAt ?? meeting.scheduledAt;
      const header = [
        `# ${meeting.title}`,
        '',
        when ? `**When** ${formatDateTime(when)}` : null,
        meeting.hostName ? `**Host** ${meeting.hostName}` : null,
        meeting.channelLabel ? `**Conversation** ${meeting.channelLabel}` : null,
        meeting.projectName ? `**Project** ${meeting.projectName}` : null,
        '',
        '---',
        '',
      ].filter(v => v !== null).join('\n');

      const page = await api<{ id: string }>('/api/workspace/pages', {
        method: 'POST',
        body: JSON.stringify({
          title: `${meeting.title} - notes`,
          content: `${header}${notes}`,
          icon: 'file-text',
        }),
      });

      toast.success('Saved to Workspace', {
        description: 'The meeting keeps its own copy as well.',
        action: allows('workspace')
          ? {
            label: 'Open it',
            onClick: () => useAppStore.getState().openRecord('workspace', 'page', page.id),
          }
          : undefined,
      });
    } catch (err: any) {
      toast.error(err.message || 'Could not save that to Workspace');
    } finally {
      setFiling(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/communication/meetings/${meeting.meetingId}`, {
        method: 'PATCH', body: JSON.stringify({ notes }),
      });
      setDraft(null);
      toast.success('Notes saved');
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Could not save the notes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{meeting.title}</span>
          </DialogTitle>
          <DialogDescription>
            {[
              when ? formatDateTime(when) : 'Not scheduled',
              meeting.hostName ? `Hosted by ${meeting.hostName}` : null,
              meeting.status === 'ended' ? 'Ended'
                : meeting.status === 'live' ? 'Happening now'
                : meeting.status === 'cancelled' ? 'Cancelled' : 'Upcoming',
            ].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>

        {(meeting.channelLabel || meeting.projectName) && (
          <div className="flex flex-wrap gap-1.5">
            {meeting.channelLabel && meeting.channelId && (
              <button
                onClick={() => { onOpenChannel(meeting.channelId!); onOpenChange(false); }}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Link2 className="size-3" /> {meeting.channelLabel}
              </button>
            )}
            {meeting.projectName && (
              <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                {meeting.projectName}
              </span>
            )}
          </div>
        )}

        {meeting.agenda?.trim() && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Agenda
            </p>
            <p className="whitespace-pre-wrap text-sm">{meeting.agenda}</p>
          </div>
        )}

        {canEdit ? (
          <div className="space-y-2">
            <Label htmlFor="meeting-notes">Notes</Label>
            <Textarea
              id="meeting-notes"
              rows={12}
              value={notes}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Decisions, actions, who is doing what…"
              className="resize-none"
            />
          </div>
        ) : notes.trim() ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">{notes}</p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">Nothing was written up for this meeting.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The host and co-hosts can add notes during or after it.
            </p>
          </div>
        )}

        {/*
          What the meeting produced, as work.

          -- Why this is a line and not a list ------------------------------

          Notes hold the decisions. An action item is a different thing: it is
          owed by somebody after everyone has left the room, and a note that
          says "Ada to send the contract" is a sentence nobody will read again.
          So the one action worth offering here is the one that takes it out of
          the notes and puts it where work lives.

          It creates a personal to-do pointing at this meeting, through the
          same intake every other module uses. Deliberately not a shared task
          list attached to the meeting: that would be a fourth place work can
          live, beside My Work, Projects and Support, and this product already
          decided where personal work goes.
        */}
        {meeting.status !== 'cancelled' && <ActionItemRow meeting={meeting} />}

        <DialogFooter className="sm:items-center">
          {dirty && (
            <span className="mr-auto text-xs text-warning">
              Unsaved changes - they are kept until you save.
            </span>
          )}
          {/*
            The record, kept where records are kept.

            A meeting's notes live on the meeting, which is right for finding
            them from the meeting and wrong for everything else: nobody
            searches a meeting list for a decision six months later. This
            writes them into the workspace as a document, with the meeting's
            title, date and participants at the top - and leaves the original
            alone, because a copy that replaces the original is a way to lose
            things.

            Offered only once there is something to keep.
          */}
          {notes.trim() && allows('workspace', 'create') && (
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={filing}
              onClick={() => void fileToWorkspace()}
            >
              {filing ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              Save to Workspace
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canEdit && (
            <Button
              className="gap-1.5"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
              Save notes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Ada to send the contract by Friday", turned into something Ada will see.
 *
 * One field and one button, under the notes. Each add clears the field and
 * leaves the focus where it was, so three actions agreed in a meeting take
 * three sentences and no navigation. The confirmation offers My Work rather
 * than taking anybody there, because the person is still writing the notes up.
 */
function ActionItemRow({ meeting }: { meeting: MeetingRow }) {
  const allows = useAppStore(s => s.allows);
  const setActiveModule = useAppStore(s => s.setActiveModule);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(0);

  if (!allows('mywork')) return null;

  const add = async () => {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intakeBody(clean, {
          module: 'communication',
          type: 'meeting',
          id: meeting.meetingId,
          label: meeting.title,
        })),
      });
      const json = await res.json().catch(() => null);
      if (json?.error) throw new Error(json.error.message || 'Could not add it');
      if (!res.ok) throw new Error(`Could not add it (${res.status})`);

      setText('');
      setAdded(n => n + 1);
      toast.success('On your list', {
        description: 'Private to you, and it points back at this meeting.',
        action: { label: 'Open My Work', onClick: () => setActiveModule('mywork') },
      });
    } catch (e: any) {
      toast.error(e.message || 'Could not add that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="meeting-action">Action items</Label>
      <div className="flex items-center gap-2">
        <Input
          id="meeting-action"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
          placeholder="Something you are taking away from this"
          className="h-9"
        />
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5"
          disabled={saving || !text.trim()} onClick={() => void add()}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <ListPlus className="size-3.5" />}
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {added > 0
          ? `${added} added to your list. They are private to you.`
          : 'Goes to My Work, linked back to this meeting.'}
      </p>
    </div>
  );
}

// ===========================================================================
//  Scheduling
// ===========================================================================

/** One interval a person is already committed for. From `member_availability()`. */
interface BusyWindow {
  memberId: string;
  busyFrom: string;
  busyTo: string;
  /** They accepted, as against having been invited and not answered. */
  confirmed: boolean;
}

/** A slot in which nobody on the list is committed. */
interface Suggestion {
  startsAt: string;
  endsAt: string;
}

export function ScheduleMeetingDialog({
  open, onOpenChange, channels, directory, defaultChannelId, seed, defaultGuestId, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: ChannelRow[];
  directory: DirectoryMember[];
  defaultChannelId?: string | null;
  /**
   * A message this meeting is about.
   *
   * "Let's meet Friday at 2" is the commonest way a meeting gets called, and
   * before this the only way to act on it was to open a form and retype the
   * sentence. The message becomes the agenda, so the invitation says what it
   * is for. Nothing is parsed out of it: the *time* is still chosen by a
   * person, because a guess that is right four times in five puts the fifth
   * meeting in the wrong week.
   */
  seed?: { title: string; agenda: string } | null;
  /**
   * A colleague already on the guest list.
   *
   * Set by "Meet" on somebody's profile in People. It seeds the list and
   * nothing else: who else should be there, and when, are decisions the
   * profile screen has no business making.
   */
  defaultGuestId?: string | null;
  onCreated: (meeting: { meetingId: string; status: string }) => void;
}) {
  const [title, setTitle] = useState(seed?.title ?? '');
  const [agenda, setAgenda] = useState(seed?.agenda ?? '');
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  // A meeting called out of a message is nearly always for later; one called
  // from the toolbar is nearly always now.
  const [when, setWhen] = useState<'now' | 'later'>(seed ? 'later' : 'now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [duration, setDuration] = useState('30');
  const [channelId, setChannelId] = useState(defaultChannelId ?? '');
  const [waitingRoom, setWaitingRoom] = useState(true);
  const [picked, setPicked] = useState<string[]>(defaultGuestId ? [defaultGuestId] : []);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * Who is already committed, and when everybody is free.
   *
   * -- Why this is fetched rather than assumed ---------------------------
   *
   * `member_availability()` reads the real calendar: events, and the guests
   * a scheduled meeting mirrors onto them. It answers with intervals only -
   * no titles - which is the least that answers "can we meet at three" and
   * the reason it can be answered about a colleague at all.
   *
   * Nothing here invents availability. If the endpoint returns nothing, the
   * interface says it found no clash rather than claiming everybody is free.
   */
  const [busy, setBusy] = useState<BusyWindow[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const invitable = channels.filter(c => c.type !== 'direct' && !c.isArchived);
  const shown = directory.filter(d =>
    d.fullName.toLowerCase().includes(filter.trim().toLowerCase()));

  /**
   * The next seven days for the people currently on the list.
   *
   * Keyed on the picked ids and the duration rather than on the chosen time:
   * moving the time re-reads the same window, and one request per keystroke
   * in a datetime field is a request per keystroke.
   */
  const pickedKey = picked.join(",");

  useEffect(() => {
    if (!open || when !== "later" || !picked.length) {
      return;
    }
    let cancelled = false;
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 86_400_000);

    void apiWithMeta<BusyWindow[]>(
      `/api/communication/availability?memberIds=${encodeURIComponent(pickedKey)}`
      + `&from=${from.toISOString()}&to=${to.toISOString()}`
      + `&duration=${Number(duration) || 30}`)
      .then(page => {
        if (cancelled) return;
        setBusy(page.data ?? []);
        setSuggestions(Array.isArray(page.meta?.suggestions) ? page.meta.suggestions : []);
      })
      .catch(() => {
        // A scheduler that cannot read the calendar still schedules. It just
        // stops claiming to know who is free.
        if (!cancelled) { setBusy(null); setSuggestions([]); }
      });

    return () => { cancelled = true; };
  }, [open, when, pickedKey, duration, picked.length]);

  /** Whether a given person is committed at the time currently chosen. */
  const clashesAt = useCallback((memberId: string): boolean => {
    if (!busy || when !== "later" || !scheduledAt) return false;
    const start = new Date(scheduledAt).getTime();
    if (Number.isNaN(start)) return false;
    const end = start + (Number(duration) || 30) * 60_000;
    return busy.some(w => w.memberId === memberId
      && new Date(w.busyFrom).getTime() < end
      && new Date(w.busyTo).getTime() > start);
  }, [busy, when, scheduledAt, duration]);

  const clashing = picked.filter(clashesAt);
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
      toast.success(when === 'now' ? 'Meeting started' : 'Meeting scheduled - it is on the calendar');
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
                {/* `min` is the local clock, not UTC: `toISOString()` here
                    would offer a picker refusing times the user considers
                    perfectly future. Scheduling a meeting into the past puts
                    an appointment on everybody's calendar that has already
                    been missed. */}
                <Input id="meeting-at" type="datetime-local" value={scheduledAt}
                  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
                    .toISOString().slice(0, 16)}
                  onChange={(e) => setScheduledAt(e.target.value)} />
                {when === 'later' && scheduledAt && new Date(scheduledAt) < new Date() && (
                  <p className="text-xs text-destructive">That time has already passed.</p>
                )}

                {/*
                  When everybody is free.

                  Offered only when somebody has been invited, because with
                  nobody on the list every slot is free and the suggestion is
                  a statement of the obvious. Read from the real calendar; if
                  the endpoint finds nothing that fits, nothing is offered
                  rather than a slot that will not work.
                */}
                {when === 'later' && picked.length > 0 && suggestions.length > 0 && (
                  <div className="pt-1">
                    <p className="pb-1 text-[11px] text-muted-foreground">
                      Everyone invited is free at
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map(slot => (
                        <button
                          key={slot.startsAt}
                          type="button"
                          onClick={() => setScheduledAt(toLocalInput(slot.startsAt))}
                          className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent"
                        >
                          {whenLabel(slot.startsAt)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
                <SelectItem value="none">No channel - invite people individually</SelectItem>
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
            {when === 'later' && scheduledAt && picked.length > 0 && (
              <p className={cn(
                'text-xs',
                clashing.length ? 'text-warning' : 'text-muted-foreground',
              )}>
                {clashing.length
                  ? `${clashing.length} of them ${clashing.length === 1 ? 'is' : 'are'} already booked then.`
                  : busy === null
                    ? 'Availability could not be read.'
                    : 'Nobody invited has a clash at that time.'}
              </p>
            )}
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
                    <PersonAvatar id={person.memberId} name={person.fullName}
                      src={person.avatarUrl} size="xs" decorative />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{person.fullName}</span>
                      {person.jobTitle && (
                        <span className="block truncate text-xs text-muted-foreground">{person.jobTitle}</span>
                      )}
                    </span>
                    {/*
                      Busy, from the calendar rather than from a guess.

                      Shown against the time currently chosen, so it appears
                      and disappears as the time moves - which is what makes
                      it useful while deciding rather than a label to read
                      afterwards.
                    */}
                    {clashesAt(person.memberId) && (
                      <span className="shrink-0 rounded border border-warning/50 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        Busy
                      </span>
                    )}
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
            
            disabled={
              !title.trim() || saving
              || (when === 'later' && (!scheduledAt || new Date(scheduledAt) < new Date()))
            }
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
 * endpoint answers with a state - `joined`, or `knocking` if there is a
 * waiting room - and it renders that answer. The peer connections are then
 * offered only to the membership ids the participant list says are in the
 * room, so a client that lied about being admitted is still connected to
 * nobody: every other browser is consulting the same list.
 *
 * ── Why it keeps asking ──────────────────────────────────────────────────
 *
 * The answer to "am I in?" changes while the room is open, and it changes on
 * the *server* - the host admits somebody, refuses somebody, ends the meeting,
 * turns the waiting room off. The component used to ask once, on mount, and
 * treat the reply as settled, which meant every one of those decisions reached
 * a browser that had stopped listening: an admitted guest waiting at a door
 * that had been opened for them, a refused one waiting at a door that never
 * would be, and everybody else holding a room open on a meeting that had
 * finished.
 *
 * So `seat` below is the last answer received rather than the only one, and
 * the participant row - delivered by the subscription, or polled when the
 * socket cannot connect - is what moves it. Every transition ends somewhere a
 * person can act from: in the room, told why they are not, or offered a retry.
 * There is no state in which this renders a spinner and waits for something
 * that will not come.
 *
 * `meeting` is a live row, not a snapshot. See the note on `activeMeetingId`
 * in the module shell for why holding a copy of it was the source of half of
 * the above.
 */
/**
 * The room, holding its own meeting.
 *
 * ── Why this is not the module's row any more ────────────────────────────
 *
 * It used to take `meeting: MeetingRow` from the module's list, and be rendered
 * only while that list happened to contain it. Which made every refetch of that
 * list a hazard: one request that failed, raced, or came back a moment stale
 * and the row was gone for a render - the room unmounted, the peer connections
 * closed, the camera stopped, and everybody in the meeting was dropped by
 * somebody else's background fetch. Saving the notes triggered exactly that
 * refetch, which is why writing them up could put people out of the call.
 *
 * A meeting is not a view of a list. It fetches its own row, by id, and keeps
 * the last one it had if a refresh fails. The only thing that closes it is the
 * server saying the meeting has ended, or that it no longer exists.
 */
export function MeetingRoom({
  meetingId, initial, currentMemberId, directory, autoJoin, onClose,
}: {
  meetingId: string;
  /**
   * The row the module already had, if it had one.
   *
   * Only a seed for the first paint - the room refetches immediately either
   * way. Passing it means opening a meeting from the list is instant rather
   * than a spinner over a request that was already answered a second ago.
   */
  initial?: MeetingRow;
  currentMemberId: string | null;
  /** Colleagues who can be pulled into a meeting that has already started. */
  directory: DirectoryMember[];
  /**
   * Skip the green room.
   *
   * True for exactly one gesture: "start a call in this conversation", where
   * the person has already decided and a confirmation step is a step
   * backwards. Every other route in - a scheduled meeting, a Join button, an
   * invitation - goes through the lobby, because in those the decision is the
   * whole point.
   */
  autoJoin?: boolean;
  /**
   * Closing is also what refreshes the module behind the room - the list is
   * caught up once, on the way out, rather than on every event inside a
   * meeting. See `closeMeeting` in the module shell.
   */
  onClose: () => void;
}) {
  const [meeting, setMeeting] = useState<MeetingRow | null>(initial ?? null);
  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);
  /**
   * What the green room decided, or null while it is still open.
   *
   * The room is not mounted until this is set, which is what makes the lobby a
   * real step rather than an overlay: no join request is sent, no media is
   * acquired by the mesh, and nobody in the meeting sees anybody arrive until
   * the person has actually chosen to.
   */
  const [entry, setEntry] = useState<{ micOn: boolean; camOn: boolean } | null>(
    autoJoin ? { micOn: true, camOn: true } : null,
  );

  /**
   * Asking again is a counter, and the fetch lives in the effect.
   *
   * The obvious shape - an async `useCallback` the effect calls - is what
   * `react-hooks/set-state-in-effect` objects to, and the objection has a point
   * here: the request has to be abandoned when the room closes or the meeting
   * changes, and a callback that owns its own setState has nowhere to put that.
   * A tick the effect reads is one place to express both.
   */
  const [reloadTick, setReloadTick] = useState(0);
  const loadMeeting = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api<MeetingRow[]>(
          `/api/communication/meetings?id=${encodeURIComponent(meetingId)}`);
        if (cancelled) return;
        if (rows?.length) { setMeeting(rows[0]); setGone(false); }
        // An empty answer is the server saying this meeting is not there - for
        // this caller, which is the same thing. `meeting_overview()` returns
        // only what the caller may see, so "deleted" and "never yours" arrive
        // alike, and both mean the room should close.
        else setGone(true);
      } catch {
        // A failed refresh keeps the last known row. Half a second of network
        // trouble is not a reason to end somebody's meeting.
      }
    })();
    return () => { cancelled = true; };
  }, [meetingId, reloadTick]);

  /** No loading state without a way out of it. */
  useEffect(() => {
    if (meeting || gone) return;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [meeting, gone]);

  if (gone) {
    return (
      <RoomShell title="Meeting" onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-white/10">
            <Video className="size-7 text-white/60" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">This meeting is no longer available</h3>
            <p className="mt-1 max-w-sm text-sm text-white/60">
              It was cancelled, or it is not one you have been invited to.
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </RoomShell>
    );
  }

  if (!meeting) {
    return (
      <RoomShell title="Meeting" onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {slow ? (
            <>
              <TriangleAlert className="size-6 text-amber-300" />
              <p className="max-w-sm text-sm text-white/70">
                This is taking longer than it should. The meeting could not be loaded.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button className="gap-1.5"
                  onClick={() => { setSlow(false); void loadMeeting(); }}>
                  <RefreshCw className="size-3.5" /> Try again
                </Button>
              </div>
            </>
          ) : (
            <>
              <Loader2 className="size-6 animate-spin text-white/60" />
              <p className="text-xs text-white/40">Opening the meeting…</p>
            </>
          )}
        </div>
      </RoomShell>
    );
  }

  if (!entry) {
    return (
      <MeetingLobby
        meeting={meeting}
        currentMemberId={currentMemberId}
        onJoin={setEntry}
        onClose={onClose}
      />
    );
  }

  return (
    <Room
      meeting={meeting}
      currentMemberId={currentMemberId}
      directory={directory}
      startMuted={!entry.micOn}
      startCameraOff={!entry.camOn}
      onClose={onClose}
      onMeetingChanged={loadMeeting}
    />
  );
}

function Room({
  meeting, currentMemberId, directory, startMuted, startCameraOff, onClose, onMeetingChanged,
}: {
  meeting: MeetingRow;
  currentMemberId: string | null;
  directory: DirectoryMember[];
  /** What the green room chose. See `MeetingLobby`. */
  startMuted?: boolean;
  startCameraOff?: boolean;
  onClose: () => void;
  /** Refetch this room's own meeting row. */
  onMeetingChanged: () => void;
}) {
  const isMobile = useIsMobile();
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  /**
   * Where the caller stands at the door, as the server last answered.
   *
   * ── Why this is a small machine and not one nullable enum ────────────────
   *
   * It used to be `MeetingParticipant['state'] | null`, set once from the join
   * response and never touched again, and that produced three dead ends that
   * no amount of realtime could clear:
   *
   *   · The host admits somebody. The endpoint writes `admitted`, which is a
   *     *permission*, not a seat - a second POST is what turns it into
   *     `joined`. Nothing sent one, so the admitted guest sat on "Waiting to
   *     be let in" for the length of the meeting while everybody else could
   *     see them in the list.
   *   · The host refuses somebody. The row goes to `removed` and the browser
   *     was never told, so the refusal looked identical to being ignored.
   *   · The host ends the meeting. Every row goes to `left` and every other
   *     participant kept a room open on a meeting that no longer existed.
   *
   * The cure is that this is derived from the participant row from here on,
   * and the row arrives over the subscription below.
   */
  const [seat, setSeat] = useState<'joining' | 'knocking' | 'in' | 'refused' | 'failed'>('joining');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  /**
   * The notes being typed, or `null` for "whatever the server has".
   *
   * Holding the draft as an override rather than as a copy is what lets the
   * live row flow through without an effect to sync it: with nothing typed the
   * panel shows what was last saved - including a save by somebody else in the
   * same meeting - and once there is a draft, the draft wins until it is saved.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  const saved = meeting.notes ?? '';
  const notes = draft ?? saved;

  const me = participants.find(p => p.memberId === currentMemberId) ?? null;
  const amHost = meeting.amHost || ['host', 'cohost'].includes(me?.role ?? '');
  /**
   * The hand is the row's, not the browser's.
   *
   * It was local state, so a host lowering somebody's hand changed the roster
   * for everybody and left the owner's own button still lit.
   */
  const handUp = !!me?.handRaisedAt;

  /**
   * The parent's callbacks, in refs.
   *
   * Both are written inline at the call site - `onClose={() => setActiveMeetingId(null)}`
   * - so they are a new function on every render of the module, and the module
   * renders on every presence beat, every keystroke in the composer and every
   * realtime event. Held in the dependency list of the join effect that meant a
   * fresh POST to `/participants` several times a second; in the one that starts
   * a scheduled meeting it meant a PATCH storm. Neither is anything a caller
   * should have to know, so the refs are here rather than a rule for callers.
   */
  const close = useRef(onClose);
  const reload = useRef(onMeetingChanged);
  useEffect(() => {
    close.current = onClose;
    reload.current = onMeetingChanged;
  });

  /**
   * Something about this meeting changed: read this room's own row again.
   *
   * ── Why the module's list is deliberately *not* refreshed here ───────────
   *
   * It used to be, and it is the most expensive thing the room could do. This
   * fires on every realtime event in the meeting - a hand going up, a camera
   * toggled, somebody admitted - and each one was answering with a
   * `meeting_overview()` *and* a `channel_overview()` for a sidebar that is
   * entirely hidden behind a full-screen room. Six people fidgeting with their
   * cameras was a few hundred rows of aggregate SQL a minute, on the device
   * least able to spare it, for a list nobody could see.
   *
   * The list is caught up once, when the room closes - which is the moment
   * before it is looked at again. See `closeMeeting` in the module shell.
   */
  const changed = useCallback(() => { reload.current(); }, []);

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
   * Ask for a seat: the join button, and the retry.
   *
   * Also what turns an admission into a seat - the server reads `admitted` and
   * answers `joined`, which is why the same call serves the knock and the entry
   * that follows it.
   */
  const requestSeat = useCallback(async () => {
    setSeat('joining');
    setJoinError(null);
    try {
      /**
       * A join that never comes back is the last way this screen could spin
       * for ever.
       *
       * `fetch` has no timeout of its own: a request that is neither answered
       * nor refused - a captive portal, a proxy holding the connection, a
       * laptop that suspended mid-flight - leaves this promise pending for as
       * long as the tab is open, and the `joining` spinner with it. Twenty
       * seconds is far longer than the endpoint has ever needed and still
       * short enough to be a wait rather than a hang, and the abort lands in
       * the catch below as an ordinary failure with a Try again beside it.
       */
      const res = await fetch(
        `/api/communication/meetings/${meeting.meetingId}/participants`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(20_000),
        },
      );
      const json = await res.json().catch(() => ({
        error: { message: 'The server did not answer. Check your connection and try again.' },
      }));
      if (json.error) throw new Error(json.error.message || 'Could not join that meeting.');
      const waiting = json.meta?.waiting === true || json.data?.state === 'knocking';
      setSeat(waiting ? 'knocking' : 'in');
      void loadParticipants();
    } catch (err: any) {
      /**
       * A failed join used to close the room outright, which threw away the
       * only screen that could explain what happened or offer another go - and
       * a meeting is exactly the moment somebody cannot afford to guess.
       */
      // A timeout arrives as `signal timed out`, which is a sentence for a
      // console and not for somebody who is late to a meeting.
      setJoinError(
        err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? 'The server did not answer in time. Check your connection and try again.'
          : err?.message || 'Could not join that meeting.',
      );
      setSeat('failed');
    }
  }, [meeting.meetingId, loadParticipants]);

  /**
   * Asking for a seat is the only thing that happens on mount.
   *
   * There was a second effect fetching the participant list alongside it, which
   * `requestSeat` already does the moment the server answers - two requests for
   * the same rows, racing, at the one moment in a meeting where latency is
   * actually felt. The roster is worth nothing before the seat is granted
   * anyway: until then there is no room to be in.
   */
  useEffect(() => { void requestSeat(); }, [requestSeat]);

  /**
   * The host opening a scheduled meeting is what starts it.
   *
   * Not a separate button. "Start" and "join" are the same gesture from the
   * host's side, and a meeting that had to be started and then joined would
   * leave everybody else looking at a room the host is standing outside.
   *
   * Guarded by a ref as well as by the status, because the status arrives from
   * a refetch: between the PATCH and the list coming back this component
   * renders several times still believing the meeting is scheduled.
   */
  const started = useRef(false);
  useEffect(() => {
    if (!meeting.amHost || meeting.status !== 'scheduled' || started.current) return;
    started.current = true;
    void api(`/api/communication/meetings/${meeting.meetingId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'live' }),
    }).then(changed).catch(() => { started.current = false; });
  }, [meeting.amHost, meeting.status, meeting.meetingId]);

  /**
   * The room is live.
   *
   * A hand going up, somebody being admitted or the host ending the meeting
   * are all UPDATEs on `meeting_participants` and `meetings`, both of which
   * were added to the realtime publication in 0023 with REPLICA IDENTITY FULL
   * so a filtered UPDATE is actually delivered.
   */
  const live = useRealtime({
    name: `meeting-room:${meeting.meetingId}`,
    debounceMs: 150,
    tables: [
      { table: 'meeting_participants', filter: `meeting_id=eq.${meeting.meetingId}` },
      { table: 'meetings', filter: `id=eq.${meeting.meetingId}` },
    ],
    onChange: () => { void loadParticipants(); changed(); },
  });

  /**
   * The fallback for a room whose subscription could not connect.
   *
   * Websockets are blocked by a good number of corporate proxies, and every
   * consequence of that here is one people cannot work around: a knock nobody
   * hears, an admission that never arrives, a meeting that ended half an hour
   * ago. Five seconds is far more traffic than the socket would be and is the
   * right trade for the few minutes a meeting lasts.
   */
  useEffect(() => {
    if (live === 'subscribed') return;
    const timer = setInterval(() => { void loadParticipants(); changed(); }, 5000);
    return () => clearInterval(timer);
  }, [live, loadParticipants]);

  const myState = me?.state ?? null;

  /**
   * The door, opened or shut.
   *
   * `admitted` is the host saying yes; the seat itself is taken by asking
   * again, which is the same call the join button makes.
   */
  useEffect(() => {
    if (seat !== 'knocking') return;
    if (myState === 'admitted') { void requestSeat(); return; }
    if (myState === 'removed') { setSeat('refused'); return; }
    // The host turned the waiting room off while somebody was standing in it.
    // There is no door left to wait at, and nothing else would ever have moved
    // this row - so ask again, and the server lets them straight in.
    if (!meeting.waitingRoom) void requestSeat();
  }, [seat, myState, meeting.waitingRoom, requestSeat]);

  /** Shown out mid-meeting. */
  useEffect(() => {
    if (seat !== 'in' || myState !== 'removed') return;
    toast.error('The host removed you from the meeting.');
    close.current();
  }, [seat, myState]);

  /**
   * The room says we are not here, and we are.
   *
   * Two ways that happens, both ordinary. A phone puts a backgrounded tab into
   * the back/forward cache, which fires `pagehide` - so the tab politely
   * announced it was leaving and was then restored intact. And a `left` written
   * by a request that raced a rejoin leaves the same disagreement.
   *
   * Either way this browser is sitting in a meeting nobody else can see it in:
   * no tile in their grid, no connection offered, because the roster is what
   * every other browser consults. Taking the seat back is silent and is what
   * the person plainly meant.
   */
  useEffect(() => {
    if (seat !== 'in' || myState !== 'left') return;
    void requestSeat();
  }, [seat, myState, requestSeat]);

  /**
   * The meeting is over.
   *
   * For everybody, including the host who ended it - a room left open on an
   * ended meeting is the state where the grid is frozen, the controls do
   * nothing and there is no explanation on screen.
   */
  useEffect(() => {
    if (meeting.status !== 'ended' && meeting.status !== 'cancelled') return;
    toast(meeting.status === 'ended' ? 'The meeting has ended.' : 'That meeting was cancelled.');
    close.current();
  }, [meeting.status]);

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
    enabled: seat === 'in',
    startMuted,
    startCameraOff,
  });

  /**
   * The host's mute is enforced locally too.
   *
   * The row is the authority - everybody in the room can see that this person
   * is muted - but the muted browser also has to stop transmitting, or the
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
      return true;
    } catch (err: any) {
      toast.error(err.message || 'That did not work');
      return false;
    }
  }, [meeting.meetingId, loadParticipants]);

  /**
   * Your camera and your share, on the row everybody else reads.
   *
   * `meeting_participants.camera_on` and `is_sharing` have been columns since
   * 0023 and the grid has always rendered them - but nothing ever wrote them,
   * so every tile claimed the camera was off and the green ring around a shared
   * screen was unreachable. This is the write that was missing.
   */
  const cameraOn = media.camOn;
  const isSharing = media.sharing;
  useEffect(() => {
    if (seat !== 'in') return;
    void patch({ cameraOn, isSharing });
  }, [seat, cameraOn, isSharing, patch]);

  const leave = useCallback(async () => {
    try {
      await fetch(`/api/communication/meetings/${meeting.meetingId}/participants`, { method: 'DELETE' });
    } catch { /* leaving should never fail in front of somebody */ }
    // Closing is what refreshes the module behind - see `closeMeeting`. Asking
    // for it here as well was the same two queries twice.
    close.current();
  }, [meeting.meetingId]);

  /**
   * A tab that is closed still leaves the meeting.
   *
   * Without this, closing the window or quitting the browser left the
   * participant row saying `joined` for ever: a name in the list, a tile in
   * everybody's grid, and a connection every other browser kept trying to
   * make. `keepalive` is what lets the request outlive the page - an ordinary
   * `fetch` is cancelled the moment the document goes.
   *
   * `pagehide` rather than `beforeunload`, because the latter is not fired at
   * all on mobile Safari and is what the bfcache was built to avoid. It is
   * best-effort by nature: a crash or a lost battery still leaves a row, which
   * is why the grid can say "could not connect to them" rather than spinning.
   */
  const meetingId = meeting.meetingId;
  useEffect(() => {
    if (seat !== 'in') return;
    const bail = () => {
      try {
        void fetch(`/api/communication/meetings/${meetingId}/participants`, {
          method: 'DELETE',
          keepalive: true,
        });
      } catch { /* the page is going; there is nobody left to tell */ }
    };
    window.addEventListener('pagehide', bail);
    return () => window.removeEventListener('pagehide', bail);
  }, [seat, meetingId]);

  const knocking = useMemo(
    () => participants.filter(p => p.state === 'knocking'),
    [participants],
  );
  const present = useMemo(
    () => participants.filter(p => p.state === 'joined'),
    [participants],
  );

  /**
   * Everything the grid shows, as one list.
   *
   * Assembled before it is rendered because the layout has to be sized to the
   * *count* - you cannot fit tiles to a stage while still discovering how many
   * there are halfway down the JSX. It also puts the three sources in one
   * place: you, the people whose media has arrived, and the people the server
   * says are here whose media has not.
   */
  const tiles = useMemo(() => {
    const list: {
      id: string;
      stream: MediaStream | null;
      label: string;
      memberId: string;
      muted?: boolean;
      mirrored?: boolean;
      cameraOff?: boolean;
      micOff?: boolean;
      handUp?: boolean;
      sharing?: boolean;
      /** Absent for your own tile, which is never "connecting" to itself. */
      health?: PeerHealth;
      avatarUrl?: string | null;
    }[] = [{
      id: 'self',
      stream: media.localStream,
      label: 'You',
      memberId: currentMemberId ?? 'me',
      // Your own row in the roster carries your photograph, so the tile with
      // your camera off shows your face rather than your initials.
      avatarUrl: participants.find(p => p.memberId === currentMemberId)?.avatarUrl ?? null,
      muted: true,
      mirrored: !media.sharing,
      cameraOff: !media.camOn,
      micOff: !media.micOn,
      sharing: media.sharing,
    }];

    for (const peer of media.peers) {
      const person = participants.find(p => p.memberId === peer.memberId);
      list.push({
        id: peer.memberId,
        stream: peer.stream,
        label: person?.fullName ?? 'Someone',
        memberId: peer.memberId,
        avatarUrl: person?.avatarUrl ?? null,
        cameraOff: !person?.cameraOn && !peer.hasVideo,
        micOff: !!person?.isMuted,
        handUp: !!person?.handRaisedAt,
        sharing: !!person?.isSharing,
        // Media is arriving, so it is live unless the connection has since
        // gone quiet - which is precisely the case a frozen picture needs a
        // word for.
        health: media.health[peer.memberId] === 'reconnecting' ? 'reconnecting' : 'live',
      });
    }

    /**
     * Somebody the room says is here whose media has not arrived.
     *
     * They get a tile rather than being missing - "is Ada here?" should be
     * answerable from the grid. What changed is that the tile now distinguishes
     * "still connecting" from "this browser could not reach them", which used
     * to be the same eternal spinner.
     */
    for (const p of present) {
      if (p.memberId === currentMemberId) continue;
      if (media.peers.some(peer => peer.memberId === p.memberId)) continue;
      list.push({
        id: p.memberId,
        stream: null,
        label: p.fullName,
        memberId: p.memberId,
        avatarUrl: p.avatarUrl,
        cameraOff: true,
        micOff: p.isMuted,
        handUp: !!p.handRaisedAt,
        health: media.health[p.memberId] ?? 'connecting',
      });
    }

    return list;
  }, [
    media.localStream, media.camOn, media.micOn, media.sharing,
    media.peers, media.health, participants, present, currentMemberId,
  ]);

  /**
   * Whether this browser can share a screen at all.
   *
   * Read once, after mount rather than during render: `navigator` does not
   * exist while the module is rendered on the server, and a value that differs
   * between the server's HTML and the client's first render is a hydration
   * mismatch.
   */
  const [canShareScreen, setCanShareScreen] = useState(false);
  useEffect(() => {
    setCanShareScreen(typeof navigator !== 'undefined'
      && typeof navigator.mediaDevices?.getDisplayMedia === 'function');
  }, []);

  const stage = useStageLayout(tiles.length, TILE_GAP, !isMobile);
  const cramped = !isMobile && stage.width > 0 && stage.width < TILE_MIN;
  const tileWidth = cramped
    ? TILE_MIN
    : tiles.length === 1
      ? Math.min(stage.width, SOLO_MAX)
      : stage.width;
  /**
   * When a tile is too small to carry its furniture.
   *
   * On a desktop that is a measured width; on a phone it is simply whether the
   * grid has gone to two columns, which is the same judgement without needing
   * the measurement the phone does not take.
   */
  const compactTiles = isMobile ? tiles.length > 2 : tileWidth > 0 && tileWidth < 220;

  /**
   * Running the meeting, from inside it.
   *
   * These existed only on the card in the meetings list, which meant a host who
   * was actually in the room had to leave it to lock the door, open or close
   * the waiting room, or end the call - and leaving is the one thing a host
   * cannot casually do. The endpoint and the permissions are the same; this is
   * the control being where the person using it already is.
   */
  const runMeeting = useCallback(async (body: Record<string, unknown>) => {
    try {
      await api(`/api/communication/meetings/${meeting.meetingId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      changed();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Could not change the meeting');
      return false;
    }
  }, [meeting.meetingId]);

  const admit = useCallback(async (memberIds: string[]) => {
    if (!memberIds.length) return;
    const results = await Promise.all(
      memberIds.map(id => patch({ memberId: id, state: 'admitted' })),
    );
    const done = results.filter(Boolean).length;
    if (done) toast.success(done === 1 ? 'Admitted' : `${done} people admitted`);
  }, [patch]);

  /**
   * A knock is an event, not a number to be noticed.
   *
   * The badge on the participants button was the only sign, which meant a host
   * mid-sentence with the panel closed left somebody at the door indefinitely.
   * The banner below is unmissable and the toast reaches a host looking at the
   * grid; the set is what keeps a redelivered row from announcing the same
   * person twice.
   */
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (!amHost) {
      announced.current.clear();
      return;
    }
    const here = new Set(knocking.map(p => p.memberId));
    for (const p of knocking) {
      if (announced.current.has(p.memberId)) continue;
      announced.current.add(p.memberId);
      toast(`${p.fullName} is waiting to be let in`, {
        action: { label: 'Admit', onClick: () => void admit([p.memberId]) },
      });
    }
    for (const id of [...announced.current]) if (!here.has(id)) announced.current.delete(id);
  }, [knocking, amHost, admit]);

  // ── The door ──

  if (seat === 'failed') {
    return (
      <RoomShell title={meeting.title} onClose={() => close.current()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-rose-500/15">
            <TriangleAlert className="size-7 text-rose-300" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Could not join</h3>
            <p className="mt-1 max-w-sm text-sm text-white/60">{joinError}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => close.current()}>Close</Button>
            <Button className="gap-1.5"
              onClick={() => void requestSeat()}>
              <RefreshCw className="size-3.5" /> Try again
            </Button>
          </div>
        </div>
      </RoomShell>
    );
  }

  if (seat === 'refused') {
    return (
      <RoomShell title={meeting.title} onClose={() => close.current()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-white/10">
            <UserX className="size-7 text-white/70" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">You were not admitted</h3>
            <p className="mt-1 max-w-sm text-sm text-white/60">
              {meeting.hostName
                ? `${meeting.hostName} did not let you in to this meeting.`
                : 'The host did not let you in to this meeting.'}
            </p>
          </div>
          <Button variant="secondary" onClick={() => close.current()}>Close</Button>
        </div>
      </RoomShell>
    );
  }

  if (seat === 'knocking') {
    return (
      <RoomShell title={meeting.title} onClose={() => void leave()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-white/10">
            <DoorOpen className="size-7 animate-pulse text-white/80" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Waiting to be let in</h3>
            <p className="mt-1 max-w-sm text-sm text-white/60">
              {meeting.hostName ? `${meeting.hostName} has been told you are here.` : 'The host has been told you are here.'}
              {' '}Your camera and microphone are off until then.
            </p>
            <p className="mt-3 text-xs text-white/40">
              {present.length > 0
                ? `${present.length} ${present.length === 1 ? 'person is' : 'people are'} already in the room.`
                : 'Nobody is in the room yet.'}
            </p>
          </div>
          <Button variant="secondary" onClick={() => void leave()}>Cancel</Button>
        </div>
      </RoomShell>
    );
  }

  if (seat === 'joining') {
    return (
      // Closable while it waits: a spinner with no way out is the state this
      // whole component exists to make impossible.
      <RoomShell title={meeting.title} onClose={() => close.current()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Loader2 className="size-6 animate-spin text-white/60" />
          <p className="text-xs text-white/40">Joining the meeting…</p>
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
            <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 sm:mx-4">
              <span className="flex-1">{media.mediaError}</span>
              {/*
                The message said what to do - allow it in the address bar - and
                then offered no way to act on it, so somebody who fixed the
                permission had to leave the meeting and come back. Asking for a
                seat again is the full restart: it takes the microphone and
                camera from scratch and rebuilds every connection.

                Withheld for the two faults retrying cannot resolve. A policy
                that forbids this document the camera will forbid it again a
                second later, and so will a browser that has no `getUserMedia`
                - offering the button there is an invitation to press it until
                somebody concludes the product is broken, when the honest
                answer is that this particular thing is not going to work.
              */}
              {media.mediaFault !== 'blocked-by-policy' && media.mediaFault !== 'unsupported' && (
                <Button size="sm" variant="secondary" className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                  onClick={() => void requestSeat()}>
                  <RefreshCw className="size-3" /> Try again
                </Button>
              )}
            </div>
          )}

          {/*
            The connection, said out loud.

            A mesh that cannot get through - no TURN, so a symmetric NAT ends
            here - used to present as a grid of avatars that never became
            faces, which is indistinguishable from colleagues who have their
            cameras off. Naming it is the difference between a broken meeting
            and a meeting somebody can do something about.
          */}
          {media.status === 'failed' && (
            <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 sm:mx-4">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="flex-1">
                The connection to this room dropped. Your network may be blocking direct
                calls - leaving and joining again is usually enough.
              </span>
              <Button size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => void requestSeat()}>
                <RefreshCw className="size-3" /> Reconnect
              </Button>
            </div>
          )}

          {/*
            Somebody at the door, where the host is already looking.

            The requirement this answers is that a host never has to leave the
            meeting to manage the waiting room - so the whole exchange happens
            here, with who it is and how long they have been there, and the
            panel stays an option rather than a detour.
          */}
          {amHost && knocking.length > 0 && (
            <div className="mx-3 mt-3 shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 sm:mx-4">
              <div className="flex items-center gap-2">
                <DoorOpen className="size-4 shrink-0 text-amber-300" />
                <p className="flex-1 text-xs font-medium text-amber-100">
                  {knocking.length === 1
                    ? `${knocking[0].fullName} is waiting to be let in`
                    : `${knocking.length} people are waiting to be let in`}
                </p>
                {knocking.length > 1 && (
                  <Button size="sm" className="h-7 gap-1 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700"
                    onClick={() => void admit(knocking.map(p => p.memberId))}>
                    <UserCheck className="size-3" /> Admit all
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-amber-100 hover:text-white"
                  onClick={() => { setShowPeople(true); setShowNotes(false); }}>
                  Review
                </Button>
              </div>
              <div className="mt-2 space-y-1">
                {knocking.slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <PersonAvatar id={p.memberId} name={p.fullName}
                      src={p.avatarUrl} size="xs" decorative />
                    <span className="min-w-0 flex-1 truncate text-xs text-white">{p.fullName}</span>
                    {p.knockedAt && (
                      <span className="shrink-0 text-[10px] text-white/40">
                        {formatRelativeTime(p.knockedAt)}
                      </span>
                    )}
                    <Button size="sm" className="h-6 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700"
                      onClick={() => void admit([p.memberId])}>
                      Admit
                    </Button>
                    <Button size="icon" variant="ghost" className="size-6 text-white/50 hover:text-white"
                      onClick={() => void patch({ memberId: p.memberId, state: 'removed' })}
                      aria-label={`Refuse ${p.fullName}`}>
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
                {knocking.length > 3 && (
                  <p className="pl-8 text-[10px] text-white/40">
                    and {knocking.length - 3} more - open Participants to see them all.
                  </p>
                )}
              </div>
            </div>
          )}

          <div
            ref={stage.ref}
            className={cn(
              'flex min-h-0 flex-1 justify-center p-4',
              // Below a readable tile size the stage stops shrinking and starts
              // scrolling: twenty people at 40px each is not a smaller version
              // of the layout, it is an unusable one. On a phone the same is
              // true a good deal sooner, so the column rules below hand over to
              // scrolling rather than to ever-smaller tiles.
              cramped ? 'items-start overflow-y-auto' : 'items-center overflow-hidden',
              /**
               * `items-start` and not `items-center`, with `my-auto` on the grid
               * below.
               *
               * A centred flex child that is taller than its container has its
               * overflow split above and below, and the half above cannot be
               * scrolled to - the first row of faces is simply gone. Automatic
               * margins centre exactly the same way when there is room and do
               * not do that when there is not, which is the whole difference
               * between a crowded meeting on a phone working and not.
               */
              isMobile && 'items-start overflow-y-auto',
            )}
          >
            <div
              className={cn(
                'grid w-full gap-3',
                isMobile && 'my-auto',
                /**
                 * ── Two layouts, because they are two different problems ────
                 *
                 * A phone is narrow and tall, and the width is the whole of it:
                 * a tile takes the full column and its height follows, which is
                 * what the module did before this phase and what it should keep
                 * doing. Fitting tiles to the height there produces something
                 * technically optimal and worse to use - a letterboxed strip
                 * with margins on a screen that has none to spare.
                 *
                 * A desktop is the opposite: wide, short, and the height is what
                 * runs out first. That is where column classes put a tile taller
                 * than the room and pushed the controls off the bottom, and
                 * where the measured fit below belongs.
                 *
                 * So the phone keeps its columns and the desktop gets the
                 * measurement. `isMobile` is the same 768px breakpoint the rest
                 * of the module uses, so the two agree about what a phone is.
                 *
                 * One column up to two tiles, two columns beyond - which is
                 * what the column classes resolved to on a small screen before
                 * this phase, restored exactly. The only thing added is that
                 * the stage scrolls once the rows outgrow it, so a crowded
                 * meeting cannot push the controls off the bottom.
                 */
                isMobile && (tiles.length <= 2 ? 'grid-cols-1' : 'grid-cols-2'),
              )}
              style={isMobile
                ? undefined
                : stage.width > 0
                  ? { gridTemplateColumns: `repeat(${stage.cols}, ${tileWidth}px)`, width: 'auto' }
                  // Before the first measurement - one frame - a sensible CSS
                  // grid, so the room does not open on an empty stage.
                  : { gridTemplateColumns: `repeat(${Math.min(tiles.length, 2)}, minmax(0, 1fr))` }}
            >
              {tiles.map(tile => (
                <VideoTile
                  key={tile.id}
                  stream={tile.stream}
                  label={tile.label}
                  memberId={tile.memberId}
                  muted={tile.muted}
                  mirrored={tile.mirrored}
                  cameraOff={tile.cameraOff}
                  micOff={tile.micOff}
                  handUp={tile.handUp}
                  sharing={tile.sharing}
                  health={tile.health}
                  avatarUrl={tile.avatarUrl}
                  compact={compactTiles}
                />
              ))}
            </div>
          </div>

          {/* ── Controls ──
              `shrink-0`, without exception. These are the buttons that mute a
              microphone and leave a call; a layout that can push them off the
              bottom of the screen under pressure from a video tile is the
              layout that made this whole section necessary. */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 border-t border-white/10 px-2 py-2.5 sm:gap-2 sm:px-4 sm:py-3">
            <TooltipProvider delayDuration={300}>
              {/* A control with no track behind it did nothing when pressed -
                  `toggleMic` returns early when there is no audio track - so
                  the button for the device somebody had just been told was
                  unavailable stayed lit and stayed silent. Disabled, and the
                  tooltip says which of the two it is. */}
              <ControlButton
                active={media.micOn}
                warnWhenOff
                disabled={!!me?.isMuted || !media.hasAudio}
                onClick={media.toggleMic}
                on={<Mic className="size-4" />}
                off={<MicOff className="size-4" />}
                label={
                  !media.hasAudio ? 'No microphone available'
                    : me?.isMuted ? 'The host has muted you'
                      : media.micOn ? 'Mute' : 'Unmute'
                }
              />
              {meeting.mode !== 'audio' && (
                <ControlButton
                  active={media.camOn}
                  warnWhenOff
                  disabled={!media.hasVideo}
                  onClick={media.toggleCam}
                  on={<Video className="size-4" />}
                  off={<VideoOff className="size-4" />}
                  label={
                    !media.hasVideo ? 'No camera available'
                      : media.camOn ? 'Turn camera off' : 'Turn camera on'
                  }
                />
              )}
              {/* Hidden where the browser cannot do it at all - iOS Safari has
                  no `getDisplayMedia`, and a button whose only possible outcome
                  is nothing happening is worse than no button. */}
              {canShareScreen && (
                <ControlButton
                  active={media.sharing}
                  activeClass="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => void media.toggleShare()}
                  on={<MonitorUp className="size-4" />}
                  off={<MonitorUp className="size-4" />}
                  label={media.sharing ? 'Stop sharing' : 'Share your screen'}
                />
              )}
              <ControlButton
                active={handUp}
                activeClass="bg-amber-500 hover:bg-amber-600"
                onClick={() => void patch({ handRaised: !handUp })}
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

              {amHost && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" className="size-10 rounded-full bg-white/15 text-white hover:bg-white/25"
                      aria-label="Host controls">
                      <ShieldCheck className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" side="top" className="w-60">
                    <DropdownMenuLabel className="text-xs">Host</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => setInviteOpen(true)}>
                      <UserPlus className="mr-2 size-4" /> Invite people
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void runMeeting({ isLocked: !meeting.isLocked })}>
                      {meeting.isLocked
                        ? <><Unlock className="mr-2 size-4" /> Unlock the room</>
                        : <><Lock className="mr-2 size-4" /> Lock the room</>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void runMeeting({ waitingRoom: !meeting.waitingRoom })}>
                      <DoorOpen className="mr-2 size-4" />
                      {meeting.waitingRoom ? 'Turn off the waiting room' : 'Turn on the waiting room'}
                    </DropdownMenuItem>
                    {knocking.length > 0 && (
                      <DropdownMenuItem onClick={() => void admit(knocking.map(p => p.memberId))}>
                        <UserCheck className="mr-2 size-4" /> Admit everyone waiting ({knocking.length})
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setEndOpen(true)}
                    >
                      <PhoneOff className="mr-2 size-4" /> End for everyone
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

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
                <TooltipContent>
                  {amHost
                    ? 'Leave - the meeting carries on without you'
                    : 'Leave the meeting'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* ── Side panel ──
            Full width on a phone, a column on a desktop. A fixed 320px panel
            beside a video grid on a 390px screen leaves 70px for the meeting,
            which is not a smaller version of the layout - it is a broken one.
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
                onAct={patch}
                onAdmit={admit}
              />
            )}
            {showNotes && (
              <div className="flex flex-1 flex-col p-4">
                <h4 className="mb-2 text-sm font-semibold text-white">Meeting notes</h4>
                <p className="mb-3 text-xs text-white/50">
                  Kept with the meeting. Everyone who was in it can read them
                  afterwards, from Meetings.
                </p>
                <Textarea
                  value={notes}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={14}
                  placeholder="Decisions, actions, who is doing what…"
                  className="flex-1 resize-none border-white/15 bg-white/5 text-sm text-white placeholder:text-white/30"
                />
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={savingNotes || draft === null || draft === saved}
                    onClick={async () => {
                      setSavingNotes(true);
                      try {
                        await api(`/api/communication/meetings/${meeting.meetingId}`, {
                          method: 'PATCH', body: JSON.stringify({ notes }),
                        });
                        // Back to following the server. The refetch below brings
                        // the saved text down, and until it lands the draft that
                        // was just accepted is still what is on screen.
                        setDraft(null);
                        toast.success('Notes saved');
                        changed();
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
                  {draft !== null && draft !== saved && (
                    <span className="text-[11px] text-amber-300">Unsaved</span>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      <InviteToMeetingDialog
        key={inviteOpen ? 'invite-open' : 'invite-closed'}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        meetingId={meeting.meetingId}
        directory={directory.filter(d =>
          !participants.some(p => p.memberId === d.memberId
            && !['left', 'removed', 'declined'].includes(p.state)))}
        onInvited={() => { setInviteOpen(false); void loadParticipants(); changed(); }}
      />

      <ConfirmDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        title="End the meeting"
        description={
          present.length > 1
            ? `Everyone still in the room - ${present.length} people - will be disconnected. `
              + 'The notes and the participant list are kept.'
            : 'The meeting will be closed. The notes and the participant list are kept.'
        }
        confirmLabel="End for everyone"
        variant="destructive"
        isLoading={ending}
        onConfirm={async () => {
          setEnding(true);
          // The room closes itself when the status arrives as `ended` - through
          // the same effect that closes it for everybody else, rather than a
          // second path that only the host takes.
          const ok = await runMeeting({ status: 'ended' });
          setEnding(false);
          if (ok) setEndOpen(false);
        }}
      />
    </RoomShell>
  );
}

/**
 * Bringing somebody into a meeting that has already started.
 *
 * The endpoint has accepted a list of member ids from a host since 0023 and
 * nothing in the room ever sent one - inviting was possible only at the moment
 * a meeting was created, which is the one moment you do not yet know who you
 * need. People already in the room, waiting at the door or invited and yet to
 * arrive are filtered out by the caller, so the list is only people it would
 * make sense to ask.
 */
function InviteToMeetingDialog({
  open, onOpenChange, meetingId, directory, onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  directory: DirectoryMember[];
  onInvited: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const shown = directory.filter(d =>
    d.fullName.toLowerCase().includes(filter.trim().toLowerCase()));

  const submit = async () => {
    setSaving(true);
    try {
      await api(`/api/communication/meetings/${meetingId}/participants`, {
        method: 'POST', body: JSON.stringify({ memberIds: picked }),
      });
      toast.success(picked.length === 1
        ? 'Invited - they have been notified'
        : `${picked.length} people invited`);
      onInvited();
    } catch (err: any) {
      toast.error(err.message || 'Could not invite them');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            They are notified straight away and can join from Communication.
          </DialogDescription>
        </DialogHeader>

        <Input placeholder="Filter colleagues…" value={filter} autoFocus
          onChange={(e) => setFilter(e.target.value)} className="h-9" />

        <ScrollArea className="h-64 rounded-md border">
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
                <PersonAvatar id={person.memberId} name={person.fullName}
                  src={person.avatarUrl} size="sm" decorative />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{person.fullName}</span>
                  {person.jobTitle && (
                    <span className="block truncate text-xs text-muted-foreground">{person.jobTitle}</span>
                  )}
                </span>
              </label>
            ))}
            {shown.length === 0 && (
              <p className="p-6 text-center text-xs text-muted-foreground">
                {filter
                  ? 'No colleagues match that.'
                  : 'Everybody who could be invited already has been.'}
              </p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            
            disabled={!picked.length || saving}
            onClick={() => void submit()}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Invite {picked.length || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  How the tiles are laid out
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is measured rather than a set of breakpoints ────────────────
 *
 * It was `grid-cols-1` for one person, `sm:grid-cols-2` for two, and so on.
 * Tailwind columns divide the *width*; the tiles are 16:9, so their height
 * follows from that width and nothing bounds it. One participant on a desktop
 * therefore got a tile as wide as the room and 56% of that tall - taller than
 * the space available - which pushed the control bar off the bottom of the
 * screen. The mute button was unreachable in a one-to-one call, which is the
 * most common call there is.
 *
 * Columns cannot fix that, because the constraint is the *height* and CSS
 * columns do not know it. So the stage is measured and the tile size is chosen
 * to fit both dimensions: for each possible column count, the width a tile
 * would get, the height that implies for the rows it needs, and whichever
 * arrangement yields the largest tile that still fits. That is the same
 * calculation every video product does, and it is the only one that behaves on
 * a phone in portrait, a laptop, and a wide monitor with the participant panel
 * open - without a breakpoint for each.
 *
 * It also means the layout responds to the panel opening and to the window
 * resizing, both of which change the stage and neither of which a media query
 * on the viewport can see.
 */
function useStageLayout(count: number, gap: number, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    // A phone lays out by column class and never reads this, so there is no
    // reason to observe it - and every soft keyboard opening would otherwise
    // re-render the whole room for a number nobody uses.
    if (!el || !enabled) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // Rounded, so a sub-pixel reflow does not re-render the grid for ever.
      setBox(prev => {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  const layout = useMemo(
    () => fitTiles(count, box.w, box.h, gap),
    [count, box.w, box.h, gap],
  );

  return { ref, ...layout };
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
    /*
      The room is a full-screen overlay, so it owns the whole device - including
      the parts of it a phone reserves. Without the safe-area insets the title
      sits under the notch and the control bar under the home indicator, which
      is where the Leave button ends up on an iPhone.
    */
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
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

/**
 * One round control in the meeting bar.
 *
 * ── Why "off" is not always red ──────────────────────────────────────────
 *
 * It was: every control in this bar went rose the moment it was inactive, so a
 * room at rest showed four red buttons - share, raise hand, participants,
 * notes - none of which was wrong with anything. Red in a meeting means
 * something specific and worth reserving: nobody can hear you, nobody can see
 * you. A panel that happens to be closed is not that, and a bar that says
 * everything is an alarm says nothing.
 *
 * So the alarming state is opt-in. `warnWhenOff` is set on the microphone and
 * the camera, where "off" is a fact about you other people are experiencing,
 * and nowhere else.
 */
function ControlButton({
  active, activeClass, warnWhenOff, disabled, onClick, on, off, label, badge,
}: {
  active: boolean;
  activeClass?: string;
  /** Render the inactive state as a warning. For the microphone and camera. */
  warnWhenOff?: boolean;
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
            'relative size-10 rounded-full transition-colors',
            active
              ? (activeClass ?? 'bg-white/15 text-white hover:bg-white/25')
              : warnWhenOff
                ? 'bg-rose-600/90 text-white hover:bg-rose-600'
                : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white',
          )}
          aria-label={label}
          aria-pressed={active}
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
 * give one to a `<video>`. Muted on the local tile without exception -
 * playing your own microphone back through your own speakers is a feedback
 * loop, and every call that has ever howled has done it for this reason.
 */
const VideoTile = memo(function VideoTile({
  stream, label, muted, mirrored, cameraOff, micOff, handUp, sharing,
  health, compact, memberId, avatarUrl,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirrored?: boolean;
  cameraOff?: boolean;
  micOff?: boolean;
  handUp?: boolean;
  sharing?: boolean;
  /** How the connection to this person is doing. Absent on your own tile. */
  health?: PeerHealth;
  /** The tile is small enough that the avatar and the labels must come down. */
  compact?: boolean;
  memberId: string;
  /**
   * The person's photograph, for the tile with the camera off.
   *
   * Which is most tiles, most of the time: a meeting where everybody has their
   * camera on is the exception, and a grid of coloured initials is the version
   * of this screen that people were actually looking at.
   */
  avatarUrl?: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);

  const showVideo = !!stream && !cameraOff;

  return (
    <div className={cn(
      'relative aspect-video overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10 transition-shadow',
      handUp && 'ring-2 ring-amber-400',
      sharing && 'ring-2 ring-emerald-400',
      health === 'lost' && 'ring-1 ring-rose-500/40',
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center">
          {/*
            Four states, where there used to be one spinner.

            "Their video is on its way", "it was working and is being rebuilt"
            and "this will never happen" were all the same animation, and they
            ask completely different things of the person watching. The last is
            the one that mattered most: without a TURN server a symmetric NAT
            cannot be traversed, the meeting is not going to fix itself, and
            saying so is what lets somebody pick up a phone instead of waiting.
          */}
          {health === 'lost' ? (
            <>
              <WifiOff className={cn('text-rose-400/80', compact ? 'size-5' : 'size-6')} />
              {!compact && (
                <span className="text-[11px] leading-tight text-white/50">
                  Could not connect to them
                </span>
              )}
            </>
          ) : health === 'reconnecting' ? (
            <>
              <RefreshCw className={cn('animate-spin text-amber-300/80', compact ? 'size-5' : 'size-6')} />
              {!compact && <span className="text-[11px] text-amber-200/60">Reconnecting…</span>}
            </>
          ) : health === 'connecting' ? (
            <>
              <Loader2 className={cn('animate-spin text-white/40', compact ? 'size-5' : 'size-6')} />
              {!compact && <span className="text-[11px] text-white/35">Connecting…</span>}
            </>
          ) : (
            <PersonAvatar
              id={memberId}
              name={label}
              src={avatarUrl}
              size={compact ? 'lg' : 'xl'}
              decorative
            />
          )}
        </div>
      )}

      {showVideo && health === 'reconnecting' && (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
          <RefreshCw className="size-2.5 animate-spin" /> Reconnecting
        </span>
      )}

      <div className={cn(
        'absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent',
        compact ? 'px-1.5 pb-1 pt-4' : 'px-2.5 pb-1.5 pt-6',
      )}>
        <span className={cn(
          'truncate font-medium text-white',
          compact ? 'text-[10px]' : 'text-xs',
        )}>
          {label}
        </span>
        {micOff && <MicOff className="size-3 shrink-0 text-rose-400" />}
        {handUp && <Hand className="size-3 shrink-0 text-amber-400" />}
        {sharing && <MonitorUp className="size-3 shrink-0 text-emerald-400" />}
      </div>
    </div>
  );
});

function ParticipantPanel({
  participants, knocking, amHost, currentMemberId, onAct, onAdmit,
}: {
  participants: MeetingParticipant[];
  knocking: MeetingParticipant[];
  amHost: boolean;
  currentMemberId: string | null;
  /**
   * The room's own writer, passed down rather than rebuilt here.
   *
   * The panel used to hold a second copy that refreshed the list on its own,
   * so admitting from the banner and admitting from the panel were two code
   * paths doing the same thing - and only one of them reported success.
   */
  onAct: (body: Record<string, unknown>) => Promise<boolean>;
  onAdmit: (memberIds: string[]) => Promise<void>;
}) {
  const act = onAct;

  const inRoom = participants.filter(p => p.state === 'joined');
  const invited = participants.filter(p => ['invited', 'admitted'].includes(p.state));

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-5 p-4">
        {amHost && knocking.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h4 className="flex flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
                <DoorOpen className="size-3.5" /> Waiting ({knocking.length})
              </h4>
              {knocking.length > 1 && (
                <Button size="sm" className="h-6 gap-1 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700"
                  onClick={() => void onAdmit(knocking.map(p => p.memberId))}>
                  <UserCheck className="size-3" /> Admit all
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              {knocking.map(p => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg bg-white/5 p-2">
                  <PersonAvatar id={p.memberId} name={p.fullName} src={p.avatarUrl}
                    size="sm" decorative />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{p.fullName}</span>
                    {/* How long somebody has been at the door is the fact that
                        decides whether this is urgent. */}
                    <span className="block truncate text-[10px] text-white/40">
                      {p.knockedAt ? `Asked ${formatRelativeTime(p.knockedAt)}` : 'Waiting'}
                    </span>
                  </span>
                  <Button size="sm" className="h-7 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-700"
                    onClick={() => void onAdmit([p.memberId])}>
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
                <PersonAvatar id={p.memberId} name={p.fullName} src={p.avatarUrl}
                  size="sm" decorative />
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
                  <PersonAvatar id={p.memberId} name={p.fullName} src={p.avatarUrl}
                    size="xs" decorative />
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

/* ========================================================================== */
/*  The green room                                                            */
/* ========================================================================== */

/**
 * Before you walk in.
 *
 * -- Why a product needs this ----------------------------------------------
 *
 * Walking straight into a meeting is the single most exposing thing a
 * conferencing product can do to somebody: camera on, microphone live, in a
 * room that may already have eight people in it, before they have seen
 * themselves. Every product people trust puts a step in front of it, and every
 * one that does not gets used with the camera permanently denied at the
 * browser level - which is the same feature, chosen once, badly.
 *
 * -- What it is allowed to promise ------------------------------------------
 *
 * Only what the architecture supports. It previews the local camera and
 * microphone with `getUserMedia`, which is the same call the room makes, and
 * it carries the two switches through into the room so they mean something.
 * It does not show who is speaking, it does not test the connection, and it
 * does not claim a "network check" this product cannot perform.
 *
 * -- The tracks it acquires, and why they are stopped ----------------------
 *
 * Its own, and released the moment it unmounts. The room asks again on the way
 * in. Holding the camera open across the handover would leave two live tracks
 * on one device, which on most hardware means the room's request fails.
 */
function MeetingLobby({
  meeting, currentMemberId, onJoin, onClose,
}: {
  meeting: MeetingRow;
  currentMemberId: string | null;
  onJoin: (choice: { micOn: boolean; camOn: boolean }) => void;
  onClose: () => void;
}) {
  /**
   * Who is in there, read once.
   *
   * Not subscribed: this screen is on for a few seconds and a roster that
   * updates under somebody deciding whether to join is movement for its own
   * sake. The room subscribes properly the moment they walk in.
   */
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api<MeetingParticipant[]>(
      `/api/communication/meetings/${meeting.meetingId}/participants`)
      .then(rows => { if (!cancelled) setParticipants(rows ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [meeting.meetingId]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(meeting.mode !== 'audio');
  const [fault, setFault] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const audioOnly = meeting.mode === 'audio';

  /**
   * One acquisition, released on the way out.
   *
   * Asked for once rather than re-requested when a switch moves: a second
   * `getUserMedia` for a camera the browser has already granted is a second
   * device start, which is visibly slower and on some hardware flashes the
   * indicator light. The switches disable the track instead, which is exactly
   * what the room does.
   */
  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    void (async () => {
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: audioOnly ? false : { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { acquired.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = acquired;
        if (videoRef.current) videoRef.current.srcObject = acquired;
        setReady(true);
      } catch (e: any) {
        if (cancelled) return;
        /*
          Named rather than swallowed. "Could not start the camera" with no
          reason is the message that sends somebody to their operating system
          settings when the answer was a permission prompt they dismissed.
        */
        setFault(
          e?.name === 'NotAllowedError'
            ? 'Your browser is blocking the camera and microphone for this site.'
            : e?.name === 'NotFoundError'
              ? 'No camera or microphone was found on this device.'
              : 'The camera and microphone could not be started.',
        );
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [audioOnly]);

  const flip = (what: 'mic' | 'cam') => {
    const stream = streamRef.current;
    if (what === 'mic') {
      const next = !micOn;
      stream?.getAudioTracks().forEach(t => { t.enabled = next; });
      setMicOn(next);
    } else {
      const next = !camOn;
      stream?.getVideoTracks().forEach(t => { t.enabled = next; });
      setCamOn(next);
    }
  };

  const inRoom = participants.filter(p => p.state === 'joined');
  const invited = participants.filter(p => p.state === 'invited');
  const me = participants.find(p => p.memberId === currentMemberId);
  const amHost = meeting.amHost || ['host', 'cohost'].includes(me?.role ?? '');
  const knocking = meeting.waitingRoom && !amHost;

  return (
    <RoomShell title={meeting.title} onClose={onClose}>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 sm:p-8">
        <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center">

          {/* -- Yourself, before anybody else sees you -- */}
          <div>
            <div className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn(
                  'size-full object-cover',
                  // Mirrored, because a preview of yourself that is not
                  // mirrored reads as somebody else's camera.
                  '-scale-x-100',
                  (!camOn || audioOnly || !!fault) && 'invisible',
                )}
              />

              {(!camOn || audioOnly || fault) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <PersonAvatar
                    id={currentMemberId ?? 'me'}
                    name={me?.fullName}
                    src={me?.avatarUrl}
                    size="xl"
                    decorative
                  />
                  <p className="text-xs text-white/50">
                    {fault ? 'No preview' : audioOnly ? 'Voice call' : 'Your camera is off'}
                  </p>
                </div>
              )}

              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-white/50" />
                </div>
              )}

              {/* The two switches, over the preview where they are being
                  judged, rather than in a toolbar somewhere else. */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-3">
                <ControlButton
                  active={micOn}
                  warnWhenOff
                  disabled={!!fault}
                  onClick={() => flip('mic')}
                  label={micOn ? 'Mute' : 'Unmute'}
                  on={<Mic className="size-4" />}
                  off={<MicOff className="size-4" />}
                />
                {!audioOnly && (
                  <ControlButton
                    active={camOn}
                    warnWhenOff
                    disabled={!!fault}
                    onClick={() => flip('cam')}
                    label={camOn ? 'Turn the camera off' : 'Turn the camera on'}
                    on={<Video className="size-4" />}
                    off={<VideoOff className="size-4" />}
                  />
                )}
              </div>
            </div>

            {fault && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-300/90">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                {fault} You can still join and listen.
              </p>
            )}
          </div>

          {/* -- What you are walking into -- */}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">{meeting.title}</h2>
            <p className="mt-1 text-sm text-white/55">
              {meeting.status === 'live'
                ? meeting.startedAt
                  ? `Started ${formatRelativeTime(meeting.startedAt)}`
                  : 'Happening now'
                : meeting.scheduledAt
                  ? formatDateTime(meeting.scheduledAt)
                  : 'Not scheduled'}
              {meeting.hostName ? ` · Hosted by ${meeting.hostName}` : ''}
            </p>

            {meeting.agenda?.trim() && (
              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-sm text-white/70">
                {meeting.agenda}
              </p>
            )}

            {(meeting.channelLabel || meeting.projectName) && (
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-white/45">
                {meeting.channelLabel && (
                  <span className="inline-flex items-center gap-1 rounded border border-white/15 px-1.5 py-0.5">
                    <Link2 className="size-2.5" /> {meeting.channelLabel}
                  </span>
                )}
                {meeting.projectName && (
                  <span className="inline-flex items-center gap-1 rounded border border-white/15 px-1.5 py-0.5">
                    {meeting.projectName}
                  </span>
                )}
              </p>
            )}

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">
                {inRoom.length > 0 ? 'Already here' : 'Invited'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(inRoom.length ? inRoom : invited).slice(0, 8).map(p => (
                  <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-white/5 py-1 pl-1 pr-2.5">
                    <PersonAvatar id={p.memberId} name={p.fullName} src={p.avatarUrl}
                      size="xs" decorative />
                    <span className="max-w-[8rem] truncate text-xs text-white/70">
                      {p.fullName}
                    </span>
                  </span>
                ))}
                {(inRoom.length ? inRoom : invited).length === 0 && (
                  <span className="text-xs text-white/40">
                    Nobody yet. You will be the first in.
                  </span>
                )}
              </div>
            </div>

            <Button
              size="lg"
              className="mt-6 w-full gap-2"
              onClick={() => onJoin({ micOn, camOn })}
            >
              <Video className="size-4" />
              {knocking ? 'Ask to join' : meeting.status === 'live' ? 'Join now' : 'Start the meeting'}
            </Button>

            {knocking && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-white/45">
                <DoorOpen className="size-3.5 shrink-0" />
                The host will be asked to let you in.
              </p>
            )}
          </div>
        </div>
      </div>
    </RoomShell>
  );
}

/**
 * An ISO instant as a `datetime-local` value, in the reader's own zone.
 *
 * `toISOString().slice(0, 16)` is UTC, so pasting one into a local field
 * offsets every suggestion by the reader's distance from Greenwich - which is
 * silently wrong for everybody outside it and is exactly the class of bug that
 * puts a meeting in the wrong hour.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Today 15:30", "Tomorrow 09:00", "Thu 4 Sep 11:00". */
function whenLabel(iso: string, locale = 'en-GB'): string {
  const when = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const time = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (when.toDateString() === today.toDateString()) return `Today ${time}`;
  if (when.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${when.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}