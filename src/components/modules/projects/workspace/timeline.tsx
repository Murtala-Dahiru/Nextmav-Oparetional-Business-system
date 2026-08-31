'use client';

import * as React from 'react';
import {
  CheckCircle2, Flag, FileText, Link2, MessageSquare, Video, Play, Target,
  ThumbsUp, ThumbsDown,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Head } from '@/components/shared/readout/primitives';
import { formatDay, todayISO } from '@/lib/format';

import { Nothing } from '../ui';
import type { TimelineEntry, Workspace } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Timeline - the story of the project
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What it can now say ──────────────────────────────────────────────────
 *
 * The old timeline had four kinds of entry: the project's start and end dates,
 * milestones, and calendar events. Everything a team actually does was missing
 * - no task ever appeared, no file, no comment, no client decision - so a
 * project six months in showed eight rows and read as though nothing had
 * happened.
 *
 * It now carries eight kinds, and every one of them is a row that exists:
 * tasks completed (possible since 0034 began stamping `tasks.completed_at`),
 * files and links added, deliverables accepted or sent back, discussion,
 * meetings, phases due and done, and the project's own two dates.
 *
 * ── Divided at today ─────────────────────────────────────────────────────
 *
 * A single list running from the future into the past makes the reader find
 * the join themselves. What has happened and what is coming are two different
 * questions, so they are two sections, with the nearest thing to now at the
 * top of each.
 */

const KIND: Record<string, { icon: React.ElementType; label: string; tone: 'good' | 'bad' | 'plain' }> = {
  project_start: { icon: Play, label: 'Project', tone: 'plain' },
  project_end: { icon: Target, label: 'Deadline', tone: 'plain' },
  milestone_completed: { icon: Flag, label: 'Phases', tone: 'good' },
  milestone_due: { icon: Flag, label: 'Phases', tone: 'plain' },
  task_completed: { icon: CheckCircle2, label: 'Tasks', tone: 'good' },
  file_added: { icon: FileText, label: 'Files', tone: 'plain' },
  link_added: { icon: Link2, label: 'Files', tone: 'plain' },
  deliverable_approved: { icon: ThumbsUp, label: 'Client', tone: 'good' },
  deliverable_rejected: { icon: ThumbsDown, label: 'Client', tone: 'bad' },
  comment: { icon: MessageSquare, label: 'Discussion', tone: 'plain' },
  meeting: { icon: Video, label: 'Meetings', tone: 'plain' },
};

const FILTERS = ['Everything', 'Tasks', 'Phases', 'Files', 'Client', 'Discussion', 'Meetings'];

export function TimelinePanel({ data }: { data: Workspace }) {
  const [filter, setFilter] = React.useState('Everything');
  const today = todayISO();

  const entries = React.useMemo(
    () => (filter === 'Everything'
      ? data.timeline
      : data.timeline.filter(t => (KIND[t.kind]?.label ?? 'Project') === filter)),
    [data.timeline, filter],
  );

  /** Which filters have anything behind them. An empty chip is a dead control. */
  const available = React.useMemo(() => {
    const present = new Set(data.timeline.map(t => KIND[t.kind]?.label ?? 'Project'));
    return FILTERS.filter(f => f === 'Everything' || present.has(f));
  }, [data.timeline]);

  const upcoming = entries.filter(e => e.at > today).reverse();
  const past = entries.filter(e => e.at <= today);

  if (data.timeline.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-e1">
        <Nothing
          className="px-4"
          title="Nothing has happened yet"
          note="Completed tasks, phases, files, client decisions, meetings and discussion all appear here in one sequence."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {available.length > 2 && (
        <div className="flex flex-wrap items-center gap-1">
          {available.map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                filter === f ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <Head title="Ahead" count={upcoming.length} />
          <Track entries={upcoming} future />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <Head title="What has happened" count={past.length} />
        {past.length === 0 ? (
          <Nothing title="Nothing yet" note="Everything on this project is still ahead of today." />
        ) : (
          <Track entries={past} />
        )}
      </section>
    </div>
  );
}

/**
 * The entries, grouped by day.
 *
 * ── Why a day band and not one dot per row ───────────────────────────────
 *
 * A project can close nine tasks in an afternoon, and nine identical
 * timestamps down the left edge is nine repetitions of the same fact. The date
 * is written once per day and the events sit under it, which is how a person
 * would write the same thing down.
 */
function Track({ entries, future = false }: { entries: TimelineEntry[]; future?: boolean }) {
  const days = React.useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const e of entries) {
      const list = map.get(e.at) ?? [];
      list.push(e);
      map.set(e.at, list);
    }
    return [...map.entries()];
  }, [entries]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-e1">
      <ol className="divide-y divide-border/70">
        {days.map(([day, items]) => (
          <li key={day} className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3.5 sm:grid-cols-[7.5rem_1fr]">
            <p className={cn(
              'text-[12px] font-medium tabular-nums',
              future ? 'text-muted-foreground' : 'text-foreground',
            )}>
              {formatDay(day, { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>

            <ul className="flex flex-col gap-2.5">
              {items.map((e, i) => {
                const meta = KIND[e.kind] ?? { icon: FileText, label: 'Project', tone: 'plain' as const };
                const Icon = meta.icon;
                return (
                  <li key={`${e.kind}-${e.id ?? i}`} className="flex min-w-0 items-start gap-2.5">
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'mt-[3px] size-3.5 shrink-0',
                        meta.tone === 'good' ? 'text-[var(--chart-1)]'
                          : meta.tone === 'bad' ? 'text-destructive'
                            : 'text-muted-foreground/70',
                      )}
                    />
                    <div className="min-w-0">
                      <p className={cn(
                        'text-[13px] leading-snug',
                        future ? 'text-muted-foreground' : 'text-foreground',
                      )}>
                        {e.title}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {e.detail}{e.by && ` · ${e.by}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
