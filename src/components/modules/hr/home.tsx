'use client';

import * as React from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  Plate, Head, Card, Band, Signal, Stat, Bar, TRow, THead, Meter,
} from '@/components/shared/readout/primitives';
import {
  useViz, axisTick, tickStyle, GRID_DASH, TipShell, TipRow, AreaFill,
} from '@/components/shared/readout/viz';
import { Button } from '@/components/ui/button';
import {
  EMPLOYMENT_TYPE_LABELS, STAGE_LABELS, APPLICATION_STAGE_LABELS,
  CASE_CATEGORY_LABELS, labelOf, tenureLabel,
} from '@/lib/hr';
import { statusLabel } from '@/lib/constants';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { getOne, pct, monthLabel, whenWord, todayISO } from './data';
import { PersonCell, Faces, StagePill, Blank, Skeleton, Pill, day, eventLine } from './ui';
import type { Overview, Section } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HR Home - the workforce, read in one screen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * There was no HR home. The module opened on a paginated table of every
 * employee, with three `StatCard`s above it - active count, on leave today,
 * department count - and a "Presence" column. Arriving at the people module of
 * a business operating system and being shown a directory answers a question
 * almost nobody arrives with; "is anything wrong with my workforce today" is
 * the one they do.
 *
 * ── The composition ──────────────────────────────────────────────────────
 *
 *   plate       who we are, how that has moved, and who is in today
 *   01 TODAY    attendance, who is out, what is waiting on somebody
 *   02 SHAPE    headcount over a year, by department, by employment type
 *   03 MOVING   hiring, onboarding and offboarding in flight
 *   04 PEOPLE   the events with dates on them, and recent history
 *
 * Four movements with a `Band` between them, because ten sections drawn
 * identically is a stack of widgets however good each one is.
 *
 * ── The two rules every figure here obeys ────────────────────────────────
 *
 * **Nothing is invented.** Where a figure cannot be computed - turnover with
 * no departures to divide, median tenure with no start dates - the endpoint
 * returns `null` and this draws the absence. `/api/dashboard` once answered a
 * hard-coded `0` for overdue receivables and told every organisation on the
 * platform it had nothing overdue; that is the failure being avoided.
 *
 * **Every bar is an exact partition.** A composition whose segments do not add
 * up to the number printed above them is worse than no bar, so the attendance
 * signal's segments are counted from one population and `unrecorded` is a
 * segment rather than being folded into `absent` - at nine in the morning most
 * of a company is unrecorded, and a screen that calls them absent is wrong
 * every day before lunch.
 */

export function HrHome({
  onOpenPerson,
  onGo,
}: {
  onOpenPerson: (memberId: string) => void;
  onGo: (section: Section) => void;
}) {
  const [data, setData] = React.useState<Overview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const viz = useViz();
  const today = todayISO();

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await getOne<Overview>('/api/hr/overview'));
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Could not load the workforce');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  /**
   * The tables whose changes move a number on this screen.
   *
   * Not every HR table: `useModuleRealtime` debounces and refetches the whole
   * overview once, so listing a table that changes hourly and moves nothing
   * here would cost a refetch per connected client for no visible difference.
   */
  useModuleRealtime('hr-home', [
    'leave_requests', 'attendance_records', 'employment_events',
    'employee_checklist_items', 'hr_cases',
  ], () => load(true));

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-52 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><Skeleton rows={4} /></Card>
          <Card><Skeleton rows={4} /></Card>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <Blank
          title="The workforce could not be loaded"
          note="Something went wrong reading the People data. Try again in a moment."
          action={<Button size="sm" variant="outline" onClick={() => load()}>Retry</Button>}
        />
      </Card>
    );
  }

  const { workforce: w, attendanceToday: a, events, journeys, recruitment, cases, leave } = data;

  /**
   * Whose workforce this is.
   *
   * Every figure comes from rows the caller may see, so an employee opening
   * this screen gets a page about themselves - and the page says so instead of
   * reporting "Headcount: 1", which would read as the company having one
   * person in it.
   */
  const isPersonal = w.headcount <= 1 && !['owner', 'administrator', 'hr_staff'].includes(data.scope.role);

  const trendData = w.trend.map(t => ({ ...t, label: monthLabel(t.month) }));
  const latest = w.trend[w.trend.length - 1];
  const yearAgo = w.trend[0];
  const yearChange = latest && yearAgo ? latest.headcount - yearAgo.headcount : 0;

  const outToday = data.peopleOnLeaveToday.map(l => ({
    id: l.member?.id ?? l.memberId,
    name: l.member?.profiles?.fullName ?? 'Someone',
    avatarUrl: l.member?.profiles?.avatarUrl ?? null,
  }));

  const departmentMax = Math.max(1, ...w.byDepartment.map(d => d.count));

  return (
    <div className="nm-enter space-y-5">
      {/* ── The plate ───────────────────────────────────────────────────── */}
      <Plate>
        <div className="px-5 pt-4 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-panel-muted">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
              {isPersonal ? ' · your record' : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[12px] text-panel-muted hover:bg-white/10 hover:text-panel-fg"
                onClick={() => load()}
              >
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3 pb-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-panel-muted">
                {isPersonal ? 'You' : 'Headcount'}
              </p>
              <p className="mt-1 text-[46px] font-semibold leading-none tabular-nums tracking-[-0.035em] text-panel-fg">
                {w.headcount}
              </p>
              <p className="mt-2 text-[12.5px] text-panel-muted">
                {w.newHires > 0 || w.departures > 0
                  ? `${w.newHires} joined and ${w.departures} left in the last 30 days`
                  : 'No joiners or leavers in the last 30 days'}
                {yearChange !== 0 ? ` · ${yearChange > 0 ? '+' : ''}${yearChange} over the year` : ''}
              </p>
            </div>

            {/* The twelve-month line, whose last point is the number beside it
                by construction - the endpoint counts both from the same rows. */}
            <div className="min-w-[220px] flex-1">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-panel-muted">
                Headcount · last 12 months
              </p>
              <div className="mt-1.5 h-[64px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                    <defs><AreaFill id="hr-head" colour={viz.cash} from={0.3} /></defs>
                    <Area
                      type="monotone" dataKey="headcount" stroke={viz.cash}
                      strokeWidth={1.75} fill="url(#hr-head)" isAnimationActive={false}
                    />
                    <Tooltip
                      cursor={{ stroke: 'rgba(255,255,255,0.18)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as typeof trendData[number];
                        return (
                          <TipShell title={p.label}>
                            <TipRow label="Headcount" value={String(p.headcount)} />
                            {p.joined ? <TipRow label="Joined" value={`+${p.joined}`} /> : null}
                            {p.left ? <TipRow label="Left" value={`-${p.left}`} /> : null}
                          </TipShell>
                        );
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between text-[10.5px] tabular-nums text-panel-muted">
                <span>{trendData[0]?.label}</span>
                <span>{trendData[trendData.length - 1]?.label}</span>
              </div>
            </div>
          </div>
        </div>

        {/* The readout strip. Five instruments in a divided row rather than a
            grid, so they cannot orphan a sixth cell at any width. */}
        <div className="grid grid-cols-2 divide-x divide-y divide-panel-line border-t border-panel-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
          <Signal
            className="px-5 py-3.5"
            label="In today"
            value={String(a.present + a.remote)}
            note={a.unrecorded ? `${a.unrecorded} not yet recorded` : `${a.stillIn} still clocked in`}
            noteTone={a.unrecorded > a.present ? 'warning' : 'default'}
            segments={[
              { value: a.present, tone: 'accent', title: 'On site' },
              { value: a.remote, tone: 'claim', title: 'Remote' },
              { value: a.onLeave, tone: 'quiet', title: 'On leave' },
              { value: a.absent, tone: 'bad', title: 'Absent' },
              { value: a.unrecorded, tone: 'warn', title: 'Not recorded' },
            ]}
            onClick={() => onGo('attendance')}
          />
          <Signal
            className="px-5 py-3.5"
            label="Away today"
            value={String(a.onLeave)}
            note={leave.upcoming.length ? `${leave.upcoming.length} more in the next fortnight` : 'Nobody booked ahead'}
            onClick={() => onGo('leave')}
          />
          <Signal
            className="px-5 py-3.5"
            label="Awaiting a decision"
            value={String(leave.pending + (data.payroll.awaitingApproval ?? 0))}
            note={leave.pending ? `${leave.pending} leave request${leave.pending === 1 ? '' : 's'}` : 'Nothing pending'}
            noteTone={leave.pending ? 'warning' : 'default'}
            segments={[
              { value: leave.pending, tone: 'warn', title: 'Leave' },
              { value: data.payroll.awaitingApproval ?? 0, tone: 'claim', title: 'Payroll' },
            ]}
            onClick={() => onGo('leave')}
          />
          <Signal
            className="px-5 py-3.5"
            label="Hiring"
            value={String(recruitment.openOpenings)}
            note={recruitment.activeApplications
              ? `${recruitment.activeApplications} candidate${recruitment.activeApplications === 1 ? '' : 's'} in play`
              : 'No open pipelines'}
            segments={Object.entries(recruitment.byStage).map(([stage, n]) => ({
              value: n, tone: stage === 'offer' ? 'accent' : 'quiet',
              title: labelOf(APPLICATION_STAGE_LABELS, stage),
            }))}
            onClick={() => onGo('recruitment')}
          />
          <Signal
            className="px-5 py-3.5"
            label="Open HR cases"
            value={String(cases.open)}
            note={cases.unassigned ? `${cases.unassigned} unassigned` : cases.assignedToMe ? `${cases.assignedToMe} are yours` : 'All assigned'}
            noteTone={cases.unassigned ? 'warning' : 'default'}
            onClick={() => onGo('cases')}
          />
        </div>
      </Plate>

      {/* ── 01 Today ────────────────────────────────────────────────────── */}
      <Band index="01" title="Today" note="who is in, who is out, and what is waiting" />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5">
            <Head title="Attendance" note={day(a.date)} />
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => onGo('attendance')}>
              Open
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 divide-x divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-y-0">
            <Stat label="On site" value={a.present} />
            <Stat label="Remote" value={a.remote} />
            <Stat label="Late" value={a.late} tone={a.late ? 'warning' : 'default'} />
            <Stat label="Absent" value={a.absent} tone={a.absent ? 'critical' : 'default'} />
          </div>
          <div className="px-4 py-3">
            {a.unrecorded > 0 ? (
              <p className="text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">{a.unrecorded}</span>{' '}
                {a.unrecorded === 1 ? 'person has' : 'people have'} not clocked in yet.
                That is not the same as absent, and is only worth acting on late in the day.
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Everybody expected today has a record.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5">
            <Head title="Away" count={outToday.length} />
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => onGo('leave')}>
              Leave
            </Button>
          </div>
          {outToday.length ? (
            <div className="px-4 py-3">
              <Faces people={outToday} max={8} size="sm" />
              <ul className="mt-3 space-y-1.5">
                {data.peopleOnLeaveToday.slice(0, 4).map(l => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="truncate text-foreground">
                      {l.member?.profiles?.fullName ?? 'Someone'}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-muted-foreground">
                      {statusLabel(l.type)} · back {whenWord(l.endDate)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Blank title="Everybody is in" note="Nobody has approved leave covering today." />
          )}
        </Card>
      </div>

      {leave.pending > 0 ? (
        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5">
            <Head title="Waiting on a decision" count={leave.pending} />
            <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => onGo('leave')}>
              Review
            </Button>
          </div>
          <div className="mt-2.5 px-2 pb-2">
            <THead columns="grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
              <span>Person</span><span>Dates</span><span className="text-right">Type</span>
            </THead>
            {leave.pendingRequests.slice(0, 5).map(r => (
              <TRow
                key={r.id}
                columns="grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                onClick={() => onGo('leave')}
                ariaLabel={`Review leave for ${r.member?.profiles?.fullName ?? 'a colleague'}`}
              >
                <PersonCell
                  id={r.member?.id ?? r.memberId}
                  name={r.member?.profiles?.fullName}
                  avatarUrl={r.member?.profiles?.avatarUrl}
                />
                <span className="truncate text-[12.5px] text-muted-foreground">
                  {day(r.startDate)} – {day(r.endDate)}
                </span>
                <span className="text-right"><Pill>{statusLabel(r.type)}</Pill></span>
              </TRow>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ── 02 Shape ────────────────────────────────────────────────────── */}
      <Band index="02" title="Shape" note="how the workforce is made up, and how it moved" />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <div className="px-4 pt-3.5">
            <Head
              title="Headcount"
              note={w.medianTenureMonths !== null
                ? `Median tenure ${tenureLabel(w.medianTenureMonths).toLowerCase()}`
                : 'No start dates recorded yet'}
            />
          </div>
          <div className="mt-2 h-[190px] px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <defs><AreaFill id="hr-head-full" colour={viz.cash} /></defs>
                <CartesianGrid strokeDasharray={GRID_DASH} stroke={viz.border} vertical={false} />
                <XAxis dataKey="label" {...tickStyle(viz)} tickLine={false} axisLine={false} />
                <YAxis
                  {...tickStyle(viz)} tickLine={false} axisLine={false}
                  width={44} tickFormatter={axisTick} allowDecimals={false}
                />
                <Area
                  type="monotone" dataKey="headcount" stroke={viz.cash}
                  strokeWidth={2} fill="url(#hr-head-full)" isAnimationActive={false}
                />
                <Tooltip
                  cursor={{ stroke: viz.border }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as typeof trendData[number];
                    return (
                      <TipShell title={p.label}>
                        <TipRow label="Headcount" value={String(p.headcount)} />
                        <TipRow label="Joined" value={p.joined ? `+${p.joined}` : '—'} />
                        <TipRow label="Left" value={p.left ? `-${p.left}` : '—'} />
                      </TipShell>
                    );
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
            <Stat label="Joined · 90 days" value={w.newHires90} />
            <Stat label="Left · 90 days" value={w.departures90} />
            <Stat
              label="Turnover · 90 days"
              /* Null rather than a fabricated zero: with nobody to divide by,
                 "0%" is a claim the data cannot support. */
              value={w.turnover90 === null ? '—' : `${w.turnover90}%`}
              tone={w.turnover90 !== null && w.turnover90 > 10 ? 'warning' : 'default'}
            />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="px-4 pt-3.5">
              <Head title="Departments" count={w.byDepartment.length} />
            </div>
            {w.byDepartment.length ? (
              <ul className="space-y-2.5 px-4 py-3">
                {w.byDepartment.slice(0, 7).map(d => (
                  <li key={d.id ?? 'none'}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[12.5px] text-foreground">{d.name}</span>
                      <span className="shrink-0 text-[12px] font-semibold tabular-nums text-muted-foreground">
                        {d.count}
                      </span>
                    </div>
                    <Meter value={(d.count / departmentMax) * 100} className="mt-1.5" tone="brand" />
                  </li>
                ))}
              </ul>
            ) : (
              <Blank title="No departments yet" note="Departments are created in Admin, and every employee assigned to one appears here." />
            )}
          </Card>

          <Card>
            <div className="px-4 pt-3.5">
              <Head title="Employment types" />
            </div>
            <div className="px-4 py-3">
              <Bar
                segments={Object.entries(w.byType).map(([type, n], i) => ({
                  value: n,
                  tone: (i === 0 ? 'accent' : i === 1 ? 'claim' : 'quiet') as any,
                  title: labelOf(EMPLOYMENT_TYPE_LABELS, type),
                }))}
                height={6}
              />
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {Object.entries(w.byType).map(([type, n]) => (
                  <li key={type} className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="truncate text-muted-foreground">
                      {labelOf(EMPLOYMENT_TYPE_LABELS, type)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </div>

      {/* ── 03 Moving ───────────────────────────────────────────────────── */}
      <Band index="03" title="Moving" note="hiring, starting, and leaving" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5">
            <Head title="Hiring" count={recruitment.openOpenings} />
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => onGo('recruitment')}>
              Open
            </Button>
          </div>
          {recruitment.openings.length ? (
            <div className="px-4 py-3">
              <p className="text-[12px] text-muted-foreground">
                {recruitment.positions} position{recruitment.positions === 1 ? '' : 's'} to fill ·{' '}
                {recruitment.activeApplications} candidate{recruitment.activeApplications === 1 ? '' : 's'}
              </p>
              <ul className="mt-3 space-y-2">
                {recruitment.openings.filter(o => o.status === 'open').slice(0, 4).map(o => (
                  <li key={o.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {o.title}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {o.department?.name ?? 'No department'} · opened {whenWord(o.openedOn)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {recruitment.interviewsThisWeek.length ? (
                <p className="mt-3 border-t border-border pt-2.5 text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {recruitment.interviewsThisWeek.length}
                  </span>{' '}
                  interview{recruitment.interviewsThisWeek.length === 1 ? '' : 's'} scheduled this week.
                </p>
              ) : null}
            </div>
          ) : (
            <Blank
              title="Nothing open"
              note="Job openings, candidates and interviews live in Recruitment."
              action={
                <Button size="sm" variant="outline" onClick={() => onGo('recruitment')}>
                  Open a role
                </Button>
              }
            />
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5">
            <Head
              title="Onboarding"
              count={journeys.onboarding.length}
              note={journeys.overdueSteps ? `${journeys.overdueSteps} steps overdue` : undefined}
            />
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => onGo('journeys')}>
              Open
            </Button>
          </div>
          {journeys.onboarding.length ? (
            <ul className="space-y-3 px-4 py-3">
              {journeys.onboarding.slice(0, 4).map(j => (
                <li key={j.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[12.5px] text-foreground">
                      {j.member?.profiles?.fullName ?? 'A new starter'}
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {j.done}/{j.total}
                    </span>
                  </div>
                  <Meter
                    value={j.percent}
                    className="mt-1.5"
                    tone={j.overdue ? 'warning' : 'accent'}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Started {whenWord(j.anchorDate)}
                    {j.overdue ? ` · ${j.overdue} overdue` : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Blank title="Nobody onboarding" note="A new hire starts a checklist, and each step becomes a to-do in the right person's My Work." />
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5">
            <Head title="Leaving" count={events.leaving.length} />
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => onGo('journeys')}>
              Open
            </Button>
          </div>
          {events.leaving.length ? (
            <ul className="space-y-2.5 px-4 py-3">
              {events.leaving.slice(0, 5).map(p => (
                <li key={p.memberId} className="flex items-center justify-between gap-3">
                  <PersonCell
                    id={p.memberId}
                    name={p.fullName}
                    avatarUrl={p.avatarUrl}
                    secondary={p.departmentName}
                    onClick={() => onOpenPerson(p.memberId)}
                  />
                  <StagePill stage={p.lifecycleStage} />
                </li>
              ))}
            </ul>
          ) : (
            <Blank title="Nobody is leaving" note="Recording an exit moves somebody to notice and starts the offboarding, without closing their account." />
          )}
        </Card>
      </div>

      {/* ── 04 People ───────────────────────────────────────────────────── */}
      <Band index="04" title="People" note="the dates coming up, and what has just changed" />

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Coming up" note="next 30 days" />
          </div>
          {events.starting.length + events.anniversaries.length + events.probationEnding.length ? (
            <ul className="divide-y divide-border">
              {events.starting.slice(0, 3).map(p => (
                <li key={`start-${p.memberId}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <PersonCell
                    id={p.memberId} name={p.fullName} avatarUrl={p.avatarUrl}
                    secondary={p.jobTitle ?? p.departmentName}
                    onClick={() => onOpenPerson(p.memberId)}
                  />
                  <span className="shrink-0 text-right">
                    <span className="block text-[11.5px] font-medium text-foreground">Starting</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {whenWord(p.hiredOn)}
                    </span>
                  </span>
                </li>
              ))}
              {events.probationEnding.slice(0, 3).map(p => (
                <li key={`prob-${p.memberId}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <PersonCell
                    id={p.memberId} name={p.fullName} avatarUrl={p.avatarUrl}
                    secondary={p.jobTitle ?? p.departmentName}
                    onClick={() => onOpenPerson(p.memberId)}
                  />
                  <span className="shrink-0 text-right">
                    <span className="block text-[11.5px] font-medium text-warning">Probation ends</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {whenWord(p.probationEndsOn)}
                    </span>
                  </span>
                </li>
              ))}
              {events.anniversaries.slice(0, 4).map(p => (
                <li key={`anniv-${p.memberId}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <PersonCell
                    id={p.memberId} name={p.fullName} avatarUrl={p.avatarUrl}
                    secondary={p.jobTitle ?? p.departmentName}
                    onClick={() => onOpenPerson(p.memberId)}
                  />
                  <span className="shrink-0 text-right">
                    <span className="block text-[11.5px] font-medium text-foreground">
                      {p.years} year{p.years === 1 ? '' : 's'}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{whenWord(p.date)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            /* No birthdays, and the empty state says why rather than leaving a
               reader to wonder where they are. */
            <Blank
              title="Nothing in the next 30 days"
              note="Work anniversaries, probation dates and start dates appear here. Birthdays do not: this product does not hold a date of birth, and inventing one would be worse than the gap."
            />
          )}
        </Card>

        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Recent changes" />
          </div>
          {data.activity.length ? (
            <ul className="divide-y divide-border">
              {data.activity.slice(0, 7).map(e => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <PersonCell
                    id={e.member?.id ?? e.memberId}
                    name={e.member?.profiles?.fullName}
                    avatarUrl={e.member?.profiles?.avatarUrl}
                    /* One describer, shared with the profile's timeline. Two of
                       these events carry a stored enum in `reason` - a
                       compensation change writes `comp_change_reason` and an
                       exit writes `exit_type` - and printing it raw put
                       "market_adjustment" and "resignation" on this feed. */
                    secondary={eventLine(e)}
                    onClick={() => onOpenPerson(e.memberId)}
                  />
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {whenWord(e.effectiveOn)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Blank title="No changes recorded" note="Promotions, transfers and joiners appear here as they happen." />
          )}
        </Card>
      </div>

      {cases.recent.length ? (
        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5">
            <Head title="HR cases" count={cases.open} />
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => onGo('cases')}>
              Case desk
            </Button>
          </div>
          <div className="mt-2.5 px-2 pb-2">
            <THead columns="grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1fr)_auto]">
              <span>Ref</span><span>Subject</span><span>Category</span><span className="text-right">Raised</span>
            </THead>
            {cases.recent.slice(0, 5).map(c => (
              <TRow
                key={c.id}
                columns="grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1fr)_auto]"
                onClick={() => onGo('cases')}
                ariaLabel={`Open case ${c.reference}`}
              >
                <span className="font-mono text-[11.5px] text-muted-foreground">{c.reference}</span>
                <span className="truncate text-[12.5px] text-foreground">{c.subject}</span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {labelOf(CASE_CATEGORY_LABELS, c.category)}
                </span>
                <span className="text-right text-[11.5px] text-muted-foreground">
                  {whenWord(c.createdAt.slice(0, 10))}
                </span>
              </TRow>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
