import {
  AlertTriangle, Sun, Sunrise, CalendarRange, CalendarClock, Inbox, CheckCircle2,
} from 'lucide-react';
import { formatDate } from '@/lib/format';
import type { ModuleId } from '@/lib/constants';
import { SOURCE_MODULE_LABELS, sourceNoun, sourceOpens } from '@/lib/mywork';
import type { Recurrence } from '@/lib/todo-recurrence';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  My Work - the shared model
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The one place that decides what "today", "this week" and "later" mean, so
 *  the list, the board, the schedule, focus mode and the day's readout cannot
 *  disagree about which bucket a to-do is in. Five screens each computing
 *  "overdue" separately is five chances to be off by a day.
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
  /** When to be told about it. An instant, unlike `dueOn`. See 0026. */
  remindAt: string | null;
  /** When that reminder was delivered. Read-only; the trigger clears it. */
  reminderSentAt: string | null;
  /** Where this came from, when it came from somewhere else. See `lib/mywork`. */
  sourceModule: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
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

export type ViewKey = 'today' | 'inbox' | 'upcoming' | 'open' | 'starred' | 'done';
export type Layout = 'list' | 'board' | 'schedule';

/**
 * ── The order is the working day ─────────────────────────────────────────
 *
 * *Today* first and selected on arrival, because the question somebody opens
 * this screen with is "what do I need to do now?" and answering it with a
 * chronological dump of twenty-four items is answering a different one. Then
 * *Inbox*, which is the pile waiting to be decided; then what is coming; then
 * everything, for the moments when you genuinely want the whole picture.
 *
 * `open` was first and default. It is a good list and a poor landing: the day
 * you are actually living in was two clicks and a scroll away, underneath next
 * month's work.
 */
export const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: 'today',    label: 'Today',     hint: 'Due today or already overdue' },
  { key: 'inbox',    label: 'Inbox',     hint: 'Captured, not yet decided' },
  { key: 'upcoming', label: 'Upcoming',  hint: 'Scheduled for later' },
  { key: 'open',     label: 'All open',  hint: 'Everything still to do' },
  { key: 'starred',  label: 'Starred',   hint: 'What matters most' },
  { key: 'done',     label: 'Completed', hint: 'Recently finished' },
];

/**
 * ── The six list colours ─────────────────────────────────────────────────
 *
 * Colour keys as stored, resolved here rather than in the database - migration
 * 0016's reasoning: a stored `#ff0000` outlives every redesign and looks wrong
 * in dark mode.
 *
 * A list colour is a *filing* mark, not a status. It says which of your own
 * folders a row is in, and it must never compete with the two colours on this
 * screen that carry meaning - late (`--destructive`) and starred
 * (`--warning`). So it appears once per row, as a 7px dot, and nowhere else.
 *
 * They are literal values rather than `--chart-*` for one reason: the chart
 * ramp holds five hues and two of them do not match the names the user picks
 * from. Mapping `violet` to `--chart-5` paints a mint dot into a swatch
 * labelled violet, which is a control that lies about what it does. These are
 * *content* - one person's choice about their own filing - not theme, and each
 * is a mid-tone that stays identifiable on both the light page and the dark
 * one without a second definition.
 */
export const LIST_COLORS: Record<string, string> = {
  slate:   'bg-[#8b8377]',
  emerald: 'bg-[#2d9572]',
  blue:    'bg-[#2c6fa7]',
  amber:   'bg-[#c8952f]',
  rose:    'bg-[#bf5f77]',
  violet:  'bg-[#7a68bd]',
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
 * A `YYYY-MM-DD` day, formatted - parsed as a *local* day.
 *
 * `formatDate` runs the string through `new Date(...)`, and a bare
 * `2026-09-03` is parsed as UTC midnight by specification. Rendered in any
 * timezone west of UTC that comes back as the 2nd, so a to-do due on the 3rd
 * would be labelled with the day before it on every screen in this module.
 * `due_on` is a `date` precisely because it has no time and no zone; appending
 * `T00:00:00` is what says so to the parser.
 */
export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return formatDate(`${iso}T00:00:00`, opts);
}

/** Whole days between two `YYYY-MM-DD` days, in the reader's own calendar. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * ── The buckets ──────────────────────────────────────────────────────────
 *
 * These are the columns of the board and the headings of the list, and they
 * are the reason the board does not have a status vocabulary.
 *
 * A Kanban board over `todo / doing / done` would require inventing a status
 * on a table that deliberately has none - the Projects module owns that idea,
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

export interface Bucket {
  key: BucketKey;
  label: string;
  icon: typeof Sun;
  /** What dropping into this column sets the due date to; null clears it. */
  dueFor: (today: string) => string | null;
  /**
   * The concrete day this column stands for, named.
   *
   * A column headed "This week" tells you the category; "This week · to Fri 5"
   * tells you the deadline. The board's whole subject is time, and a time
   * column that never says a date is asking the reader to hold a calendar in
   * their head. Null where the column genuinely has no single day.
   */
  dayNote: (today: string) => string | null;
  tone: string;
}

export const BUCKETS: Bucket[] = [
  {
    key: 'overdue', label: 'Overdue', icon: AlertTriangle,
    dueFor: t => t, dayNote: () => null,
    tone: 'text-destructive',
  },
  {
    key: 'today', label: 'Today', icon: Sun,
    dueFor: t => t,
    dayNote: t => formatDay(t, { weekday: 'short', day: 'numeric', month: 'short' }),
    tone: 'text-[var(--chart-1)]',
  },
  {
    key: 'tomorrow', label: 'Tomorrow', icon: Sunrise,
    dueFor: t => addDaysISO(t, 1),
    dayNote: t => formatDay(addDaysISO(t, 1), { weekday: 'short', day: 'numeric', month: 'short' }),
    tone: 'text-foreground',
  },
  {
    key: 'week', label: 'This week', icon: CalendarRange,
    // Dropping lands mid-window rather than on its edge: an item dragged into
    // "this week" that arrives dated Sunday is one the reader has to move
    // again on Monday.
    dueFor: t => addDaysISO(t, 3),
    dayNote: t => `to ${formatDay(addDaysISO(t, 7), { weekday: 'short', day: 'numeric' })}`,
    tone: 'text-muted-foreground',
  },
  {
    key: 'later', label: 'Later', icon: CalendarClock,
    dueFor: t => addDaysISO(t, 8),
    dayNote: t => `after ${formatDay(addDaysISO(t, 7), { day: 'numeric', month: 'short' })}`,
    tone: 'text-muted-foreground',
  },
  {
    key: 'someday', label: 'Someday', icon: Inbox,
    dueFor: () => null, dayNote: () => null,
    tone: 'text-muted-foreground',
  },
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

export interface TodoGroup {
  key: BucketKey;
  label: string;
  icon: typeof Sun;
  tone: string;
  /** The concrete day, where the bucket has one. */
  dayNote: string | null;
  items: Todo[];
}

/**
 * The visible list, in display order, grouped.
 *
 * Ordered bucket-major and then by hand-ordering, which is what makes dragging
 * meaningful: the server sorts starred-first, so without re-sorting here a
 * dragged item would spring back to wherever the star put it and the reorder
 * would look broken while having worked perfectly.
 */
export function groupByBucket(todos: Todo[], today: string): TodoGroup[] {
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
    .map(b => ({
      key: b.key, label: b.label, icon: b.icon, tone: b.tone,
      dayNote: b.dayNote(today),
      items: byKey.get(b.key)!,
    }));
}

/**
 * ── How a due date is said ────────────────────────────────────────────────
 *
 * Two rules, both about not wasting the reader's attention.
 *
 * **Late is counted, not labelled.** "Overdue" on a row already sitting under
 * an *Overdue* heading is the same word twice and tells nobody how bad it is.
 * "5 days late" is a different fact, and it is the one that decides whether
 * something gets done today.
 *
 * **A heading speaks for its rows.** Inside the Today group every row said
 * "Today"; inside Tomorrow, "Tomorrow". `groupKey` lets a row stay silent when
 * its group has already said it, so the meta line is empty for the common case
 * and every mark left on it means something.
 */
export function dueLabel(
  due: string | null,
  opts: { today?: string; groupKey?: BucketKey } = {},
): { text: string; tone: string; urgent?: boolean } | null {
  if (!due) return null;
  const today = opts.today ?? todayISO();

  if (due < today) {
    const late = daysBetween(due, today);
    return {
      text: late === 1 ? 'Yesterday' : `${late} days late`,
      tone: 'text-destructive',
      urgent: true,
    };
  }

  if (due === today) {
    return opts.groupKey === 'today'
      ? null
      : { text: 'Today', tone: 'text-[var(--chart-1)]' };
  }

  if (due === addDaysISO(today, 1)) {
    return opts.groupKey === 'tomorrow'
      ? null
      : { text: 'Tomorrow', tone: 'text-muted-foreground' };
  }

  // Inside the next week a weekday is what people plan against; beyond it the
  // weekday is ambiguous and the date is what is meant.
  const text = due <= addDaysISO(today, 7)
    ? formatDay(due, { weekday: 'long' })
    : formatDay(due, { day: 'numeric', month: 'short' });

  return { text, tone: 'text-muted-foreground' };
}

/**
 * ── When something was finished ──────────────────────────────────────────
 *
 * The Completed view's entire subject is history, and it used to carry no
 * date at all: seven ticked-off titles in the server's ordering - starred
 * first, then by the day they had been *due* - which is an order that means
 * nothing once the work is done. "Read the market brief" with no answer to
 * "when?" is a receipt with the date torn off.
 *
 * `completed_at` has been stamped by a trigger since 0016 and returned by the
 * endpoint ever since; nothing had ever read it.
 */
export function completedLabel(
  completedAt: string | null,
  today = todayISO(),
): string | null {
  if (!completedAt) return null;
  const day = completedAt.slice(0, 10);
  if (day === today) return 'Today';
  if (day === addDaysISO(today, -1)) return 'Yesterday';
  return formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Completed work, newest first, grouped by the day it was finished.
 *
 * Sorted here rather than in the endpoint because the ordering the endpoint
 * applies is right for everything else it serves - starred first, then by due
 * date - and adding a second ordering to it for one view would mean the same
 * query answering to two rules.
 */
export function groupByCompletion(todos: Todo[], today: string): TodoGroup[] {
  const sorted = [...todos].sort((a, b) =>
    (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  const out: TodoGroup[] = [];
  for (const todo of sorted) {
    const label = completedLabel(todo.completedAt, today) ?? 'Undated';
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(todo);
    else {
      out.push({
        key: 'today', label, icon: CheckCircle2, tone: 'text-[var(--chart-1)]',
        dayNote: null, items: [todo],
      });
    }
  }
  return out;
}

/** What `/api/todos` reports about the whole list, whatever view is loaded. */
export interface TodoCounts {
  open: number;
  /** Open and due today or earlier - the day's remaining work. */
  today: number;
  /** The part of `today` that is already late. */
  overdue: number;
  /** Open with no day on it - a list, not a commitment. */
  someday: number;
  /** Open with neither a day nor a list: captured and not yet decided. */
  inbox: number;
  starred: number;
  doneToday: number;
}

export const EMPTY_COUNTS: TodoCounts = {
  open: 0, today: 0, overdue: 0, someday: 0, inbox: 0, starred: 0, doneToday: 0,
};

/**
 * ── The day, read honestly ────────────────────────────────────────────────
 *
 * The previous version of this screen carried a 24px ring reading "3 of 12
 * done today" and nothing else, which answers *how far through* and none of
 * the three questions somebody actually opens a list to ask: what is late,
 * what is due, and is the rest of it manageable.
 *
 * So the day is a partition rather than a percentage. `done + dueToday +
 * overdue` is exactly the work owed today, every part of it a count the API
 * returns, and `ahead` is everything dated past today. Nothing here is
 * inferred, weighted or scored: there is no productivity index, because a
 * number nobody can check is a number nobody should be shown.
 *
 * The one judgement it makes is `state`, and it is a judgement about arithmetic
 * only - whether the owed set is empty, cleared, or still owed with some of it
 * late.
 */
export interface DaySummary {
  done: number;
  /** Still to do and dated today exactly. */
  dueToday: number;
  /** Still to do and dated before today. */
  overdue: number;
  /** Owed today in total - done plus everything still outstanding for it. */
  owed: number;
  /** Open work dated after today. Context, not part of the day. */
  ahead: number;
  /** Undated open work. Also context - it can wait by definition. */
  someday: number;
  pct: number;
  state: 'empty' | 'clear' | 'late' | 'due';
}

export function daySummary(counts: TodoCounts): DaySummary {
  const someday = counts.someday;
  const overdue = Math.min(counts.overdue, counts.today);
  const dueToday = Math.max(0, counts.today - overdue);
  const owed = counts.doneToday + counts.today;
  const ahead = Math.max(0, counts.open - counts.today - someday);

  return {
    done: counts.doneToday,
    dueToday,
    overdue,
    owed,
    ahead,
    someday,
    pct: owed === 0 ? 0 : Math.round((counts.doneToday / owed) * 100),
    state: owed === 0 ? 'empty'
      : counts.today === 0 ? 'clear'
        : overdue > 0 ? 'late' : 'due',
  };
}

/**
 * The sentence the day's readout leads with.
 *
 * One line, in the reader's own terms, and it changes with the situation
 * rather than being a template with numbers dropped into it - "0 overdue,
 * 0 due today" is a sentence no person would say.
 */
export function dayHeadline(day: DaySummary): string {
  if (day.state === 'empty') {
    return day.ahead > 0 || day.someday > 0
      ? 'Nothing is due today'
      : 'Your list is clear';
  }
  if (day.state === 'clear') {
    return day.done === 1 ? 'Today is done - one item' : `Today is done - all ${day.done}`;
  }
  if (day.state === 'late') {
    const late = `${day.overdue} late`;
    return day.dueToday > 0 ? `${late}, ${day.dueToday} due today` : `${late} and nothing else due`;
  }
  return day.dueToday === 1 ? 'One thing due today' : `${day.dueToday} due today`;
}

/**
 * ── What to do next ───────────────────────────────────────────────────────
 *
 * Focus mode's whole job is to answer that in one glance, so the ordering is
 * opinionated rather than configurable: overdue before today, starred before
 * unstarred, then the person's own hand-ordering. A "what now?" screen that
 * asks you to choose has not answered the question.
 *
 * ── Why it stops at the end of today ──────────────────────────────────────
 *
 * It used to queue every open item, so a session opened with nine things due
 * announced "24 to go" and marched on into *Someday*. That is not a focus
 * session, it is the backlog with one item showing - and the thing a person
 * loses faith in fastest is a "what now" screen that never ends.
 *
 * So the queue is the day: overdue and today. Once that is empty the caller
 * can offer to carry on into what is scheduled next, which is a decision the
 * person makes having *finished* their day rather than one made for them at
 * the start of it.
 */
export function focusOrder(
  todos: Todo[],
  today: string,
  scope: 'today' | 'all' = 'today',
): Todo[] {
  const rank: Record<BucketKey, number> = {
    overdue: 0, today: 1, tomorrow: 2, week: 3, later: 4, someday: 5,
  };

  return todos
    .filter(t => !t.isDone)
    .filter(t => (scope === 'all' ? true : rank[bucketOf(t, today)] <= 1))
    .sort((a, b) =>
      rank[bucketOf(a, today)] - rank[bucketOf(b, today)] ||
      Number(b.isStarred) - Number(a.isStarred) ||
      a.sortOrder - b.sortOrder);
}

/* -------------------------------------------------------------------------- */
/*  Where a to-do came from                                                   */
/* -------------------------------------------------------------------------- */

export interface TodoOrigin {
  module: ModuleId;
  type: string;
  id: string;
  /** "Q4 Campaign", "#1043 · Acme Ltd" - what the source was called. */
  label: string | null;
  /** A word for the record itself: Task, Ticket, Deal. */
  noun: string;
  /** Whether the owning module can be asked to open it. */
  opens: boolean;
  /** Live status, where the source is a project task and the join returned it. */
  status?: string | null;
}

/**
 * ── One answer to "where did this come from?" ────────────────────────────
 *
 * Two mechanisms carry it and they cannot disagree - migration 0026's CHECK
 * requires a row with `linked_task_id` to name that task in the source triple.
 * The task is preferred here anyway, because it brings something the stored
 * columns cannot: the *live* project name and the task's current status, which
 * is how a personal item can quietly show that the work behind it was already
 * finished by somebody else.
 *
 * Returns null for the ordinary case, which is a to-do somebody simply wrote
 * down. Most rows have no origin and should show no chip.
 */
export function originOf(todo: Todo): TodoOrigin | null {
  if (todo.linkedTask) {
    return {
      module: 'projects',
      type: 'task',
      id: todo.linkedTask.id,
      label: todo.linkedTask.project?.name ?? todo.sourceLabel ?? null,
      noun: 'Task',
      opens: true,
      status: todo.linkedTask.status ?? null,
    };
  }

  if (!todo.sourceModule || !todo.sourceType || !todo.sourceId) return null;

  return {
    module: todo.sourceModule as ModuleId,
    type: todo.sourceType,
    id: todo.sourceId,
    label: todo.sourceLabel,
    noun: sourceNoun(todo.sourceType),
    opens: sourceOpens(todo.sourceType),
  };
}

/** How the origin reads on a row: "Projects · Q4 Campaign". */
export function originText(origin: TodoOrigin): string {
  const where = SOURCE_MODULE_LABELS[origin.module] ?? origin.module;
  return origin.label ? `${where} · ${origin.label}` : where;
}

/* -------------------------------------------------------------------------- */
/*  Reminders                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A reminder, in the fewest words that are still unambiguous.
 *
 * The time is always shown - that is the entire content of a reminder - and
 * the day only when it is not today. "9:00" on a row due today needs no more;
 * "Fri 9:00" on one due Friday does.
 *
 * `sent` is what lets the row stop shouting: a reminder that has already been
 * delivered is history, and drawing it at the same weight as one still coming
 * makes a list of ticked-off obligations look like a list of pending ones.
 */
export function reminderLabel(
  remindAt: string | null,
  today = todayISO(),
): { text: string; sent: boolean; overdue: boolean } | null {
  if (!remindAt) return null;

  const at = new Date(remindAt);
  if (Number.isNaN(at.getTime())) return null;

  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const when = day === today ? time
    : day === addDaysISO(today, 1) ? `Tomorrow ${time}`
      : day === addDaysISO(today, -1) ? `Yesterday ${time}`
        : `${formatDay(day, { day: 'numeric', month: 'short' })} ${time}`;

  return { text: when, sent: at.getTime() <= Date.now(), overdue: day < today };
}

/* -------------------------------------------------------------------------- */
/*  Today, as a command centre                                                */
/* -------------------------------------------------------------------------- */

/**
 * ── What "today" is made of ──────────────────────────────────────────────
 *
 * The day's readout answers *how much*; this answers *of what kind*. Both are
 * counted from rows already on screen rather than asked of the server, because
 * the Today view holds exactly the rows this describes - it is the one view
 * where a client-side count cannot lie about a filtered subset.
 *
 * `fromWork` is the number that only exists because intake exists: how much of
 * today came from somewhere else in the business rather than from you. It is a
 * genuinely different fact about a day, and it is the one a person uses to
 * decide whether their own plans are going to survive it.
 */
export interface TodayShape {
  remaining: number;
  overdue: number;
  starred: number;
  fromWork: number;
  withReminder: number;
}

export function todayShape(todos: Todo[], today: string): TodayShape {
  const open = todos.filter(t => !t.isDone);
  return {
    remaining: open.length,
    overdue: open.filter(t => t.dueOn && t.dueOn < today).length,
    starred: open.filter(t => t.isStarred).length,
    fromWork: open.filter(t => !!originOf(t)).length,
    withReminder: open.filter(t => !!t.remindAt && !t.reminderSentAt).length,
  };
}

/** Morning, afternoon, evening - the same greeting the Overview uses. */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
