'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import {
  CheckSquare, Plus, Star, Trash2, CalendarDays, Loader2,
  Inbox, Sun, CalendarClock, CheckCircle2, ListChecks, Link2, MoreHorizontal, Pencil,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDate } from '@/lib/format';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  My Work — a person's own to-do list
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is not the Tasks screen ──────────────────────────────────────
 *
 * The Projects module already has a task system: a table with assignee,
 * status, priority, estimated hours, project and milestone columns, a filter
 * bar and a create dialog with ten fields. That is the right shape for work
 * the organization is tracking, because every one of those columns answers a
 * question somebody other than the assignee will ask.
 *
 * This screen answers no questions for anybody else. It is a list with
 * checkboxes. There is no assignee (they are all yours), no status (done or
 * not), no priority beyond a star, no estimate, and no project unless you
 * choose to pin one. Adding a to-do is one field and the Enter key, because
 * the moment capturing a thought costs a dialog, people stop capturing them
 * and the feature dies.
 *
 * The deliberate consequence: nothing here moves a project metric. Ticking off
 * "call the client back" changes no burndown, no report and nobody else's
 * screen. That is the guarantee that makes people willing to put real things
 * on it.
 *
 * The one bridge is "pin a task": an assigned project task can be attached to
 * a to-do so you can plan your day around it. The link is one-way and inert.
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface TodoList {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  todos?: { count: number }[];
}

interface LinkedTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  project?: { id: string; name: string } | null;
}

interface Todo {
  id: string;
  title: string;
  note: string;
  isDone: boolean;
  completedAt: string | null;
  dueOn: string | null;
  isStarred: boolean;
  sortOrder: number;
  listId: string | null;
  linkedTaskId: string | null;
  list?: { id: string; name: string; color: string } | null;
  linkedTask?: LinkedTask | null;
  createdAt: string;
}

interface AssignedTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  project?: { id: string; name: string } | null;
}

type ViewKey = 'open' | 'today' | 'upcoming' | 'starred' | 'done';

const VIEWS: { key: ViewKey; label: string; icon: typeof Inbox; hint: string }[] = [
  { key: 'open',     label: 'All open',  icon: Inbox,         hint: 'Everything still to do' },
  { key: 'today',    label: 'Today',     icon: Sun,           hint: 'Due today or already overdue' },
  { key: 'upcoming', label: 'Upcoming',  icon: CalendarClock, hint: 'Scheduled for later' },
  { key: 'starred',  label: 'Starred',   icon: Star,          hint: 'What matters most' },
  { key: 'done',     label: 'Completed', icon: CheckCircle2,  hint: 'Recently finished' },
];

/** Colour keys as stored, resolved here rather than in the database. */
const LIST_COLORS: Record<string, string> = {
  slate:   'bg-slate-400',
  emerald: 'bg-emerald-500',
  blue:    'bg-blue-500',
  amber:   'bg-amber-500',
  rose:    'bg-rose-500',
  violet:  'bg-violet-500',
};

const COLOR_KEYS = Object.keys(LIST_COLORS);

// ═══════════════════════════════════════════════════════════════════════════
//  API helper
// ═══════════════════════════════════════════════════════════════════════════

async function api<T>(url: string, init?: RequestInit): Promise<{ data: T; meta?: any }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json().catch(() => null);
  if (json?.error) throw new Error(json.error.message || 'Request failed');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json;
}

/** Today, tomorrow, or the date — how people actually refer to their own days. */
function dueLabel(due: string | null): { text: string; tone: string } | null {
  if (!due) return null;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  if (due < today) return { text: 'Overdue', tone: 'text-destructive' };
  if (due === today) return { text: 'Today', tone: 'text-emerald-600 dark:text-emerald-400' };
  if (due === tomorrow) return { text: 'Tomorrow', tone: 'text-muted-foreground' };
  return { text: formatDate(due, { month: 'short', day: 'numeric' }), tone: 'text-muted-foreground' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Module
// ═══════════════════════════════════════════════════════════════════════════

export default function MyWorkModule() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<TodoList[]>([]);
  const [counts, setCounts] = useState({ open: 0, today: 0, starred: 0 });
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewKey>('open');
  const [listFilter, setListFilter] = useState<string | null>(null);

  // Quick capture
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);

  // Dialogs
  const [editing, setEditing] = useState<Todo | null>(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState('emerald');
  const [deleting, setDeleting] = useState<Todo | null>(null);
  const [busy, setBusy] = useState(false);

  // Pin-a-task
  const [pinOpen, setPinOpen] = useState(false);
  const [assigned, setAssigned] = useState<AssignedTask[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('view', view);
      if (listFilter) params.set('listId', listFilter);

      const [todoRes, listRes] = await Promise.all([
        api<Todo[]>(`/api/todos?${params.toString()}`),
        api<TodoList[]>('/api/todos/lists'),
      ]);

      setTodos(todoRes.data ?? []);
      setLists(listRes.data ?? []);
      if (todoRes.meta?.counts) setCounts(todoRes.meta.counts);
    } catch (e: any) {
      toast.error(e.message || 'Could not load your list');
    } finally {
      setLoading(false);
    }
  }, [view, listFilter]);

  useEffect(() => { load(); }, [load]);

  // ── Quick capture ────────────────────────────────────────────────────────
  /**
   * One field, Enter to save, focus retained.
   *
   * The input is not cleared until the request succeeds — losing what someone
   * typed because the network blipped is the fastest way to make a capture box
   * untrustworthy, and an untrusted capture box goes unused.
   */
  const addTodo = useCallback(async () => {
    const title = draft.trim();
    if (!title || adding) return;

    setAdding(true);
    try {
      await api('/api/todos', {
        method: 'POST',
        body: JSON.stringify({
          title,
          // A to-do captured while looking at a list belongs to that list.
          listId: listFilter,
          // Captured in the Today view, it is for today.
          dueOn: view === 'today' ? new Date().toISOString().slice(0, 10) : null,
          isStarred: view === 'starred',
        }),
      });
      setDraft('');
      captureRef.current?.focus();
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not add that');
    } finally {
      setAdding(false);
    }
  }, [draft, adding, listFilter, view, load]);

  /**
   * Toggle done, applied locally first.
   *
   * A checkbox that waits for a round trip before ticking feels broken, and
   * this is the single most-used control on the screen. Reverted on failure.
   */
  const toggleDone = useCallback(async (todo: Todo) => {
    const before = todos;
    setTodos(prev => prev.map(t => (t.id === todo.id ? { ...t, isDone: !t.isDone } : t)));
    setCounts(c => ({ ...c, open: Math.max(0, c.open + (todo.isDone ? 1 : -1)) }));

    try {
      await api(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDone: !todo.isDone }),
      });
      // Reload only when the change removes it from the current view, so the
      // list does not flicker on every tick.
      if (view !== 'done' && view !== 'open') load();
      else if (view === 'open' && !todo.isDone) {
        setTimeout(() => setTodos(prev => prev.filter(t => t.id !== todo.id)), 400);
      }
    } catch (e: any) {
      toast.error(e.message || 'Could not update');
      setTodos(before);
    }
  }, [todos, view, load]);

  const toggleStar = useCallback(async (todo: Todo) => {
    const before = todos;
    setTodos(prev => prev.map(t => (t.id === todo.id ? { ...t, isStarred: !t.isStarred } : t)));
    try {
      await api(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isStarred: !todo.isStarred }),
      });
      setCounts(c => ({ ...c, starred: Math.max(0, c.starred + (todo.isStarred ? -1 : 1)) }));
    } catch (e: any) {
      toast.error(e.message || 'Could not update');
      setTodos(before);
    }
  }, [todos]);

  const saveEdit = useCallback(async (values: Partial<Todo>) => {
    if (!editing) return;
    setBusy(true);
    try {
      await api(`/api/todos/${editing.id}`, { method: 'PATCH', body: JSON.stringify(values) });
      toast.success('Saved');
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }, [editing, load]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/todos/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }, [deleting, load]);

  const createList = useCallback(async () => {
    const name = newListName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api('/api/todos/lists', {
        method: 'POST',
        body: JSON.stringify({ name, color: newListColor }),
      });
      setNewListName('');
      setListDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not create the list');
    } finally {
      setBusy(false);
    }
  }, [newListName, newListColor, load]);

  /**
   * Pin an assigned project task onto the list.
   *
   * Reads tasks assigned to the signed-in user from the projects endpoint. The
   * to-do created from it is a separate object — completing it does not touch
   * the task, because "I have planned my day around this" and "the work is
   * finished" are different statements.
   */
  const openPin = useCallback(async () => {
    setPinOpen(true);
    try {
      const res = await api<AssignedTask[]>('/api/projects/tasks?assignedToMe=true&pageSize=50');
      setAssigned((res.data ?? []).filter(t => t.status !== 'done'));
    } catch {
      setAssigned([]);
    }
  }, []);

  const pinTask = useCallback(async (task: AssignedTask) => {
    try {
      await api('/api/todos', {
        method: 'POST',
        body: JSON.stringify({
          title: task.title,
          dueOn: task.dueDate,
          linkedTaskId: task.id,
          listId: listFilter,
        }),
      });
      toast.success('Pinned to your list');
      setPinOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not pin that task');
    }
  }, [listFilter, load]);

  const activeView = VIEWS.find(v => v.key === view)!;
  const currentList = useMemo(
    () => lists.find(l => l.id === listFilter) ?? null,
    [lists, listFilter],
  );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 overflow-auto h-full">
      <PageHeader title="My Work" icon={CheckSquare}>
        <Button variant="outline" onClick={openPin} className="gap-1.5">
          <Link2 className="size-4" /> Pin a task
        </Button>
      </PageHeader>

      {/*
        A single explanatory line, once. Without it the obvious question on
        first sight is "how is this different from Tasks?", and a user who
        guesses wrong puts team work here or personal reminders there.
      */}
      <p className="-mt-3 text-sm text-muted-foreground">
        Your own list — private to you, and never counted in project reports.
        Work assigned to you by others lives in{' '}
        <span className="font-medium text-foreground">Projects → Tasks</span>.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
        {/* ── Sidebar: views and lists ─────────────────────────────────── */}
        <aside className="flex flex-col gap-6">
          <nav className="flex flex-col gap-0.5">
            {VIEWS.map(v => {
              const Icon = v.icon;
              const count = v.key === 'open' ? counts.open
                : v.key === 'today' ? counts.today
                : v.key === 'starred' ? counts.starred
                : null;

              return (
                <button
                  key={v.key}
                  type="button"
                  title={v.hint}
                  onClick={() => { setView(v.key); setListFilter(null); }}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                    view === v.key && !listFilter
                      ? 'bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left">{v.label}</span>
                  {count ? (
                    <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between px-2.5 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Lists
              </span>
              <button
                type="button"
                aria-label="New list"
                onClick={() => setListDialogOpen(true)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            {lists.length === 0 ? (
              <p className="px-2.5 text-xs text-muted-foreground/70">
                Group your to-dos into lists when you have enough to sort.
              </p>
            ) : lists.map(list => (
              <button
                key={list.id}
                type="button"
                onClick={() => { setListFilter(list.id); setView('open'); }}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  listFilter === list.id
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className={cn('size-2 shrink-0 rounded-full', LIST_COLORS[list.color] ?? LIST_COLORS.slate)} />
                <span className="flex-1 truncate text-left">{list.name}</span>
                {list.todos?.[0]?.count ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {list.todos[0].count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </aside>

        {/* ── The list ─────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-4">
          {/* Quick capture. Hidden in the completed view, where adding makes
              no sense — a to-do you create as already done is a note. */}
          {view !== 'done' && (
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <Plus className="size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={captureRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTodo(); }}
                placeholder={
                  currentList
                    ? `Add to ${currentList.name}…`
                    : 'Add something to your list…'
                }
                className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
              />
              {adding
                ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                : draft.trim() && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Enter
                    </span>
                  )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {currentList ? currentList.name : activeView.label}
            </h2>
            <span className="text-xs text-muted-foreground">
              {loading ? '' : `${todos.length} item${todos.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : todos.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={view === 'done' ? 'Nothing completed yet' : 'Nothing here'}
              description={
                view === 'done'
                  ? 'Items you tick off will collect here.'
                  : activeView.hint + '. Add something above to get started.'
              }
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {todos.map(todo => {
                const due = dueLabel(todo.dueOn);

                return (
                  <Card key={todo.id} className="group transition-colors hover:border-emerald-500/40">
                    <CardContent className="flex items-start gap-3 p-3">
                      <Checkbox
                        checked={todo.isDone}
                        onCheckedChange={() => toggleDone(todo)}
                        className="mt-0.5 shrink-0"
                        aria-label={todo.isDone ? 'Mark as not done' : 'Mark as done'}
                      />

                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          'text-sm leading-snug',
                          todo.isDone ? 'text-muted-foreground line-through' : 'text-foreground',
                        )}>
                          {todo.title}
                        </p>

                        {todo.note && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {todo.note}
                          </p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {due && !todo.isDone && (
                            <span className={cn('flex items-center gap-1 text-[11px]', due.tone)}>
                              <CalendarDays className="size-3" /> {due.text}
                            </span>
                          )}

                          {todo.list && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <span className={cn('size-1.5 rounded-full', LIST_COLORS[todo.list.color] ?? LIST_COLORS.slate)} />
                              {todo.list.name}
                            </span>
                          )}

                          {/*
                            The pinned task, shown as provenance rather than as
                            something editable here. Changing the task is done
                            in Projects, which is where the team can see it.
                          */}
                          {todo.linkedTask && (
                            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
                              <Link2 className="size-2.5" />
                              {todo.linkedTask.project?.name ?? 'Task'}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label={todo.isStarred ? 'Remove star' : 'Star this'}
                        onClick={() => toggleStar(todo)}
                        className="shrink-0 rounded p-1 text-muted-foreground/40 transition hover:text-amber-500"
                      >
                        <Star className={cn('size-4', todo.isStarred && 'fill-amber-400 text-amber-400')} />
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-0 transition group-hover:opacity-100">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(todo)}>
                            <Pencil className="mr-2 size-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(todo)}
                          >
                            <Trash2 className="mr-2 size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ── Edit ──────────────────────────────────────────────────────── */}
      <EditTodoDialog
        todo={editing}
        lists={lists}
        saving={busy}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
      />

      {/* ── New list ──────────────────────────────────────────────────── */}
      <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New list</DialogTitle>
            <DialogDescription>
              A way to group your own to-dos. Only you can see it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="list-name">Name</Label>
              <Input
                id="list-name"
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createList(); }}
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
                    onClick={() => setNewListColor(c)}
                    className={cn(
                      'size-6 rounded-full transition',
                      LIST_COLORS[c],
                      newListColor === c
                        ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                        : 'opacity-60 hover:opacity-100',
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setListDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={createList}
              disabled={busy || !newListName.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Pin a task ────────────────────────────────────────────────── */}
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pin an assigned task</DialogTitle>
            <DialogDescription>
              Puts a copy on your list so you can plan around it. Ticking it off
              here does not complete the task — do that in Projects, where your
              team can see it.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 overflow-y-auto">
            {assigned.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing is currently assigned to you.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {assigned.map(task => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => pinTask(task)}
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

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={open => { if (!open) setDeleting(null); }}
        title="Delete this to-do"
        description={`"${deleting?.title}" will be removed from your list.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={busy}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Edit dialog
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Four fields, and that is the whole of it.
 *
 * The temptation with a screen like this is to reach parity with the task
 * dialog — a status, a priority, an estimate. Each one individually seems
 * harmless and collectively they turn a list into the thing it exists to be an
 * alternative to.
 */
function EditTodoDialog(props: {
  todo: Todo | null;
  lists: TodoList[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  /**
   * The form is keyed on the to-do rather than synced to it.
   *
   * Copying props into state inside an effect means the fields are briefly
   * wrong on open — they hold the *previous* to-do until the effect runs —
   * and it silently discards anything typed if the prop changes underneath.
   * Remounting on identity gives correct initial state with no effect at all.
   */
  if (!props.todo) return null;
  return <EditTodoForm key={props.todo.id} {...props} todo={props.todo} />;
}

function EditTodoForm({
  todo, lists, saving, onClose, onSave,
}: {
  todo: Todo;
  lists: TodoList[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [note, setNote] = useState(todo.note ?? '');
  const [dueOn, setDueOn] = useState(todo.dueOn ?? '');
  const [listId, setListId] = useState<string>(todo.listId ?? 'none');

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="todo-title">What needs doing</Label>
            <Input id="todo-title" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="todo-note">Note</Label>
            <Textarea
              id="todo-note"
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Anything you want to remember about it"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="todo-due">Due</Label>
              <Input id="todo-due" type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} />
            </div>

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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !title.trim()}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => onSave({
              title: title.trim(),
              note,
              dueOn: dueOn || null,
              listId: listId === 'none' ? null : listId,
            })}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
