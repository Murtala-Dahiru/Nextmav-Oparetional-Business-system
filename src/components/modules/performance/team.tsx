'use client';

import * as React from 'react';
import { Users, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';

import {
  useEndpoint, money, metricValue, percent, targetStanding,
} from './data';
import {
  SectionHead, Avatar, Standing, TargetBar, Figure, FigureRow,
  Blank, Spinner, Broken, periodChoices, type PeriodChoice,
} from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A team, and how it is doing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Who appears here ─────────────────────────────────────────────────────
 *
 * Whoever the database says this person may see. `auth_visible_member_ids()`
 * has answered that question since 0005 and answers it for every table in the
 * performance layer: owners, administrators and HR get the organisation, a
 * manager gets their department plus their direct reports, everyone else gets
 * themselves. Nothing on this screen decides visibility, which is why nothing
 * on this screen can get it wrong.
 *
 * ── Why the bottom of the list is not hidden ─────────────────────────────
 *
 * Every visible member is listed, including those with nothing closed. A
 * leaderboard that shows the top five is a game; the person a manager most
 * needs to find is the one at the bottom, and dropping them makes the screen
 * useless for its actual purpose.
 *
 * ── Aggregates, not records ──────────────────────────────────────────────
 *
 * Totals per person, never the deals behind them. Seeing that a colleague
 * closed forty million is a different disclosure from being able to open
 * every one of those deals, and in a company where commission is sensitive
 * the difference is the whole point. Anyone who wants the records goes to
 * CRM, where CRM's own scope applies.
 */

interface TeamRow {
  id: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  department: string | null;
  achievement: {
    revenueWon: number; revenueCollected: number; dealsWon: number; dealsLost: number;
    leadsQualified: number; leadsConverted: number; winRate: number | null;
    averageDeal: number | null; activitiesLogged: number;
  };
  pipeline: { open: number; weighted: number; count: number };
  target: number | null;
  achieved: number;
  progress: number | null;
  self: boolean;
}

interface TeamData {
  period: { start: string; end: string; label: string; pace: number };
  currency: string;
  metric: string;
  metricLabel: string;
  metricUnit: 'money' | 'count';
  members: TeamRow[];
  totals: {
    revenueWon: number; revenueCollected: number; dealsWon: number; dealsLost: number;
    openPipeline: number; weightedPipeline: number; target: number; achieved: number;
    activitiesLogged: number; winRate: number | null; progress: number | null; headcount: number;
  } | null;
  scope: string;
}

const METRICS = [
  { id: 'revenue_won', label: 'Revenue won' },
  { id: 'deals_won', label: 'Deals won' },
  { id: 'leads_qualified', label: 'Leads qualified' },
  { id: 'activities_logged', label: 'Activities' },
];

export function TeamPerformance({ onOpenMember }: { onOpenMember: (id: string) => void }) {
  const choices = React.useMemo(() => periodChoices(), []);
  const [period, setPeriod] = React.useState<PeriodChoice>(choices[0]);
  const [metric, setMetric] = React.useState('revenue_won');

  const url = React.useMemo(() => {
    const q = new URLSearchParams({ metric });
    if (period.from) q.set('from', period.from);
    if (period.to) q.set('to', period.to);
    return `/api/performance/team?${q}`;
  }, [period, metric]);

  const { data, loading, error, reload } = useEndpoint<TeamData>(url);

  if (loading && !data) return <Spinner label="Reading the team" />;
  if (error) return <Broken message={error} onRetry={reload} />;
  if (!data) return null;

  if (data.scope === 'own' || data.members.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-e1">
        <Blank
          icon={Users}
          title="No team to show"
          body={
            data.scope === 'own'
              ? 'You can see your own performance, which is on the My performance tab. Team figures are for managers, HR and administrators.'
              : 'Nobody in your view has any recorded activity for this period.'
          }
        />
      </div>
    );
  }

  const t = data.totals!;
  const pace = data.period.pace;
  const unit = data.metricUnit;

  /* The largest figure in the list, so the bars are comparable to each other. */
  const peak = Math.max(...data.members.map(m => m.achieved), 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionHead title="Team performance" count={t.headcount} note={data.period.label} />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={metric}
            onChange={e => setMetric(e.target.value)}
            aria-label="Measure by"
            className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] font-medium text-foreground"
          >
            {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>

          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
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
      </div>

      {/* ── The team as one number ──────────────────────────────────────── */}
      <FigureRow className="sm:grid-cols-4">
        <Figure
          label="Revenue won"
          value={money(t.revenueWon, data.currency)}
          sub={`${formatNumber(t.dealsWon)} ${t.dealsWon === 1 ? 'deal' : 'deals'}`}
          tone={t.revenueWon > 0 ? 'success' : 'default'}
        />
        <Figure
          label="Against target"
          value={t.target > 0 ? percent(t.progress) : '-'}
          sub={t.target > 0
            ? `of ${money(t.target, data.currency)}`
            : 'No targets set for this period'}
        />
        <Figure
          label="Open pipeline"
          value={money(t.openPipeline, data.currency)}
          sub={`${money(t.weightedPipeline, data.currency)} weighted`}
        />
        <Figure
          label="Win rate"
          value={percent(t.winRate)}
          sub={t.winRate === null ? 'Nothing decided yet' : `${t.dealsWon} won, ${t.dealsLost} lost`}
        />
      </FigureRow>

      {/* ── Everyone ────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
            {data.metricLabel}, highest first
          </p>
          <p className="text-[11.5px] text-muted-foreground">
            {Math.round(pace * 100)}% of the period gone
          </p>
        </div>

        <ul className="divide-y divide-border">
          {data.members.map(m => {
            const stand = targetStanding(m.progress, pace);
            const share = peak > 0 ? m.achieved / peak : 0;

            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenMember(m.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                >
                  <Avatar name={m.name} url={m.avatarUrl} />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-foreground">
                        {m.name}
                      </span>
                      {m.self && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                          You
                        </span>
                      )}
                      {!m.isActive && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">Inactive</span>
                      )}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {[m.jobTitle, m.department].filter(Boolean).join(' · ') || 'No job title recorded'}
                    </span>

                    {/*
                      The comparison bar, scaled to the top performer rather
                      than to a target, because not everybody has a target.

                      Drawn only when there is something to draw. An empty
                      track under every name that closed nothing put eleven
                      grey lines down the screen, which reads as a component
                      that failed to load rather than as a zero.
                    */}
                    {m.achieved > 0 && (
                      <span className="mt-1.5 block h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-border/70 sm:max-w-[320px]">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${share * 100}%`, background: 'var(--chart-1)' }}
                        />
                      </span>
                    )}
                  </span>

                  <span className="hidden shrink-0 text-right sm:block">
                    <span className="block text-[11px] uppercase tracking-[0.07em] text-muted-foreground/85">
                      Open
                    </span>
                    <span className="block text-[12.5px] tabular-nums text-muted-foreground">
                      {money(m.pipeline.open, data.currency)}
                    </span>
                  </span>

                  <span className="w-[128px] shrink-0 text-right sm:w-[150px]">
                    <span className="block text-[14px] font-semibold tabular-nums text-foreground">
                      {metricValue(m.achieved, unit, data.currency)}
                    </span>
                    {m.target ? (
                      <>
                        <TargetBar progress={m.progress} pace={pace} tone={stand.tone} className="mt-1.5" />
                        <span className="mt-1 block">
                          <Standing tone={stand.tone} word={stand.word} />
                        </span>
                      </>
                    ) : (
                      <span className="mt-1 block text-[11px] text-muted-foreground">No target</span>
                    )}
                  </span>

                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
