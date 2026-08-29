'use client';

import * as React from 'react';
import {
  Check, X, ArrowRight, Star, Repeat, PartyPopper, CalendarPlus, CornerDownRight,
  Bell, Pencil, Link2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RECURRENCE_LABELS } from '@/lib/todo-recurrence';
import {
  addDaysISO, dueLabel, focusOrder, originOf, originText, todayISO,
  type Todo, type TodoCounts, type TodoOrigin,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Focus - one thing at a time
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this is for ─────────────────────────────────────────────────────
 *
 *  A list is a planning tool. It is a poor *working* tool, because the whole
 *  point of a list is that it shows you everything, and everything is exactly
 *  what you do not want in front of you while doing one thing. The common
 *  outcome is somebody re-reading their twenty open items every few minutes
 *  and starting none of them.
 *
 *  So this shows one: the next thing, chosen for you, with what follows named
 *  underneath so the order is visible without being a decision. Tick it, defer
 *  it, or skip it, and the next one arrives.
 *
 *  ── Why it chooses rather than asks ──────────────────────────────────────
 *
 *  The ordering is opinionated - overdue, then today, starred first, then your
 *  own hand-ordering - and deliberately not configurable. A "what should I do
 *  now?" screen with a sort dropdown has handed the question back.
 *
 *  Skipping is per-session and never written down: it means "not this minute",
 *  which is not a fact about the to-do and has no business outliving the
 *  sitting. Deferring is written down, because "tomorrow" is.
 *
 *  ── Three things this pass fixed ─────────────────────────────────────────
 *
 *  1. **The queue is the day, not the backlog.** It used to march through
 *     every open item - a session with nine things due announced "24 to go"
 *     and carried on into *Someday*. Now it ends when today does, and offers
 *     to continue only once today is actually clear, which is a decision
 *     somebody makes having finished rather than one made for them at the
 *     start.
 *  2. **"Done today" was always zero.** It was counted from the rows on
 *     screen, and the view those rows come from excludes completed items by
 *     design - so the progress bar sat at 0% no matter how much work had been
 *     cleared. It reads the server's count now, the same one the day's readout
 *     uses.
 *  3. **It is composed rather than centred.** A card floating in the middle of
 *     a 900px void is not calm, it is empty. The session sits at the top, the
 *     item sits above the optical centre where a reader's eye already is, and
 *     what is coming sits under it.
 */
export function FocusMode({
  todos, counts, onToggle, onStar, onReschedule, onRemind, onOpenSource,
  onOpenDetails, onClose,
}: {
  todos: Todo[];
  counts: TodoCounts;
  onToggle: (todo: Todo) => void;
  onStar: (todo: Todo) => void;
  onReschedule: (todo: Todo, dueOn: string | null) => void;
  /** Snooze without moving the work. Absent where reminders are unavailable. */
  onRemind?: (todo: Todo, remindAt: string | null) => void;
  /** Open the record the item came from, where the module can receive it. */
  onOpenSource?: ((origin: TodoOrigin) => void) | null;
  /** Open the full item, without leaving the session. */
  onOpenDetails: (todo: Todo) => void;
  onClose: () => void;
}) {
  const today = todayISO();
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());
  /** Carried past the end of today, on request rather than by default. */
  const [scope, setScope] = React.useState<'today' | 'all'>('today');

  const queue = React.useMemo(
    () => focusOrder(todos, today, scope).filter(t => !skipped.has(t.id)),
    [todos, today, scope, skipped],
  );

  /** What is left after today, so the offer to continue is an honest number. */
  const beyondToday = React.useMemo(
    () => (scope === 'all' ? 0 : focusOrder(todos, today, 'all').length - focusOrder(todos, today, 'today').length),
    [todos, today, scope],
  );

  const current = queue[0] ?? null;
  const upNext = queue.slice(1, 4);

  const done = counts.doneToday;
  const owed = done + queue.length;
  const pct = owed === 0 ? 100 : Math.round((done / owed) * 100);

  /**
   * Escape closes; Space or Enter completes; S skips; T defers to tomorrow.
   * The keys somebody's hands are already on while they work.
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (!current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onToggle(current);
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSkipped(prev => new Set(prev).add(current.id));
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        onReschedule(current, addDaysISO(today, 1));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, onToggle, onReschedule, onClose, today]);

  const due = current ? dueLabel(current.dueOn, { today }) : null;
  const origin = current ? originOf(current) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      {/* ── The session, said once, at the top ─────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 md:px-6">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Focus</span>

        <span className="flex min-w-0 items-center gap-2.5 text-[12px] text-muted-foreground">
          <span className="hidden h-3 w-px bg-border sm:block" aria-hidden="true" />
          <span className="tabular-nums">
            <span className="font-medium text-foreground">{done}</span> done today
          </span>
          {queue.length > 0 && (
            <>
              <span className="text-muted-foreground/50" aria-hidden="true">·</span>
              <span className="tabular-nums">{queue.length} to go</span>
            </>
          )}
        </span>

        <span
          className="mx-auto hidden h-1 w-40 overflow-hidden rounded-full bg-border md:block lg:w-56"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Today's progress"
        >
          <span
            className="block h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-500 ease-[var(--ease-brand)]"
            style={{ width: `${pct}%` }}
          />
        </span>

        <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto gap-1.5 md:ml-0">
          <X className="size-4" /> Exit
          <kbd className="ml-1 hidden rounded border border-border px-1 text-[10px] text-muted-foreground sm:inline">Esc</kbd>
        </Button>
      </header>

      {/* Content sits a little above the optical centre - where a reader looks
          first. Dead-centre on a tall screen puts the one thing that matters
          below the eye's resting point; top-aligned leaves half a screen of
          nothing under it. The asymmetric padding is what buys the difference. */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-5 pb-24 pt-10 md:pb-40 md:pt-16">
        {!current ? (
          <div className="w-full max-w-sm text-center">
            <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-[var(--chart-1)]/12 text-[var(--chart-1)]">
              <PartyPopper className="size-6" />
            </div>
            <h2 className="text-[19px] font-semibold tracking-[-0.015em]">
              {done > 0 ? 'That is today, done' : 'Nothing waiting'}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {skipped.size > 0
                ? `You skipped ${skipped.size} item${skipped.size === 1 ? '' : 's'} this session.`
                : done > 0
                  ? `${done} cleared. Nothing else is owed today.`
                  : 'Nothing is due today, and nothing is overdue.'}
            </p>

            <div className="mt-6 flex flex-col items-center gap-2">
              {skipped.size > 0 && (
                <Button variant="outline" size="sm" onClick={() => setSkipped(new Set())}>
                  Bring the skipped ones back
                </Button>
              )}
              {/*
                The one place the queue is allowed to leave today - and it is
                offered rather than assumed, after the day is finished.
              */}
              {scope === 'today' && beyondToday > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setScope('all')}>
                  <CornerDownRight className="size-3.5" />
                  Carry on into what is scheduled next ({beyondToday})
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>Close focus</Button>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-2xl">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {due?.urgent ? 'Overdue · do this first' : 'Now'}
            </p>

            <div className="mt-4 flex items-start gap-4">
              <h1 className="flex-1 text-[26px] font-semibold leading-[1.25] tracking-[-0.02em] md:text-[32px]">
                {current.title}
              </h1>
              <button
                type="button"
                aria-label={current.isStarred ? 'Remove star' : 'Star this'}
                aria-pressed={current.isStarred}
                onClick={() => onStar(current)}
                className={cn(
                  'mt-1.5 shrink-0 rounded p-1 transition',
                  current.isStarred ? 'text-warning' : 'text-muted-foreground/40 hover:text-warning',
                )}
              >
                <Star className={cn('size-5', current.isStarred && 'fill-current')} />
              </button>
            </div>

            {current.note && (
              <p className="mt-3 max-w-xl whitespace-pre-wrap text-[14px] leading-relaxed text-muted-foreground">
                {current.note}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
              {due && (
                <span className={cn(due.tone, due.urgent && 'font-medium')}>{due.text}</span>
              )}
              {current.recurrence && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Repeat className="size-3.5" /> {RECURRENCE_LABELS[current.recurrence]}
                </span>
              )}
              {current.list && (
                <span className="text-muted-foreground">{current.list.name}</span>
              )}

              {/*
                Where the work came from, and a way to it.

                The single most common reason somebody breaks out of a focus
                session is that they need to look at the thing the item is
                about - the ticket, the deal, the task. Naming it was already
                half of that; opening it is the other half, and it costs one
                control that is only drawn when the module can receive it.
              */}
              {origin && (
                onOpenSource && origin.opens ? (
                  <button
                    type="button"
                    onClick={() => onOpenSource(origin)}
                    className="flex items-center gap-1.5 rounded text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    <Link2 className="size-3.5" />
                    {originText(origin)}
                    {origin.status === 'done' && (
                      <span className="text-[11px] text-[var(--chart-1)]">· already done there</span>
                    )}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Link2 className="size-3.5" /> {originText(origin)}
                  </span>
                )
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-6">
              <Button
                onClick={() => onToggle(current)}
                className="gap-1.5 bg-[var(--chart-1)] text-white hover:bg-[var(--chart-1)]/90"
              >
                <Check className="size-4" /> Done
                <kbd className="ml-1 rounded border border-white/30 px-1 text-[10px]">Space</kbd>
              </Button>

              {/*
                Deferring is the honest second option, and it was missing.
                "Not now" without it means a person working through a list has
                one way to get an item off the screen and no way to say when
                they will actually do it - so it comes back tomorrow anyway,
                unmoved and now a day later.
              */}
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => onReschedule(current, addDaysISO(today, 1))}
              >
                <CalendarPlus className="size-4" /> Tomorrow
                <kbd className="ml-1 rounded border border-border px-1 text-[10px] text-muted-foreground">T</kbd>
              </Button>

              <Button
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                onClick={() => setSkipped(prev => new Set(prev).add(current.id))}
                disabled={queue.length < 2}
              >
                <ArrowRight className="size-4" /> Not now
                <kbd className="ml-1 rounded border border-border px-1 text-[10px]">S</kbd>
              </Button>

              {/*
                ── Snooze, and how it differs from the two beside it ────────

                *Tomorrow* moves the work. *Not now* moves your attention, and
                only for this sitting. Neither one says "come back to me at
                three", which is the thing somebody in the middle of a
                focused hour most often actually means - so this sets a
                reminder without touching the plan, and the item stays exactly
                where it was on the list.

                One offset, not a menu. A focus session is the wrong place to
                make a scheduling decision, and "an hour" is the answer nearly
                every time it is asked here.
              */}
              {onRemind && (
                <Button
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => {
                    const at = new Date();
                    at.setHours(at.getHours() + 1, at.getMinutes(), 0, 0);
                    onRemind(current, at.toISOString());
                  }}
                  title="Keep it where it is, and remind me in an hour"
                >
                  <Bell className="size-4" /> Snooze an hour
                </Button>
              )}

              {/*
                The details, without leaving.

                A person working through a queue reaches the item whose note
                they need to read or whose date they need to change, and until
                now the only way to do either was to leave the session and find
                it again in the list.
              */}
              {/*
                No `ml-auto`. Pushed to the far end it was the one control
                that wrapped to a line of its own and sat there orphaned; the
                five actions read as one set, and a set should look like one.
              */}
              <Button
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                onClick={() => onOpenDetails(current)}
              >
                <Pencil className="size-4" /> Open details
              </Button>
            </div>

            {/*
              What is coming, named but not actionable. Knowing what is next is
              what stops somebody breaking focus to go and check - three of
              them rather than one, because "and then?" is asked twice.
            */}
            {upNext.length > 0 && (
              <div className="mt-8">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  Up next
                </p>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {upNext.map((t, i) => (
                    <li key={t.id} className="flex items-baseline gap-3 text-[13px] text-muted-foreground">
                      <span className="w-3 shrink-0 tabular-nums text-[11px] text-muted-foreground/50">
                        {i + 2}
                      </span>
                      <span className="truncate">{t.title}</span>
                      {t.isStarred && <Star className="size-3 shrink-0 translate-y-0.5 fill-warning text-warning" />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
