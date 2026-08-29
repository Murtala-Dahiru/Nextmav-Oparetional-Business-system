'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, Link2, Repeat, FolderKanban, Star, Bell } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  RECURRENCES, RECURRENCE_LABELS, nextOccurrence, type Recurrence,
} from '@/lib/todo-recurrence';
import {
  REMINDER_PRESETS, presetNeedsDate, resolveReminder,
} from '@/lib/todo-reminder';
import {
  COLOR_KEYS, LIST_COLORS, addDaysISO, formatDay, todayISO,
  type AssignedTask, type Todo, type TodoList,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Edit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The form is keyed on the to-do rather than synced to it.
 *
 * Copying props into state inside an effect means the fields are briefly wrong
 * on open - they hold the *previous* to-do until the effect runs - and it
 * silently discards anything typed if the prop changes underneath. Remounting
 * on identity gives correct initial state with no effect at all.
 */
export function EditTodoDialog(props: {
  todo: Todo | null;
  lists: TodoList[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
  /** Open the pinned project task. Null when the role cannot see Projects. */
  onOpenTask?: ((taskId: string) => void) | null;
}) {
  if (!props.todo) return null;
  return <EditTodoForm key={props.todo.id} {...props} todo={props.todo} />;
}

/** The three dates people actually pick, before reaching for a calendar. */
const QUICK_DATES: { label: string; of: (today: string) => string | null }[] = [
  { label: 'Today',    of: t => t },
  { label: 'Tomorrow', of: t => addDaysISO(t, 1) },
  { label: 'Next week', of: t => addDaysISO(t, 7) },
  { label: 'No date',  of: () => null },
];

/**
 * An instant, in the shape a `datetime-local` input wants.
 *
 * That control speaks wall-clock with no zone, so the ISO string has to be
 * shifted into the reader's own offset before it is handed over - otherwise a
 * reminder set for 09:00 in Lagos is displayed as 08:00 to the person who set
 * it, which reads as the field having failed to save.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** How a project task's status reads on a personal list. */
const LINKED_STATUS: Record<string, string> = {
  todo: 'Not started',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
  blocked: 'Blocked',
};

function EditTodoForm({
  todo, lists, saving, onClose, onSave, onOpenTask,
}: {
  todo: Todo;
  lists: TodoList[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
  onOpenTask?: ((taskId: string) => void) | null;
}) {
  const [title, setTitle] = React.useState(todo.title);
  const [note, setNote] = React.useState(todo.note ?? '');
  const [dueOn, setDueOn] = React.useState(todo.dueOn ?? '');
  const [listId, setListId] = React.useState<string>(todo.listId ?? 'none');
  const [recurrence, setRecurrence] = React.useState<string>(todo.recurrence ?? 'none');
  const [isStarred, setIsStarred] = React.useState(todo.isStarred);
  const [remindAt, setRemindAt] = React.useState(
    todo.remindAt ? toLocalInput(todo.remindAt) : '',
  );

  const today = todayISO();

  /**
   * A repeat needs a day to repeat from - the database says so too. Rather
   * than letting the user submit an impossible pair and reading the refusal
   * back as a toast, choosing a repeat with no date sets today's, which is
   * what "starting from when?" always means here.
   */
  const chooseRecurrence = (value: string) => {
    setRecurrence(value);
    if (value !== 'none' && !dueOn) setDueOn(today);
  };

  const submit = () => onSave({
    title: title.trim(),
    note,
    dueOn: dueOn || null,
    listId: listId === 'none' ? null : listId,
    recurrence: recurrence === 'none' ? null : recurrence,
    isStarred,
    /* A `datetime-local` value is wall-clock with no zone; `new Date` reads
       it in the reader's own, which is exactly the instant they meant. */
    remindAt: remindAt ? new Date(remindAt).toISOString() : null,
  });

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit to-do</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="todo-title">Task</Label>
            <Input
              id="todo-title" value={title} autoFocus
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                // Enter saves from the title, which is where the cursor is.
                if (e.key === 'Enter' && title.trim()) { e.preventDefault(); submit(); }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="todo-note">Note</Label>
            <Textarea
              id="todo-note" rows={3} value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Anything worth remembering"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="todo-due">Due</Label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_DATES.map(q => {
                const value = q.of(today);
                const active = (value ?? '') === dueOn;
                return (
                  <Button
                    key={q.label}
                    type="button" variant={active ? 'default' : 'outline'} size="sm"
                    className='h-7 px-2 text-xs'
                    // Clearing the date is refused while a repeat is set, so
                    // the control that would cause it is disabled instead of
                    // failing after the fact.
                    disabled={value === null && recurrence !== 'none'}
                    onClick={() => setDueOn(value ?? '')}
                  >
                    {q.label}
                  </Button>
                );
              })}
            </div>
            <Input id="todo-due" type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>List</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No list</SelectItem>
                  {lists.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Repeat</Label>
              <Select value={recurrence} onValueChange={chooseRecurrence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Does not repeat</SelectItem>
                  {RECURRENCES.map(r => (
                    <SelectItem key={r} value={r}>{RECURRENCE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {recurrence !== 'none' && dueOn && (
            <p className="-mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Repeat className="size-3.5 shrink-0" />
              Completing it queues the next for{' '}
              <span className="font-medium text-foreground">
                {formatDay(nextOccurrence(dueOn, recurrence as Recurrence), {
                  weekday: 'short', month: 'short', day: 'numeric',
                })}
              </span>
            </p>
          )}

          {/*
            ── The reminder ──────────────────────────────────────────────

            Separated from *Due* by a rule and its own label, because they are
            different statements and a form that puts them side by side
            teaches people they are the same thing. Due is when the work
            should be done; a reminder is when you want to be told.

            Presets first, because "the evening before" is what somebody
            actually wants and computing it from a clock is work they should
            not have to do. The exact control is underneath for the times they
            do mean 14:30 - and it is a `datetime-local`, which the browser
            renders in the reader's own clock, which is the whole reason the
            column is a `timestamptz`.
          */}
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="todo-remind">Remind me</Label>
              {remindAt && (
                <button
                  type="button"
                  onClick={() => setRemindAt('')}
                  className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {REMINDER_PRESETS.map(preset => {
                const blocked = presetNeedsDate(preset.key) && !dueOn;
                return (
                  <Button
                    key={preset.key}
                    type="button" variant="outline" size="sm"
                    className="h-7 px-2 text-xs"
                    // A preset that needs a due date and has none would resolve
                    // to nothing; the control that cannot work is disabled
                    // rather than silently doing nothing when pressed.
                    disabled={blocked}
                    title={blocked ? 'Give it a date first' : undefined}
                    onClick={() => {
                      const at = resolveReminder(preset.key, dueOn || null);
                      if (at) setRemindAt(toLocalInput(at));
                    }}
                  >
                    {preset.label}
                  </Button>
                );
              })}
            </div>

            <Input
              id="todo-remind"
              type="datetime-local"
              value={remindAt}
              onChange={e => setRemindAt(e.target.value)}
            />

            {remindAt && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Bell className="size-3.5 shrink-0" />
                {new Date(remindAt) <= new Date()
                  ? 'That time has passed - choose a later one.'
                  : `Notifies you ${new Date(remindAt).toLocaleString(undefined, {
                      weekday: 'short', day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                    })}.`}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsStarred(s => !s)}
            aria-pressed={isStarred}
            className="flex items-center gap-2 self-start rounded-md border px-2.5 py-1.5 text-xs transition hover:bg-muted"
          >
            <Star className={cn('size-3.5', isStarred ? 'fill-warning text-warning' : 'text-muted-foreground')} />
            {isStarred ? 'Starred' : 'Star this'}
          </button>

          {/*
            The task this to-do is pinned to, as context rather than as
            something editable here.

            The API has always returned the task's title, status and project
            and nothing ever showed more than the project's name on a badge -
            so a person looking at "Draft the brief" on their own list could
            not see that the task behind it was already marked done by
            somebody else. Read-only on purpose: the status belongs to the
            team, and it is changed in Projects where they can see it.
          */}
          {todo.linkedTask && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                <Link2 className="size-3" /> Project task
              </p>
              <p className="mt-1.5 text-[13px] font-medium leading-snug text-foreground">
                {todo.linkedTask.title}
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {todo.linkedTask.project?.name ?? 'No project'}
                {' · '}
                {LINKED_STATUS[todo.linkedTask.status] ?? todo.linkedTask.status}
                {todo.linkedTask.dueDate
                  ? ` · due ${formatDay(todo.linkedTask.dueDate, { day: 'numeric', month: 'short' })}`
                  : ''}
              </p>
              {onOpenTask && (
                <button
                  type="button"
                  onClick={() => onOpenTask(todo.linkedTask!.id)}
                  className="mt-2 text-[12px] font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
                >
                  Open it in Projects →
                </button>
              )}
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground/80">
                Completing this to-do does not complete the task.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !title.trim()}
            
            onClick={submit}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Lists                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create or rename, in one dialog.
 *
 * `/api/todos/lists/[id]` has supported renaming and recolouring since it was
 * written and nothing ever called it, so a list created with a typo was
 * permanent and a colour chosen once could never be changed.
 */
export function ListDialog({
  open, editing, saving, onOpenChange, onSubmit,
}: {
  open: boolean;
  /** The list being renamed, or null when creating. */
  editing: TodoList | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { name: string; color: string }) => void;
}) {
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('emerald');

  // Reset whenever the dialog opens, so renaming one list and then creating
  // another does not start with the previous name in the field.
  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setColor(editing?.color ?? 'emerald');
  }, [open, editing]);

  const submit = () => { if (name.trim()) onSubmit({ name: name.trim(), color }); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? 'Rename list' : 'New list'}</DialogTitle>
          <DialogDescription>
            Your own grouping. Nobody else can see it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name" value={name} autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder="Follow-ups"
            />
          </div>

          <div className="space-y-2">
            <Label>Colour</Label>
            <div className="flex gap-2">
              {COLOR_KEYS.map(c => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-6 rounded-full transition',
                    LIST_COLORS[c],
                    color === c
                      ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                      : 'opacity-60 hover:opacity-100',
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={saving || !name.trim()}
            
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {editing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pin an assigned task                                                      */
/* -------------------------------------------------------------------------- */

export function PinTaskDialog({
  open, tasks, loading, onOpenChange, onPin,
}: {
  open: boolean;
  tasks: AssignedTask[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onPin: (task: AssignedTask) => void;
}) {
  const [filter, setFilter] = React.useState('');

  React.useEffect(() => { if (open) setFilter(''); }, [open]);

  const shown = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t =>
      t.title.toLowerCase().includes(q) || (t.project?.name ?? '').toLowerCase().includes(q));
  }, [tasks, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pin an assigned task</DialogTitle>
          <DialogDescription>
            Puts it on your list so you can plan around it. Completing it here
            does not complete the task.
          </DialogDescription>
        </DialogHeader>

        {tasks.length > 6 && (
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by task or project…"
            className="h-9"
          />
        )}

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading your assignments…
            </p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tasks.length === 0
                ? 'Nothing is assigned to you.'
                : 'No assigned task matches that.'}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {shown.map(task => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onPin(task)}
                  className="flex items-start gap-3 rounded-md border p-3 text-left transition hover:border-foreground/25 hover:bg-accent/60"
                >
                  <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.project?.name ?? 'No project'}
                      {task.dueDate && ` · due ${formatDay(task.dueDate, { month: 'short', day: 'numeric' })}`}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Convert to a project task                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The other direction of the bridge.
 *
 * "Pin a task" brings assigned work onto the list; this sends personal work
 * the other way, for the moment a note to yourself turns out to be a job the
 * team should be able to see. The to-do is kept and linked rather than
 * consumed - see the endpoint for why.
 */
export function ConvertDialog({
  todo, saving, onOpenChange, onConvert,
}: {
  todo: Todo | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConvert: (projectId: string) => void;
}) {
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!todo) return;
    setProjectId('');
    setLoading(true);
    fetch('/api/projects/projects?pageSize=100')
      .then(r => (r.ok ? r.json() : null))
      .then(json => setProjects((json?.data ?? []).map((p: any) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [todo]);

  return (
    <Dialog open={!!todo} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Make it a project task</DialogTitle>
          <DialogDescription>
            Creates a task assigned to you, so the team can see it. Your to-do
            stays here and links to it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">{todo?.title}</p>
            {todo?.note && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{todo.note}</p>}
          </div>

          <div className="space-y-2">
            <Label>Project</Label>
            {loading ? (
              <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading projects…
              </div>
            ) : projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                There are no projects you can add a task to.
              </p>
            ) : (
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={saving || !projectId}
            onClick={() => onConvert(projectId)}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <FolderKanban className="size-4" />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Keyboard help                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Grouped, because eleven flat rows is a reference card and three short
 * groups is something a person can actually learn: what moves, what acts,
 * what navigates.
 */
const SHORTCUTS: { group: string; keys: string[]; what: string }[] = [
  { group: 'Moving', keys: ['J', 'K'], what: 'Down and up the list' },
  { group: 'Moving', keys: ['1', '…', '6'], what: 'Switch between the views' },
  { group: 'Moving', keys: ['/'], what: 'Search everything' },
  { group: 'Moving', keys: ['Esc'], what: 'Clear the search, or leave focus' },

  { group: 'Highlighted item', keys: ['Space'], what: 'Tick it off' },
  { group: 'Highlighted item', keys: ['Enter'], what: 'Open it' },
  { group: 'Highlighted item', keys: ['S'], what: 'Star it' },
  { group: 'Highlighted item', keys: ['T'], what: 'Move it to tomorrow' },
  { group: 'Highlighted item', keys: ['E'], what: 'Edit it' },
  { group: 'Highlighted item', keys: ['⌫'], what: 'Delete it' },

  { group: 'Working', keys: ['N'], what: 'Jump to the capture box' },
  { group: 'Working', keys: ['F'], what: 'Enter focus mode' },
  { group: 'Working', keys: ['?'], what: 'This list' },

  { group: 'While typing a new one', keys: ['/today'], what: 'Due today' },
  { group: 'While typing a new one', keys: ['/tomorrow'], what: 'Due tomorrow' },
  { group: 'While typing a new one', keys: ['/nextweek'], what: 'Due in a week' },
  { group: 'While typing a new one', keys: ['!'], what: 'Star it' },
];

export function ShortcutsDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = Array.from(new Set(SHORTCUTS.map(s => s.group)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Faster without the mouse.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {groups.map(group => (
            <div key={group}>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80">
                {group}
              </p>
              <dl className="flex flex-col gap-1">
                {SHORTCUTS.filter(s => s.group === group).map(s => (
                  <div key={s.what} className="flex items-center gap-3 text-[13px]">
                    <dt className="flex w-[5.5rem] shrink-0 items-center gap-1">
                      {s.keys.map(k => (k === '…' ? (
                        <span key={k} className="text-[11px] text-muted-foreground">to</span>
                      ) : (
                        <kbd
                          key={k}
                          className="min-w-[1.4rem] rounded border border-border bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium"
                        >
                          {k}
                        </kbd>
                      )))}
                    </dt>
                    <dd className="text-muted-foreground">{s.what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
