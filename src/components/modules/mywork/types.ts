import {
  AlertTriangle, Sun, Sunrise, CalendarRange, CalendarClock, Inbox,
} from 'lucide-react';
import { formatDate } from '@/lib/format';
import type { Recurrence } from '@/lib/todo-recurrence';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  My Work — the shared model
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The one place that decides what "today", "this week" and "later" mean, so
 *  the list, the board, the schedule and the day's progress ring cannot
 *  disagree about which bucket a to-do is in. Three screens each computing
 *  "overdue" separately is three chances to be off by a day.
 */

export interface TodoList {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  todos?: { count: number }[];
}

export interface LinkedTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  project?: { id: string; name: string } | null;
}

export interface Todo {
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
  recurrence: Recurrence | null;
  list?: { id: string; name: string; color: string } | null;
  linkedTask?: LinkedTask | null;
  createdAt: string;
}

export interface AssignedTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  project?: { id: string; name: string } | null;
}

export type ViewKey = 'open' | 'today' | 'upcoming' | 'starred' | 'done';
export type Layout = 'list' | 'board' | 'schedule';

export const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: 'open',     label: 'All open',  hint: 'Everything still to do' },
  { key: 'today',    label: 'Today',     hint: 'Due today or already overdue' },
  { key: 'upcoming', label: 'Upcoming',  hint: 'Scheduled for later' },
  { key: 'starred',  label: 'Starred',   hint: 'What matters most' },
  { key: 'done',     label: 'Completed', hint: 'Recently finished' },
];

/** Colour keys as stored, resolved here rather than in the database. */
export const LIST_COLORS: Record<string, string> = {
  slate:   'bg-slate-400',
  emerald: 'bg-emerald-500',
  blue:    'bg-blue-500',
  amber:   'bg-amber-500',
  rose:    'bg-rose-500',
  violet:  'bg-violet-500',
};

export const COLOR_KEYS = Object.keys(LIST_COLORS);

// ── Days ───────────────────────────────────────────────────────────────────

/** Today as `YYYY-MM-DD` in the reader's own timezone, not UTC's. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * ── The buckets ──────────────────────────────────────────────────────────
 *
 * These are the columns of the board and the headings of the list, and they
 * are the reason the board does not have a status vocabulary.
 *
 * A Kanban board over `todo / doing / done` would require inventing a status
 * on a table that deliberately has none — the Projects module owns that idea,
 * and a private list whose items need a workflow state is a list that has
 * turned into the task tracker it exists as an alternative to. What a person
 * actually moves a personal to-do *between* is days: this slips to tomorrow,
 * that one is for next week, this one has no date and never will.
 *
 * So the columns are time, dragging between them reschedules, and the same
 * buckets group the list. One dimension, understood instantly, and every drag
 * writes a field that already exists.
 */
export type BucketKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'someday';

export const BUCKETS: {
  key: BucketKey;
  label: string;
  icon: typeof Sun;
  /** What dropping into this column sets the due date to; null clears it. */
  dueFor: (today: string) => string | null;
  tone: string;
}[] = [
  { key: 'overdue',  label: 'Overdue',   icon: AlertTriangle, dueFor: t => t,                tone: 'text-destructive' },
  { key: 'today',    label: 'Today',     icon: Sun,           dueFor: t => t,                tone: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'tomorrow', label: 'Tomorrow',  icon: Sunrise,       dueFor: t => addDaysISO(t, 1), tone: 'text-foreground' },
  { key: 'week',     label: 'This week', icon: CalendarRange, dueFor: t => addDaysISO(t, 3), tone: 'text-muted-foreground' },
  { key: 'later',    label: 'Later',     icon: CalendarClock, dueFor: t => addDaysISO(t, 8), tone: 'text-muted-foreground' },
  { key: 'someday',  label: 'Someday',   icon: Inbox,         dueFor: () => null,            tone: 'text-muted-foreground' },
];

/**
 * Which bucket a to-do sits in.
 *
 * "This week" is the next seven days rather than the calendar week: on a
 * Friday, a calendar week means "this week" holds one day and "later" holds
 * everything, which is not how anybody plans.
 */
export function bucketOf(todo: Todo, today: string): BucketKey {
  if (!todo.dueOn) return 'someday';
  if (todo.dueOn < today) return 'overdue';
  if (todo.dueOn === today) return 'today';
  if (todo.dueOn === addDaysISO(today, 1)) return 'tomorrow';
  if (todo.dueOn <= addDaysISO(today, 7)) return 'week';
  return 'later';
}

/**
 * The visible list, in display order, grouped.
 *
 * Ordered bucket-major and then by hand-ordering, which is what makes dragging
 * meaningful: the server sorts starred-first, so without re-sorting here a
 * dragged item would spring back to wherever the star put it and the reorder
 * would look broken while having worked perfectly.
 */
export function groupByBucket(
  todos: Todo[],
  today: string,
): { key: BucketKey; label: string; icon: typeof Sun; tone: string; items: Todo[] }[] {
  const byKey = new Map<BucketKey, Todo[]>();
  for (const t of todos) {
    const k = bucketOf(t, today);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(t);
  }

  for (const items of byKey.values()) {
    items.sort((a, b) =>
      a.sortOrder - b.sortOrder ||
      (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  return BUCKETS
    .filter(b => (byKey.get(b.key)?.length ?? 0) > 0)
    .map(b => ({ key: b.key, label: b.label, icon: b.icon, tone: b.tone, items: byKey.get(b.key)! }));
}

/** Today, tomorrow, or the date — how people actually refer to their own days. */
export function dueLabel(due: string | null): { text: string; tone: string } | null {
  if (!due) return null;
  const today = todayISO();

  if (due < today) return { text: 'Overdue', tone: 'text-destructive' };
  if (due === today) return { text: 'Today', tone: 'text-emerald-600 dark:text-emerald-400' };
  if (due === addDaysISO(today, 1)) return { text: 'Tomorrow', tone: 'text-muted-foreground' };
  return { text: formatDate(due, { month: 'short', day: 'numeric' }), tone: 'text-muted-foreground' };
}

/** What `/api/todos` reports about the whole list, whatever view is loaded. */
export interface TodoCounts {
  open: number;
  /** Open and due today or earlier. */
  today: number;
  starred: number;
  doneToday: number;
}

/**
 * The day's progress.
 *
 * Built from the server's counts rather than from the rows on screen, because
 * the default view excludes completed items: deriving it here would show
 * "0 done today" to somebody who had just spent the morning clearing their
 * list, which is the most demoralising possible reading.
 *
 * The denominator is what was owed today *plus* what has been finished today,
 * so clearing an overdue item moves the ring. Counting only items dated today
 * tells somebody working through last week's backlog that they have done
 * nothing.
 */
export function dayProgress(counts: TodoCounts): { done: number; total: number; pct: number } {
  const done = counts.doneToday;
  const total = done + counts.today;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * What to do next.
 *
 * Focus mode's whole job is to answer that in one glance, so the ordering is
 * opinionated rather than configurable: overdue before today, starred before
 * unstarred, then the person's own hand-ordering. A "what now?" screen that
 * asks you to choose has not answered the question.
 */
export function focusOrder(todos: Todo[], today: string): Todo[] {
  const rank: Record<BucketKey, number> = {
    overdue: 0, today: 1, tomorrow: 2, week: 3, later: 4, someday: 5,
  };

  return todos
    .filter(t => !t.isDone)
    .sort((a, b) =>
      rank[bucketOf(a, today)] - rank[bucketOf(b, today)] ||
      Number(b.isStarred) - Number(a.isStarred) ||
      a.sortOrder - b.sortOrder);
}
