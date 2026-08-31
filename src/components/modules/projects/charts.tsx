'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf, formatDay, formatDayShort, daysUntil } from '@/lib/format';
import { HEALTH_LABELS, type Health, type PortfolioProject } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Delivery instruments
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why Projects does not reuse the dashboard's plate ────────────────────
 *
 * `components/shared/readout` is the vocabulary of a *readout*: a dark plate
 * carrying a headline figure, a strip of instruments, numbered bands dividing
 * the page. The Executive Overview is built from it and so is CRM Home,
 * because both answer the same shape of question - here is one big number,
 * here is what it is made of, here is what happened.
 *
 * Delivery is not that question. A project is a **span of time with work
 * inside it**, and the things somebody needs to see are shapes, not figures:
 * which engagements overlap, where today falls inside each of them, whether
 * output is rising or falling, and who is carrying the load. A headline number
 * cannot say any of that, and a third module opening on the same dark
 * rectangle would make the product feel like one screen repainted.
 *
 * So Projects has its own instruments, and they share the design system rather
 * than the composition: same tokens, same type scale, same restraint about
 * colour (it means trouble, and nothing else), same refusal to draw anything
 * that is not a count of real rows.
 *
 *   Timeline   the portfolio as spans against one date axis. The page's hero.
 *   UnitGrid   one square per project. A count you can also read as a shape.
 *   Columns    twelve weeks of finished work, which is the only signal here
 *              that goes *down* when delivery stalls.
 *   LoadRows   who is holding the open work, across every project at once.
 *
 * Drawn in markup rather than with recharts. All four are rectangles on a
 * proportional axis; a charting library would add a bundle, a tooltip system
 * and a set of defaults to fight, and would still need every colour overridden
 * to match the tokens.
 */

const HEALTH_INK: Record<Health, string> = {
  on_track: 'var(--chart-1)',
  at_risk: 'var(--warning)',
  off_track: 'var(--destructive)',
};

/* -------------------------------------------------------------------------- */
/*  Timeline                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every live project as a span, against one shared axis.
 *
 * ── What it answers that a list cannot ───────────────────────────────────
 *
 * Whether the portfolio is spread or stacked. Six projects all ending in the
 * same fortnight is the single most useful thing a delivery lead can learn on
 * a Monday, and it is invisible in a table of dates however well sorted.
 *
 * ── The bar says three things ────────────────────────────────────────────
 *
 *   · its **position** is the engagement's span, start to target;
 *   · its **fill** is the progress figure from `v_project_health`, drawn from
 *     the left, so the gap between the fill's edge and the today line is
 *     visible as *lateness* rather than having to be worked out;
 *   · its **colour** is the health verdict.
 *
 * That third rule is what makes the whole strip readable at a glance: a red
 * bar whose fill stops well short of today is a project in trouble, and the
 * eye finds it without reading a word.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not a Gantt. No dependency arrows, no critical path, nothing draggable -
 * there is no scheduler behind this and a draggable bar would be a control
 * that does less than it looks like it does. Projects with no dates are listed
 * under the axis rather than given an invented span.
 */
export function Timeline({
  projects, today, onOpen,
}: {
  projects: PortfolioProject[];
  today: string;
  onOpen: (id: string) => void;
}) {
  const dated = projects.filter(p => p.startDate && p.endDate);
  const undated = projects.filter(p => !p.startDate || !p.endDate);

  const window = React.useMemo(() => {
    if (!dated.length) return null;
    const starts = dated.map(p => p.startDate!);
    const ends = dated.map(p => p.endDate!);
    // Today is always inside the window, so the marker is never off the edge
    // on a portfolio that is entirely in the past or entirely ahead.
    let min = [...starts, today].reduce((a, b) => (a < b ? a : b));
    let max = [...ends, today].reduce((a, b) => (a > b ? a : b));

    // A fortnight of padding at each end, so a bar that starts on the first
    // day is not flush against the frame.
    const pad = (iso: string, days: number) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    min = pad(min, -14);
    max = pad(max, 14);

    const span = Math.max(1, daysUntil(max)! - daysUntil(min)!);
    return { min, max, span };
  }, [dated, today]);

  if (!window) {
    return (
      <p className="px-5 py-8 text-[13px] text-muted-foreground">
        No project carries both a start and a target date, so there is no span
        to draw. Add dates to a project and it appears here.
      </p>
    );
  }

  const { min, max, span } = window;
  const at = (iso: string) => ((daysUntil(iso)! - daysUntil(min)!) / span) * 100;
  const todayPos = at(today);

  /** The first of each month inside the window, for the gridlines. */
  const months: { iso: string; label: string }[] = [];
  {
    const cursor = new Date(`${min}T00:00:00Z`);
    cursor.setUTCDate(1);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    while (cursor.toISOString().slice(0, 10) < max) {
      const iso = cursor.toISOString().slice(0, 10);
      months.push({
        iso,
        label: cursor.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  return (
    <div className="flex flex-col">
      {/* The axis, above the rows so it is read first. */}
      <div className="relative ml-0 h-6 border-b border-border sm:ml-[13rem]">
        {months.map(m => (
          <span
            key={m.iso}
            className="absolute bottom-1 hidden -translate-x-1/2 text-[10.5px] font-medium uppercase tracking-[0.07em] text-muted-foreground/70 sm:inline"
            style={{ left: `${at(m.iso)}%` }}
          >
            {m.label}
          </span>
        ))}
        <span
          className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-foreground px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.07em] text-background"
          style={{ left: `${todayPos}%` }}
        >
          Today
        </span>
      </div>

      <ul className="relative">
        {/*
          The gridlines run behind every row rather than being drawn per row.

          One absolutely positioned layer means the month rules are continuous
          down the whole strip, which is what lets the eye compare two bars four
          rows apart. Drawn per row they would be twelve separate hairlines with
          a two-pixel gap at every boundary.
        */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 ml-0 sm:ml-[13rem]">
          {months.map(m => (
            <span
              key={m.iso}
              className="absolute inset-y-0 w-px bg-border/50"
              style={{ left: `${at(m.iso)}%` }}
            />
          ))}
          <span
            className="absolute inset-y-0 w-px bg-foreground/35"
            style={{ left: `${todayPos}%` }}
          />
        </span>

        {dated.map(p => {
          const left = at(p.startDate!);
          const width = Math.max(1, at(p.endDate!) - left);
          const late = p.isOverdue;
          /** How much of the whole axis the filled part covers. */
          const filled = (width * Math.min(100, Math.max(0, p.progressPct))) / 100;
          const inside = filled > 4.5;

          return (
            <li key={p.id} className="relative">
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                className="group grid w-full grid-cols-1 items-center gap-x-3 rounded-md py-2 text-left transition-colors hover:bg-accent/50 sm:grid-cols-[13rem_1fr]"
              >
                <span className="flex min-w-0 items-center gap-2 px-2 sm:px-2">
                  <span
                    aria-hidden="true"
                    className="size-[7px] shrink-0 rounded-full"
                    style={{ background: HEALTH_INK[p.health] }}
                  />
                  <span className="truncate text-[12.5px] font-medium text-foreground">
                    {p.name}
                  </span>
                </span>

                <span className="relative block h-5">
                  <span
                    className="absolute inset-y-0 overflow-hidden rounded-[3px] border"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      borderColor: late
                        ? 'color-mix(in srgb, var(--destructive) 45%, transparent)'
                        : 'var(--border)',
                      background: 'var(--muted)',
                    }}
                    title={`${p.name}: ${formatDay(p.startDate)} to ${formatDay(p.endDate)}, ${Math.round(p.progressPct)}% complete`}
                  >
                    {/* Progress, drawn from the left inside the span. The gap
                        between its edge and the today line is the lateness. */}
                    <span
                      className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-[var(--ease-brand)]"
                      style={{
                        width: `${Math.max(2, Math.min(100, p.progressPct))}%`,
                        background: `color-mix(in srgb, ${HEALTH_INK[p.health]} ${p.health === 'on_track' ? 70 : 82}%, transparent)`,
                      }}
                    />
                  </span>

                  {/*
                    The figure goes inside the bar only when the *fill* is wide
                    enough to hold it.

                    Sizing it against the whole bar was wrong in the case that
                    matters most: a long engagement at 0% has plenty of bar and
                    no fill, so the label landed on the empty track in the fill's
                    colour and read as a rendering fault. Outside the bar it is
                    grey, and it is always legible.
                  */}
                  <span
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10.5px] font-semibold tabular-nums',
                      inside ? 'text-white mix-blend-luminosity' : 'text-muted-foreground',
                    )}
                    style={
                      inside
                        ? { left: `calc(${left}% + 6px)` }
                        : { left: `calc(${left + width}% + 6px)` }
                    }
                  >
                    {Math.round(p.progressPct)}%
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {undated.length > 0 && (
        <p className="mt-2 border-t border-border/70 px-2 pt-2.5 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">{undated.length}</span>{' '}
          {undated.length === 1 ? 'project has' : 'projects have'} no start or
          target date, so {undated.length === 1 ? 'it is' : 'they are'} not on
          the axis: {undated.map(p => p.name).join(', ')}.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Unit grid                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One square per project, coloured by health.
 *
 * ── Why not a bar or a donut ─────────────────────────────────────────────
 *
 * A stacked bar of five, one and five is three coloured lengths a reader has
 * to convert back into counts, and it is what the Executive Overview already
 * uses for its own compositions. A donut is worse: it costs an arc, a legend
 * and a hole, and answers exactly one question.
 *
 * A unit grid is the count *and* the shape at once. Eleven squares are eleven
 * projects, so nothing has to be inferred, and each one is a link to the
 * project it stands for - which no proportional chart can be.
 *
 * It stops being the right instrument somewhere past a hundred projects, at
 * which point the squares are too small to hit. The component says so rather
 * than degrading quietly.
 */
export function UnitGrid({
  projects, onOpen,
}: {
  projects: PortfolioProject[];
  onOpen: (id: string) => void;
}) {
  const order: Health[] = ['off_track', 'at_risk', 'on_track'];
  const sorted = [...projects].sort(
    (a, b) => order.indexOf(a.health) - order.indexOf(b.health),
  );

  if (projects.length > 120) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        {projects.length} projects in delivery, too many to draw one square each.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {sorted.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.id)}
            title={`${p.name} - ${HEALTH_LABELS[p.health]}, ${Math.round(p.progressPct)}% complete`}
            aria-label={`${p.name}, ${HEALTH_LABELS[p.health]}`}
            className="size-[18px] rounded-[3px] ring-offset-2 ring-offset-card transition-transform hover:scale-110"
            style={{ background: HEALTH_INK[p.health] }}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {order.map(h => {
          const n = projects.filter(p => p.health === h).length;
          if (!n) return null;
          return (
            <li key={h} className="flex items-center gap-2 text-[12.5px]">
              <span
                aria-hidden="true"
                className="size-[9px] shrink-0 rounded-[2px]"
                style={{ background: HEALTH_INK[h] }}
              />
              <span className="tabular-nums font-medium text-foreground">{n}</span>
              <span className="text-muted-foreground">{HEALTH_LABELS[h].toLowerCase()}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Columns                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Twelve weeks of finished work.
 *
 * The only figure on this page that goes **down** when a team stops
 * delivering. Progress rises and never falls, health is a verdict on a moment,
 * and a count of open tasks says as much about how much was planned as about
 * how much was done. Weekly completions are the one honest measure of output,
 * and they became measurable at all only when 0034 started stamping
 * `tasks.completed_at`.
 *
 * The last column is the week in progress and is drawn hollow, because
 * comparing a part week with eleven whole ones is the mistake the Executive
 * Overview shipped once with a part month.
 */
export function Columns({ data }: { data: { weekStart: string; count: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.count));
  const done = data.slice(0, -1);
  const total = done.reduce((n, d) => n + d.count, 0);
  const average = done.length ? total / done.length : 0;
  const current = data[data.length - 1];

  if (!data.some(d => d.count > 0)) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Nothing has been completed in the last twelve weeks.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-24 items-end gap-[3px]">
        {/* The average, as a hairline the columns are read against. */}
        {average > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${(average / max) * 100}%` }}
          />
        )}
        {data.map((d, i) => {
          const partial = i === data.length - 1;
          return (
            <span
              key={d.weekStart}
              title={`Week of ${formatDayShort(d.weekStart)}: ${d.count} completed${partial ? ' so far' : ''}`}
              className="group relative flex flex-1 items-end"
              style={{ height: '100%' }}
            >
              <span
                className={cn(
                  'w-full rounded-[2px] transition-[height] duration-500 ease-[var(--ease-brand)]',
                  partial
                    ? 'border border-dashed border-[var(--chart-1)] bg-[var(--chart-1)]/15'
                    : 'bg-[var(--chart-1)]/75 group-hover:bg-[var(--chart-1)]',
                )}
                style={{ height: `${Math.max(d.count === 0 ? 1 : 4, (d.count / max) * 100)}%` }}
              />
            </span>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-3 text-[11.5px] text-muted-foreground">
        <span>{formatDayShort(data[0].weekStart)}</span>
        <span className="tabular-nums">
          <span className="font-medium text-foreground">{average.toFixed(average >= 10 ? 0 : 1)}</span>
          {' a week on average'}
        </span>
        <span>this week</span>
      </div>

      <p className="text-[12px] text-muted-foreground">
        {current.count} finished so far this week, against an average of{' '}
        {average.toFixed(average >= 10 ? 0 : 1)} over the eleven before it.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Load rows                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Who is carrying the open work, across every live project at once.
 *
 * A project's own team panel cannot answer this: the person under most
 * pressure is usually the one on four projects, and each workspace sees a
 * quarter of their load.
 *
 * Scaled against the heaviest load rather than a hundred, for the reason the
 * team panel's bar is: what matters is who is carrying more than everybody
 * else, and a bar scaled to an arbitrary maximum makes every row look alike.
 */
export function LoadRows({
  workload, unassigned, limit = 6,
}: {
  workload: { memberId: string; name: string; avatarUrl: string | null; open: number; overdue: number }[];
  unassigned: number;
  limit?: number;
}) {
  const shown = workload.slice(0, limit);
  const busiest = Math.max(1, unassigned, ...workload.map(w => w.open));

  if (!workload.length && !unassigned) {
    return <p className="text-[12.5px] text-muted-foreground">No open work on any live project.</p>;
  }

  const bar = (open: number, overdue: number) => (
    <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-border/70">
      <span
        className="h-full bg-warning transition-[width] duration-500"
        style={{ width: `${(overdue / busiest) * 100}%` }}
      />
      <span
        className="h-full bg-foreground/45 transition-[width] duration-500"
        style={{ width: `${((open - overdue) / busiest) * 100}%` }}
      />
    </span>
  );

  return (
    <ul className="flex flex-col gap-3">
      {shown.map(w => (
        <li key={w.memberId} className="grid grid-cols-[1fr_2.5rem] items-center gap-x-3 gap-y-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <Avatar className="size-5 shrink-0">
              {w.avatarUrl ? <AvatarImage src={w.avatarUrl} alt="" /> : null}
              <AvatarFallback className="bg-muted text-[9px] font-medium text-muted-foreground">
                {initialsOf(w.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-[12.5px] text-foreground">{w.name}</span>
          </span>
          <span className="text-right text-[12.5px] tabular-nums text-foreground">{w.open}</span>
          <span className="col-span-2">{bar(w.open, w.overdue)}</span>
        </li>
      ))}

      {/*
        Work nobody is holding, counted apart.

        Folded into the people it would be invisible; left out entirely it is
        the largest thing on a struggling portfolio and nobody sees it.
      */}
      {unassigned > 0 && (
        <li className="grid grid-cols-[1fr_2.5rem] items-center gap-x-3 gap-y-1.5 border-t border-border/70 pt-3">
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-input text-[10px] text-muted-foreground"
            >
              ?
            </span>
            <span className="truncate text-[12.5px] text-muted-foreground">Nobody assigned</span>
          </span>
          <span className="text-right text-[12.5px] tabular-nums text-foreground">{unassigned}</span>
          <span className="col-span-2">
            <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-border/70">
              <span
                className="h-full bg-muted-foreground/40 transition-[width] duration-500"
                style={{ width: `${(unassigned / busiest) * 100}%` }}
              />
            </span>
          </span>
        </li>
      )}

      {workload.length > limit && (
        <li className="text-[12px] text-muted-foreground">
          and {workload.length - limit} more carrying less.
        </li>
      )}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/*  Runway                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The phases that are due, laid out on days rather than as a list.
 *
 * A list of dates is read one row at a time. The runway is read as a shape:
 * three phases stacked on one Thursday is a week to worry about, and it is
 * obvious from the spacing before a single name has been read.
 *
 * Overdue phases sit in their own group to the left of the axis, because a
 * date in the past has no position on a forward-looking scale and giving it
 * one would compress everything else into the right-hand third.
 */
export function Runway({
  items, horizonDays, onOpen,
}: {
  items: {
    id: string; name: string; projectName: string; projectId: string;
    dueDate: string; overdue: boolean; owner: string | null;
  }[];
  horizonDays: number;
  onOpen: (projectId: string) => void;
}) {
  const late = items.filter(i => i.overdue);
  const ahead = items.filter(i => !i.overdue);

  /** Ahead items grouped by day, so a busy day reads as a busy day. */
  const byDay = React.useMemo(() => {
    const map = new Map<string, typeof ahead>();
    for (const i of ahead) map.set(i.dueDate, [...(map.get(i.dueDate) ?? []), i]);
    return [...map.entries()];
  }, [ahead]);

  if (!items.length) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Nothing on any roadmap is late, and nothing falls inside the next{' '}
        {horizonDays} days.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {late.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-destructive">
            {late.length} already late
          </p>
          <ul className="flex flex-col gap-1.5">
            {late.slice(0, 4).map(i => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => onOpen(i.projectId)}
                  className="grid w-full grid-cols-[1fr_auto] items-baseline gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">{i.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{i.projectName}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-[12px] font-medium tabular-nums text-destructive">
                    {Math.abs(daysUntil(i.dueDate) ?? 0)}d late
                  </span>
                </button>
              </li>
            ))}
            {late.length > 4 && (
              <li className="px-2 text-[12px] text-muted-foreground">
                and {late.length - 4} more.
              </li>
            )}
          </ul>
        </div>
      )}

      {byDay.length > 0 && (
        <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
          {byDay.map(([day, group]) => {
            const d = daysUntil(day) ?? 0;
            return (
              <li key={day} className="relative">
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -left-[21px] top-[7px] size-[7px] rounded-full ring-4 ring-background',
                    d <= 2 ? 'bg-warning' : 'bg-border',
                  )}
                />
                <p className="flex items-baseline gap-2 text-[12px]">
                  <span className={cn('font-medium', d <= 2 ? 'text-warning' : 'text-foreground')}>
                    {d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : formatDayShort(day)}
                  </span>
                  {d > 1 && <span className="text-muted-foreground">in {d} days</span>}
                  {group.length > 1 && (
                    <span className="text-muted-foreground">{group.length} phases</span>
                  )}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {group.map(i => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(i.projectId)}
                        className="grid w-full grid-cols-[1fr_auto] items-baseline gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] text-foreground">{i.name}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {i.projectName}
                          </span>
                        </span>
                        {i.owner && (
                          <span className="hidden shrink-0 truncate text-[12px] text-muted-foreground sm:block">
                            {i.owner}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
