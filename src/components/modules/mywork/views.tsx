'use client';

import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronLeft, ChevronRight, Plus, Star, Repeat } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { SortableTodoRow, TodoRow, type TodoRowActions } from './todo-row';
import {
  BUCKETS, bucketOf, todayISO, addDaysISO, type BucketKey, type Todo,
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
 * The obvious alternative — to do / doing / done — would mean inventing a
 * status on a table that deliberately has none. That vocabulary belongs to
 * Projects, where a status is a statement to colleagues about work they are
 * waiting on. On a private list there is nobody to tell, so a "doing" column
 * is a lie you keep for yourself, and the honest thing a person actually moves
 * their own to-dos between is days.
 *
 * The dividend is that every drag writes `due_on`, a column that already
 * exists and already means this — no new state, no migration, and the board
 * and the list group by exactly the same rule.
 */
function BoardColumn({
  bucket, items, actions, isOver,
}: {
  bucket: (typeof BUCKETS)[number];
  items: Todo[];
  actions: TodoRowActions;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `bucket:${bucket.key}` });
  const Icon = bucket.icon;

  return (
    <div className="flex w-[17rem] shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Icon className={cn('size-3.5', bucket.tone)} />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {bucket.label}
        </h3>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {items.length || ''}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[8rem] flex-1 flex-col gap-1.5 rounded-lg border border-dashed p-1.5 transition-colors',
          isOver ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-transparent bg-muted/30',
        )}
      >
        {/* The whole card is the handle here — which is what everybody
            expects of a card on a board, and small enough that there is
            nowhere sensible to put a separate grip. */}
        <SortableContext items={items.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {items.map(todo => (
            <SortableTodoRow key={todo.id} todo={todo} actions={actions} compact />
          ))}
        </SortableContext>

        {items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground/60">
            Drop here to move it to {bucket.label.toLowerCase()}
          </p>
        )}
      </div>
    </div>
  );
}

export function BoardView({
  todos, actions, overBucket,
}: {
  todos: Todo[];
  actions: TodoRowActions;
  overBucket: BucketKey | null;
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
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {BUCKETS.map(bucket => (
        <BoardColumn
          key={bucket.key}
          bucket={bucket}
          items={byBucket.get(bucket.key) ?? []}
          actions={actions}
          isOver={overBucket === bucket.key}
        />
      ))}
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
 * A month of your own work.
 *
 * Deliberately not the Calendar module: that shows meetings, which are
 * commitments to other people at a time of day. This shows to-dos, which are
 * commitments to yourself on a day — the reason `due_on` is a `date` and not a
 * timestamp. Putting them on the same grid would suggest the two can be
 * compared, and "read the contract" does not occupy 2pm.
 *
 * Clicking a day adds to it; dropping a to-do on a day reschedules it.
 */
export function ScheduleView({
  todos, actions, onQuickAdd, onReschedule,
}: {
  todos: Todo[];
  actions: TodoRowActions;
  onQuickAdd: (dueOn: string) => void;
  onReschedule: (todo: Todo, dueOn: string) => void;
}) {
  const today = todayISO();
  const [cursor, setCursor] = React.useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = React.useState<string>(today);
  const [dragOver, setDragOver] = React.useState<string | null>(null);

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

  const undated = React.useMemo(() => todos.filter(t => !t.dueOn), [todos]);
  const selectedItems = byDay.get(selected) ?? [];

  const step = (delta: number) => setCursor(c => {
    const d = new Date(c.year, c.month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const monthLabel = new Date(cursor.year, cursor.month, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{monthLabel}</h3>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7" aria-label="Previous month" onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 px-2 text-xs"
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

        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-7 border-b bg-muted/50">
            {DAY_NAMES.map(d => (
              <div key={d} className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((date, i) => {
              if (!date) return <div key={i} className="min-h-[5.5rem] border-b border-r bg-muted/20 last:border-r-0" />;

              const iso = isoOf(date);
              const items = byDay.get(iso) ?? [];
              const open = items.filter(t => !t.isDone);
              const isToday = iso === today;
              const isSelected = iso === selected;
              const isPast = iso < today;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(iso)}
                  onDoubleClick={() => onQuickAdd(iso)}
                  // A native drop target rather than a dnd-kit droppable: the
                  // month grid is 42 cells, and registering that many
                  // droppables costs more than the drag is worth.
                  onDragOver={e => { e.preventDefault(); setDragOver(iso); }}
                  onDragLeave={() => setDragOver(d => (d === iso ? null : d))}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = e.dataTransfer.getData('text/todo-id');
                    const todo = todos.find(t => t.id === id);
                    if (todo) onReschedule(todo, iso);
                  }}
                  className={cn(
                    'min-h-[5.5rem] border-b border-r p-1 text-left align-top transition-colors last:border-r-0',
                    'hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none',
                    isSelected && 'bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/40',
                    dragOver === iso && 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500',
                    isPast && 'bg-muted/10',
                  )}
                >
                  <span className={cn(
                    'inline-flex size-5 items-center justify-center rounded-full text-xs font-medium',
                    isToday ? 'bg-emerald-500 text-white' : 'text-muted-foreground',
                  )}>
                    {date.getDate()}
                  </span>

                  <div className="mt-0.5 space-y-0.5">
                    {open.slice(0, 2).map(t => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={e => e.dataTransfer.setData('text/todo-id', t.id)}
                        className={cn(
                          'flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight',
                          isPast ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                        )}
                      >
                        {t.isStarred && <Star className="size-2 shrink-0 fill-current" />}
                        {t.recurrence && <Repeat className="size-2 shrink-0" />}
                        <span className="truncate">{t.title}</span>
                      </div>
                    ))}
                    {open.length > 2 && (
                      <span className="pl-1 text-[10px] text-muted-foreground">+{open.length - 2} more</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* The chosen day, in full. The grid can only ever show two per cell. */}
      <aside className="flex w-full shrink-0 flex-col gap-2 xl:w-80">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            {selected === today ? 'Today' : formatDate(selected, { weekday: 'long', month: 'short', day: 'numeric' })}
          </h3>
          <Button
            variant="ghost" size="sm"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            onClick={() => onQuickAdd(selected)}
          >
            <Plus className="size-3.5" /> Add
          </Button>
        </div>

        {/*
          Plain rows, not sortable: a single day's work has no ordering to
          change, and rescheduling here is done by dragging onto the grid
          rather than within this panel.
        */}
        {selectedItems.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            Nothing due on this day.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {selectedItems.map(t => (
              <TodoRow key={t.id} todo={t} actions={actions} compact />
            ))}
          </div>
        )}

        {undated.length > 0 && (
          <>
            <h4 className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              No date · drag onto a day
            </h4>
            <div className="flex flex-col gap-1">
              {undated.slice(0, 8).map(t => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/todo-id', t.id)}
                  className="cursor-grab truncate rounded border bg-card px-2 py-1.5 text-xs active:cursor-grabbing"
                >
                  {t.title}
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
