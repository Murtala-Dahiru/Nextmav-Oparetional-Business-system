'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  CheckSquare, Plus, Loader2, Inbox, Sun, CalendarClock, CheckCircle2, Star,
  ListChecks, Link2, MoreHorizontal, Pencil, Trash2, Search, X, Keyboard,
  Rows3, Columns3, CalendarDays, Crosshair,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { SortableTodoRow, type TodoRowActions } from './todo-row';
import { BoardView, ScheduleView } from './views';
import { FocusMode } from './focus-mode';
import {
  ConvertDialog, EditTodoDialog, ListDialog, PinTaskDialog, ShortcutsDialog,
} from './dialogs';
import {
  BUCKETS, LIST_COLORS, VIEWS, bucketOf, dayProgress, groupByBucket, todayISO,
  type AssignedTask, type BucketKey, type Layout, type Todo, type TodoCounts,
  type TodoList, type ViewKey,
} from './types';

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
 * ── What this pass added, and what it deliberately did not ────────────────
 *
 * Added: the three things the API already did and no screen had ever asked
 * for — reordering by hand, renaming a list, and search — plus a board and a
 * schedule over the one dimension a personal list genuinely has, a focus mode,
 * repeats, and a way to promote a note into real project work.
 *
 * Not added, on purpose: labels (lists and the star already do that job),
 * attachments (a file belongs in Workspace, where it can be found again), and
 * a priority scale (the star *is* the scale — a private list with four levels
 * of importance is one nobody triages honestly). Each was considered against
 * the same test: does it reduce the friction of getting personal work done, or
 * does it move this closer to being the task tracker it exists as a calmer
 * alternative to?
 */

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

const VIEW_ICONS: Record<ViewKey, typeof Inbox> = {
  open: Inbox, today: Sun, upcoming: CalendarClock, starred: Star, done: CheckCircle2,
};

const LAYOUTS: { key: Layout; label: string; icon: typeof Rows3 }[] = [
  { key: 'list', label: 'List', icon: Rows3 },
  { key: 'board', label: 'Board', icon: Columns3 },
  { key: 'schedule', label: 'Schedule', icon: CalendarDays },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Module
// ═══════════════════════════════════════════════════════════════════════════

export default function MyWorkModule() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<TodoList[]>([]);
  const [counts, setCounts] = useState<TodoCounts>({ open: 0, today: 0, starred: 0, doneToday: 0 });
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewKey>('open');
  const [layout, setLayout] = useState<Layout>('list');
  const [listFilter, setListFilter] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const searchRef = useRef<HTMLInputElement>(null);

  // Quick capture
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);

  // Dialogs
  const [editing, setEditing] = useState<Todo | null>(null);
  const [converting, setConverting] = useState<Todo | null>(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<TodoList | null>(null);
  const [deletingList, setDeletingList] = useState<TodoList | null>(null);
  const [deleting, setDeleting] = useState<Todo | null>(null);
  const [busy, setBusy] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);

  // Pin-a-task
  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [assigned, setAssigned] = useState<AssignedTask[]>([]);

  // Keyboard cursor and drag state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overBucket, setOverBucket] = useState<BucketKey | null>(null);

  const today = todayISO();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      /**
       * Searching looks across everything, not just the current view.
       *
       * Somebody typing "dentist" is trying to find a to-do, and answering
       * "not in Starred" is answering a question they did not ask. The view
       * chips stay visible so it is clear the filter has been widened.
       */
      params.set('view', debouncedSearch.trim() ? 'all' : view);
      if (listFilter) params.set('listId', listFilter);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());

      const [todoRes, listRes] = await Promise.all([
        api<Todo[]>(`/api/todos?${params.toString()}`),
        api<TodoList[]>('/api/todos/lists'),
      ]);

      setTodos(todoRes.data ?? []);
      setLists(listRes.data ?? []);
      if (todoRes.meta?.counts) setCounts(todoRes.meta.counts);
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Could not load your list');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [view, listFilter, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  /**
   * Somebody assigning you a task should put it on your list without you
   * pressing anything — this is the screen where a missed update means missed
   * work. `todos` is a personal list nobody else writes to, so it is not
   * published; `tasks` is where an assignment arrives from.
   */
  useModuleRealtime('mywork', ['tasks'], () => load(true));

  // ── Derived ──────────────────────────────────────────────────────────────

  const groups = useMemo(
    // Completed items are history, not a plan, so they are not bucketed by
    // when they were due — that heading would say "Overdue" about work that
    // is finished.
    () => (view === 'done' && !debouncedSearch.trim()
      ? [{ key: 'today' as BucketKey, label: 'Completed', icon: CheckCircle2, tone: '', items: todos }]
      : groupByBucket(todos, today)),
    [todos, today, view, debouncedSearch],
  );

  /** The visible order, flattened — what j/k walks and what a reorder writes. */
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const progress = useMemo(() => dayProgress(counts), [counts]);
  const currentList = useMemo(
    () => lists.find(l => l.id === listFilter) ?? null,
    [lists, listFilter],
  );
  const activeView = VIEWS.find(v => v.key === view)!;

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * One field, Enter to save, focus retained.
   *
   * The input is not cleared until the request succeeds — losing what someone
   * typed because the network blipped is the fastest way to make a capture box
   * untrustworthy, and an untrusted capture box goes unused.
   */
  const addTodo = useCallback(async (dueOverride?: string | null) => {
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
          dueOn: dueOverride !== undefined
            ? dueOverride
            : view === 'today' ? today : null,
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
  }, [draft, adding, listFilter, view, today, load]);

  /**
   * Toggle done, applied locally first.
   *
   * A checkbox that waits for a round trip before ticking feels broken, and
   * this is the single most-used control on the screen. Reverted on failure.
   */
  const toggleDone = useCallback(async (todo: Todo) => {
    const before = todos;
    const nowDone = !todo.isDone;

    setTodos(prev => prev.map(t => (t.id === todo.id
      ? { ...t, isDone: nowDone, completedAt: nowDone ? new Date().toISOString() : null }
      : t)));
    setCounts(c => ({ ...c, open: Math.max(0, c.open + (nowDone ? -1 : 1)) }));

    try {
      await api(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDone: nowDone }),
      });

      /**
       * A repeat queues its successor in the database, so the list has to be
       * re-read to show it. Without this the next occurrence exists and is
       * invisible until a reload, which reads as the repeat not working.
       */
      if (todo.recurrence && nowDone) {
        load(true);
        toast.success('Done — the next one is on your list');
        return;
      }

      // Otherwise reload only when the change removes it from the current
      // view, so the list does not flicker on every tick.
      if (view !== 'done' && view !== 'open') load(true);
      else if (view === 'open' && nowDone) {
        setTimeout(() => setTodos(prev => prev.filter(t => t.id !== todo.id)), 450);
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

  /** Move a to-do to a day. Used by the board, the schedule and drag. */
  const reschedule = useCallback(async (todo: Todo, dueOn: string | null) => {
    if (todo.dueOn === dueOn) return;
    const before = todos;
    setTodos(prev => prev.map(t => (t.id === todo.id ? { ...t, dueOn } : t)));

    try {
      await api(`/api/todos/${todo.id}`, {
        method: 'PATCH', body: JSON.stringify({ dueOn }),
      });
      load(true);
    } catch (e: any) {
      // The repeat guard is the likely refusal here, and it says why.
      toast.error(e.message || 'Could not move that');
      setTodos(before);
    }
  }, [todos, load]);

  const saveEdit = useCallback(async (values: Record<string, unknown>) => {
    if (!editing) return;
    setBusy(true);
    try {
      await api(`/api/todos/${editing.id}`, { method: 'PATCH', body: JSON.stringify(values) });
      setEditing(null);
      load(true);
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
      load(true);
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }, [deleting, load]);

  // ── Lists ────────────────────────────────────────────────────────────────

  const submitList = useCallback(async (values: { name: string; color: string }) => {
    setBusy(true);
    try {
      if (editingList) {
        await api(`/api/todos/lists/${editingList.id}`, {
          method: 'PATCH', body: JSON.stringify(values),
        });
      } else {
        await api('/api/todos/lists', { method: 'POST', body: JSON.stringify(values) });
      }
      setListDialogOpen(false);
      setEditingList(null);
      load(true);
    } catch (e: any) {
      toast.error(e.message || 'Could not save the list');
    } finally {
      setBusy(false);
    }
  }, [editingList, load]);

  const confirmDeleteList = useCallback(async () => {
    if (!deletingList) return;
    setBusy(true);
    try {
      const res = await api<{ todosUnfiled: number }>(`/api/todos/lists/${deletingList.id}`, {
        method: 'DELETE',
      });
      const unfiled = res.data?.todosUnfiled ?? 0;
      // Said out loud, because "where did my to-dos go?" is the obvious fear
      // and the answer is "nowhere, they are just unfiled now".
      toast.success(
        unfiled > 0
          ? `List deleted — ${unfiled} to-do${unfiled === 1 ? '' : 's'} kept and unfiled`
          : 'List deleted',
      );
      if (listFilter === deletingList.id) setListFilter(null);
      setDeletingList(null);
      load(true);
    } catch (e: any) {
      toast.error(e.message || 'Could not delete the list');
    } finally {
      setBusy(false);
    }
  }, [deletingList, listFilter, load]);

  // ── The bridge, both ways ────────────────────────────────────────────────

  const openPin = useCallback(async () => {
    setPinOpen(true);
    setPinLoading(true);
    try {
      const res = await api<AssignedTask[]>('/api/projects/tasks?assignedToMe=true&pageSize=50');
      setAssigned((res.data ?? []).filter(t => t.status !== 'done'));
    } catch {
      setAssigned([]);
    } finally {
      setPinLoading(false);
    }
  }, []);

  const pinTask = useCallback(async (task: AssignedTask) => {
    try {
      await api('/api/todos', {
        method: 'POST',
        body: JSON.stringify({
          title: task.title, dueOn: task.dueDate,
          linkedTaskId: task.id, listId: listFilter,
        }),
      });
      toast.success('Pinned to your list');
      setPinOpen(false);
      load(true);
    } catch (e: any) {
      toast.error(e.message || 'Could not pin that task');
    }
  }, [listFilter, load]);

  const convert = useCallback(async (projectId: string) => {
    if (!converting) return;
    setBusy(true);
    try {
      const res = await api<{ task: { title: string; project?: { name: string } } }>(
        `/api/todos/${converting.id}/convert`,
        { method: 'POST', body: JSON.stringify({ projectId }) },
      );
      toast.success(`Added to ${res.data?.task?.project?.name ?? 'the project'} — your to-do now links to it`);
      setConverting(null);
      load(true);
    } catch (e: any) {
      toast.error(e.message || 'Could not create the task');
    } finally {
      setBusy(false);
    }
  }, [converting, load]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    // 6px of travel before a drag starts, so a click on the handle is still a
    // click and the row's own buttons stay usable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commitOrder = useCallback(async (ordered: Todo[]) => {
    setTodos(prev => {
      const rank = new Map(ordered.map((t, i) => [t.id, i]));
      return prev.map(t => (rank.has(t.id) ? { ...t, sortOrder: rank.get(t.id)! } : t));
    });

    try {
      await api('/api/todos', {
        method: 'PATCH',
        body: JSON.stringify({ order: ordered.map(t => t.id) }),
      });
    } catch (e: any) {
      toast.error(e.message || 'Could not save the new order');
      load(true);
    }
  }, [load]);

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));

  const onDragOver = (e: DragOverEvent) => {
    const overId = e.over ? String(e.over.id) : '';
    setOverBucket(overId.startsWith('bucket:') ? (overId.slice(7) as BucketKey) : null);
  };

  /**
   * Dropping means one of two things, and which one is decided by where it
   * landed rather than by a mode the user has to choose:
   *
   *   · onto another bucket  → reschedule to that bucket's day
   *   · within its own group → reorder by hand
   *
   * Both write a field that already exists, so neither needed new state.
   */
  const onDragEnd = useCallback((e: DragEndEvent) => {
    setDragId(null);
    setOverBucket(null);

    const { active, over } = e;
    if (!over) return;

    const dragged = todos.find(t => t.id === active.id);
    if (!dragged) return;

    const overId = String(over.id);

    if (overId.startsWith('bucket:')) {
      const bucket = BUCKETS.find(b => b.key === overId.slice(7));
      if (bucket) void reschedule(dragged, bucket.dueFor(today));
      return;
    }

    if (active.id === over.id) return;

    const target = todos.find(t => t.id === over.id);
    if (!target) return;

    const from = bucketOf(dragged, today);
    const to = bucketOf(target, today);

    if (from !== to) {
      // Crossing a heading is a reschedule. The item then lands wherever the
      // new day puts it, which is more predictable than also trying to honour
      // the exact drop position in a group it has just joined.
      const bucket = BUCKETS.find(b => b.key === to);
      if (bucket) void reschedule(dragged, bucket.dueFor(today));
      return;
    }

    const oldIndex = flat.findIndex(t => t.id === active.id);
    const newIndex = flat.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    void commitOrder(arrayMove(flat, oldIndex, newIndex));
  }, [todos, flat, today, reschedule, commitOrder]);

  // ── Keyboard ─────────────────────────────────────────────────────────────

  const actions: TodoRowActions = useMemo(() => ({
    onToggle: toggleDone,
    onStar: toggleStar,
    onEdit: setEditing,
    onDelete: setDeleting,
    onConvert: setConverting,
  }), [toggleDone, toggleStar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never steal a key from somewhere text is being entered.
      const typing = !!el && (
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
      );

      if (e.key === 'Escape' && typing) {
        if (el === searchRef.current && search) { setSearch(''); }
        (el as HTMLElement).blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // A dialog is open: its own handlers own the keyboard.
      if (editing || converting || deleting || deletingList || listDialogOpen
          || pinOpen || shortcutsOpen || focusOpen) return;

      const index = selectedId ? flat.findIndex(t => t.id === selectedId) : -1;
      const move = (delta: number) => {
        if (!flat.length) return;
        const next = index === -1
          ? (delta > 0 ? 0 : flat.length - 1)
          : Math.min(flat.length - 1, Math.max(0, index + delta));
        setSelectedId(flat[next].id);
        document.querySelector(`[data-todo-id="${flat[next].id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      };
      const selected = index >= 0 ? flat[index] : null;

      switch (e.key.toLowerCase()) {
        case 'n': e.preventDefault(); captureRef.current?.focus(); break;
        case '/': e.preventDefault(); searchRef.current?.focus(); break;
        case 'j': e.preventDefault(); move(1); break;
        case 'k': e.preventDefault(); move(-1); break;
        case 'f': e.preventDefault(); setFocusOpen(true); break;
        case '?': e.preventDefault(); setShortcutsOpen(true); break;
        case ' ': if (selected) { e.preventDefault(); void toggleDone(selected); } break;
        case 's': if (selected) { e.preventDefault(); void toggleStar(selected); } break;
        case 'e': if (selected) { e.preventDefault(); setEditing(selected); } break;
        case 'backspace':
        case 'delete': if (selected) { e.preventDefault(); setDeleting(selected); } break;
        case '1': case '2': case '3': case '4': case '5': {
          const v = VIEWS[Number(e.key) - 1];
          if (v) { e.preventDefault(); setView(v.key); setListFilter(null); }
          break;
        }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    flat, selectedId, search, toggleDone, toggleStar,
    editing, converting, deleting, deletingList, listDialogOpen, pinOpen,
    shortcutsOpen, focusOpen,
  ]);

  const draggedTodo = dragId ? todos.find(t => t.id === dragId) ?? null : null;

  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col gap-5 overflow-auto p-4 md:p-6">
      <PageHeader title="My Work" icon={CheckSquare}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline" onClick={() => setFocusOpen(true)}
            className="gap-1.5" disabled={loading || flat.length === 0}
          >
            <Crosshair className="size-4" /> Focus
          </Button>
          <Button variant="outline" onClick={openPin} className="gap-1.5">
            <Link2 className="size-4" /> Pin a task
          </Button>
          <Button
            variant="ghost" size="icon" aria-label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard className="size-4" />
          </Button>
        </div>
      </PageHeader>

      {/*
        A single explanatory line, once. Without it the obvious question on
        first sight is "how is this different from Tasks?", and a user who
        guesses wrong puts team work here or personal reminders there.
      */}
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Your own list — private to you, and never counted in project reports.
          Work assigned to you by others lives in{' '}
          <span className="font-medium text-foreground">Projects → Tasks</span>.
        </p>

        <DayProgress done={progress.done} total={progress.total} pct={progress.pct} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_1fr]">
        {/* ── Views and lists ──────────────────────────────────────────── */}
        <aside className="flex flex-col gap-5">
          {/*
            A vertical rail on a wide screen, a scrolling strip of chips on a
            phone. Stacked vertically on mobile the sidebar pushed the actual
            list two screens down, which made the module unusable on the device
            people are most likely to check a to-do list from.
          */}
          <nav
            aria-label="Views"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {VIEWS.map(v => {
              const Icon = VIEW_ICONS[v.key];
              const count = v.key === 'open' ? counts.open
                : v.key === 'today' ? counts.today
                : v.key === 'starred' ? counts.starred
                : null;
              const active = view === v.key && !listFilter;

              return (
                <button
                  key={v.key}
                  type="button"
                  title={v.hint}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => { setView(v.key); setListFilter(null); }}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors lg:gap-2.5',
                    active
                      ? 'bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="lg:flex-1 lg:text-left">{v.label}</span>
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
                onClick={() => { setEditingList(null); setListDialogOpen(true); }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            {lists.length === 0 ? (
              <p className="px-2.5 text-xs text-muted-foreground/70">
                Group your to-dos into lists when you have enough to sort.
              </p>
            ) : (
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
                {lists.map(list => (
                  <div
                    key={list.id}
                    className={cn(
                      'group flex shrink-0 items-center gap-2 rounded-md pr-1 transition-colors lg:gap-2.5',
                      listFilter === list.id
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => { setListFilter(list.id); setView('open'); }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-sm"
                    >
                      <span className={cn('size-2 shrink-0 rounded-full', LIST_COLORS[list.color] ?? LIST_COLORS.slate)} />
                      <span className="flex-1 truncate text-left">{list.name}</span>
                      {list.todos?.[0]?.count ? (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {list.todos[0].count}
                        </span>
                      ) : null}
                    </button>

                    {/*
                      Rename and delete. The endpoint has supported both since
                      it was written and nothing called either, so a list made
                      with a typo was permanent.
                    */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost" size="icon"
                          aria-label={`Manage ${list.name}`}
                          className="size-6 shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditingList(list); setListDialogOpen(true); }}>
                          <Pencil className="mr-2 size-4" /> Rename or recolour
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingList(list)}
                        >
                          <Trash2 className="mr-2 size-4" /> Delete list
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ── The work ─────────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-col gap-4">
          {/* Quick capture. Hidden in the completed view, where adding makes
              no sense — a to-do you create as already done is a note. */}
          {view !== 'done' && (
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 focus-within:border-emerald-500/50">
              <Plus className="size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={captureRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTodo(); }}
                placeholder={
                  currentList ? `Add to ${currentList.name}…` : 'Add something to your list…'
                }
                className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
              />
              {adding
                ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                : draft.trim()
                  ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">Enter</span>
                  : <kbd className="hidden shrink-0 rounded border px-1 text-[10px] text-muted-foreground sm:inline">N</kbd>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {debouncedSearch.trim()
                ? `Results for “${debouncedSearch.trim()}”`
                : currentList ? currentList.name : activeView.label}
            </h2>
            <span aria-live="polite" className="text-xs text-muted-foreground">
              {loading ? '' : `${flat.length} item${flat.length === 1 ? '' : 's'}`}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  aria-label="Search your to-dos"
                  className="h-8 w-36 pl-7 pr-7 sm:w-48"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Layout switcher. Hidden while searching: results are a flat
                  answer to a question, not a plan to arrange. */}
              {!debouncedSearch.trim() && (
                <div role="tablist" aria-label="Layout" className="flex rounded-md border p-0.5">
                  {LAYOUTS.map(l => {
                    const Icon = l.icon;
                    return (
                      <button
                        key={l.key}
                        role="tab"
                        aria-selected={layout === l.key}
                        aria-label={l.label}
                        title={l.label}
                        onClick={() => setLayout(l.key)}
                        className={cn(
                          'rounded p-1.5 transition-colors',
                          layout === l.key
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : flat.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={
                debouncedSearch.trim() ? 'Nothing matches that'
                  : view === 'done' ? 'Nothing completed yet'
                  : currentList ? `${currentList.name} is empty`
                  : 'Nothing here'
              }
              description={
                debouncedSearch.trim()
                  ? 'Try a different word — search looks at titles and notes across every view.'
                  : view === 'done'
                    ? 'Items you tick off will collect here.'
                    : `${activeView.hint}. Add something above to get started.`
              }
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={() => { setDragId(null); setOverBucket(null); }}
            >
              {layout === 'board' && !debouncedSearch.trim() ? (
                <BoardView todos={todos} actions={actions} overBucket={overBucket} />
              ) : layout === 'schedule' && !debouncedSearch.trim() ? (
                <ScheduleView
                  todos={todos}
                  actions={actions}
                  onQuickAdd={dueOn => { captureRef.current?.focus(); void addTodo(dueOn); }}
                  onReschedule={reschedule}
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {groups.map(group => {
                    const Icon = group.icon;
                    return (
                      <div key={group.key} className="flex flex-col gap-1.5">
                        {/* Headings only when there is more than one, so a
                            short list is not filed under a category of one. */}
                        {groups.length > 1 && (
                          <div className="flex items-center gap-2 px-1">
                            <Icon className={cn('size-3.5', group.tone)} />
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {group.label}
                            </h3>
                            <span className="text-[11px] tabular-nums text-muted-foreground/70">
                              {group.items.length}
                            </span>
                          </div>
                        )}

                        <SortableContext
                          items={group.items.map(t => t.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="flex flex-col gap-1.5">
                            {group.items.map(todo => (
                              // A grip rather than a whole-card handle: rows
                              // are wide, and dragging from anywhere would
                              // fight with selecting the text in one.
                              <SortableTodoRow
                                key={todo.id}
                                todo={todo}
                                actions={actions}
                                selected={selectedId === todo.id}
                                showHandle
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* The card follows the cursor rather than the row moving, so the
                  gap left behind reads as the destination. */}
              <DragOverlay>
                {draggedTodo && (
                  <div className="rounded-lg border bg-card px-3 py-2.5 text-sm shadow-lg">
                    {draggedTodo.title}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </section>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────── */}
      <EditTodoDialog
        todo={editing}
        lists={lists}
        saving={busy}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
      />

      <ConvertDialog
        todo={converting}
        saving={busy}
        onOpenChange={open => { if (!open) setConverting(null); }}
        onConvert={convert}
      />

      <ListDialog
        open={listDialogOpen}
        editing={editingList}
        saving={busy}
        onOpenChange={open => { setListDialogOpen(open); if (!open) setEditingList(null); }}
        onSubmit={submitList}
      />

      <PinTaskDialog
        open={pinOpen}
        tasks={assigned}
        loading={pinLoading}
        onOpenChange={setPinOpen}
        onPin={pinTask}
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {focusOpen && (
        <FocusMode
          todos={todos}
          onToggle={toggleDone}
          onStar={toggleStar}
          onClose={() => setFocusOpen(false)}
        />
      )}

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

      <ConfirmDialog
        open={!!deletingList}
        onOpenChange={open => { if (!open) setDeletingList(null); }}
        title={`Delete "${deletingList?.name}"`}
        description="The to-dos in this list are kept — they simply become unfiled."
        confirmLabel="Delete list"
        variant="destructive"
        onConfirm={confirmDeleteList}
        isLoading={busy}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The day's progress                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A ring, not a bar.
 *
 * It reads as a state rather than a target: a bar that is 30% full invites the
 * question "of what?", and the answer on a personal list changes every time
 * something is added. The ring says "you have done four of the seven things
 * you owed today" and nothing more.
 */
function DayProgress({ done, total, pct }: { done: number; total: number; pct: number }) {
  if (total === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Nothing due today
      </span>
    );
  }

  const circumference = 2 * Math.PI * 9;

  return (
    <div className="flex items-center gap-2" title={`${done} of ${total} done today`}>
      <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" className="stroke-muted" />
        <circle
          cx="12" cy="12" r="9" fill="none" strokeWidth="3" strokeLinecap="round"
          className="stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
        />
      </svg>
      <span className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{done}</span> of {total} done today
      </span>
    </div>
  );
}
