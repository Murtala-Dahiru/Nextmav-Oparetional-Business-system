'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Star, Trash2, CalendarDays, Link2, MoreHorizontal, Pencil, GripVertical,
  Repeat, FolderKanban,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { RECURRENCE_LABELS } from '@/lib/todo-recurrence';
import { LIST_COLORS, dueLabel, type Todo } from './types';

export interface TodoRowActions {
  onToggle: (todo: Todo) => void;
  onStar: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onConvert: (todo: Todo) => void;
}

interface TodoRowProps {
  todo: Todo;
  actions: TodoRowActions;
  /** Highlighted by keyboard navigation. */
  selected?: boolean;
  /** The board's narrower cards drop the note and the list chip. */
  compact?: boolean;
}

/**
 * One to-do.
 *
 * Shared by the list, the board and the schedule so a to-do looks and behaves
 * identically wherever it is seen — the alternative is three renderings that
 * drift, and the board quietly losing the star, or the repeat badge.
 *
 * ── Why the drag hook is not in here ─────────────────────────────────────
 *
 * `useSortable` is a hook, so a component that calls it can never be rendered
 * outside a `SortableContext` — and the schedule's day panel is exactly that:
 * a plain list of one day's work, with no ordering to change. Splitting the
 * presentation from the drag wiring is what lets the same row appear in all
 * three places without one of them registering a sortable it does not have a
 * context for.
 */
export function TodoRow({
  todo, actions, selected, compact = false,
  innerRef, style, dragProps, showHandle = false, isDragging = false,
}: TodoRowProps & {
  innerRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
  /**
   * Attributes and listeners from `useSortable`.
   *
   * Placed on the grip when there is one and on the whole card when there is
   * not — a board card with no handle and no listeners looks draggable and
   * cannot be dragged, which is exactly how this was wrong the first time.
   */
  dragProps?: React.HTMLAttributes<HTMLElement>;
  showHandle?: boolean;
  isDragging?: boolean;
}) {
  const due = dueLabel(todo.dueOn);
  const cardDrag = dragProps && !showHandle ? dragProps : undefined;

  return (
    <div
      ref={innerRef}
      style={style}
      data-todo-id={todo.id}
      {...cardDrag}
      className={cn(
        'group relative flex items-start gap-2 rounded-lg border bg-card px-2 py-2.5 transition-colors',
        'hover:border-emerald-500/40',
        selected && 'border-emerald-500/70 ring-1 ring-emerald-500/30',
        // Lifted out of the flow while dragging so the gap it leaves reads as
        // "this is where it will land" rather than as a rendering glitch.
        isDragging && 'z-10 opacity-90 shadow-lg',
        cardDrag && 'cursor-grab touch-none active:cursor-grabbing',
        todo.isDone && 'opacity-60',
      )}
    >
      {showHandle && (
        <button
          type="button"
          {...dragProps}
          aria-label={`Reorder ${todo.title}`}
          className={cn(
            'mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-transparent transition',
            'hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-none',
            'group-hover:text-muted-foreground/50 active:cursor-grabbing',
          )}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}

      <Checkbox
        checked={todo.isDone}
        onCheckedChange={() => actions.onToggle(todo)}
        className="mt-0.5 shrink-0"
        aria-label={todo.isDone ? `Mark ${todo.title} as not done` : `Mark ${todo.title} as done`}
      />

      <button
        type="button"
        onClick={() => actions.onEdit(todo)}
        className="min-w-0 flex-1 text-left focus-visible:outline-none"
      >
        <p className={cn(
          'text-sm leading-snug',
          todo.isDone ? 'text-muted-foreground line-through' : 'text-foreground',
        )}>
          {todo.title}
        </p>

        {todo.note && !compact && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{todo.note}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 empty:mt-0">
          {due && !todo.isDone && (
            <span className={cn('flex items-center gap-1 text-[11px]', due.tone)}>
              <CalendarDays className="size-3" /> {due.text}
            </span>
          )}

          {todo.recurrence && (
            <span
              className="flex items-center gap-1 text-[11px] text-muted-foreground"
              title={RECURRENCE_LABELS[todo.recurrence]}
            >
              <Repeat className="size-3" /> {RECURRENCE_LABELS[todo.recurrence]}
            </span>
          )}

          {todo.list && !compact && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', LIST_COLORS[todo.list.color] ?? LIST_COLORS.slate)} />
              {todo.list.name}
            </span>
          )}

          {/*
            The linked task, shown as provenance rather than as something
            editable here. Changing the task is done in Projects, which is
            where the team can see it.
          */}
          {todo.linkedTask && (
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
              <Link2 className="size-2.5" />
              {todo.linkedTask.project?.name ?? 'Task'}
            </Badge>
          )}
        </div>
      </button>

      <button
        type="button"
        aria-label={todo.isStarred ? `Remove star from ${todo.title}` : `Star ${todo.title}`}
        aria-pressed={todo.isStarred}
        onClick={() => actions.onStar(todo)}
        className="shrink-0 rounded p-1 text-muted-foreground/40 transition hover:text-amber-500"
      >
        <Star className={cn('size-4', todo.isStarred && 'fill-amber-400 text-amber-400')} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost" size="icon"
            aria-label={`More actions for ${todo.title}`}
            className="size-7 shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.onEdit(todo)}>
            <Pencil className="mr-2 size-4" /> Edit
          </DropdownMenuItem>
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
 * is small enough that the whole card is the handle — which is what everybody
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
