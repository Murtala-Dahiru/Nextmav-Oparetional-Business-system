'use client';

import * as React from 'react';
import {
  Check, X, ArrowRight, Star, CalendarDays, Repeat, PartyPopper, Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { RECURRENCE_LABELS } from '@/lib/todo-recurrence';
import { dueLabel, focusOrder, todayISO, type Todo } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Focus — one thing at a time
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
 *  So this shows one: the next thing, chosen for you, with the one after it
 *  named underneath so the order is visible without being a decision. Tick it
 *  or skip it, and the next one arrives.
 *
 *  ── Why it chooses rather than asks ──────────────────────────────────────
 *
 *  The ordering is opinionated — overdue, then today, starred first, then your
 *  own hand-ordering — and deliberately not configurable. A "what should I do
 *  now?" screen with a sort dropdown has handed the question back.
 *
 *  Skipping is per-session and never written down: it means "not this minute",
 *  which is not a fact about the to-do and has no business outliving the
 *  sitting.
 */
export function FocusMode({
  todos, onToggle, onStar, onClose,
}: {
  todos: Todo[];
  onToggle: (todo: Todo) => void;
  onStar: (todo: Todo) => void;
  onClose: () => void;
}) {
  const today = todayISO();
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());

  const queue = React.useMemo(
    () => focusOrder(todos, today).filter(t => !skipped.has(t.id)),
    [todos, today, skipped],
  );

  const current = queue[0] ?? null;
  const next = queue[1] ?? null;

  const doneToday = todos.filter(
    t => t.isDone && t.completedAt?.slice(0, 10) === today,
  ).length;
  const remaining = queue.length;
  const pct = doneToday + remaining === 0 ? 100 : Math.round((doneToday / (doneToday + remaining)) * 100);

  // Escape closes; Space or Enter completes; S skips. The keys somebody's
  // hands are already on while they work.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (!current) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onToggle(current);
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSkipped(prev => new Set(prev).add(current.id));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, onToggle, onClose]);

  const due = current ? dueLabel(current.dueOn) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
      className="fixed inset-0 z-50 flex flex-col bg-background/98 backdrop-blur-sm"
    >
      <header className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
        <span className="text-sm font-medium">Focus</span>
        <span className="text-xs text-muted-foreground">
          {doneToday} done{remaining > 0 ? ` · ${remaining} to go` : ''}
        </span>
        <div className="mx-auto hidden w-48 md:block">
          <Progress value={pct} className="h-1.5" />
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto gap-1.5 md:ml-0">
          <X className="size-4" /> Exit
          <kbd className="ml-1 hidden rounded border px-1 text-[10px] text-muted-foreground sm:inline">Esc</kbd>
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        {!current ? (
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <PartyPopper className="size-7" />
            </div>
            <h2 className="text-lg font-semibold">
              {doneToday > 0 ? 'That is everything' : 'Nothing waiting'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {skipped.size > 0
                ? `You skipped ${skipped.size} item${skipped.size === 1 ? '' : 's'} this session.`
                : 'Your open list is clear. Close focus and enjoy it.'}
            </p>
            {skipped.size > 0 && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setSkipped(new Set())}>
                Bring the skipped ones back
              </Button>
            )}
          </div>
        ) : (
          <div className="w-full max-w-xl">
            <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Now
            </p>

            <div className="rounded-2xl border bg-card p-6 shadow-sm md:p-8">
              <div className="flex items-start gap-3">
                <h1 className="flex-1 text-xl font-medium leading-snug md:text-2xl">
                  {current.title}
                </h1>
                <button
                  type="button"
                  aria-label={current.isStarred ? 'Remove star' : 'Star this'}
                  aria-pressed={current.isStarred}
                  onClick={() => onStar(current)}
                  className="shrink-0 rounded p-1 text-muted-foreground/40 transition hover:text-amber-500"
                >
                  <Star className={cn('size-5', current.isStarred && 'fill-amber-400 text-amber-400')} />
                </button>
              </div>

              {current.note && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {current.note}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                {due && (
                  <span className={cn('flex items-center gap-1', due.tone)}>
                    <CalendarDays className="size-3.5" /> {due.text}
                  </span>
                )}
                {current.recurrence && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Repeat className="size-3.5" /> {RECURRENCE_LABELS[current.recurrence]}
                  </span>
                )}
                {current.list && (
                  <span className="text-muted-foreground">{current.list.name}</span>
                )}
                {current.linkedTask?.project?.name && (
                  <span className="text-muted-foreground">
                    for {current.linkedTask.project.name}
                  </span>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => onToggle(current)}
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Check className="size-4" /> Done
                  <kbd className="ml-1 rounded border border-white/30 px-1 text-[10px]">Space</kbd>
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setSkipped(prev => new Set(prev).add(current.id))}
                  disabled={!next}
                >
                  <ArrowRight className="size-4" /> Not now
                  <kbd className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">S</kbd>
                </Button>
              </div>
            </div>

            {/*
              The next one is named but not actionable. Knowing what is coming
              is what stops somebody breaking focus to go and check.
            */}
            {next && (
              <div className="mt-5 flex items-center gap-2 rounded-lg border border-dashed px-4 py-2.5 text-sm text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                <span className="text-[11px] font-semibold uppercase tracking-wide">Next</span>
                <span className="truncate">{next.title}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
