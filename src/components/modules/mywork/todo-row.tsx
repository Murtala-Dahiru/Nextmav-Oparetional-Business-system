'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Star, Trash2, Link2, MoreHorizontal, Pencil, GripVertical, Repeat,
  FolderKanban, CalendarPlus, Bell, BellOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { RECURRENCE_LABELS } from '@/lib/todo-recurrence';
import {
  LIST_COLORS, addDaysISO, completedLabel, dueLabel, originOf, originText,
  reminderLabel, todayISO,
  type BucketKey, type Todo, type TodoOrigin,
} from './types';

/**
 * The two reminder times a row offers, resolved in the reader's own clock.
 *
 * Local rather than UTC on purpose: "nine in the morning" is a fact about
 * where the person is, and a reminder computed against the server's midnight
 * arrives at breakfast for one colleague and at bedtime for another.
 */
function inAnHour(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, d.getMinutes(), 0, 0);
  return d.toISOString();
}

function tomorrowMorning(today: string): string {
  const d = new Date(`${addDaysISO(today, 1)}T00:00:00`);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export interface TodoRowActions {
  onToggle: (todo: Todo) => void;
  onStar: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onConvert: (todo: Todo) => void;
  /** Move to a day. Powers the row menu's "tomorrow / next week". */
  onReschedule: (todo: Todo, dueOn: string | null) => void;
  /**
   * Open the record this to-do came from, wherever it lives. Null when the
   * role cannot reach that module, which is why the chip asks before drawing
   * itself as a control.
   */
  onOpenSource?: ((origin: TodoOrigin) => void) | null;
  /** Set or clear the reminder. Powers the row menu's snooze.  */
  onRemind?: (todo: Todo, remindAt: string | null) => void;
}

interface TodoRowProps {
  todo: Todo;
  actions: TodoRowActions;
  /** Highlighted by keyboard navigation. */
  selected?: boolean;
  /**
   * A narrow column: a board card, a schedule panel.
   *
   * The title wraps instead of truncating and the meta drops underneath it
   * rather than being right-aligned beside it. Right-aligning a date against
   * a 300px panel leaves about eight characters for the title, which is how
   * the schedule's day panel came to read "Call the client back ab…".
   */
  compact?: boolean;
  /** The group this row is sitting under, so it does not repeat its heading. */
  groupKey?: BucketKey;
  /** That group's printed label, for the same reason on the Completed view. */
  groupLabel?: string;
  today?: string;
  /**
   * Draw the row on its own surface.
   *
   * The list is a list and needs no boxes. A board column is a stack of things
   * you pick up and move, and an object you can pick up has to look like one -
   * so a board card gets a hairline and a card fill, and nothing else does.
   */
  surface?: boolean;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  One to-do
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared by the list, the board and the schedule so a to-do looks and behaves
 * identically wherever it is seen - the alternative is three renderings that
 * drift, and the board quietly losing the star, or the repeat badge.
 *
 * ── Why this stopped being a card ─────────────────────────────────────────
 *
 * It was a bordered, rounded, 78px card with the title on one line, the note
 * on a second and a metadata strip on a third. Twenty-four of them made a
 * field of identical floating boxes - the exact failure `primitives.tsx`
 * describes for the dashboard - and six of them filled a laptop screen. A
 * personal list whose whole job is *scanning* was showing a quarter of itself
 * at a time, and the border around every single item said "these are all
 * equally important", which is the one thing a to-do list must not say.
 *
 * A row instead: no border, no surface, one line of 13.5px with the meta
 * right-aligned so the dates form a straight edge down the page, and the note
 * on a second line only when there is one. Twenty rows now fit where six did,
 * hover paints the row, and the only marks left are the ones that carry
 * meaning.
 *
 * ── Two colours, and what they cost ──────────────────────────────────────
 *
 * Late is `--destructive`; starred is `--warning`, the palette's warm ochre
 * rather than Tailwind's `amber-400`, which is a framework yellow that sits
 * outside this product's warm ramp and shouted louder than the overdue mark
 * next to it. Nothing else on the row is coloured - the list dot is a 6px
 * neutral-weighted mark, because a list is filing, not urgency.
 *
 * ── Why the drag hook is not in here ─────────────────────────────────────
 *
 * `useSortable` is a hook, so a component that calls it can never be rendered
 * outside a `SortableContext` - and the schedule's day panel is exactly that:
 * a plain list of one day's work, with no ordering to change. Splitting the
 * presentation from the drag wiring is what lets the same row appear in all
 * three places without one of them registering a sortable it has no context
 * for.
 */
export function TodoRow({
  todo, actions, selected, compact = false, groupKey, groupLabel, today,
  surface = false,
  innerRef, style, dragProps, showHandle = false, isDragging = false,
}: TodoRowProps & {
  innerRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
  /**
   * Attributes and listeners from `useSortable`.
   *
   * Placed on the grip when there is one and on the whole card when there is
   * not - a board card with no handle and no listeners looks draggable and
   * cannot be dragged, which is exactly how this was wrong the first time.
   */
  dragProps?: React.HTMLAttributes<HTMLElement>;
  showHandle?: boolean;
  isDragging?: boolean;
}) {
  const day = today ?? todayISO();
  const due = todo.isDone ? null : dueLabel(todo.dueOn, { today: day, groupKey });
  const cardDrag = dragProps && !showHandle ? dragProps : undefined;

  /**
   * A finished item says when it was finished, not when it had been due.
   *
   * A due date on a completed row is an obligation that no longer exists, and
   * the Completed view's only real question is "when did I do this?".
   */
  const finishedOn = todo.isDone ? completedLabel(todo.completedAt, day) : null;
  const finished = finishedOn === groupLabel ? null : finishedOn;

  const origin = originOf(todo);
  const reminder = todo.isDone ? null : reminderLabel(todo.remindAt, day);

  const meta = (
    <>
      {finished && (
        <span className="shrink-0 tabular-nums text-muted-foreground/85">{finished}</span>
      )}

      {due && (
        <span className={cn('shrink-0 tabular-nums', due.tone, due.urgent && 'font-medium')}>
          {due.text}
        </span>
      )}

      {/* Named where there is room, and an icon with a label where there is
          not: "Every weekday" is the reason a row keeps coming back, and a
          bare glyph makes the reader hover to find that out. */}
      {todo.recurrence && (
        <span
          className="flex shrink-0 items-center gap-1.5 text-muted-foreground/85"
          title={RECURRENCE_LABELS[todo.recurrence]}
          aria-label={RECURRENCE_LABELS[todo.recurrence]}
        >
          <Repeat className="size-3 shrink-0" />
          {!compact && <span>{RECURRENCE_LABELS[todo.recurrence]}</span>}
        </span>
      )}

      {/*
        The reminder.

        Only while it is still coming. Once the sweep has delivered it the
        mark has done its job, and a bell left on a row long after the fact is
        one more thing to read that says nothing - the notification is in the
        tray, and the due date is on the row beside it.
      */}
      {reminder && !reminder.sent && (
        <span
          className="flex shrink-0 items-center gap-1.5 text-muted-foreground/85"
          title={`Reminder ${reminder.text}`}
        >
          <Bell className="size-3 shrink-0" />
          <span className="tabular-nums">{reminder.text}</span>
        </span>
      )}

      {todo.list && (
        <span className="flex min-w-0 shrink items-center gap-1.5 text-muted-foreground/85">
          <span className={cn('size-1.5 shrink-0 rounded-full', LIST_COLORS[todo.list.color] ?? LIST_COLORS.slate)} />
          <span className="truncate">{todo.list.name}</span>
        </span>
      )}

      {/*
        Where the work came from.

        Two mechanisms carry it - a real foreign key for a project task, a
        polymorphic reference for a ticket, a deal, a message - and `originOf`
        resolves them into one answer, so a row never has to know which kind it
        is looking at. Migration 0026's CHECK is what guarantees they agree.

        It was an inert outline badge naming the project. The id it holds is
        exactly what `openRecord` wants and several modules already receive
        one, so the thing a reader actually wants from this mark - "what *is*
        that, and how is it doing?" - cost nothing to give. Editing still
        happens where the record lives, which is where colleagues can see it.
      */}
      {origin && (
        origin.opens && actions.onOpenSource ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); actions.onOpenSource!(origin); }}
            title={`Open this ${origin.noun.toLowerCase()} where it lives`}
            className="flex min-w-0 shrink items-center gap-1 rounded text-muted-foreground/85 underline-offset-2 hover:text-foreground hover:underline"
          >
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">{originText(origin)}</span>
          </button>
        ) : (
          <span
            className="flex min-w-0 shrink items-center gap-1 text-muted-foreground/85"
            title={originText(origin)}
          >
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">{originText(origin)}</span>
          </span>
        )
      )}
    </>
  );

  return (
    <div
      ref={innerRef}
      style={style}
      data-todo-id={todo.id}
      {...cardDrag}
      className={cn(
        'group/row relative flex items-start gap-2 rounded-md py-[7px] pl-1 pr-1 transition-colors',
        surface
          ? 'border border-border/70 bg-card px-1.5 shadow-e1 hover:border-border'
          : 'hover:bg-accent/60',
        selected && (surface ? 'border-foreground/25' : 'bg-accent'),
        // Lifted onto a surface while dragging, so the gap it leaves behind
        // reads as "this is where it will land" rather than as a glitch.
        isDragging && 'z-10 rounded-md border border-border bg-card opacity-95 shadow-e2',
        cardDrag && 'cursor-grab touch-none active:cursor-grabbing',
        compact && 'py-1.5',
      )}
    >
      {/* The keyboard cursor, as a position rather than a ring: a 2px edge is
          findable from across the page and costs no horizontal space. */}
      {selected && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-foreground/70"
        />
      )}

      {showHandle && (
        <button
          type="button"
          {...dragProps}
          aria-label={`Reorder ${todo.title}`}
          className={cn(
            'mt-[3px] -ml-0.5 hidden shrink-0 cursor-grab touch-none rounded text-transparent transition sm:block',
            'hover:text-muted-foreground focus-visible:text-muted-foreground',
            'group-hover/row:text-muted-foreground/40 active:cursor-grabbing',
          )}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}

      <Checkbox
        checked={todo.isDone}
        onCheckedChange={() => actions.onToggle(todo)}
        // Round, and brand-filled when ticked. This is the one moment of
        // colour the screen earns: it is 16px, it happens once per item, and
        // the row leaves the default view a second later.
        className={cn(
          'mt-[3px] size-[17px] shrink-0 rounded-full border-input/90',
          'data-[state=checked]:border-[var(--chart-1)] data-[state=checked]:bg-[var(--chart-1)]',
          'data-[state=checked]:text-white dark:data-[state=checked]:bg-[var(--chart-1)]',
          'hover:border-foreground/45',
        )}
        aria-label={todo.isDone ? `Mark ${todo.title} as not done` : `Mark ${todo.title} as done`}
      />

      {/*
        Wide: title and meta on one line, meta right-aligned, so a column of
        dates makes one straight edge - the same rule the dashboard's tables
        follow. Narrow (a board card, a schedule chip): the meta drops
        underneath, because a 16rem column cannot hold both and truncating a
        to-do's title to fit a date beside it loses the only part that matters.

        ── Why the meta is a sibling of the button and not inside it ────────

        Because one of its marks became a control. The origin chip opens the
        ticket or the task the item came from, and a `<button>` inside a
        `<button>` is invalid HTML: React reported it as a hydration error, and
        browsers resolve the nesting by closing the outer element early, which
        would have left the chip outside the row's own click target in some
        engines and inside it in others.
      */}
      <div className={cn(
        'flex min-w-0 flex-1 gap-x-3',
        compact ? 'flex-col gap-y-1' : 'items-baseline',
      )}>
        <button
          type="button"
          onClick={() => actions.onEdit(todo)}
          className="min-w-0 flex-1 text-left focus-visible:outline-none"
        >
          {/*
            Wrapping to two lines below `sm`, truncating above it.

            A 358px phone row minus a checkbox, a date, a list name and a star
            leaves about twenty characters for the title, and truncating there
            produced rows reading "Chase the signed ND…" - the one part of a
            to-do that has to survive. Wrapping costs a line on the few rows
            that need it and loses nothing.
          */}
          <span className={cn(
            'block text-[13.5px] leading-[1.45]',
            compact ? 'line-clamp-2' : 'line-clamp-2 sm:truncate',
            todo.isDone ? 'text-muted-foreground line-through' : 'text-foreground',
          )}>
            {todo.title}
          </span>

          {todo.note && !compact && (
            <span className="mt-0.5 block truncate text-[12px] leading-snug text-muted-foreground/80">
              {todo.note}
            </span>
          )}
        </button>

        <span className={cn(
          'flex items-center gap-2.5 text-[11.5px] leading-[1.45] empty:hidden',
          compact ? 'flex-wrap' : 'shrink-0',
        )}>
          {meta}
        </span>
      </div>

      <button
        type="button"
        aria-label={todo.isStarred ? `Remove star from ${todo.title}` : `Star ${todo.title}`}
        aria-pressed={todo.isStarred}
        onClick={() => actions.onStar(todo)}
        className={cn(
          'mt-px shrink-0 rounded p-0.5 transition',
          // Unstarred stars are hidden until the row is touched: twenty-four
          // grey outlines down the right of the page is a column of noise
          // that means nothing, and it drowns the four that do.
          todo.isStarred
            ? 'text-warning'
            : 'text-muted-foreground/45 opacity-0 hover:text-warning focus-visible:opacity-100 group-hover/row:opacity-100',
        )}
      >
        <Star className={cn('size-[15px]', todo.isStarred && 'fill-current')} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost" size="icon"
            aria-label={`More actions for ${todo.title}`}
            className="mt-px size-5 shrink-0 rounded text-muted-foreground/60 opacity-0 transition hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => actions.onEdit(todo)}>
            <Pencil className="mr-2 size-4" /> Edit
            <span className="ml-auto text-[11px] text-muted-foreground">E</span>
          </DropdownMenuItem>

          {/*
            The two reschedules people actually reach for, on the row rather
            than behind the edit dialog. Slipping something to tomorrow is the
            most common thing anybody does to a to-do, and it was three clicks
            and a form.
          */}
          {!todo.isDone && (
            <>
              {todo.dueOn !== day && (
                <DropdownMenuItem onClick={() => actions.onReschedule(todo, day)}>
                  <CalendarPlus className="mr-2 size-4" /> Move to today
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => actions.onReschedule(todo, addDaysISO(day, 1))}>
                <CalendarPlus className="mr-2 size-4" /> Move to tomorrow
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onReschedule(todo, addDaysISO(day, 7))}>
                <CalendarPlus className="mr-2 size-4" /> Move to next week
              </DropdownMenuItem>
              {/* Clearing the date is refused for a repeating item - the
                  database constraint says a repeat needs a day to repeat
                  from - so the control that would fail is simply not there. */}
              {todo.dueOn && !todo.recurrence && (
                <DropdownMenuItem onClick={() => actions.onReschedule(todo, null)}>
                  <CalendarPlus className="mr-2 size-4" /> Remove the date
                </DropdownMenuItem>
              )}
            </>
          )}

          {/*
            The reminder, on the row.

            Two entries, not a submenu of six: "tomorrow morning" and "in an
            hour" are what people actually reach for from a list, and anything
            more considered is a decision worth opening the item for. The third
            entry only appears when there is something to clear.
          */}
          {!todo.isDone && actions.onRemind && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions.onRemind!(todo, inAnHour())}>
                <Bell className="mr-2 size-4" /> Remind me in an hour
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onRemind!(todo, tomorrowMorning(day))}>
                <Bell className="mr-2 size-4" /> Remind me tomorrow, 9:00
              </DropdownMenuItem>
              {todo.remindAt && (
                <DropdownMenuItem onClick={() => actions.onRemind!(todo, null)}>
                  <BellOff className="mr-2 size-4" /> Clear the reminder
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          {/*
            Only offered when there is nothing linked yet. A to-do that already
            points at a task has been promoted once, and offering it again is
            offering to create a duplicate the team would have to reconcile.
          */}
          {!todo.linkedTaskId && (
            <DropdownMenuItem onClick={() => actions.onConvert(todo)}>
              <FolderKanban className="mr-2 size-4" /> Make it a project task
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => actions.onDelete(todo)}
          >
            <Trash2 className="mr-2 size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The same row, wired for dragging.
 *
 * `showHandle` decides where the drag lives: the list gives each row a grip so
 * a pointer can still select text and press buttons freely, while a board card
 * is small enough that the whole card is the handle - which is what everybody
 * expects of a card on a board.
 */
export function SortableTodoRow(props: TodoRowProps & { showHandle?: boolean }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: props.todo.id });

  return (
    <TodoRow
      {...props}
      innerRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      dragProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLElement>}
      isDragging={isDragging}
    />
  );
}
