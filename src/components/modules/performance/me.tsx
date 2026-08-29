'use client';

import * as React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { Trophy, XCircle, Handshake, Target as TargetIcon, ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { formatNumber } from '@/lib/format';
import { useViz, axisTick, tickStyle, GRID_DASH, TipShell, TipRow } from '@/components/shared/readout/viz';

import { useEndpoint, money, metricValue, percent, targetStanding, formatDay, monthLabel, STAGE_LABELS, EVENT_LABELS } from './data';
import {
  SectionHead, Avatar, Standing, TargetBar, Figure, FigureRow,
  Blank, Spinner, Broken, periodChoices, type PeriodChoice,
} from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  One person's performance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this screen is for ──────────────────────────────────────────────
 *
 * Telling one person whether they are on track, and what to do about it. That
 * is the whole brief, and it is why this is not a second Executive Overview:
 * everything that does not serve that question belongs on CRM Home, which
 * already answers the commercial one well.
 *
 * The order of the page is the order the questions are actually asked:
 *
 *   1. Am I going to make it?      Targets, with the period's pace on them.
 *   2. What have I done?           Won, lost, win rate, cycle.
 *   3. What is still in play?      Open pipeline by stage.
 *   4. What happened lately?       The event stream, in plain words.
 *
 * ── Why there is no "score" ──────────────────────────────────────────────
 *
 * A single composite number would be easy to render and impossible to act on,
 * and inventing one would make this the gamified system the brief rules out.
 * Every figure here is a thing that happened, traceable to the event that
 * recorded it.
 */

interface Overview {
  member: { id: string; name: string; jobTitle: string | null; avatarUrl: string | null; role: string | null; department: string | null };
  self: boolean;
  period: { start: string; end: string; label: string; pace: number; today: string };
  currency: string;
  achievement: {
    revenueWon: number; revenueCollected: number; dealsWon: number; dealsLost: number;
    leadsQualified: number; leadsConverted: number; winRate: number | null;
    averageDeal: number | null; activitiesLogged: number; salesCycle: number | null;
  };
  pipeline: {
    openValue: number; weightedValue: number; count: number;
    byStage: { stage: string; count: number; value: number }[];
    top: { id: string; name: string; value: number; stage: string; probability: number; expectedClose: string | null; company: string | null }[];
  };
  targets: {
    id: string; metric: string; label: string; unit: 'money' | 'count'; note: string;
    target: number; currency: string; achieved: number; progress: number | null;
    projected: number | null; periodLabel: string; periodStart: string; periodEnd: string; notes: string;
  }[];
  months: { month: string; won: number; lost: number; count: number }[];
  recent: { type: string; at: string; entityId: string; title: string; value: number }[];
}

export function MyPerformance({ memberId }: { memberId?: string | null }) {
  const choices = React.useMemo(() => periodChoices(), []);
  const [period, setPeriod] = React.useState<PeriodChoice>(choices[0]);
  const openRecord = useAppStore(s => s.openRecord);
  const viz = useViz();

  const url = React.useMemo(() => {
    const q = new URLSearchParams();
    if (memberId) q.set('member', memberId);
    if (period.from) q.set('from', period.from);
    if (period.to) q.set('to', period.to);
    return `/api/performance/overview?${q}`;
  }, [memberId, period]);

  const { data, loading, error, reload } = useEndpoint<Overview>(url);

  if (loading && !data) return <Spinner label="Reading your numbers" />;
  if (error) return <Broken message={error} onRetry={reload} />;
  if (!data) return null;

  const { achievement: a, pipeline: p, currency } = data;
  const pace = data.period.pace;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Who, and when ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Avatar name={data.member.name} url={data.member.avatarUrl} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            {data.self ? 'Your performance' : data.member.name}
          </h2>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {[data.member.jobTitle, data.member.department].filter(Boolean).join(' · ')
              || 'No job title recorded'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {choices.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setPeriod(c)}
              aria-current={c.id === period.id ? 'true' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                c.id === period.id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 1. Am I going to make it ────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHead
          title="Against target"
          note={`${data.period.label} · ${Math.round(pace * 100)}% of the period gone`}
        />

        {data.targets.length === 0 ? (
          <div className="rounded-xl border border-border bg-card shadow-e1">
            <Blank
              icon={TargetIcon}
              title="No target set for this period"
              body={
                data.self
                  ? 'Your manager or HR sets these. Until one exists, the figures below are the whole story.'
                  : 'Nobody has set this person a target for the period you are looking at.'
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.targets.map(t => {
              const stand = targetStanding(t.progress, pace);
              return (
                <div key={t.id} className="rounded-xl border border-border bg-card p-4 shadow-e1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-medium text-foreground">{t.label}</p>
                    <Standing tone={stand.tone} word={stand.word} />
                  </div>

                  <p className="mt-2 text-[24px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-foreground">
                    {metricValue(t.achieved, t.unit, t.currency || currency)}
                    <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">
                      of {metricValue(t.target, t.unit, t.currency || currency)}
                    </span>
                  </p>

                  <TargetBar progress={t.progress} pace={pace} tone={stand.tone} className="mt-3" />

                  <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span className="tabular-nums">{percent(t.progress)} achieved</span>
                    {/*
                      The run rate, only once there is enough period behind it
                      to mean anything. The endpoint returns null before that
                      rather than a confident number that is nonsense.
                    */}
                    {t.projected !== null && (
                      <span className="tabular-nums">
                        On this rate: {metricValue(t.projected, t.unit, t.currency || currency)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 2. What have I done ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHead title="Closed" note="From the record of what happened, not from today's deal values" />

        <FigureRow className="sm:grid-cols-4">
          <Figure
            label="Revenue won"
            value={money(a.revenueWon, currency)}
            sub={`${formatNumber(a.dealsWon)} ${a.dealsWon === 1 ? 'deal' : 'deals'}`}
            tone={a.revenueWon > 0 ? 'success' : 'default'}
          />
          <Figure
            label="Win rate"
            value={percent(a.winRate)}
            sub={a.winRate === null
              ? 'Nothing decided yet'
              : `${a.dealsWon} won, ${a.dealsLost} lost`}
          />
          <Figure
            label="Average deal"
            value={a.averageDeal === null ? '-' : money(a.averageDeal, currency)}
            sub={a.averageDeal === null ? 'Nothing won yet' : 'Across deals won'}
          />
          <Figure
            label="Sales cycle"
            value={a.salesCycle === null ? '-' : `${a.salesCycle}d`}
            sub={a.salesCycle === null ? 'No closed deal to measure' : 'First stage to close'}
          />
        </FigureRow>

        {data.months.some(m => m.won > 0 || m.lost > 0) && (
          <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
            <p className="mb-3 text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
              Won and lost by month
            </p>
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.months} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={viz.border} strokeDasharray={GRID_DASH} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={monthLabel}
                    {...tickStyle(viz)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tickFormatter={axisTick} {...tickStyle(viz)} axisLine={false} tickLine={false} width={52} />
                  <Tooltip
                    cursor={{ fill: viz.border, opacity: 0.35 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as { won: number; lost: number; count: number };
                      return (
                        <TipShell title={monthLabel(String(label))}>
                          <TipRow label="Won" value={money(row.won, currency)} colour={viz.cash} />
                          <TipRow label="Lost" value={money(row.lost, currency)} colour={viz.bad} />
                          <TipRow label="Deals won" value={String(row.count)} />
                        </TipShell>
                      );
                    }}
                  />
                  <Bar dataKey="won" radius={[3, 3, 0, 0]} maxBarSize={26}>
                    {data.months.map((m, i) => (
                      <Cell key={i} fill={viz.cash} />
                    ))}
                  </Bar>
                  <Bar dataKey="lost" radius={[3, 3, 0, 0]} maxBarSize={26}>
                    {data.months.map((m, i) => (
                      <Cell key={i} fill={viz.bad} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* ── 3. What is still in play ────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHead
          title="Still open"
          count={p.count}
          note="Live pipeline, as it stands right now"
        />

        {p.count === 0 ? (
          <div className="rounded-xl border border-border bg-card shadow-e1">
            <Blank
              icon={Handshake}
              title="Nothing open"
              body={data.self
                ? 'You have no deals in play. That is the number to change first.'
                : 'This person has no deals in play.'}
            />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-foreground">
                  {money(p.openValue, currency)}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {money(p.weightedValue, currency)} weighted
                </p>
              </div>

              <div className="mt-4 flex flex-col gap-2.5">
                {p.byStage.map(s => {
                  const share = p.openValue > 0 ? s.value / p.openValue : 0;
                  return (
                    <div key={s.stage}>
                      <div className="flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="text-muted-foreground">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                        <span className="tabular-nums text-foreground">
                          {money(s.value, currency)}
                          <span className="ml-1.5 text-muted-foreground">{s.count}</span>
                        </span>
                      </div>
                      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-border/70">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${share * 100}%`, background: 'var(--chart-1)' }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-e1">
              <p className="px-4 pb-1 pt-3.5 text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                Biggest open
              </p>
              <ul className="divide-y divide-border">
                {p.top.map(d => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => openRecord('crm', 'deal', d.id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{d.name}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {[d.company, STAGE_LABELS[d.stage] ?? d.stage].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-medium tabular-nums text-foreground">
                          {money(d.value, currency)}
                        </span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {d.probability}%
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* ── 4. What happened lately ─────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHead title="Lately" note="Every entry here is an event the system recorded, not a summary" />

        {data.recent.length === 0 ? (
          <div className="rounded-xl border border-border bg-card shadow-e1">
            <Blank
              icon={TargetIcon}
              title="Nothing recorded in this period"
              body="Wins, losses, qualified leads and paid invoices all appear here as they happen."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
            {data.recent.map((e, i) => {
              const won = e.type === 'deal.won';
              const lost = e.type === 'deal.lost';
              const isDeal = e.type.startsWith('deal.');
              return (
                <li key={`${e.entityId}-${e.at}-${i}`}>
                  <button
                    type="button"
                    disabled={!isDeal}
                    onClick={() => isDeal && openRecord('crm', 'deal', e.entityId)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      isDeal && 'hover:bg-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full',
                        won ? 'bg-success/12 text-success'
                          : lost ? 'bg-destructive/12 text-destructive'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {won ? <Trophy className="size-3" />
                        : lost ? <XCircle className="size-3" />
                          : <ArrowRight className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">{e.title}</span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {EVENT_LABELS[e.type] ?? e.type} · {formatDay(e.at)}
                      </span>
                    </span>
                    {e.value > 0 && (
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                        {money(e.value, currency)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
