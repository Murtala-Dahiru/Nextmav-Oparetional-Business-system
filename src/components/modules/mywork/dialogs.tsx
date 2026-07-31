'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, Link2, Repeat, FolderKanban, Star } from 'lucide-react';

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
import { formatDate } from '@/lib/format';
import {
  RECURRENCES, RECURRENCE_LABELS, nextOccurrence, type Recurrence,
} from '@/lib/todo-recurrence';
import {
  COLOR_KEYS, LIST_COLORS, addDaysISO, todayISO,
  type AssignedTask, type Todo, type TodoList,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Edit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The form is keyed on the to-do rather than synced to it.
 *
 * Copying props into state inside an effect means the fields are briefly wrong
 * on open — they hold the *previous* to-do until the effect runs — and it
 * silently discards anything typed if the prop changes underneath. Remounting
 * on identity gives correct initial state with no effect at all.
 */
export function EditTodoDialog(props: {
  todo: Todo | null;
  lists: TodoList[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
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

function EditTodoForm({
  todo, lists, saving, onClose, onSave,
}: {
  todo: Todo;
  lists: TodoList[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = React.useState(todo.title);
  const [note, setNote] = React.useState(todo.note ?? '');
  const [dueOn, setDueOn] = React.useState(todo.dueOn ?? '');
  const [listId, setListId] = React.useState<string>(todo.listId ?? 'none');
  const [recurrence, setRecurrence] = React.useState<string>(todo.recurrence ?? 'none');
  const [isStarred, setIsStarred] = React.useState(todo.isStarred);

  const today = todayISO();

  /**
   * A repeat needs a day to repeat from — the database says so too. Rather
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
  });

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="todo-title">What needs doing</Label>
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
              placeholder="Anything you want to remember about it"
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
                    className={cn('h-7 px-2 text-xs', active && 'bg-emerald-600 text-white hover:bg-emerald-700')}
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
              Ticking it off will queue the next one for{' '}
              <span className="font-medium text-foreground">
                {formatDate(nextOccurrence(dueOn, recurrence as Recurrence), {
                  weekday: 'short', month: 'short', day: 'numeric',
                })}
              </span>
            </p>
          )}

          <button
            type="button"
            onClick={() => setIsStarred(s => !s)}
            aria-pressed={isStarred}
            className="flex items-center gap-2 self-start rounded-md border px-2.5 py-1.5 text-xs transition hover:bg-muted"
          >
            <Star className={cn('size-3.5', isStarred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
            {isStarred ? 'Starred' : 'Star this'}
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !title.trim()}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
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
            A way to group your own to-dos. Only you can see it.
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
            className="bg-emerald-600 text-white hover:bg-emerald-700"
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
            Puts a copy on your list so you can plan around it. Ticking it off
            here does not complete the task — do that in Projects, where your
            team can see it.
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
              <Loader2 className="size-4 animate-spin" /> Looking for your assignments…
            </p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tasks.length === 0
                ? 'Nothing is currently assigned to you.'
                : 'No assigned task matches that.'}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {shown.map(task => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onPin(task)}
                  className="flex items-start gap-3 rounded-md border p-3 text-left transition hover:border-emerald-500/50 hover:bg-muted/50"
                >
                  <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.project?.name ?? 'No project'}
                      {task.dueDate && ` · due ${formatDate(task.dueDate, { month: 'short', day: 'numeric' })}`}
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
 * consumed — see the endpoint for why.
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
            Creates a task assigned to you, so your team can see the work. Your
            to-do stays on this list and links to it.
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
            className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
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

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['N'], what: 'Jump to the capture box' },
  { keys: ['/'], what: 'Search' },
  { keys: ['J', 'K'], what: 'Move down and up the list' },
  { keys: ['Space'], what: 'Tick the highlighted item off' },
  { keys: ['S'], what: 'Star it' },
  { keys: ['E'], what: 'Edit it' },
  { keys: ['⌫'], what: 'Delete it' },
  { keys: ['F'], what: 'Enter focus mode' },
  { keys: ['1', '5'], what: 'Switch between the views' },
  { keys: ['Esc'], what: 'Clear the search, or leave focus' },
  { keys: ['?'], what: 'This list' },
];

export function ShortcutsDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard</DialogTitle>
          <DialogDescription>
            The list is faster without the mouse once you know these.
          </DialogDescription>
        </DialogHeader>

        <dl className="flex flex-col gap-1.5">
          {SHORTCUTS.map(s => (
            <div key={s.what} className="flex items-center gap-3 text-sm">
              <dt className="flex shrink-0 gap-1">
                {s.keys.map(k => (
                  <kbd
                    key={k}
                    className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{s.what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
