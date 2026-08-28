'use client';

import * as React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { statusLabel } from '@/lib/constants';
/* `Bar` is already recharts' in this file; the primitive comes in under a
   name that cannot collide with it. */
import { Head, TRow, THead, Rail, Meter, Stat, Bar as SplitBar } from './primitives';
import { useViz, tickStyle, GRID_DASH, TipShell, TipRow, niceTicks } from './viz';
import type { DashboardProjects, DashboardWork } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Project health, and whether work is getting done
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What the endpoint now supplies ────────────────────────────────────────
 *
 * `v_project_health` computes eleven columns per project and the dashboard
 * used to render five of them. Blocked tasks, overdue tasks and the milestone
 * counts were all being fetched and discarded — so a project could be flagged
 * at risk and the page could not say *why*, even though the database had
 * already worked it out. "Why" is the entire value of a health table; without
 * it the row is a progress bar with a warning colour.
 *
 * ── Three states, counted separately ──────────────────────────────────────
 *
 * `atRisk` (the deadline is close and the work is not proportionally done) and
 * `delayed` (already past the end date) overlap, so they are never added
 * together. A project that is both is shown as delayed, because that is the
 * more definite of the two claims.
 */

/* -------------------------------------------------------------------------- */
/*  Project health                                                            */
/* -------------------------------------------------------------------------- */

/** The reason a row is flagged, drawn from what the view actually counted. */
function reasonFor(p: DashboardProjects['progress'][number]): string | null {
  const bits: string[] = [];
  if (p.daysLeft !== null && p.daysLeft < 0) {
    bits.push(`${Math.abs(p.daysLeft)}d past the end date`);
  }
  if (p.overdueTasks > 0) bits.push(`${p.overdueTasks} overdue`);
  if (p.blockedTasks > 0) bits.push(`${p.blockedTasks} blocked`);
  if (p.milestones.overdue > 0) {
    bits.push(`${p.milestones.overdue} milestone${p.milestones.overdue === 1 ? '' : 's'} late`);
  }
  if (bits.length === 0 && p.atRisk && p.daysLeft !== null) {
    // The view's own rule, restated: close to the deadline and under 75% done.
    bits.push(`${p.daysLeft}d left at ${Math.round(p.progress)}%`);
  }
  return bits.length ? bits.join(' · ') : null;
}

export function ProjectHealth({
  projects,
  onOpenProjects,
  onOpenProject,
}: {
  projects: DashboardProjects;
  onOpenProjects: () => void;
  onOpenProject: (id: string) => void;
}) {
  // Trouble first: sorted any other way, the reader has to find the one row
  // that matters.
  const rows = React.useMemo(() => [...projects.progress].sort((a, b) => {
    const lateA = a.daysLeft !== null && a.daysLeft < 0 ? 0 : 1;
    const lateB = b.daysLeft !== null && b.daysLeft < 0 ? 0 : 1;
    if (lateA !== lateB) return lateA - lateB;
    const risk = Number(b.atRisk) - Number(a.atRisk);
    if (risk) return risk;
    return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
  }), [projects.progress]);

  /* The exact partition of the tracked rows — see the note on the strip. */
  const late = rows.filter(p => p.daysLeft !== null && p.daysLeft < 0).length;
  const flagged = rows.filter(p => p.atRisk && !(p.daysLeft !== null && p.daysLeft < 0)).length;
  const settled = rows.length - late - flagged;

  /**
   * Name and progress on a phone; six columns from `md`.
   *
   * The progress track is deliberately the widest fixed column — it is the
   * only cell whose *length* is the information.
   */
  const cols =
    'grid-cols-[minmax(0,1fr)_5.5rem] md:grid-cols-[minmax(0,1fr)_5rem_4.5rem_5rem_13rem_5rem]';

  return (
    <section className="min-w-0">
      <Head
        title="Project health"
        count={projects.active}
        note={
          projects.delayed > 0
            ? `${projects.delayed} past deadline`
            : projects.atRisk > 0
              ? `${projects.atRisk} at risk`
              : 'All on track'
        }
        action={{ label: 'Projects', onClick: onOpenProjects }}
      />

      {/*
        ── The three states, as one bar and three counts ────────────────────

        This was three `Stat` cells across the full page: about three hundred
        and seventy pixels of card each, carrying a label and a single digit.
        A strip whose cells are 95% empty is what a reader means when they say
        a screen looks padded.

        `atRisk` and `delayed` overlap in the payload — a project past its end
        date is very often also flagged at risk — so the three counts must
        never be summed, and the API's `onTrack` is defined as neither. The
        partition that *is* exact is therefore: late, at risk but not yet late,
        and everything else. It is computed here from the same `progress` rows
        the table below renders, so the bar and the table can never disagree,
        and the three headline counts stay exactly as the endpoint reported
        them.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-border bg-card px-4 py-3.5 shadow-e1">
        <span className="flex flex-wrap items-center gap-x-7 gap-y-3">
          {[
            { label: 'On track', value: projects.onTrack, tone: 'success' as const },
            { label: 'At risk', value: projects.atRisk, tone: 'warning' as const },
            { label: 'Past deadline', value: projects.delayed, tone: 'critical' as const },
          ].map(s => (
            <span key={s.label} className="flex items-baseline gap-2">
              <span
                className={cn(
                  'text-[21px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
                  s.value === 0 ? 'text-muted-foreground'
                    : s.tone === 'success' ? 'text-success'
                      : s.tone === 'warning' ? 'text-warning' : 'text-destructive',
                )}
              >
                {s.value}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                {s.label}
              </span>
            </span>
          ))}
        </span>

        {/* Capped: a five-project composition drawn across seven hundred
            pixels reads as a decorative rule, not as a proportion. */}
        <span className="ml-auto flex w-full min-w-[13rem] max-w-md items-center gap-3">
          <SplitBar
            segments={[
              { value: settled, tone: 'accent', title: 'On schedule' },
              { value: flagged, tone: 'warn', title: 'At risk, not yet late' },
              { value: late, tone: 'bad', title: 'Past the end date' },
            ]}
            height={5}
          />
          {/* What the bar is drawn over, said plainly. The endpoint fetches
              the six most urgent active projects, so in a large organisation
              this is a sample and the label has to admit it. */}
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
            {rows.length < projects.active
              ? `${rows.length} of ${projects.active} shown`
              : `${rows.length} tracked`}
          </span>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-border bg-card px-4 py-5 text-[12.5px] text-muted-foreground shadow-e1">
          No active projects.
        </p>
      ) : (
        <div className="mt-5">
          <THead columns={cols} className="-ml-3">
            <span>Project</span>
            <span className="hidden md:block">Priority</span>
            <span className="hidden text-right md:block">Tasks</span>
            <span className="hidden text-right md:block">Milestones</span>
            <span>Progress</span>
            <span className="hidden text-right md:block">Deadline</span>
          </THead>
          <ul className="-ml-3">
            {/* Every active project the endpoint returns, rather than six of
                them. The route fetches the eight most urgent; showing six of
                eight left the strip's "8 tracked" describing rows the reader
                could not see. */}
            {rows.slice(0, 8).map(p => {
              const late = p.daysLeft !== null && p.daysLeft < 0;
              const reason = reasonFor(p);
              return (
                <li key={p.id}>
                  <TRow
                    columns={cols}
                    onClick={() => onOpenProject(p.id)}
                    ariaLabel={`Open ${p.name}${reason ? `. ${reason}` : ''}`}
                  >
                    {late ? <Rail severity="critical" /> : p.atRisk ? <Rail severity="warning" /> : null}
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-foreground">
                        {p.name}
                      </span>
                      {/* Why it is flagged, from the columns the view already
                          counted — not "At risk" repeated in grey. */}
                      <span
                        className={cn(
                          'mt-0.5 block truncate text-[11.5px]',
                          late ? 'text-destructive' : p.atRisk ? 'text-warning' : 'text-muted-foreground',
                        )}
                      >
                        {reason ?? statusLabel(p.status)}
                      </span>
                    </span>
                    <span className="hidden text-[12.5px] capitalize text-muted-foreground md:block">
                      {statusLabel(p.priority)}
                    </span>
                    <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground md:block">
                      {p.doneTasks}/{p.totalTasks}
                    </span>
                    <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground md:block">
                      {p.milestones.total === 0 ? '—' : `${p.milestones.done}/${p.milestones.total}`}
                    </span>
                    <span className="flex items-center gap-2">
                      <Meter
                        value={p.progress}
                        tone={late ? 'critical' : p.atRisk ? 'warning' : 'brand'}
                      />
                      <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-foreground">
                        {Math.round(p.progress)}%
                      </span>
                    </span>
                    <span
                      className={cn(
                        'hidden text-right text-[12.5px] tabular-nums md:block',
                        late ? 'font-medium text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {p.daysLeft === null
                        ? '—'
                        : late
                          ? `${Math.abs(p.daysLeft)}d over`
                          : `${p.daysLeft}d`}
                    </span>
                  </TRow>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Work and tasks                                                            */
/* -------------------------------------------------------------------------- */
/**
 * "Is work actually being completed?"
 *
 * Eight weeks of `tasks.completed_at`, bucketed by the organisation's week.
 * Bars rather than a line, because these are counts of discrete events in
 * discrete buckets — a line between two weekly counts implies a value halfway
 * between them on Thursday, which does not exist.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * Not a velocity, not a burndown, not a forecast, and not a per-person
 * workload. The payload carries completion timestamps and two org-wide totals;
 * anything else would be invented. `v_resource_allocation` could support a
 * real workload split, and is noted as the next thing this section could
 * honestly gain.
 */
function WorkTip({ active, payload, label }: any) {
  const v = useViz();
  if (!active || !payload?.length) return null;
  const n = payload[0].value as number;
  return (
    <TipShell title={`Week of ${label}`}>
      <TipRow
        colour={v.cash}
        label={n === 1 ? 'task completed' : 'tasks completed'}
        value={String(n)}
      />
    </TipShell>
  );
}

export function WorkIntelligence({
  work,
  projects,
  onOpenProjects,
  onOpenProject,
}: {
  work: DashboardWork;
  /** Optional: a role may see tasks without seeing the project table. */
  projects?: DashboardProjects;
  onOpenProjects: () => void;
  onOpenProject: ((id: string) => void) | null;
}) {
  const v = useViz();
  const weeks = work.completionByWeek;
  const anyCompletions = weeks.some(w => w.count > 0);

  /**
   * What is due next, from the project rows already on the payload.
   *
   * This card was a third the height of the pipeline panel beside it, which
   * left four hundred pixels of blank page in the middle of the composition.
   * Filling it with a real answer to "what is coming" was the alternative to
   * padding the chart — and deadlines are work, so it belongs here rather than
   * in the project table, which is a health view and not a calendar.
   */
  const deadlines = React.useMemo(
    () => (projects ? upcomingDeadlines(projects, 30).slice(0, 4) : []),
    [projects],
  );

  // The busiest week, so the current one can be read against the run rather
  // than only against its neighbour.
  const best = Math.max(...weeks.map(w => w.count), 0);
  const ticks = React.useMemo(() => niceTicks(best), [best]);
  const thisWeek = weeks[weeks.length - 1]?.count ?? 0;
  const lastWeek = weeks[weeks.length - 2]?.count ?? 0;

  return (
    <section className="min-w-0">
      <Head
        title="Work & tasks"
        count={work.openTasks || undefined}
        note={work.openTasks ? 'open across the organisation' : 'Nothing open'}
        action={{ label: 'Projects', onClick: onOpenProjects }}
      />

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <Stat label="Open" value={work.openTasks} />
          <Stat
            label="Overdue"
            value={work.overdueTasks}
            tone={work.overdueTasks > 0 ? 'critical' : 'default'}
          />
          <Stat
            label="Done · 8 weeks"
            value={work.completedLast8Weeks}
            tone={work.completedLast8Weeks > 0 ? 'success' : 'default'}
          />
        </div>

        {!anyCompletions ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
            No tasks have been completed in the last eight weeks. Completions appear here as work
            is closed out.
          </p>
        ) : (
          <>
            <div className="px-1 pb-1 pt-4">
              <div className="h-[168px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeks} margin={{ top: 4, right: 14, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={v.border} strokeDasharray={GRID_DASH} vertical={false} />
                    <XAxis
                      dataKey="week" tickLine={false} axisLine={false}
                      tick={tickStyle(v)} dy={8} interval="preserveStartEnd"
                    />
                    {/*
                      An explicit ladder, not recharts' idea of one.

                      `domain={[0, 'dataMax']}` was here to stop the default
                      rounding a peak of 2 up to 4 and drawing a full week's
                      output as a half-height stub. It fixed that and created
                      a second fault the small demo dataset could not show: it
                      pins the top tick to the data, so a best week of 15 gave
                      the rungs 0, 4, 8, 15. `niceTicks` keeps the first
                      property — the ceiling is the smallest sensible step
                      above the peak, never a doubling of it — while making
                      every gap the same.
                    */}
                    <YAxis
                      tickLine={false} axisLine={false} tick={tickStyle(v)}
                      width={30} allowDecimals={false}
                      ticks={ticks}
                      domain={[0, ticks[ticks.length - 1]]}
                    />
                    <Tooltip
                      content={<WorkTip />}
                      cursor={{ fill: v.axis, fillOpacity: 0.06 }}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]} animationDuration={550} maxBarSize={34}>
                      {weeks.map(w => (
                        /* The current week is still in progress, so it is
                           drawn lighter — otherwise a Tuesday reading always
                           looks like a collapse in output. */
                        <Cell
                          key={w.start}
                          fill={v.cash}
                          fillOpacity={w.start === weeks[weeks.length - 1].start ? 0.45 : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
              <span>
                This week{' '}
                <span className="font-medium tabular-nums text-foreground">{thisWeek}</span>
                {' · '}last week{' '}
                <span className="font-medium tabular-nums text-foreground">{lastWeek}</span>
              </span>
              <span className="ml-auto">Best week {best}</span>
            </div>
          </>
        )}

        {deadlines.length > 0 ? (
          <>
            <p className="border-t border-border px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
              Deadlines in the next 30 days
            </p>
            <ul className="p-1.5 pt-0">
              {deadlines.map(d => (
                <li key={d.id}>
                  <TRow
                    columns="grid-cols-[minmax(0,1fr)_5rem_4.5rem]"
                    onClick={onOpenProject ? () => onOpenProject(d.id) : undefined}
                    ariaLabel={onOpenProject ? `Open ${d.name}` : undefined}
                    className="py-1.5"
                  >
                    {d.atRisk ? <Rail severity="warning" /> : null}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground">{d.name}</span>
                      <span
                        className={cn(
                          'mt-0.5 block truncate text-[11.5px]',
                          d.atRisk ? 'text-warning' : 'text-muted-foreground',
                        )}
                      >
                        {Math.round(d.progress)}% complete
                        {d.atRisk ? ' · at risk' : ''}
                      </span>
                    </span>
                    <span className="text-right text-[12px] tabular-nums text-muted-foreground">
                      {formatDeadline(d.endDate, d.daysLeft)}
                    </span>
                    <span
                      className={cn(
                        'text-right text-[12px] font-medium tabular-nums',
                        d.daysLeft <= 7 ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {d.daysLeft}d
                    </span>
                  </TRow>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Upcoming                                                                  */
/* -------------------------------------------------------------------------- */
/** Re-exported for the composition; the deadline list lives with the table. */
export function upcomingDeadlines(projects: DashboardProjects, within = 21) {
  return projects.progress
    .filter(p => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= within)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .map(p => ({
      id: p.id,
      name: p.name,
      daysLeft: p.daysLeft as number,
      endDate: p.endDate,
      progress: p.progress,
      atRisk: p.atRisk,
    }));
}

export function formatDeadline(endDate: string | null, daysLeft: number): string {
  if (endDate) return formatDate(endDate, { day: 'numeric', month: 'short' });
  return `${daysLeft}d`;
}
