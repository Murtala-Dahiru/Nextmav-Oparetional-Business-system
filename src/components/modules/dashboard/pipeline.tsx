'use client';

import * as React from 'react';
import { formatDate } from '@/lib/format';
import { statusLabel } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Head, TRow, Stat } from '@/components/shared/readout/primitives';
import { useViz, money } from '@/components/shared/readout/viz';
import type { DashboardCrm } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Pipeline momentum
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * "What is happening with our pipeline?" — which is not the same question as
 * "how big is our pipeline". Size is one number and the plate already carries
 * it. Momentum is four facts the payload can now support:
 *
 *   how the value is distributed across the stages
 *   what is expected to land this month
 *   what has already been won this month
 *   what has gone quiet
 *
 * ── Why a funnel and not a bar chart ──────────────────────────────────────
 *
 * A pipeline has an inherent direction — prospecting flows toward closing —
 * and a horizontal bar chart throws that away by sorting on value. The stage
 * order *is* information: a book where the money sits in Prospecting is a
 * different business from one where it sits in Negotiation, and those two
 * produce identical bar charts if you sort them.
 *
 * So the stages stay in pipeline order, top to bottom, and the bar length is
 * value. It is a funnel in the only sense that matters — the axis is the
 * process — without pretending the stages are a strict subset of one another,
 * which in this data they are not: `v_pipeline_summary` groups deals by their
 * *current* stage, so a deal appears in exactly one band and the bands do not
 * nest. Drawing a true tapering funnel over non-nested data would be a lie
 * about what the shape means.
 *
 * ── The counting rule ─────────────────────────────────────────────────────
 *
 * `closed_won` and `closed_lost` are outcomes, not positions, and are kept out
 * of every open-pipeline figure. The panel this replaces summed all six stages
 * and called the result "open deals", disagreeing with `company.openDeals` in
 * the same payload by exactly the number of closed deals.
 */

const CLOSED = new Set(['closed_won', 'closed_lost']);

/** Pipeline order, not payload order — the view groups, it does not sequence. */
const STAGE_ORDER = ['prospecting', 'qualification', 'proposal', 'negotiation'];

const orderOf = (stage: string) => {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? STAGE_ORDER.length : i;
};

export function PipelineMomentum({
  crm,
  openDeals,
  onOpenCrm,
  onOpenDeal,
}: {
  crm: DashboardCrm;
  /** `company.openDeals` — the same count, computed server-side. */
  openDeals: number;
  onOpenCrm: () => void;
  onOpenDeal: ((id: string) => void) | null;
}) {
  const v = useViz();

  const open = React.useMemo(
    () => crm.dealsByStage.filter(s => !CLOSED.has(s.stage)).sort((a, b) => orderOf(a.stage) - orderOf(b.stage)),
    [crm.dealsByStage],
  );
  const won = crm.dealsByStage.find(s => s.stage === 'closed_won');
  const lost = crm.dealsByStage.find(s => s.stage === 'closed_lost');

  const openCount = open.reduce((s, d) => s + d.count, 0);
  // The largest single stage, not the sum: a stage bar answers "how does this
  // stage compare with the others", and against the total every band in a
  // healthy four-stage pipeline is a stub.
  const peak = Math.max(...open.map(s => s.value), 1);

  const weightedShare = crm.pipelineValue > 0
    ? (crm.weightedPipeline / crm.pipelineValue) * 100
    : 0;

  return (
    <section className="min-w-0">
      <Head
        title="Pipeline momentum"
        count={openCount || undefined}
        note={openCount ? `open ${openCount === 1 ? 'deal' : 'deals'}` : 'Nothing open'}
        action={{ label: 'CRM', onClick: onOpenCrm }}
      />

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        {/* ── The forecast ─────────────────────────────────────────────── */}
        <div className="border-b border-border px-4 py-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                Weighted forecast
              </p>
              <p className="mt-1.5 text-[28px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-foreground">
                {money(crm.weightedPipeline)}
              </p>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              of {money(crm.pipelineValue)} open
            </p>
          </div>

          {/* The weighting made visible: the filled part is what the recorded
              probabilities actually expect to land. */}
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-brand)]"
              style={{ width: `${Math.min(100, weightedShare)}%`, backgroundColor: v.cash }}
            />
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {weightedShare.toFixed(0)}% of the open book, weighted by probability
          </p>
        </div>

        {/* ── Movement ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <Stat
            label="Closing this month"
            value={crm.closingThisMonth}
            tone={crm.closingThisMonth > 0 ? 'success' : 'default'}
          />
          <Stat
            label="Won this month"
            value={
              crm.wonThisMonth > 0
                ? <>{crm.wonThisMonth}<span className="ml-1.5 text-[12px] font-medium text-muted-foreground">
                    {money(crm.wonValueThisMonth)}
                  </span></>
                : 0
            }
            tone={crm.wonThisMonth > 0 ? 'success' : 'default'}
          />
          <Stat
            label="Gone quiet"
            value={crm.stalled}
            tone={crm.stalled > 0 ? 'warning' : 'default'}
          />
        </div>

        {/* ── The stages, in pipeline order ────────────────────────────── */}
        {open.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
            No open deals in the pipeline.
          </p>
        ) : (
          <ul className="space-y-3 px-4 py-4">
            {open.map(stage => (
              <li key={stage.stage}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="truncate text-[12.5px] font-medium text-foreground">
                    {statusLabel(stage.stage)}
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                    {stage.count} · {money(stage.value)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-brand)]"
                    style={{
                      width: `${(stage.value / peak) * 100}%`,
                      backgroundColor: v.cash,
                      // Later stages are nearer the money, so they read
                      // stronger. Same hue, so this is a gradient of certainty
                      // rather than five unrelated colours.
                      opacity: 0.45 + 0.55 * ((orderOf(stage.stage) + 1) / STAGE_ORDER.length),
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* ── The biggest open deals, named ────────────────────────────── */}
        {crm.topOpen.length > 0 ? (
          <>
            <p className="border-t border-border px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
              Largest open deals
            </p>
            <ul className="p-1.5 pt-0">
              {crm.topOpen.slice(0, 3).map(d => (
                <li key={d.id}>
                  <TRow
                    columns="grid-cols-[minmax(0,1fr)_auto]"
                    onClick={onOpenDeal ? () => onOpenDeal(d.id) : undefined}
                    ariaLabel={onOpenDeal ? `Open ${d.name}` : undefined}
                    className="py-1.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground">{d.name}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {statusLabel(d.stage)} · {d.probability}%
                        {d.expectedClose
                          ? ` · ${formatDate(d.expectedClose, { day: 'numeric', month: 'short' })}`
                          : ''}
                      </span>
                    </span>
                    <span className="text-[12.5px] font-medium tabular-nums text-foreground">
                      {money(d.value)}
                    </span>
                  </TRow>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {/* ── Outcomes, kept apart from positions ──────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-4 py-2.5 text-[12px]">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: v.cash }} aria-hidden="true" />
            <span className="text-muted-foreground">Won</span>
            <span className="font-medium tabular-nums text-foreground">
              {won?.count ?? 0} · {money(won?.value ?? 0)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
            <span className="text-muted-foreground">Lost</span>
            <span className="font-medium tabular-nums text-muted-foreground">
              {lost?.count ?? 0} · {money(lost?.value ?? 0)}
            </span>
          </span>
          <span
            className={cn(
              'ml-auto text-[12px] font-medium tabular-nums',
              crm.winRate >= 50 ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {crm.winRate}% win rate
          </span>
        </div>

        {/* `openDeals` is the same count computed server-side. If the two ever
            disagree the stage view is stale, and saying so is better than
            silently showing two different numbers on one page. */}
        {openDeals !== openCount ? (
          <p className="border-t border-border px-4 py-2 text-[11px] text-warning">
            Stage totals ({openCount}) disagree with the deal count ({openDeals}) — reopen to refresh.
          </p>
        ) : null}
      </div>
    </section>
  );
}
