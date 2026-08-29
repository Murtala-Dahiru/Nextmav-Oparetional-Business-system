'use client';

import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronLeft, ChevronRight, Plus, Star, Repeat, Inbox } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SortableTodoRow, type TodoRowActions } from './todo-row';
import {
  BUCKETS, bucketOf, todayISO, formatDay, type BucketKey, type Todo,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Board                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ── A board over time, not over status ───────────────────────────────────
 *
 * The columns are Overdue · Today · Tomorrow · This week · Later · Someday,
 * and dragging a card between them sets its due date.
 *
 * The obvious alternative - to do / doing / done - would mean inventing a
 * status on a table that deliberately has none. That vocabulary belongs to
 * Projects, where a status is a statement to colleagues about work they are
 * waiting on. On a private list there is nobody to tell, so a "doing" column
 * is a lie you keep for yourself, and the honest thing a person actually moves
 * their own to-dos between is days.
 *
 * ── What this pass changed ───────────────────────────────────────────────
 *
 * Three things, all about the column being *time*:
 *
 *   · **Columns name their day.** "Tomorrow" told you the category and left
 *     you to work out the date; "Tomorrow · Sun 30 Aug" is the fact. A board
 *     whose entire subject is the calendar should not make you hold one in
 *     your head.
 *   · **Cards stopped repeating the heading.** Every card under *Overdue*
 *     said "Overdue" and every card under *Today* said "Today" - the same
 *     word up to six times per column. An overdue card now says how late it
 *     is, which the heading does not know, and a card under Today says
 *     nothing, because there is nothing left to say.
 *   · **The drop target only appears while dragging.** Six columns each
 *     carrying a permanent dashed box reading "Drop here to move it to
 *     someday" is six instructions for something nobody is doing.
 */
function BoardColumn({
  bucket, items, actions, isOver, dragging, today, onAdd,
}: {
  bucket: (typeof BUCKETS)[number];
  items: Todo[];
  actions: TodoRowActions;
  isOver: boolean;
  dragging: boolean;
  today: string;
  onAdd: (dueOn: string | null) => void;
}) {
  const { setNodeRef } = useDroppable({ id: `bucket:${bucket.key}` });
  const Icon = bucket.icon;
  const dayNote = bucket.dayNote(today);

  return (
    <div className="flex w-[15.5rem] shrink-0 flex-col gap-2 sm:w-[16.5rem]">
      <div className="flex items-baseline gap-2 px-1">
        <Icon className={cn('size-3.5 shrink-0 translate-y-0.5', bucket.tone)} aria-hidden="true" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground/80">
          {bucket.label}
        </h3>
        {dayNote && (
          <span className="truncate text-[11px] text-muted-foreground/70">{dayNote}</span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {items.length || ''}
        </span>
        {/*
          Planning straight into a day. The capture box files to whatever view
          you are looking at; on a board the column *is* the day, so adding
          from its head is the shortest path there is from "next Tuesday" to a
          to-do dated next Tuesday.
        */}
        <button
          type="button"
          aria-label={`Add to ${bucket.label.toLowerCase()}`}
          onClick={() => onAdd(bucket.dueFor(today))}
          className="rounded p-0.5 text-muted-foreground/50 opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/board:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        /*
          Nothing at rest.

          The column carried a permanent recessed fill, which on a short
          column drew a tall grey block under the last card with nothing in
          it. A drop target is only worth showing when something is being
          dropped, and the heading plus the cards already say where the column
          is. The surface appears the moment a drag starts and goes again when
          it ends.
        */
        className={cn(
          'flex min-h-[5rem] flex-1 flex-col gap-1 rounded-lg border border-transparent p-1',
          'transition-colors duration-150',
          isOver
            ? 'border-dashed border-[var(--chart-1)] bg-[var(--chart-1)]/[0.06]'
            : dragging
              ? 'border-dashed border-border bg-muted/40'
              : '',
        )}
      >
        {/* The whole card is the handle here - which is what everybody
            expects of a card on a board, and small enough that there is
            nowhere sensible to put a separate grip. */}
        <SortableContext items={items.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {items.map(todo => (
            <SortableTodoRow
              key={todo.id}
              todo={todo}
              actions={actions}
              groupKey={bucket.key}
              today={today}
              compact
              surface
            />
          ))}
        </SortableContext>

        {items.length === 0 && (
          <p className={cn(
            'px-2 py-4 text-center text-[11.5px] transition-colors',
            isOver ? 'text-[var(--chart-1)]'
              : dragging ? 'text-muted-foreground' : 'text-muted-foreground/40',
          )}>
            {dragging ? `Drop into ${bucket.label.toLowerCase()}` : 'Empty'}
          </p>
        )}
      </div>
    </div>
  );
}

export function BoardView({
  todos, actions, overBucket, dragging, onQuickAdd,
}: {
  todos: Todo[];
  actions: TodoRowActions;
  overBucket: BucketKey | null;
  dragging: boolean;
  onQuickAdd: (dueOn: string | null) => void;
}) {
  const today = todayISO();

  const byBucket = React.useMemo(() => {
    const map = new Map<BucketKey, Todo[]>();
    for (const b of BUCKETS) map.set(b.key, []);
    for (const t of todos) map.get(bucketOf(t, today))!.push(t);
    for (const items of map.values()) items.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [todos, today]);

  return (
    /*
      The right edge fades rather than being cut.

      Six columns do not fit a laptop, which is correct - the board is a wide
      instrument. What was wrong was that the fourth column simply stopped
      mid-card at the viewport edge with nothing to say more of it existed, so
      "Someday" was, for most readers, a column that did not exist.
    */
    <div className="group/board relative">
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {BUCKETS.map(bucket => (
          <BoardColumn
            key={bucket.key}
            bucket={bucket}
            items={byBucket.get(bucket.key) ?? []}
            actions={actions}
            isOver={overBucket === bucket.key}
            dragging={dragging}
            today={today}
            onAdd={onQuickAdd}
          />
        ))}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Schedule                                                                  */
/* -------------------------------------------------------------------------- */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const pad = first.getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One day in the month grid - and a drop target.
 *
 * ── Why these are dnd-kit droppables now ─────────────────────────────────
 *
 * They used to be native HTML5 drag targets, with `draggable` chips inside
 * `<button>` cells and a `text/todo-id` data transfer. The note beside them
 * said registering forty-two droppables cost more than the drag was worth.
 * It costs a `useDroppable` per cell and it buys three things the native API
 * cannot give at any price:
 *
 *   · **It works on a touch screen.** HTML5 drag-and-drop does not fire on
 *     iOS or Android at all, so on a phone the schedule was a calendar you
 *     could look at and not plan with.
 *   · **It works from the keyboard**, through the sensor the rest of this
 *     module already has.
 *   · **One drag model.** Two coexisting systems meant a card dragged from
 *     the day panel could not be dropped on the grid beside it, which reads
 *     as the feature being broken rather than as two implementations.
 */
function DayCell({
  iso, date, items, isToday, isSelected, isPast, isOutside, busiest, onSelect, onAdd,
}: {
  iso: string;
  date: Date;
  items: Todo[];
  isToday: boolean;
  isSelected: boolean;
  isPast: boolean;
  isOutside: boolean;
  busiest: number;
  onSelect: () => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${iso}` });
  const open = items.filter(t => !t.isDone);
  const done = items.length - open.length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative min-h-[5.75rem] border-b border-r border-border last:border-r-0',
        isOutside && 'bg-muted/25',
        isPast && !isOutside && 'bg-muted/[0.35]',
        isSelected && 'bg-accent/70',
        isOver && 'bg-[var(--chart-1)]/[0.09] ring-1 ring-inset ring-[var(--chart-1)]',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onAdd}
        aria-current={isToday ? 'date' : undefined}
        aria-label={`${formatDay(iso, { weekday: 'long', day: 'numeric', month: 'long' })}, ${open.length} open`}
        className="flex size-full flex-col items-stretch gap-1 p-1.5 text-left focus-visible:outline-none"
      >
        <span className="flex items-center gap-1.5">
          <span className={cn(
            'inline-flex size-[19px] items-center justify-center rounded-full text-[11.5px] font-medium tabular-nums',
            isToday
              ? 'bg-foreground text-background'
              : isSelected ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {date.getDate()}
          </span>
          {open.length > 0 && (
            <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground/70">
              {open.length}
            </span>
          )}
        </span>

        <span className="flex flex-1 flex-col gap-[3px]">
          {open.slice(0, 3).map(t => (
            <span
              key={t.id}
              title={t.title}
              className={cn(
                'flex items-center gap-1 truncate rounded-[3px] px-1 py-[1px] text-[10.5px] leading-[1.5]',
                isPast
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-foreground/[0.06] text-foreground/85',
              )}
            >
              {t.isStarred && <Star className="size-2 shrink-0 fill-warning text-warning" />}
              {t.recurrence && <Repeat className="size-2 shrink-0 opacity-60" />}
              <span className="truncate">{t.title}</span>
            </span>
          ))}
          {open.length > 3 && (
            <span className="pl-1 text-[10px] tabular-nums text-muted-foreground/70">
              +{open.length - 3} more
            </span>
          )}
          {open.length === 0 && done > 0 && (
            <span className="pl-1 text-[10px] text-muted-foreground/60">
              {done} done
            </span>
          )}
        </span>

        {/*
          The day's load, relative to the busiest day on screen.

          A month grid can only ever show three of a day's items, so without
          this the difference between a Tuesday with four and a Tuesday with
          eleven is one line of small grey text. This is the one thing a month
          view is genuinely good at - showing where the pressure is - and it is
          a ratio of two counts, not a score.
        */}
        {open.length > 0 && busiest > 0 && (
          <span
            aria-hidden="true"
            className="block h-[3px] w-full overflow-hidden rounded-full bg-border/70"
          >
            <span
              className={cn('block h-full rounded-full', isPast ? 'bg-destructive/70' : 'bg-foreground/45')}
              style={{ width: `${Math.max(12, (open.length / busiest) * 100)}%` }}
            />
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * A month of your own work, and the day you are planning.
 *
 * Deliberately not the Calendar module: that shows meetings, which are
 * commitments to other people at a time of day. This shows to-dos, which are
 * commitments to yourself on a day - the reason `due_on` is a `date` and not a
 * timestamp. Putting them on the same grid would suggest the two can be
 * compared, and "read the contract" does not occupy 2pm.
 *
 * Clicking a day opens it; dropping a to-do on a day reschedules it; the
 * gutter carries each week's total, because "next week has eleven things in
 * it" is a fact you cannot get by counting cells.
 */
export function ScheduleView({
  todos, actions, onQuickAdd,
}: {
  todos: Todo[];
  actions: TodoRowActions;
  onQuickAdd: (dueOn: string | null) => void;
}) {
  const today = todayISO();
  const [cursor, setCursor] = React.useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = React.useState<string>(today);

  const cells = React.useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  const byDay = React.useMemo(() => {
    const map = new Map<string, Todo[]>();
    for (const t of todos) {
      if (!t.dueOn) continue;
      if (!map.has(t.dueOn)) map.set(t.dueOn, []);
      map.get(t.dueOn)!.push(t);
    }
    return map;
  }, [todos]);

  /** The busiest day *on screen*, so the load bars compare like with like. */
  const busiest = React.useMemo(() => {
    let max = 0;
    for (const date of cells) {
      if (!date) continue;
      const n = (byDay.get(isoOf(date)) ?? []).filter(t => !t.isDone).length;
      if (n > max) max = n;
    }
    return max;
  }, [cells, byDay]);

  const weeks = React.useMemo(() => {
    const out: { cells: (Date | null)[]; open: number }[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const week = cells.slice(i, i + 7);
      const open = week.reduce((sum, date) => sum + (date
        ? (byDay.get(isoOf(date)) ?? []).filter(t => !t.isDone).length
        : 0), 0);
      out.push({ cells: week, open });
    }
    return out;
  }, [cells, byDay]);

  const undated = React.useMemo(() => todos.filter(t => !t.dueOn && !t.isDone), [todos]);
  const selectedItems = byDay.get(selected) ?? [];
  const monthOf = cursor.month;

  const step = (delta: number) => setCursor(c => {
    const d = new Date(c.year, c.month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const monthLabel = new Date(cursor.year, cursor.month, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[13.5px] font-semibold tracking-[-0.01em]">{monthLabel}</h3>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7" aria-label="Previous month" onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
              onClick={() => {
                const d = new Date();
                setCursor({ year: d.getFullYear(), month: d.getMonth() });
                setSelected(today);
              }}
            >
              Today
            </Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Next month" onClick={() => step(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          {/* A leading gutter column, matched by every week row below it. */}
          <div className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/50">
            <div aria-hidden="true" className="border-r border-border" />
            {DAY_NAMES.map(d => (
              <div key={d} className="px-2 py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {weeks.map((week, w) => (
            <div key={w} className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))]">
              {/*
                The week's own total. Six numbers down the left edge is the
                whole of "how is the month shaped", and it is the question a
                month view is asked more often than any other.
              */}
              <div className={cn(
                'flex items-start justify-center border-b border-r border-border pt-2 text-[11px] font-medium tabular-nums',
                week.open > 0 ? 'text-muted-foreground' : 'text-muted-foreground/35',
              )}>
                <span title={`${week.open} open this week`}>{week.open || '·'}</span>
              </div>

              {week.cells.map((date, i) => {
                if (!date) {
                  return <div key={i} className="min-h-[5.75rem] border-b border-r border-border bg-muted/25 last:border-r-0" />;
                }
                const iso = isoOf(date);
                return (
                  <DayCell
                    key={iso}
                    iso={iso}
                    date={date}
                    items={byDay.get(iso) ?? []}
                    isToday={iso === today}
                    isSelected={iso === selected}
                    isPast={iso < today}
                    isOutside={date.getMonth() !== monthOf}
                    busiest={busiest}
                    onSelect={() => setSelected(iso)}
                    onAdd={() => onQuickAdd(iso)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* The chosen day, in full. The grid can only ever show three per cell. */}
      <aside className="flex w-full shrink-0 flex-col gap-3 xl:w-[19rem]">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-[13.5px] font-semibold tracking-[-0.01em]">
              {selected === today ? 'Today' : formatDay(selected, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            <span className="text-[11.5px] tabular-nums text-muted-foreground">
              {selectedItems.filter(t => !t.isDone).length || 'nothing'}
              {selectedItems.filter(t => !t.isDone).length ? ' open' : ''}
            </span>
            <Button
              variant="ghost" size="sm"
              className="ml-auto h-7 gap-1 px-2 text-[12px]"
              onClick={() => onQuickAdd(selected)}
            >
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
          {selected === today && (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground/80">
              {formatDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          )}
        </div>

        {selectedItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-7 text-center text-[12px] text-muted-foreground">
            Nothing due.
            <span className="mt-1 block text-muted-foreground/70">
              Drag something here, or add it above.
            </span>
          </p>
        ) : (
          <SortableContext items={selectedItems.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="-mx-1 flex flex-col">
              {selectedItems.map(t => (
                <SortableTodoRow
                  key={t.id}
                  todo={t}
                  actions={actions}
                  today={today}
                  groupKey={selected === today ? 'today' : undefined}
                  compact
                />
              ))}
            </div>
          </SortableContext>
        )}

        {/*
          The backlog with no date on it, and the reason the schedule is a
          planning surface rather than a picture: this is the pile you pull
          from when you are deciding what next week looks like.
        */}
        {undated.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <div className="flex items-baseline gap-2 px-1">
              <Inbox className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" aria-hidden="true" />
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground/80">
                No date
              </h4>
              <span className="text-[11px] tabular-nums text-muted-foreground">{undated.length}</span>
              <span className="ml-auto text-[11px] text-muted-foreground/70">drag onto a day</span>
            </div>
            <SortableContext items={undated.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="-mx-1 flex flex-col">
                {undated.map(t => (
                  <SortableTodoRow
                    key={t.id}
                    todo={t}
                    actions={actions}
                    today={today}
                    groupKey="someday"
                    compact
                  />
                ))}
              </div>
            </SortableContext>
          </div>
        )}
      </aside>
    </div>
  );
}
