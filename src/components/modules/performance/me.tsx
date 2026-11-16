'use client';

import * as React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { Handshake, Target as TargetIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { formatNumber } from '@/lib/format';
import { useViz, axisTick, tickStyle, GRID_DASH, TipShell, TipRow } from '@/components/shared/readout/viz';

import { useEndpoint, money, metricValue, percent, targetStanding, monthLabel, STAGE_LABELS } from './data';
import {
  SectionHead, Avatar, Standing, TargetBar, Figure, FigureRow,
  Blank, Spinner, Broken, periodChoices, type PeriodChoice,
} from './ui';
import { EvidenceRecord } from './evidence';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  One person's performance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this screen is for ──────────────────────────────────────────────
 *
 * Telling one person how they are doing here, and what the evidence for it is.
 *
 * It used to answer something narrower — *how are your deals going* — which is
 * the right question for a salesperson and the wrong one for everybody else in
 * the company. A developer, a designer, a support agent and an accountant all
 * opened their own performance screen and found an empty pipeline chart.
 *
 * The page is now in two parts:
 *
 *   1. The evidence record.   Delivered work, goals, attendance, recognition,
 *                             reviews and commercial, each figure printed with
 *                             what it was computed from. `evidence.tsx`.
 *   2. The commercial detail. Targets against pace, closures, open pipeline —
 *                             everything this screen used to be, now shown
 *                             only to people who have a commercial record.
 *
 * ── Why there is no "score" ──────────────────────────────────────────────
 *
 * A single composite number would be easy to render and impossible to act on,
 * and inventing one would make this the gamified system the brief rules out.
 * Every figure here is a thing that happened, traceable to the event that
 * recorded it. `lib/evidence.ts` states the same rule where the figures are
 * actually computed, because that is where somebody would go to add one.
 */

/**
 * Hoisted so the prop keeps its identity between renders.
 *
 * A fresh `['commercial']` on every render is a new object every time, which
 * is the shape of bug that turns a memoised child into one that re-renders
 * with the parent for no reason. Cheap to avoid, tedious to find later.
 */
const HIDE_COMMERCIAL = ['commercial'] as const;
const HIDE_NOTHING: readonly string[] = [];

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
    top: { id: string; name: string; value: number; currency?:string; stage: string; probability: number; expectedClose: string | null; company: string | null }[];
  };
  targets: {
    id: string; metric: string; label: string; unit: 'money' | 'count'; note: string;
    target: number; currency: string; achieved: number; progress: number | null;
    projected: number | null; periodLabel: string; periodStart: string; periodEnd: string; notes: string;
  }[];
  months: { month: string; won: number; lost: number; count: number }[];
  recent: { type: string; at: string; entityId: string; title: string; value: number; currency?:string }[];
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

  /**
   * Does this person have a commercial record at all?
   *
   * Three independent signs, because any one of them alone would hide the
   * sections from somebody who legitimately needs them: a new salesperson has
   * a target and no closures, somebody mid-quarter has closures and an empty
   * pipeline, and a manager may hold a target against a pipeline they do not
   * personally own.
   */
  const hasCommercial =
    p.count > 0 || data.targets.length > 0 || a.dealsWon + a.dealsLost > 0;

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

      {/*
        ── The evidence record ───────────────────────────────────────────

        First on the page, and first deliberately. Everything below this is
        commercial, and for most of the company the commercial sections are
        empty — a designer opening their own performance screen used to find a
        pipeline chart with nothing in it and reasonably concluded the feature
        was not for them.

        It takes its dates from this screen's period control rather than
        owning one, so the two halves of the page cannot end up describing
        different quarters.
      */}
      <EvidenceRecord
        memberId={data.member.id}
        from={period.from}
        to={period.to}
        hideAreas={hasCommercial ? HIDE_COMMERCIAL : HIDE_NOTHING}
      />

      {/*
        ── The commercial detail, for the people it applies to ────────────

        Shown when there is something to show: an owned pipeline, a target, or
        a deal closed either way in this period. The alternative — rendering
        three empty charts for everybody who does not sell — is the thing that
        made this screen feel broken to most of its users.

        This is a display decision and nothing more. The figures were already
        bounded by RLS long before they reached here.
      */}
      {hasCommercial && (
        <>
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
                          {money(d.value, d.currency??currency)}
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

      {/*
        The commercial event stream used to live here as a fifth section
        called "Lately". It has been removed rather than kept: the evidence
        timeline above already lists these same events, alongside completed
        tasks, achieved goals, recognition and closed reviews, and it opens
        the same records on click. Two timelines on one screen, one of them a
        strict subset of the other, is the duplication this pass exists to
        remove.
      */}
        </>
      )}
    </div>
  );
}
