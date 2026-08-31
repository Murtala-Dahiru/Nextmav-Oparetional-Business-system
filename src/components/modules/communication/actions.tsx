'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  ListPlus, BellRing, CalendarPlus, Building2, FolderKanban, Loader2, Bookmark,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/store/app-store';
import { intakeBody } from '@/lib/mywork';
import { truncate } from '@/lib/format';

import { type ChannelRow, type Message, channelLabel } from './types';
import { plainPreview } from './rich-text';

/**
 * ===========================================================================
 *  Communication to action
 * ===========================================================================
 *
 *  -- The gap this closes ---------------------------------------------------
 *
 *  "Please send the proposal to Sarah tomorrow" is work. It arrived as a
 *  sentence in a channel, and until now the only way to make it work was to
 *  read it, remember it, switch module, and type it again - which is the point
 *  at which most of it stops happening. Every messaging product has this
 *  problem and only one inside an operating system can actually fix it.
 *
 *  -- What it deliberately is not -------------------------------------------
 *
 *  Not a parser. Nothing here reads "tomorrow" out of a message and guesses a
 *  date, and nothing decides on somebody's behalf that a sentence is a task.
 *  A guess that is right four times in five is worse than no guess at all,
 *  because the fifth one is a meeting in the wrong week that somebody has to
 *  find. The message text is offered as the title, already selected, and a
 *  person presses Return.
 *
 *  -- Why every destination already exists ---------------------------------
 *
 *  A to-do is `POST /api/todos` with the intake body every other module sends
 *  (`lib/mywork.ts`), including the `message` source kind, which has been in
 *  `SOURCE_KINDS` since Phase 3b with nothing in the product reaching it. A
 *  reminder is the same row with `remindAt` set, which is the mechanism
 *  `sweep_todo_reminders()` already runs on. A CRM activity is
 *  `POST /api/crm/activities`. A project task is `POST /api/projects/tasks`.
 *  Nothing new is written here; four things that existed are connected.
 *
 *  -- And why the menu is short --------------------------------------------
 *
 *  Two of the four destinations are offered only when the conversation is
 *  actually about something: a CRM activity when the channel carries a
 *  company, a project task when it carries a project. A menu that offers to
 *  file a message against a client the conversation has nothing to do with is
 *  a menu people learn to skip.
 */

type Destination = 'todo' | 'reminder' | 'crm' | 'task';

export interface MessageActionTarget {
  message: Message;
  channel: ChannelRow;
  senderName: string;
}

/**
 * The submenu that sits inside a message's own menu.
 *
 * Rendered by `MessageBubble`; the dialog it opens is mounted once by the
 * module rather than once per message, because forty bubbles each carrying
 * their own form is forty components with state and effects for a panel almost
 * nobody has open.
 */
export function TurnIntoMenu({
  channel, onPick, onScheduleMeeting,
}: {
  channel: ChannelRow;
  onPick: (destination: Destination) => void;
  onScheduleMeeting: () => void;
}) {
  const allows = useAppStore(s => s.allows);

  const canTodo = allows('mywork');
  const canCrm = allows('crm', 'create') && !!channel.companyId;
  const canTask = allows('projects', 'create') && !!channel.projectId;

  if (!canTodo && !canCrm && !canTask) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ListPlus className="mr-2 size-4" /> Turn into
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {canTodo && (
          <>
            <DropdownMenuItem onClick={() => onPick('todo')}>
              <ListPlus className="mr-2 size-4" /> A task on my list
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPick('reminder')}>
              <BellRing className="mr-2 size-4" /> A reminder
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={onScheduleMeeting}>
          <CalendarPlus className="mr-2 size-4" /> A meeting
        </DropdownMenuItem>
        {canTask && (
          <DropdownMenuItem onClick={() => onPick('task')}>
            <FolderKanban className="mr-2 size-4" /> A task on {truncate(channel.projectName ?? 'the project', 22)}
          </DropdownMenuItem>
        )}
        {canCrm && (
          <DropdownMenuItem onClick={() => onPick('crm')}>
            <Building2 className="mr-2 size-4" /> A note on {truncate(channel.companyName ?? 'the client', 22)}
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const TITLES: Record<Destination, { title: string; description: string; verb: string }> = {
  todo: {
    title: 'Add to My Work',
    description: 'Private to you. Completing it changes nothing for the team.',
    verb: 'Add',
  },
  reminder: {
    title: 'Remind me about this',
    description: 'You will be told at the time you choose. Nobody else is.',
    verb: 'Set reminder',
  },
  crm: {
    title: 'Log against the client',
    description: 'Appears on the client timeline, where the account team will see it.',
    verb: 'Log it',
  },
  task: {
    title: 'Add to the project',
    description: 'A real project task. The team sees it and it counts towards progress.',
    verb: 'Create task',
  },
};

/**
 * One dialog for all four destinations.
 *
 * The alternative was four, which is four places for the quoted message to be
 * assembled slightly differently and four sets of error handling. What differs
 * between them is two fields and one endpoint; that is not four dialogs.
 */
export function MessageActionDialog({
  target, destination, onOpenChange, onDone,
}: {
  target: MessageActionTarget | null;
  destination: Destination | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const setActiveModule = useAppStore(s => s.setActiveModule);
  const allows = useAppStore(s => s.allows);

  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [dueOn, setDueOn] = React.useState('');
  const [remindAt, setRemindAt] = React.useState('');
  const [activityType, setActivityType] = React.useState('note');
  const [saving, setSaving] = React.useState(false);

  const open = !!target && !!destination;
  const spec = destination ? TITLES[destination] : null;

  /**
   * The message becomes the title, and the message stays the note.
   *
   * A title has to be short enough to read in a list, and a message is often
   * three sentences. So the first line is offered as the title and the whole
   * thing is kept underneath, attributed - which is the difference between a
   * to-do that says "yes, but only if legal agree" and one that means anything
   * in a fortnight.
   */
  React.useEffect(() => {
    if (!target || !destination) return;
    const plain = plainPreview(target.message.body).trim();
    const firstLine = plain.split('\n')[0] || 'Follow up on a message';
    setTitle(truncate(firstLine, 120));
    setNote(
      plain && plain !== firstLine
        ? `${target.senderName} in ${channelLabel(target.channel)}:\n\n${plain}`
        : `From ${target.senderName} in ${channelLabel(target.channel)}`,
    );
    setDueOn('');
    setRemindAt(destination === 'reminder' ? defaultReminder() : '');
    setActivityType('note');
  }, [target, destination]);

  const submit = React.useCallback(async () => {
    if (!target || !destination) return;
    const clean = title.trim();
    if (!clean) { toast.error('Give it a title first.'); return; }

    setSaving(true);
    try {
      if (destination === 'crm') {
        await post('/api/crm/activities', {
          activityType,
          subject: clean,
          body: note,
          companyId: target.channel.companyId,
          completedAt: new Date().toISOString(),
        });
        toast.success('Logged on the client timeline', {
          description: target.channel.companyName ?? undefined,
          action: allows('crm')
            ? { label: 'Open CRM', onClick: () => setActiveModule('crm') }
            : undefined,
        });
      } else if (destination === 'task') {
        await post('/api/projects/tasks', {
          title: clean,
          description: note,
          projectId: target.channel.projectId,
          dueDate: dueOn || null,
        });
        toast.success('Added to the project', {
          description: target.channel.projectName ?? undefined,
          action: allows('projects')
            ? { label: 'Open Projects', onClick: () => setActiveModule('projects') }
            : undefined,
        });
      } else {
        /**
         * The source is the message itself, which is what makes pressing this
         * twice on the same sentence answer "already on your list" rather than
         * write a second copy: `POST /api/todos` looks for an open item with
         * the same source triple before it inserts.
         */
        const body = intakeBody(
          clean,
          {
            module: 'communication',
            type: 'message',
            id: target.message.id,
            label: `${target.senderName} in ${channelLabel(target.channel)}`,
          },
          { note, dueOn: dueOn || null },
        );
        if (remindAt) body.remindAt = new Date(remindAt).toISOString();

        const result = await post('/api/todos', body);
        toast.success(
          result.meta?.alreadyOnList ? 'Already on your list' : spec?.title ?? 'Added',
          {
            description: remindAt
              ? 'You will be reminded at the time you set.'
              : 'Private to you. Completing it changes nothing for the team.',
            action: allows('mywork')
              ? { label: 'Open My Work', onClick: () => setActiveModule('mywork') }
              : undefined,
          },
        );
      }
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      toast.error(e.message || 'That could not be saved');
    } finally {
      setSaving(false);
    }
  }, [
    target, destination, title, note, dueOn, remindAt, activityType,
    allows, setActiveModule, onOpenChange, onDone, spec,
  ]);

  if (!spec) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="action-title">Title</Label>
            <Input
              id="action-title"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            />
          </div>

          {destination === 'crm' && (
            <div className="space-y-1.5">
              <Label htmlFor="action-kind">Kind</Label>
              <Select value={activityType} onValueChange={setActivityType}>
                <SelectTrigger id="action-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {(destination === 'todo' || destination === 'task') && (
            <div className="space-y-1.5">
              <Label htmlFor="action-due">Due</Label>
              <Input id="action-due" type="date" value={dueOn}
                onChange={(e) => setDueOn(e.target.value)} />
            </div>
          )}

          {destination === 'reminder' && (
            <div className="space-y-1.5">
              <Label htmlFor="action-remind">Remind me at</Label>
              <Input id="action-remind" type="datetime-local" value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="action-note">
              {destination === 'crm' ? 'Detail' : 'Note'}
            </Label>
            <Textarea
              id="action-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground">
              The message is kept here so this still makes sense in a fortnight.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {spec.verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Nine o'clock tomorrow, in the reader's own timezone.
 *
 * `datetime-local` wants a local wall-clock string and `toISOString()` gives
 * UTC, so a naive default lands an hour or five out for most of the world.
 */
function defaultReminder(): string {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** POST, returning the whole envelope, because two callers want `meta`. */
async function post(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (json?.error) throw new Error(json.error.message || 'Request failed');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json ?? {};
}

/**
 * The save control, as it appears in a message's hover bar.
 *
 * A filled bookmark means it is on your shelf. Deliberately quiet: this is the
 * most-used action in the bar and the least important-looking, which is the
 * right way round for something a person does thirty times a week.
 */
export function SaveToggle({
  saved, onToggle, className,
}: {
  saved: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={onToggle}
      aria-label={saved ? 'Remove from saved' : 'Save this message'}
      aria-pressed={saved}
    >
      <Bookmark className={saved ? 'size-3.5 fill-current text-primary' : 'size-3.5'} />
    </Button>
  );
}
