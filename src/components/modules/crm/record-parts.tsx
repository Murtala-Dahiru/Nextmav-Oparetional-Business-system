'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Check, Clock, CalendarClock, AlertTriangle, Pencil, Trash2, Loader2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';

import { patch, remove, relativeDay, formatDayShort } from './data';
import { activityIcon, memberName, Blank } from './ui';
import type { CrmActivity } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The pieces a record's own screen is made of
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared by the lead, contact, deal and company panels, because all four
 * answer the same four questions in the same order: who is this, what is it
 * worth, what has happened, and what happens next. Four panels each writing
 * their own timeline is four timelines that drift.
 */

/* -------------------------------------------------------------------------- */
/*  Facts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A label and a value, in a two-column list.
 *
 * A field with no value is *omitted*, not rendered as a dash. Twelve rows of
 * "-" is how a record panel ends up looking empty when it is only sparse, and
 * it makes the four fields that are filled in harder to find, not easier.
 */
export function Facts({
  items, className,
}: {
  items: { label: string; value: React.ReactNode; full?: boolean }[];
  className?: string;
}) {
  const live = items.filter(i => i.value !== null && i.value !== undefined && i.value !== '');
  if (!live.length) return null;

  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {live.map((item, i) => (
        <div key={i} className={cn('min-w-0', item.full && 'sm:col-span-2')}>
          <dt className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
            {item.label}
          </dt>
          <dd className="mt-1 text-[13px] text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panels                                                                    */
/* -------------------------------------------------------------------------- */

export function Panel({
  title, count, action, children, className,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  What is owed                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The open follow-ups on one record.
 *
 * Kept out of the timeline deliberately. A timeline is history in reverse
 * order; a follow-up has not happened. Putting a future item at the top of a
 * list of past ones is how "next action" becomes something people stop
 * noticing.
 */
export function NextActions({
  items, onChanged, onEdit,
}: {
  items: CrmActivity[];
  onChanged: () => void;
  onEdit?: (activity: CrmActivity) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const complete = async (a: CrmActivity) => {
    setBusy(a.id);
    try {
      await patch(`/api/crm/activities/${a.id}`, { completedAt: new Date().toISOString() });
      toast.success('Done', { description: a.subject });
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'That could not be marked done');
    } finally {
      setBusy(null);
    }
  };

  if (!items.length) return null;

  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map(a => {
        const state = a.when ?? whenOf(a.dueAt);
        const Icon = activityIcon(a.activityType);

        return (
          <li key={a.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <button
              type="button"
              onClick={() => complete(a)}
              disabled={busy === a.id}
              aria-label={`Mark "${a.subject}" done`}
              className={cn(
                'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
                'border-input text-transparent hover:border-foreground/50 hover:text-foreground/60',
              )}
            >
              {busy === a.id
                ? <Loader2 className="size-3 animate-spin text-muted-foreground" />
                : <Check className="size-3" />}
            </button>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-foreground">{a.subject}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Icon className="size-3" />
                  {a.activityType}
                </span>
                {a.dueAt && (
                  <span className={cn(
                    'inline-flex items-center gap-1',
                    state === 'overdue' && 'font-medium text-destructive',
                    state === 'today' && 'font-medium text-warning',
                  )}>
                    {state === 'overdue' ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}
                    Due {relativeDay(a.dueAt)}
                  </span>
                )}
                {a.remindAt && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3" />
                    Reminder {formatDayShort(a.remindAt)}
                  </span>
                )}
              </p>
            </div>

            {onEdit && (
              <Button
                type="button" variant="ghost" size="icon" className="size-7 shrink-0"
                onClick={() => onEdit(a)} aria-label="Edit follow-up"
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Which bucket a due date falls in, in the reader's own calendar. */
export function whenOf(dueAt: string | null | undefined): 'overdue' | 'today' | 'upcoming' | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  if (d < start) return 'overdue';
  if (d < end) return 'today';
  return 'upcoming';
}

/* -------------------------------------------------------------------------- */
/*  What happened                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The history of a relationship, in one column.
 *
 * ── Why a rail rather than cards ─────────────────────────────────────────
 *
 * The old Activities screen drew a three-across grid of bordered cards. A grid
 * has no direction, so a *chronology* rendered in one has to be read by
 * checking each card's date - which is the one thing a timeline exists to save
 * you from. A single column with a continuous rule down the left is read in
 * one movement, and the date only has to appear when it changes.
 */
export function Timeline({
  items, onDelete, empty,
}: {
  items: CrmActivity[];
  onDelete?: (activity: CrmActivity) => void;
  empty?: React.ReactNode;
}) {
  if (!items.length) {
    return empty ?? (
      <p className="py-2 text-[12.5px] text-muted-foreground">Nothing has been logged yet.</p>
    );
  }

  /**
   * Which rows start a new day, worked out before anything renders.
   *
   * A `let` carried through the `map` would be a variable mutated during
   * render, which React's rules forbid for good reason: on a re-render the
   * carry-over is whatever the last pass left behind, so the date headings
   * would flicker on and off as the list refetched.
   */
  const stamps = items.map(a => formatDayShort(a.completedAt ?? a.createdAt));
  const startsDay = stamps.map((day, i) => i === 0 || day !== stamps[i - 1]);

  return (
    <ol className="relative flex flex-col">
      {/* The rule the whole column hangs on. */}
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-[11px] top-2 w-px bg-border"
      />

      {items.map((a, i) => {
        const Icon = activityIcon(a.activityType);
        const day = stamps[i];
        const newDay = startsDay[i];

        return (
          <li key={a.id} className="relative flex gap-3 py-2.5">
            <span className="relative z-10 mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
              <Icon className="size-3" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">
                  {a.subject || a.activityType}
                </p>
                {/*
                  The date appears once per day, not once per row.

                  It used to fall back to a relative time on every row after the
                  first, so one day's entries read "Aug 13", "13 Aug 2026",
                  "2 weeks ago" - three formats for one date, in a column whose
                  job is to be scanned. The full timestamp is still on the
                  title, for anyone who wants the hour.
                */}
                <span
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                  title={formatDateTime(a.completedAt ?? a.createdAt)}
                >
                  {newDay ? day : ''}
                </span>
              </div>

              {a.body && (
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                  {a.body}
                </p>
              )}

              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground/80">
                <span className="capitalize">{a.activityType}</span>
                {memberName(a.member) && <span>· {memberName(a.member)}</span>}
                {subjectOf(a) && <span>· {subjectOf(a)}</span>}
              </p>
            </div>

            {onDelete && (
              <Button
                type="button" variant="ghost" size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(a)}
                aria-label="Delete this entry"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** What an activity is about, in the words the timeline shows. */
export function subjectOf(a: CrmActivity): string {
  if (a.deal?.name) return a.deal.name;
  if (a.company?.name) return a.company.name;
  if (a.contact) return `${a.contact.firstName} ${a.contact.lastName}`.trim();
  if (a.lead) return `${a.lead.firstName} ${a.lead.lastName}`.trim();
  return '';
}

/** Deleting one timeline entry, with the confirmation inline. */
export function useDeleteActivity(onDone: () => void) {
  return React.useCallback(async (a: CrmActivity) => {
    try {
      await remove(`/api/crm/activities/${a.id}`);
      toast.success('Removed', { description: a.subject });
      onDone();
    } catch (e: any) {
      toast.error(e.message || 'That could not be removed');
    }
  }, [onDone]);
}

export { Blank };
