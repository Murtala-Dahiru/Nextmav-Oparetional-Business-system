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
  Plus, Loader2, Inbox, Sun, CalendarClock, CheckCircle2, Star,
  Link2, MoreHorizontal, Pencil, Trash2, Search, X, Keyboard,
  Rows3, Columns3, CalendarDays, Crosshair, AlertTriangle, RotateCcw,
  ArrowDownToLine, ListChecks, Bell,
} from 'lucide-react';

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
import { useAppStore } from '@/store/app-store';

import { SortableTodoRow, type TodoRowActions } from './todo-row';
import { BoardView, ScheduleView } from './views';
import { FocusMode } from './focus-mode';
import {
  ConvertDialog, EditTodoDialog, ListDialog, PinTaskDialog, ShortcutsDialog,
} from './dialogs';
import {
  BUCKETS, EMPTY_COUNTS, LIST_COLORS, VIEWS, addDaysISO, bucketOf, dayHeadline,
  daySummary, formatDay, greeting, groupByBucket, groupByCompletion,
  originOf, reminderLabel, todayISO, todayShape,
  type AssignedTask, type BucketKey, type DaySummary, type Layout, type Todo,
  type TodoCounts, type TodoList, type TodoOrigin, type ViewKey,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  My Work - a person's own to-do list
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
 * ── What this pass changed, and what it deliberately did not ──────────────
 *
 * The features were all here. What was missing was a **reading** of them: the
 * screen showed twenty-four items and never said how the day stood. So the
 * header stopped restating the shell's title and became the day - a sentence,
 * a partition of what is owed, and the one action a late list needs. Rows
 * stopped being bordered cards and became rows, which is the difference
 * between six items on a laptop screen and twenty. The board names its days,
 * the schedule reads its month's shape and can be planned from a phone, and
 * focus mode ends when today does.
 *
 * Still not added, on purpose: labels (lists and the star already do that
 * job), attachments (a file belongs in Workspace, where it can be found
 * again), and a priority scale (the star *is* the scale - a private list with
 * four levels of importance is one nobody triages honestly). Each was
 * reconsidered in this pass against the same test: does it reduce the friction
 * of getting personal work done, or does it move this closer to being the task
 * tracker it exists as a calmer alternative to?
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
  today: Sun, inbox: Inbox, upcoming: CalendarClock, open: ListChecks,
  starred: Star, done: CheckCircle2,
};

const LAYOUTS: { key: Layout; label: string; icon: typeof Rows3; hint: string }[] = [
  { key: 'list', label: 'List', icon: Rows3, hint: 'Everything in order' },
  { key: 'board', label: 'Board', icon: Columns3, hint: 'Plan across the days ahead' },
  { key: 'schedule', label: 'Schedule', icon: CalendarDays, hint: 'A month of your own work' },
];

/**
 * The board and the schedule are *planning* surfaces, and a plan is over all
 * the work you owe rather than over whichever view happens to be selected.
 *
 * Left alone, choosing Schedule while the Today view was active drew a month
 * grid containing nine items and twenty-eight empty days - a calendar that
 * had been filtered down to a single day and could not say so. So switching
 * to one of them widens to "all open", exactly as searching already widens to
 * "all", and choosing a view returns to the list it belongs to.
 */
const PLANNING: Layout[] = ['board', 'schedule'];

/* -------------------------------------------------------------------------- */
/*  Quick entry                                                               */
/* -------------------------------------------------------------------------- */

/**
 * ── Shortcuts, not natural language ──────────────────────────────────────
 *
 * Typing "Call Ahmed tomorrow" and having the date understood is a lovely
 * feature and a terrible one to guess at. Every implementation of it
 * eventually eats a word somebody meant literally - "Review the Monday
 * report", "Post the Friday numbers" - and silently files the item on a day
 * they did not choose. A capture box that is occasionally wrong about what you
 * meant is a capture box people stop trusting, and an untrusted capture box
 * goes unused, which is the one failure this whole module cannot survive.
 *
 * So the vocabulary is explicit and tiny: a leading or trailing `/today`,
 * `/tomorrow`, `/nextweek`, or a `!` to star. A slash is not a word anybody
 * types by accident, the token is removed from the title, and everything else
 * is taken exactly as written.
 *
 * If real language understanding is ever added to the product, this is where
 * it goes - behind the same contract, with the parse shown before it is
 * committed. Until then this is deterministic, explainable, and never
 * surprising.
 */
const CAPTURE_TOKENS: { token: string; apply: (today: string) => { dueOn?: string | null; starred?: boolean } }[] = [
  { token: '/today',    apply: t => ({ dueOn: t }) },
  { token: '/tomorrow', apply: t => ({ dueOn: addDaysISO(t, 1) }) },
  { token: '/nextweek', apply: t => ({ dueOn: addDaysISO(t, 7) }) },
  { token: '/someday',  apply: () => ({ dueOn: null }) },
  { token: '!',         apply: () => ({ starred: true }) },
];

export interface ParsedCapture {
  title: string;
  /** `undefined` when nothing was said, which is not the same as `null`. */
  dueOn?: string | null;
  starred: boolean;
  /** What was recognised, so the box can show it before it is committed. */
  hints: string[];
}

export function parseCapture(raw: string, today: string): ParsedCapture {
  let text = ` ${raw} `;
  let dueOn: string | null | undefined;
  let starred = false;
  const hints: string[] = [];

  for (const { token, apply } of CAPTURE_TOKENS) {
    // Only as a whole word at either end, so "3/today's figures" is left alone.
    const pattern = new RegExp(`(^|\\s)${token.replace('/', '\\/')}(?=\\s|$)`, 'i');
    if (!pattern.test(text)) continue;

    text = text.replace(pattern, ' ');
    const result = apply(today);
    if ('dueOn' in result) dueOn = result.dueOn;
    if (result.starred) starred = true;
    hints.push(token);
  }

  return { title: text.trim(), dueOn, starred, hints };
}

/** How a recognised token reads back to the person typing it. */
export function captureHint(parsed: ParsedCapture, today: string): string | null {
  const parts: string[] = [];
  if (parsed.dueOn === null) parts.push('no date');
  else if (parsed.dueOn === today) parts.push('today');
  else if (parsed.dueOn) parts.push(formatDay(parsed.dueOn, { weekday: 'short', day: 'numeric', month: 'short' }));
  if (parsed.starred) parts.push('starred');
  return parts.length ? parts.join(' · ') : null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Module
// ═══════════════════════════════════════════════════════════════════════════

export default function MyWorkModule() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<TodoList[]>([]);
  const [counts, setCounts] = useState<TodoCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  /** A failed load is not an empty list, and must never be drawn as one. */
  const [loadError, setLoadError] = useState<string | null>(null);

  const [view, setView] = useState<ViewKey>('today');
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
  const [clearingOverdue, setClearingOverdue] = useState(false);

  // Pin-a-task
  const [pinOpen, setPinOpen] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [assigned, setAssigned] = useState<AssignedTask[]>([]);

  // Keyboard cursor and drag state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overBucket, setOverBucket] = useState<BucketKey | null>(null);

  const user = useAppStore(s => s.user);
  const firstName = user?.firstName?.trim() || '';
  const allows = useAppStore(s => s.allows);
  const openRecord = useAppStore(s => s.openRecord);
  /**
   * Open the record a to-do came from, wherever it lives.
   *
   * Gated on the reader's access to *that* module rather than on nothing: a
   * personal item can outlive the role that created it - somebody moves from
   * support to finance and keeps their list - and a chip that navigates into a
   * module the session cannot open lands on an empty screen. Where access is
   * gone the chip stays, as a label, because the note is still true.
   */
  const openSource = useCallback((origin: TodoOrigin) => {
    if (!allows(origin.module)) return;
    openRecord(origin.module, origin.type, origin.id);
  }, [allows, openRecord]);

  const openTask = useMemo(
    () => (allows('projects') ? (id: string) => openRecord('projects', 'task', id) : null),
    [allows, openRecord],
  );

  const today = todayISO();
  const planning = PLANNING.includes(layout);

  /**
   * The view the *server* is being asked for, which is not always the one the
   * rail has highlighted: searching widens to everything, and the planning
   * layouts widen to everything open.
   *
   * Named, and used as the fetch's only view dependency, because otherwise
   * switching from the list to the board while already on "All open" changes
   * no query parameter and still tears the screen down to a skeleton and
   * rebuilds it - a loading state for a request whose answer is already on
   * screen.
   */
  const effectiveView: ViewKey | 'all' =
    debouncedSearch.trim() ? 'all' : planning ? 'open' : view;

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
      params.set('view', effectiveView);
      if (listFilter) params.set('listId', listFilter);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());

      const [todoRes, listRes] = await Promise.all([
        api<Todo[]>(`/api/todos?${params.toString()}`),
        api<TodoList[]>('/api/todos/lists'),
      ]);

      setTodos(todoRes.data ?? []);
      setLists(listRes.data ?? []);
      if (todoRes.meta?.counts) setCounts(todoRes.meta.counts);
      setLoadError(null);
    } catch (e: any) {
      // A silent refetch that fails leaves the last good data on screen, which
      // is the right outcome - the error state is for the load the reader is
      // waiting on.
      if (!silent) setLoadError(e.message || 'Could not reach your list');
      else toast.error(e.message || 'Could not refresh your list');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [effectiveView, listFilter, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  /**
   * Somebody assigning you a task should put it on your list without you
   * pressing anything - this is the screen where a missed update means missed
   * work. `todos` is a personal list nobody else writes to, so it is not
   * published; `tasks` is where an assignment arrives from.
   */
  useModuleRealtime('mywork', ['tasks'], () => load(true));

  /**
   * ── The reminder sweep, from the client ──────────────────────────────────
   *
   * Migration 0026 runs `sweep_todo_reminders()` on `pg_cron` every minute,
   * and that is the path that matters - it is what makes a reminder arrive
   * while nobody has the application open. This is the same function called
   * once when the module mounts, and it exists for the deployments where the
   * extension is not installed.
   *
   * Without it, "reminders work" and "reminders silently never fire" would
   * look identical to anybody running this product outside the one project it
   * was built against. With it, the degradation is describable: reminders
   * arrive on next use rather than on the minute.
   *
   * Once, on mount - not on a timer. Where cron is running this is redundant
   * and one wasted request is the whole cost; where it is not, opening the
   * module is exactly when a person is about to look at the tray anyway. The
   * sweep claims each row as it selects it, so this and the cron worker
   * cannot both deliver the same reminder.
   */
  useEffect(() => {
    void fetch('/api/todos/reminders/sweep', { method: 'POST' }).catch(() => {
      // A failed sweep is not worth a toast: the list itself is unaffected,
      // and where cron is running the reminders arrive regardless.
    });
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  /**
   * Completed work is grouped by the day it was *finished*, not by the day it
   * had been due - that heading would say "Overdue" about work that is done,
   * and the server's ordering (starred first, then by due date) is an order
   * that stops meaning anything the moment something is ticked off.
   */
  const groups = useMemo(
    () => (view === 'done' && !debouncedSearch.trim()
      ? groupByCompletion(todos, today)
      : groupByBucket(todos, today)),
    [todos, today, view, debouncedSearch],
  );

  /** The visible order, flattened - what j/k walks and what a reorder writes. */
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const day = useMemo(() => daySummary(counts), [counts]);
  const currentList = useMemo(
    () => lists.find(l => l.id === listFilter) ?? null,
    [lists, listFilter],
  );
  const activeView = VIEWS.find(v => v.key === view)!;

  /** The overdue rows currently loaded - what "move them" would actually move. */
  /** The shape of today, counted from the rows the Today view actually holds. */
  const shape = useMemo(() => todayShape(todos, today), [todos, today]);

  const overdueLoaded = useMemo(
    () => todos.filter(t => !t.isDone && t.dueOn && t.dueOn < today),
    [todos, today],
  );

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * One field, Enter to save, focus retained.
   *
   * The input is not cleared until the request succeeds - losing what someone
   * typed because the network blipped is the fastest way to make a capture box
   * untrustworthy, and an untrusted capture box goes unused.
   */
  const addTodo = useCallback(async (dueOverride?: string | null) => {
    const parsed = parseCapture(draft, today);
    if (!parsed.title || adding) return;

    setAdding(true);
    try {
      await api('/api/todos', {
        method: 'POST',
        body: JSON.stringify({
          title: parsed.title,
          // A to-do captured while looking at a list belongs to that list.
          listId: listFilter,
          /**
           * The day, decided by three things in order of how explicit they
           * are: what the caller passed (a board column, a calendar cell),
           * then what the person typed (`/tomorrow`), then the view they are
           * standing in.
           *
           * The *Inbox* view is the one that deliberately dates nothing -
           * that is what an inbox is - so an item captured there stays
           * undecided until somebody decides it.
           */
          dueOn: dueOverride !== undefined
            ? dueOverride
            : parsed.dueOn !== undefined
              ? parsed.dueOn
              : view === 'today' ? today : null,
          isStarred: parsed.starred || view === 'starred',
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
    const beforeCounts = counts;
    const nowDone = !todo.isDone;
    const owedToday = !!todo.dueOn && todo.dueOn <= today;

    setTodos(prev => prev.map(t => (t.id === todo.id
      ? { ...t, isDone: nowDone, completedAt: nowDone ? new Date().toISOString() : null }
      : t)));

    /**
     * The day's readout moves with the checkbox.
     *
     * It used to move only when something happened to cause a refetch - and
     * ticking an item off in the default view causes none, by design, so the
     * one number the header exists to show sat frozen through an entire
     * morning's work. Every part of this is the same arithmetic the server
     * would return; the refetch that follows confirms it.
     */
    setCounts(c => ({
      ...c,
      open: Math.max(0, c.open + (nowDone ? -1 : 1)),
      doneToday: Math.max(0, c.doneToday + (nowDone ? 1 : -1)),
      today: owedToday ? Math.max(0, c.today + (nowDone ? -1 : 1)) : c.today,
      overdue: owedToday && todo.dueOn! < today
        ? Math.max(0, c.overdue + (nowDone ? -1 : 1))
        : c.overdue,
      someday: todo.dueOn ? c.someday : Math.max(0, c.someday + (nowDone ? -1 : 1)),
      starred: todo.isStarred ? Math.max(0, c.starred + (nowDone ? -1 : 1)) : c.starred,
    }));

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
        toast.success('Done. The next one is on your list.');
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
      setCounts(beforeCounts);
    }
  }, [todos, counts, view, today, load]);

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

  /** Move a to-do to a day. Used by the board, the schedule, the row and drag. */
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

  /**
   * ── Bring the overdue forward ────────────────────────────────────────────
   *
   * The one bulk action this list needs, and the reason it needs one: an
   * overdue pile is not a list of decisions, it is a single decision made
   * once - *these are today's now* - and making it item by item is what
   * causes people to stop opening the list at all.
   *
   * Deliberately N calls to the endpoint that already exists rather than a new
   * bulk route: this is one to ten rows in practice, the per-row PATCH already
   * carries the ownership filter and the recurrence guard, and a second way to
   * write a due date is a second place for those rules to be forgotten.
   *
   * Any row that refuses is reported by count rather than silently dropped -
   * a repeating item whose date cannot move is the case that will happen.
   */
  const clearOverdue = useCallback(async () => {
    const items = overdueLoaded;
    if (!items.length || clearingOverdue) return;

    setClearingOverdue(true);
    const before = todos;
    setTodos(prev => prev.map(t => (
      items.some(i => i.id === t.id) ? { ...t, dueOn: today } : t
    )));

    try {
      const results = await Promise.allSettled(items.map(t => api(
        `/api/todos/${t.id}`,
        { method: 'PATCH', body: JSON.stringify({ dueOn: today }) },
      )));

      const moved = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - moved;

      if (moved) {
        toast.success(
          failed
            ? `${moved} moved. ${failed} could not be moved.`
            : `${moved} overdue item${moved === 1 ? '' : 's'} moved to today`,
        );
      } else {
        toast.error('Nothing could be moved.');
        setTodos(before);
      }
      load(true);
    } catch (e: any) {
      toast.error(e.message || 'Could not move those');
      setTodos(before);
    } finally {
      setClearingOverdue(false);
    }
  }, [overdueLoaded, clearingOverdue, todos, today, load]);

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

  /**
   * ── Set or clear a reminder ──────────────────────────────────────────────
   *
   * The one write on this screen that is *not* applied optimistically. Every
   * other field is a fact about the row and can be shown before the server
   * confirms it; a reminder is a promise that something will happen later, and
   * showing a bell for a promise the server never accepted is the worst kind
   * of lie a to-do list can tell. So the row changes when the write lands.
   */
  const remind = useCallback(async (todo: Todo, remindAt: string | null) => {
    try {
      const res = await api<Todo>(`/api/todos/${todo.id}`, {
        method: 'PATCH', body: JSON.stringify({ remindAt }),
      });
      setTodos(prev => prev.map(t => (t.id === todo.id ? res.data : t)));
      toast.success(
        remindAt
          ? `Reminder set for ${reminderLabel(remindAt, today)?.text ?? 'later'}`
          : 'Reminder cleared',
      );
    } catch (e: any) {
      toast.error(e.message || 'Could not set the reminder');
    }
  }, [today]);

  /**
   * ── Delete, and the way back ─────────────────────────────────────────────
   *
   * `DELETE /api/todos/[id]` is a hard delete - deliberately, and the route
   * explains why: a personal reminder is not a business record and keeping a
   * tombstone of somebody's deleted private note would be a surprising thing
   * for the product to do.
   *
   * Which makes the absence of an undo the real problem. The row is gone the
   * instant the dialog is confirmed, and the only recovery was to remember
   * what it said and type it again. So the fields are held for as long as the
   * toast is on screen and re-posted verbatim if it is asked for - including
   * the source, so an item taken from a ticket comes back still pointing at
   * it. A new id, which nothing else references, and the same to-do.
   */
  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    const gone = deleting;
    setBusy(true);
    try {
      await api(`/api/todos/${gone.id}`, { method: 'DELETE' });
      setDeleting(null);
      load(true);

      toast.success('Deleted', {
        description: gone.title,
        action: {
          label: 'Undo',
          onClick: () => {
            void api('/api/todos', {
              method: 'POST',
              body: JSON.stringify({
                title: gone.title,
                note: gone.note,
                dueOn: gone.dueOn,
                isStarred: gone.isStarred,
                listId: gone.listId,
                recurrence: gone.recurrence,
                sortOrder: gone.sortOrder,
                // A reminder already in the past would be refused, and one
                // still ahead is worth keeping. `readRemindAt` decides.
                remindAt: gone.remindAt && new Date(gone.remindAt) > new Date()
                  ? gone.remindAt : null,
                sourceModule: gone.sourceModule,
                sourceType: gone.sourceType,
                sourceId: gone.sourceId,
                sourceLabel: gone.sourceLabel,
                linkedTaskId: gone.linkedTaskId,
              }),
            })
              .then(() => { toast.success('Restored'); load(true); })
              .catch((err: any) => toast.error(err.message || 'Could not restore it'));
          },
        },
      });
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
          ? `List deleted. ${unfiled} to-do${unfiled === 1 ? '' : 's'} kept, now unfiled.`
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
      toast.success(`Added to ${res.data?.task?.project?.name ?? 'the project'}. Your to-do links to it.`);
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
   * Dropping means one of three things, and which one is decided by where it
   * landed rather than by a mode the user has to choose:
   *
   *   · onto a board column  → reschedule to that column's day
   *   · onto a calendar day  → reschedule to that exact day
   *   · within its own group → reorder by hand
   *
   * All three write a field that already exists, so none of them needed new
   * state.
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

    if (overId.startsWith('day:')) {
      void reschedule(dragged, overId.slice(4));
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
    onReschedule: reschedule,
    onRemind: remind,
    /* Null where the source cannot be reached, so the chip draws as a label
       rather than as a control that lands on an empty module. */
    onOpenSource: openSource,
  }), [toggleDone, toggleStar, reschedule, remind, openSource]);

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
        /* Enter opens what is highlighted. Every list in this product opens a
           row on Enter and this one did not, so the keyboard path stopped
           dead at "which one" and made you reach for E or the mouse. */
        case 'enter': if (selected) { e.preventDefault(); setEditing(selected); } break;
        /* The most common thing anybody does to a to-do, on one key. */
        case 't':
          if (selected && !selected.isDone) {
            e.preventDefault();
            void reschedule(selected, addDaysISO(today, 1));
          }
          break;
        case 'backspace':
        case 'delete': if (selected) { e.preventDefault(); setDeleting(selected); } break;
        case '1': case '2': case '3': case '4': case '5': case '6': {
          const v = VIEWS[Number(e.key) - 1];
          if (v) {
            e.preventDefault();
            setView(v.key);
            setListFilter(null);
            setLayout('list');
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    flat, selectedId, search, toggleDone, toggleStar, reschedule, today,
    editing, converting, deleting, deletingList, listDialogOpen, pinOpen,
    shortcutsOpen, focusOpen,
  ]);

  const draggedTodo = dragId ? todos.find(t => t.id === dragId) ?? null : null;

  /** Choosing a view is choosing the list; the planning surfaces widen. */
  const chooseView = (key: ViewKey) => {
    setView(key);
    setListFilter(null);
    setLayout('list');
  };
  const chooseLayout = (key: Layout) => {
    setLayout(key);
    if (PLANNING.includes(key)) setView('open');
  };

  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex-1 overflow-auto">
      {/*
        The page has two measures, and which one it uses says what it is for.

        Reading and working through a list wants a column: a to-do row is a
        line of prose with a mark at each end, and at 1,200 pixels the meta on
        the right ends up a third of a metre from the title it belongs to, so
        the eye travels back across an empty field for every row. Planning
        wants the opposite - a board of six columns and a seven-column month
        grid are grids, and they want every pixel there is.

        The header shares whichever measure is in force, so the day's readout
        and the work under it stand on the same two edges.
      */}
      <div className={cn(
        'mx-auto flex w-full flex-col gap-5 p-4 md:p-6 lg:p-7',
        planning ? 'max-w-[1480px]' : 'max-w-[64rem]',
      )}>

        {/* ══ The day ═══════════════════════════════════════════════════

            What replaced the old header, and why.

            There used to be three things stacked here: a second `<h1>`
            reading "My Work" forty pixels under the shell header already
            reading "My Work"; a permanent two-line paragraph explaining that
            the list is private; and a 24px ring in the far corner saying
            "3 of 12 done today" in the smallest type on the screen.

            So the most valuable band on the page restated the title, taught
            the same lesson every day forever, and buried the one sentence
            worth reading. This is that sentence at the size it deserves, with
            the day underneath it as a partition rather than a percentage -
            and the private-list explanation moved to where a person is
            actually asking the question, which is the day-one empty state. */}
        <DayHeader
          day={day}
          loading={loading && !todos.length}
          today={today}
          firstName={firstName}
          shape={view === 'today' && !debouncedSearch.trim() ? shape : null}
          inbox={counts.inbox}
          onOpenInbox={() => chooseView('inbox')}
          overdueLoaded={overdueLoaded.length}
          clearing={clearingOverdue}
          onClearOverdue={clearOverdue}
          onFocus={() => setFocusOpen(true)}
          onPin={openPin}
          onShortcuts={() => setShortcutsOpen(true)}
          focusable={!loading && day.dueToday + day.overdue > 0}
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-7">
          {/* ── Views and lists ──────────────────────────────────────── */}
          {/*
            ── One rail, two shapes ────────────────────────────────────────

            A vertical rail on a wide screen; on a phone, **one** scrolling
            strip carrying the views, a divider and the lists together.

            It was two stacked strips with a "LISTS +" heading between them,
            which cost about ninety vertical pixels on the device where
            vertical pixels are the whole problem: the first actual to-do sat
            below the fold on every phone. Nothing is removed - the same
            controls are in the same order, laid out along the axis that has
            room rather than the one that does not.
          */}
          <aside className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:items-stretch lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
            <nav
              aria-label="Views"
              className="flex gap-1 lg:flex-col lg:gap-px"
            >
              {VIEWS.map(v => {
                const Icon = VIEW_ICONS[v.key];
                const count = v.key === 'open' ? counts.open
                  : v.key === 'today' ? counts.today
                  : v.key === 'starred' ? counts.starred
                  : null;
                const active = view === v.key && !listFilter && !planning;

                return (
                  <button
                    key={v.key}
                    type="button"
                    title={v.hint}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => chooseView(v.key)}
                    className={cn(
                      // The selected row is a *neutral* fill, as it is in the
                      // shell's navigation: an accent-tinted row here competes
                      // with the two colours on this screen that mean
                      // something, and it is not a status.
                      'flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
                      active
                        ? 'bg-accent font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground/80')} />
                    <span className="lg:flex-1 lg:text-left">{v.label}</span>
                    {count ? (
                      <span className="text-[11.5px] tabular-nums text-muted-foreground">{count}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {/* The joint between the two halves of the strip, on a phone. */}
            <span className="h-5 w-px shrink-0 bg-border lg:hidden" aria-hidden="true" />

            <div className="flex items-center gap-1 lg:flex-col lg:items-stretch lg:gap-px">
              <div className="hidden items-center justify-between px-2.5 pb-1.5 lg:flex">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                  Lists
                </span>
                <button
                  type="button"
                  aria-label="New list"
                  onClick={() => { setEditingList(null); setListDialogOpen(true); }}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>

              {lists.length === 0 ? (
                <p className="hidden px-2.5 text-[11.5px] leading-relaxed text-muted-foreground/70 lg:block">
                  Lists group your to-dos. Add one when you have enough to sort.
                </p>
              ) : (
                <div className="flex gap-1 lg:flex-col lg:gap-px">
                  {lists.map(list => {
                    const active = listFilter === list.id;
                    return (
                      <div
                        key={list.id}
                        className={cn(
                          'group/list flex h-8 shrink-0 items-center rounded-md pr-1 transition-colors',
                          active
                            ? 'bg-accent font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => { setListFilter(list.id); setView('open'); }}
                          className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-[13px]"
                        >
                          <span className={cn('size-[7px] shrink-0 rounded-full', LIST_COLORS[list.color] ?? LIST_COLORS.slate)} />
                          <span className="flex-1 truncate text-left">{list.name}</span>
                          {list.todos?.[0]?.count ? (
                            <span className="text-[11.5px] tabular-nums text-muted-foreground">
                              {list.todos[0].count}
                            </span>
                          ) : null}
                        </button>

                        {/*
                          Rename and delete. The endpoint has supported both
                          since it was written and nothing called either, so a
                          list made with a typo was permanent.
                        */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost" size="icon"
                              aria-label={`Manage ${list.name}`}
                              className="size-6 shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover/list:opacity-100"
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
                    );
                  })}
                </div>
              )}

              {/* On a phone the heading is gone, so the only way to make a
                  list is here, at the end of the strip. */}
              <button
                type="button"
                aria-label="New list"
                onClick={() => { setEditingList(null); setListDialogOpen(true); }}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground lg:hidden"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </aside>

          {/* ── The work ─────────────────────────────────────────────── */}
          <section className="flex min-w-0 flex-col gap-3.5">
            {/* Quick capture. Hidden in the completed view, where adding makes
                no sense - a to-do you create as already done is a note. */}
            {view !== 'done' && (
              <Composer
                inputRef={captureRef}
                value={draft}
                onChange={setDraft}
                onSubmit={() => addTodo()}
                busy={adding}
                placeholder={
                  currentList ? `Add to ${currentList.name}…`
                    : view === 'inbox' ? 'Capture it now, decide later…'
                    : view === 'today' ? 'Add something to today…'
                    : 'Add something to your list…'
                }
                hint={captureHint(parseCapture(draft, today), today)}
              />
            )}

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">
                {debouncedSearch.trim()
                  ? `Results for “${debouncedSearch.trim()}”`
                  : currentList ? currentList.name
                  : planning ? 'Everything open'
                  : activeView.label}
              </h2>
              <span
                aria-live="polite"
                className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
              >
                {loading ? '·' : flat.length}
              </span>

              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search…"
                    aria-label="Search your to-dos"
                    className="h-8 w-36 pl-8 pr-7 text-[13px] sm:w-52"
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
                    answer to a question, not a plan to arrange. Hidden below
                    `sm`, where a six-column board and a seven-column month
                    grid are not usable however they are drawn - offering a
                    control that produces an unusable screen is worse than not
                    offering it. */}
                {!debouncedSearch.trim() && (
                  <div
                    role="radiogroup" aria-label="Layout"
                    className="hidden items-center gap-0.5 rounded-md bg-muted p-0.5 sm:flex"
                  >
                    {LAYOUTS.map(l => {
                      const Icon = l.icon;
                      const on = layout === l.key;
                      return (
                        <button
                          key={l.key}
                          role="radio"
                          aria-checked={on}
                          aria-label={l.label}
                          title={`${l.label} - ${l.hint}`}
                          onClick={() => chooseLayout(l.key)}
                          className={cn(
                            'rounded-[5px] p-1.5 transition-colors',
                            on
                              ? 'bg-card text-foreground shadow-sm'
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
              <ListSkeleton />
            ) : loadError ? (
              /*
                A failed load is not an empty list.

                Before this, the fetch threw, a toast appeared for four seconds
                and the screen drew "Nothing here - add something above". A
                person who looked away for a moment was told, in the product's
                own voice, that their to-do list was empty.
              */
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-foreground">
                    Could not load your list
                  </h3>
                  <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
                    Nothing has been lost. {loadError}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => load()}>
                  <RotateCcw className="size-3.5" /> Try again
                </Button>
              </div>
            ) : flat.length === 0 ? (
              <MyWorkEmpty
                view={view}
                hint={activeView.hint}
                listName={currentList?.name ?? null}
                searching={!!debouncedSearch.trim()}
                fresh={counts.open === 0 && counts.doneToday === 0 && !listFilter}
                openCount={counts.open}
                onCapture={() => captureRef.current?.focus()}
                onPin={openPin}
                onSeeAll={() => chooseView('open')}
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
                  <BoardView
                    todos={todos}
                    actions={actions}
                    overBucket={overBucket}
                    dragging={!!dragId}
                    onQuickAdd={dueOn => { captureRef.current?.focus(); void addTodo(dueOn); }}
                  />
                ) : layout === 'schedule' && !debouncedSearch.trim() ? (
                  <ScheduleView
                    todos={todos}
                    actions={actions}
                    onQuickAdd={dueOn => { captureRef.current?.focus(); void addTodo(dueOn); }}
                  />
                ) : (
                  <div className="flex flex-col gap-5">
                    {groups.map(group => {
                      const Icon = group.icon;
                      return (
                        <div key={group.key} className="flex flex-col gap-0.5">
                          {/* Headings only when there is more than one, so a
                              short list is not filed under a category of one. */}
                          {groups.length > 1 && (
                            <div className="mb-1 flex items-baseline gap-2 px-1">
                              <Icon
                                className={cn('size-3.5 shrink-0 translate-y-0.5', group.tone)}
                                aria-hidden="true"
                              />
                              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground/80">
                                {group.label}
                              </h3>
                              {group.dayNote && (
                                <span className="truncate text-[11px] text-muted-foreground/70">
                                  {group.dayNote}
                                </span>
                              )}
                              <span className="text-[11px] tabular-nums text-muted-foreground/70">
                                {group.items.length}
                              </span>
                              <span className="ml-2 h-px flex-1 bg-border" aria-hidden="true" />
                            </div>
                          )}

                          <SortableContext
                            items={group.items.map(t => t.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="-mx-1 flex flex-col">
                              {group.items.map(todo => (
                                // A grip rather than a whole-row handle: rows
                                // are wide, and dragging from anywhere would
                                // fight with selecting the text in one.
                                <SortableTodoRow
                                  key={todo.id}
                                  todo={todo}
                                  actions={actions}
                                  selected={selectedId === todo.id}
                                  /*
                                    A row stays silent about its day only when
                                    a heading has actually said it - and the
                                    heading is drawn only when there is more
                                    than one group. Searching produces exactly
                                    one, so passing the key unconditionally
                                    suppressed the date on every result: a
                                    to-do found by search with no date on it at
                                    all, which is the one thing a search result
                                    has to carry.
                                  */
                                  groupKey={
                                    groups.length > 1 && view !== 'done' ? group.key : undefined
                                  }
                                  groupLabel={groups.length > 1 ? group.label : undefined}
                                  today={today}
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
                    <div className="flex max-w-sm items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13.5px] shadow-e2">
                      <span className="size-[15px] shrink-0 rounded-full border border-input" />
                      <span className="truncate">{draggedTodo.title}</span>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
          </section>
        </div>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────── */}
      <EditTodoDialog
        todo={editing}
        lists={lists}
        saving={busy}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
        onOpenTask={openTask}
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
          counts={counts}
          onToggle={toggleDone}
          onStar={toggleStar}
          onReschedule={reschedule}
          onRemind={remind}
          onOpenSource={openSource}
          /* Opening the item closes the session: a dialog behind a full-screen
             overlay is a dialog nobody can reach. */
          onOpenDetails={todo => { setFocusOpen(false); setEditing(todo); }}
          onClose={() => setFocusOpen(false)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={open => { if (!open) setDeleting(null); }}
        title="Delete to-do"
        description={`“${deleting?.title}” will be removed.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={busy}
      />

      <ConfirmDialog
        open={!!deletingList}
        onOpenChange={open => { if (!open) setDeletingList(null); }}
        title={`Delete "${deletingList?.name}"`}
        description="The to-dos in it are kept, and become unfiled."
        confirmLabel="Delete list"
        variant="destructive"
        onConfirm={confirmDeleteList}
        isLoading={busy}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The day                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ── A partition, not a percentage ────────────────────────────────────────
 *
 * "40% of today done" invites the question "of what?", and on a personal list
 * the denominator changes every time something is added. What a person opens
 * this screen to find out is four separate facts - what is late, what is due,
 * what has been cleared, and how much is stacked up behind today - and a
 * single ratio answers none of them.
 *
 * So the bar is the day *divided*: done, due today, late. Every segment is a
 * count the API returns, they sum exactly to the work owed today, and the
 * legend names each one. This is the same device the Executive Overview's
 * signals use, for the same reason: a figure with its composition beneath it
 * says "and what is that made of" without a second panel.
 *
 * Nothing here is scored, weighted or predicted. There is no productivity
 * index and no estimate of how long anything will take, because this table
 * has no duration on it and a number nobody can check is a number nobody
 * should be shown.
 */
function DayHeader({
  day, loading, today, firstName, shape, inbox, overdueLoaded, clearing,
  onOpenInbox, onClearOverdue, onFocus, onPin, onShortcuts, focusable,
}: {
  day: DaySummary;
  loading: boolean;
  today: string;
  /** Who is reading. Empty until the session resolves, and then omitted. */
  firstName: string;
  /**
   * What today is made of, and only while Today is the view being read.
   *
   * The composition is counted from the rows on screen, so it is honest only
   * where those rows *are* today. On any other view the caller passes null and
   * the strip is not drawn, rather than describing a set the reader is not
   * looking at.
   */
  shape: ReturnType<typeof todayShape> | null;
  inbox: number;
  overdueLoaded: number;
  clearing: boolean;
  onOpenInbox: () => void;
  onClearOverdue: () => void;
  onFocus: () => void;
  onPin: () => void;
  onShortcuts: () => void;
  focusable: boolean;
}) {
  const segments = [
    { key: 'done', value: day.done, className: 'bg-[var(--chart-1)]', label: 'done' },
    { key: 'due', value: day.dueToday, className: 'bg-foreground/45', label: 'due today' },
    { key: 'late', value: day.overdue, className: 'bg-destructive', label: 'late' },
  ].filter(s => s.value > 0);

  return (
    <header className="nm-enter flex flex-col gap-4 border-b border-border pb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/*
            The greeting is a courtesy and is sized like one - the same
            decision the Executive Overview's plate makes, for the same
            reason: it is not the content. The date sits with it on one line
            rather than above it, because two stacked eyebrows over a heading
            is three lines of preamble before anything is said.
          */}
          <p className="flex flex-wrap items-baseline gap-x-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            {firstName && (
              <>
                <span className="text-foreground/70">{greeting()}, {firstName}</span>
                <span className="text-muted-foreground/40" aria-hidden="true">·</span>
              </>
            )}
            <span>{formatDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </p>
          <h2 className="mt-1.5 text-[19px] font-semibold leading-tight tracking-[-0.018em] text-foreground sm:text-[21px]">
            {loading ? <Skeleton className="h-6 w-56" /> : dayHeadline(day)}
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline" size="sm" onClick={onFocus}
            className="h-8 gap-1.5" disabled={!focusable}
            title={focusable ? 'Work through today one item at a time' : 'Nothing is due today'}
          >
            <Crosshair className="size-4" /> Focus
          </Button>
          <Button variant="outline" size="sm" onClick={onPin} className="h-8 gap-1.5">
            <Link2 className="size-4" />
            <span className="hidden sm:inline">Pin a task</span>
            <span className="sm:hidden">Pin</span>
          </Button>
          {/* No keyboard on a phone, so no keyboard help on a phone. */}
          <Button
            variant="ghost" size="icon" aria-label="Keyboard shortcuts"
            onClick={onShortcuts} className="hidden size-8 sm:inline-flex"
          >
            <Keyboard className="size-4" />
          </Button>
        </div>
      </div>

      {!loading && (day.owed > 0 || day.ahead > 0 || day.someday > 0) && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-8">
          {/*
            No bar on a day that owed nothing.

            An empty track with an empty legend is a chart of zero, drawn under
            a headline that has already said so - and on day one it was the
            first thing a new account saw: a grey line and the sentence
            "Nothing was owed today" under "Your list is clear".
          */}
          {day.owed > 0 && (
            <div className="min-w-0 max-w-xl flex-1">
              <span
                role="img"
                aria-label={segments.map(s => `${s.value} ${s.label}`).join(', ')}
                className="flex h-[5px] w-full overflow-hidden rounded-full bg-border"
              >
                {segments.map(s => (
                  <span
                    key={s.key}
                    title={`${s.value} ${s.label}`}
                    className={cn('h-full transition-[width] duration-700 ease-[var(--ease-brand)]', s.className)}
                    style={{ width: `${(s.value / day.owed) * 100}%` }}
                  />
                ))}
              </span>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
                {segments.map(s => (
                  <span key={s.key} className="flex items-center gap-1.5">
                    <span className={cn('size-[7px] rounded-full', s.className)} aria-hidden="true" />
                    <span className="tabular-nums">
                      <span className="font-medium text-foreground">{s.value}</span> {s.label}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* What is behind today - context, kept out of the day's own
              arithmetic so that "6 due today" never quietly means 24. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground lg:ml-auto">
            {/*
              The two least actionable numbers here are hidden on a phone.

              "Scheduled ahead" and "filed with no date" are orientation: they
              change nothing you would do in the next minute. On a 390px screen
              they cost a wrapped line each before the capture box, and vertical
              space above the capture box is the scarcest thing this module
              has. The inbox count and the overdue action survive at every
              width, because both are things to act on.
            */}
            {day.ahead > 0 && (
              <span className="hidden tabular-nums sm:inline">
                <span className="font-medium text-foreground">{day.ahead}</span> scheduled ahead
              </span>
            )}
            {/*
              Filed, but with no day on it - and *not* the inbox, which is
              counted beside this and is a subset of the same rows.

              Printed as written, the two overlapped: "6 with no date · 4 to
              sort" describes ten things to a reader and six to the database.
              Every other number on this header is an exact partition of a set
              that adds up, and this one has to be as well.
            */}
            {day.someday - inbox > 0 && (
              <span className="hidden tabular-nums sm:inline">
                <span className="font-medium text-foreground">{day.someday - inbox}</span>
                {' '}filed with no date
              </span>
            )}

            {/*
              The inbox, as a number you can press.

              The one count on this line that is a *queue* rather than a
              quantity: it should reach zero, and it is the only thing here
              worth interrupting the day to deal with. So it is the only one
              drawn as a control.
            */}
            {inbox > 0 && (
              <button
                type="button"
                onClick={onOpenInbox}
                className="inline-flex items-center gap-1.5 rounded text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                <Inbox className="size-3.5" aria-hidden="true" />
                <span className="tabular-nums">
                  <span className="font-medium text-foreground">{inbox}</span> to sort
                </span>
              </button>
            )}

            {/*
              The one bulk action on the screen, and it appears only when there
              is something to bulk. Counted from the rows actually loaded, so
              the button never promises to move more than it can reach.
            */}
            {overdueLoaded > 0 && (
              <Button
                variant="outline" size="sm"
                onClick={onClearOverdue}
                disabled={clearing}
                className="h-7 gap-1.5 px-2.5 text-[12px]"
              >
                {clearing
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <ArrowDownToLine className="size-3.5" />}
                Move {overdueLoaded} overdue to today
              </Button>
            )}
          </div>
        </div>
      )}

      {/*
        ── What today is made of ──────────────────────────────────────────

        The bar above answers *how much*; this answers *of what kind*, and
        only on the Today view, where the rows on screen genuinely are today.

        Two of these are facts a to-do list has never been able to state. "3
        from your work" is how much of the day arrived from somewhere else in
        the business rather than from you - the number that decides whether
        your own plans survive the afternoon, and it exists only because
        intake exists. "2 will remind you" is the part of the day you can
        stop holding in your head.

        Drawn as a sentence rather than as four tiles: these are small counts
        about one set, and a row of cards would make them look like separate
        subjects. Absent entirely when there is nothing to say.
      */}
      {!loading && shape && shape.remaining > 0 && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
          <span className="tabular-nums">
            <span className="font-medium text-foreground">{shape.remaining}</span>
            {shape.remaining === 1 ? ' item left today' : ' items left today'}
          </span>
          {shape.starred > 0 && (
            <span className="flex items-center gap-1.5 tabular-nums">
              <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
              <span className="font-medium text-foreground">{shape.starred}</span> starred
            </span>
          )}
          {shape.fromWork > 0 && (
            <span className="flex items-center gap-1.5 tabular-nums">
              <Link2 className="size-3" aria-hidden="true" />
              <span className="font-medium text-foreground">{shape.fromWork}</span> from your work
            </span>
          )}
          {shape.withReminder > 0 && (
            <span className="flex items-center gap-1.5 tabular-nums">
              <Bell className="size-3" aria-hidden="true" />
              <span className="font-medium text-foreground">{shape.withReminder}</span>
              {shape.withReminder === 1 ? ' will remind you' : ' will remind you'}
            </span>
          )}
        </p>
      )}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/*  Loading and empty                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The skeleton is the shape of the list it precedes.
 *
 * It used to be five 56px rounded blocks, which was the shape of the *cards*
 * this screen no longer draws - so the moment data arrived, the layout jumped
 * and the load felt longer than it was.
 */
function ListSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      {[4, 3].map((rows, g) => (
        <div key={g} className="flex flex-col gap-0.5">
          <div className="mb-1 flex items-center gap-2 px-1">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3 w-20" />
            <span className="ml-2 h-px flex-1 bg-border" />
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 py-[7px] pl-1">
              <Skeleton className="size-[17px] shrink-0 rounded-full" />
              <Skeleton
                className="h-3.5 rounded"
                style={{ width: `${42 + ((i * 37) % 38)}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * ── Empty states that are actually different ─────────────────────────────
 *
 * There were two of these before, both a grey circle in the middle of the
 * page, and the copy for a brand-new account read "Nothing here - everything
 * still to do. Add something above to get started." A person's first minute
 * with the module was a shrug.
 *
 * A cleared *Today* is an achievement, an empty *Completed* is a statement of
 * fact, a search with no hits is a dead end, and day one is the only moment
 * where explaining what this screen is for is worth a paragraph - which is
 * where the permanent explainer that used to sit under the title now lives,
 * shown to the people who need it and to nobody else.
 */
function MyWorkEmpty({
  view, hint, listName, searching, fresh, openCount,
  onCapture, onPin, onSeeAll,
}: {
  view: ViewKey;
  hint: string;
  listName: string | null;
  searching: boolean;
  fresh: boolean;
  /** Everything still to do, so an empty Today can point at it honestly. */
  openCount: number;
  onCapture: () => void;
  onPin: () => void;
  onSeeAll: () => void;
}) {
  if (searching) {
    return (
      <div className="px-6 py-14 text-center">
        <h3 className="text-[14px] font-semibold text-foreground">Nothing matches that</h3>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
          Search covers titles and notes across every view, completed
          included.
        </p>
      </div>
    );
  }

  if (fresh) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          Your list is private
        </h3>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          Invisible to administrators and never counted in a project report.
          Put anything on it. Work assigned to you lives in{' '}
          <span className="font-medium text-foreground">Projects</span>, and you
          can pin it here to plan around it.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" onClick={onCapture} className="gap-1.5">
            <Plus className="size-4" /> Add the first one
          </Button>
          <Button size="sm" variant="outline" onClick={onPin} className="gap-1.5">
            <Link2 className="size-4" /> Pin an assigned task
          </Button>
        </div>
      </div>
    );
  }

  /**
   * ── Today and Inbox earn their own endings ──────────────────────────────
   *
   * *Today* is the landing view, so its empty state is the first thing a
   * person with a clear morning sees - and "Nothing here" would be a shrug
   * where the honest answer is "you are done, and here is what is behind it".
   * It offers the one move worth making next, which is to look at everything
   * else, and only when there *is* everything else.
   *
   * *Inbox* empty is an achievement rather than an absence: the queue has been
   * cleared. It says so, and it explains what will land here, because an inbox
   * nobody understands is an inbox nobody uses.
   */
  const copy = view === 'done'
    ? {
        title: 'Nothing completed yet',
        body: 'Newest first.',
      }
    : view === 'today'
      ? {
          title: openCount > 0 ? 'Today is clear' : 'Nothing due today',
          body: 'Nothing due, nothing overdue. Anything you add here is dated today.',
        }
      : view === 'inbox'
        ? {
            title: 'Inbox is empty',
            body: 'Anything captured without a day or a list waits here. Work added from Projects, Support and CRM lands here too.',
          }
        : view === 'starred'
          ? {
              title: 'Nothing starred',
              body: 'The star is the only priority here. Keep it for what cannot wait.',
            }
          : listName
            ? {
                title: `${listName} is empty`,
                body: 'Anything you add here is filed into it.',
              }
            : {
                title: 'Nothing open',
                body: `${hint}.`,
              };

  return (
    <div className="px-6 py-14 text-center">
      <h3 className="text-[14px] font-semibold text-foreground">{copy.title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
        {copy.body}
      </p>

      {/*
        The one move worth offering, and only when it leads somewhere. A
        button reading "See everything open" on an account with nothing open
        is a button that goes to a second empty screen.
      */}
      {view === 'today' && openCount > 0 && (
        <Button
          size="sm" variant="outline" onClick={onSeeAll}
          className="mt-4 gap-1.5"
        >
          <ListChecks className="size-4" />
          See all {openCount} open
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The composer                                                              */
/* -------------------------------------------------------------------------- */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Capture - and why the Add button is not a responsive afterthought
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * The only way to commit a to-do was the Enter key. On a desktop that is
 * excellent - it is the fastest capture in the product and the reason this
 * module gets used at all. On a phone it is a dead end dressed as a feature:
 *
 *   · iOS shows **return** on the keyboard, and a bare `<input>` in a `<div>`
 *     with no form gives it nothing to do - the keyboard dismisses and the
 *     text sits there uncommitted.
 *   · Android shows a **↵** or a **✓** depending on the keyboard app, the
 *     locale and the input type. Three keyboards, three behaviours.
 *   · A person using voice input, a stylus, or an accessibility keyboard may
 *     have no return key in reach at all.
 *
 * So capture depended on a key that a large share of the people using it did
 * not have. That is not a responsive rough edge; it is the feature not
 * existing on mobile.
 *
 * ── What this does instead ────────────────────────────────────────────────
 *
 * **A real `<form>`.** `onSubmit` is what makes the on-screen return key work
 * at all - the browser wires the keyboard's action to form submission, so the
 * three Android behaviours collapse into one. `enterKeyHint="done"` asks for
 * the label that matches.
 *
 * **A visible Add button, always.** Not hidden behind a hover, not conditional
 * on the field being non-empty - a control that appears only once you have
 * typed cannot be found by somebody wondering *how* to commit what they
 * typed. It is disabled while empty, which says the same thing without
 * vanishing. 40×40 at its smallest, above the 44px touch target on the row
 * axis and comfortably tappable.
 *
 * **It stays reachable while the keyboard is open.** The composer sits at the
 * top of the working column, above the list, so the on-screen keyboard covers
 * the *list* and never the field or its button. The alternative - a bar
 * pinned to the bottom of the viewport - is the pattern that fails: mobile
 * browsers resize `100vh` unpredictably when the keyboard opens, and a fixed
 * footer ends up either behind the keyboard or floating in the middle of the
 * page. Being above the fold by construction needs no viewport arithmetic and
 * cannot be defeated by a browser's idea of its own height.
 *
 * **Enter still works everywhere it did.** Nothing was taken away; a second
 * way in was added.
 */
function Composer({
  inputRef, value, onChange, onSubmit, busy, placeholder, hint,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  /** What the typed shortcuts resolved to, shown before it is committed. */
  hint: string | null;
}) {
  const ready = value.trim().length > 0;

  return (
    /*
      ── Sticky, below `sm`, and why that is not decoration ────────────────

      Measured on a 390×844 viewport the Add button sat at y=478. An iOS
      keyboard takes roughly 300–340px, so on that phone it survives by
      thirty pixels - and on a 667px-tall phone it is *behind* the keyboard,
      which is the precise failure this composer exists to remove.

      Pinning it to the top of the scroll container fixes it without any
      viewport arithmetic: the browser scrolls a focused field into view, and
      sticky then holds the whole composer at the top edge no matter how far
      the list is scrolled or what the keyboard has done to the visual
      viewport. `100vh` maths and `visualViewport` listeners are the fragile
      way to solve this; being pinned above the content cannot be defeated by
      a browser's opinion of its own height.

      Static from `sm` up, where there is no keyboard eating half the screen
      and a pinned bar would only take space from the list.
    */
    <form
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
      className={cn(
        'sticky top-0 z-20 -mx-1 flex items-center gap-2 rounded-lg border border-border',
        'bg-card p-1.5 pl-3 shadow-e1 transition-colors focus-within:border-foreground/25',
        'sm:static sm:mx-0',
      )}
    >
      <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

      <Input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Add a to-do"
        // `enterKeyHint` is what puts "done" on the on-screen key rather than
        // a newline arrow; `autoCapitalize` because a to-do is a sentence.
        enterKeyHint="done"
        autoCapitalize="sentences"
        autoComplete="off"
        // 16px on small screens: anything below it makes iOS Safari zoom the
        // whole page on focus, which throws the layout and the person's place
        // in it away every time they tap the field.
        className="h-11 border-0 px-0 text-[16px] shadow-none focus-visible:ring-0 sm:h-9 sm:text-[13.5px]"
      />

      {/*
        What the shortcuts were understood to mean, before it is committed.
        A parse the person cannot see before pressing Add is a parse they have
        to undo afterwards.
      */}
      {hint && (
        <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
          {hint}
        </span>
      )}

      {/*
        44×44 on a touch screen, 36 high on a pointer one.

        It was `h-9` at both, which is 36px, under the 44px minimum every touch
        guideline agrees on, and this is the control the entire mobile capture
        workflow depends on. Shrinking to `sm:h-9` above the breakpoint keeps
        the desktop composer the height it was.

        The disabled state is a recessed fill rather than ink at half opacity.
        Faded near-black reads as a smudge; a muted control reads as one
        waiting for input, which is what it is.

        There was a `kbd` hint showing `N` between the field and this button.
        It made the primary control look like two, and the shortcut is already
        in the keyboard dialog. A capture box should be one thing.
      */}
      <Button
        type="submit"
        size="sm"
        disabled={!ready || busy}
        aria-label="Add to your list"
        className={cn(
          'size-11 shrink-0 gap-1.5 p-0 transition-colors sm:h-9 sm:w-auto sm:px-3.5',
          'disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5 sm:hidden" />}
        <span className="hidden sm:inline">Add</span>
        <span className="sr-only sm:hidden">Add</span>
      </Button>
    </form>
  );
}
