'use client';

import * as React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  ArrowRight, Plus, CornerUpRight, Upload, Handshake, Target, CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleRealtime } from '@/hooks/use-realtime';
import {
  Plate, Band, Head, Signal, Trace, Meter, Rail, TRow, THead, Card, Chip,
} from '@/components/shared/readout/primitives';
import {
  useViz, axisTick, tickStyle, GRID_DASH, TipShell, TipRow, money as vizMoney,
} from '@/components/shared/readout/viz';

import { getOne, money, exact, percent, monthLabel, relativeDay, daysUntil, formatDayShort } from './data';
import {
  SectionHead, StageTag, StageSplit, LeadStatusTag, OwnerTag, Blank, Broken, Spinner, personName,
} from './ui';
import { buildCrmAttention } from './attention';
import { NextActions, Timeline, whenOf } from './record-parts';
import { ActivityDialog } from './activity-dialog';
import { DealDialog, LeadDialog } from './forms';
import {
  STAGE_LABELS, LEAD_STATUS_LABELS, OPEN_STAGES,
  type CrmOverview, type CrmSection, type Deal,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CRM Home - the commercial command centre
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── How this differs from the Executive Overview ─────────────────────────
 *
 * They are not the same screen at two sizes. The Overview answers "how is the
 * company doing" for whoever runs it - headcount, delivery, receivables,
 * support. This answers "how is the book doing and what do I do next" for
 * whoever sells. The only figure they share is pipeline value, and they reach
 * it from the same view, so they cannot disagree.
 *
 * Where the Overview looks *backwards* at what the business earned, this looks
 * *forwards* at what it is about to: the plate's headline is the open
 * pipeline, not last month's revenue.
 *
 * ── The composition ──────────────────────────────────────────────────────
 *
 *   Plate      what the book is worth, what it is weighted at, and the twelve
 *              months of won revenue behind it.
 *   01 Attention   what needs a person today. First, because it is the reason
 *              to open the screen.
 *   02 Pipeline    where the money is sitting, by stage, and what moved.
 *   03 Revenue     won against lost, month by month, and who is winning it.
 *   04 Leads       the funnel above the pipeline, and what is not being worked.
 *   05 Diary       the follow-up queue and how much is being logged.
 *
 * ── Nothing here is invented ─────────────────────────────────────────────
 *
 * Every figure is a column, a count or an arithmetic combination of the two,
 * computed by `/api/crm/overview`. There is no forecast model, no lead score
 * beyond the one a person typed, and no natural-language "insight". Where the
 * data cannot answer something - a sales cycle with nothing closed yet - the
 * screen says so rather than printing a zero.
 */

export function CrmHome({ onGo }: { onGo: (section: CrmSection, focus?: { type: string; id: string }) => void }) {
  const v = useViz();

  const [data, setData] = React.useState<CrmOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const [logOpen, setLogOpen] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);
  const [dealOpen, setDealOpen] = React.useState(false);
  const [leadOpen, setLeadOpen] = React.useState(false);

  const reload = React.useCallback(() => setNonce(n => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    getOne<CrmOverview>('/api/crm/overview')
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [nonce]);

  /**
   * Everything here moves when a deal, a lead or an activity moves.
   *
   * One subscription rather than four, because the payload is one request:
   * splitting it would mean four refetches of the same endpoint when somebody
   * converts a lead, which writes to three of those tables at once.
   */
  useModuleRealtime('crm-home', ['deals', 'leads', 'crm_activities'], reload);

  const attention = React.useMemo(() => (data ? buildCrmAttention(data) : []), [data]);

  if (loading && !data) return <Spinner label="Loading the commercial position" />;
  if (error && !data) return <Broken message={error} onRetry={reload} />;
  if (!data) return null;

  const r = data.revenue;
  const scoped = data.scope === 'own';

  /* ── The plate's series ─────────────────────────────────────────────────── */

  const months = r.byMonth;
  const trace = months.map(m => m.won);
  const traceLabels = months.map(m => monthLabel(m.period));
  const anyWon = trace.some(n => n > 0);

  /* ── Pipeline ───────────────────────────────────────────────────────────── */

  const openStages = data.stages.filter(s => OPEN_STAGES.includes(s.stage));
  const biggest = Math.max(1, ...openStages.map(s => s.value));

  /* ── Revenue chart ──────────────────────────────────────────────────────── */

  const chart = months.map(m => ({
    month: monthLabel(m.period),
    period: m.period,
    won: m.won,
    lost: m.lost,
    wonCount: m.wonCount,
    lostCount: m.lostCount,
  }));
  const anyClosed = chart.some(m => m.won > 0 || m.lost > 0);

  /* ── Follow-ups ─────────────────────────────────────────────────────────── */

  const overdue = data.followups.filter(f => f.when === 'overdue');
  const today = data.followups.filter(f => f.when === 'today');
  const upcoming = data.followups.filter(f => f.when === 'upcoming');

  return (
    <div className="flex flex-col gap-7">
      {/* ═══ The plate ═══════════════════════════════════════════════════════ */}
      <Plate>
        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10 lg:p-6">
          <div className="min-w-0">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-panel-muted">
              {scoped ? 'Your pipeline' : 'Open pipeline'}
            </p>
            <p className="mt-2.5 text-[38px] font-semibold leading-none tabular-nums tracking-[-0.035em] text-panel-fg sm:text-[46px]">
              {money(r.pipelineValue, data.currency)}
            </p>
            <p className="mt-3 text-[13px] text-panel-muted">
              {r.openCount} open {r.openCount === 1 ? 'deal' : 'deals'}
              {' · '}
              <span className="text-panel-fg/80">{money(r.weightedPipeline, data.currency)} weighted</span>
            </p>

            {/*
              The composition of the open book, by stage.

              A single figure says how much is in play; the bar says what shape
              it is in. A pipeline that is nine tenths prospecting and one that
              is nine tenths negotiation are the same number and completely
              different situations, and the ramp is what makes the difference
              visible without reading a word.
            */}
            <div className="mt-5">
              <StageSplit segments={openStages.map(s => ({ stage: s.stage, value: s.value }))} />
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-panel-muted">
                {openStages.map(s => (
                  <span key={s.stage} className="tabular-nums">
                    {STAGE_LABELS[s.stage]}{' '}
                    <span className="text-panel-fg/70">{s.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Twelve months of won revenue, at a size worth reading. */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-panel-muted">
                Won, last 12 months
              </p>
              <p className="text-[15px] font-semibold tabular-nums text-panel-fg">
                {money(r.wonThisYear, data.currency)}
              </p>
            </div>
            {anyWon ? (
              <Trace
                className="mt-3"
                values={trace}
                labels={traceLabels}
                colour="var(--panel-accent)"
                height={92}
                format={n => vizMoney(n)}
              />
            ) : (
              <p className="mt-6 text-[12.5px] leading-relaxed text-panel-muted">
                Nothing won in the last twelve months yet. Close a deal and the trend starts here.
              </p>
            )}
          </div>
        </div>

        {/* The instruments. */}
        <div className="grid grid-cols-2 divide-x divide-y divide-panel-line border-t border-panel-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          {/*
            The notes use the abbreviated format, not the full one.

            `Signal` truncates its note, and at two columns on a phone
            "up on ₦16,000,000 last month" was cut to "up on ₦16,000,000 last
            ...". Abbreviating the comparison figure - which is a reference
            point, not a figure anybody adds up - is what makes the sentence
            fit rather than shortening the sentence until it says less.
          */}
          <Signal
            className="px-5 py-4"
            label="Won this month"
            value={money(r.wonThisMonth, data.currency)}
            note={
              r.wonLastMonth > 0
                ? `${r.wonThisMonth >= r.wonLastMonth ? 'up' : 'down'} on ${vizMoney(r.wonLastMonth)} last month`
                : 'No comparison yet'
            }
            noteTone={r.wonLastMonth > 0 && r.wonThisMonth >= r.wonLastMonth ? 'good' : 'default'}
          />
          <Signal
            className="px-5 py-4"
            label="Weighted forecast"
            value={money(r.weightedPipeline, data.currency)}
            note={`of ${vizMoney(r.pipelineValue)} in play`}
          />
          <Signal
            className="px-5 py-4"
            label="Win rate"
            value={r.winRate === null ? 'Not yet' : `${r.winRate}%`}
            note={
              r.winRate === null
                ? 'Nothing decided in 12 months'
                : `${r.wonCount} won, ${r.lostCount} lost`
            }
            segments={
              r.wonCount + r.lostCount > 0
                ? [
                  { value: r.wonCount, tone: 'accent', title: 'Won' },
                  { value: r.lostCount, tone: 'bad', title: 'Lost' },
                ]
                : undefined
            }
          />
          <Signal
            className="px-5 py-4"
            label="Average deal"
            value={r.averageDeal > 0 ? money(r.averageDeal, data.currency) : 'Not yet'}
            note={r.averageDeal > 0 ? `Across ${r.wonCount} won this year` : 'Nothing won yet'}
          />
          <Signal
            className="px-5 py-4"
            label="Sales cycle"
            value={r.averageCycleDays === null ? 'Not yet' : `${r.averageCycleDays} days`}
            note={
              r.averageCycleDays === null
                ? 'Needs a won deal to measure'
                : 'Written down to won'
            }
          />
        </div>
      </Plate>

      {/* ═══ 01 Attention ════════════════════════════════════════════════════ */}
      <section className="flex flex-col gap-3">
        <Band index="01" title="Attention" note="What needs somebody today" />

        {attention.length === 0 ? (
          <Card className="px-4 py-8">
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="size-5 text-success" />
              <p className="text-[13.5px] font-medium">Nothing is behind</p>
              <p className="max-w-sm text-[12.5px] text-muted-foreground">
                Nothing overdue, nothing past its close date, nothing gone quiet.
              </p>
              <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setFollowOpen(true)}>
                <CornerUpRight className="size-4" /> Schedule follow-up
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <THead columns="grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem_6.5rem]" className="px-3 pt-3">
              <span>What</span>
              <span className="hidden md:block">Detail</span>
              <span className="hidden md:block">State</span>
              <span className="text-right">Go</span>
            </THead>

            <div className="flex flex-col p-1.5">
              {attention.map(item => (
                <TRow
                  key={item.id}
                  columns="grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem_6.5rem]"
                  onClick={() => onGo(item.go.section, item.go.focus)}
                  ariaLabel={`${item.title} - ${item.go.label}`}
                >
                  <Rail severity={item.severity} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted-foreground md:hidden">
                      {item.detail}
                    </span>
                  </span>
                  <span className="hidden min-w-0 truncate text-[12.5px] text-muted-foreground md:block">
                    {item.detail}
                  </span>
                  <span className={cn(
                    'hidden text-[11.5px] font-medium md:block',
                    item.severity === 'critical' ? 'text-destructive'
                      : item.severity === 'warning' ? 'text-warning' : 'text-muted-foreground',
                  )}>
                    {item.state}
                  </span>
                  <span className="flex items-center justify-end gap-1 text-[12px] text-muted-foreground">
                    <span className="hidden lg:inline">{item.go.label}</span>
                    <ArrowRight className="size-3.5" />
                  </span>
                </TRow>
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* ═══ 02 Pipeline ═════════════════════════════════════════════════════ */}
      <section className="flex flex-col gap-3">
        <Band index="02" title="Pipeline" note="Where the money is sitting" />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="p-4">
            <Head
              title="By stage"
              count={r.openCount}
              action={{ label: 'Open the board', onClick: () => onGo('pipeline') }}
            />

            {r.openCount === 0 ? (
              <Blank
                icon={Handshake}
                title="Nothing in the pipeline"
                body="Add a deal, or convert a lead, and the board fills up."
                action={
                  <Button size="sm" className="gap-1.5" onClick={() => setDealOpen(true)}>
                    <Plus className="size-4" /> Add deal
                  </Button>
                }
              />
            ) : (
              <div className="mt-4 flex flex-col gap-3.5">
                {openStages.map(s => (
                  <button
                    key={s.stage}
                    type="button"
                    onClick={() => onGo('pipeline')}
                    className="group rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <StageTag stage={s.stage} />
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                        {money(s.value, data.currency)}
                        <span className="ml-2 text-[11.5px] font-normal text-muted-foreground">
                          {s.count}
                        </span>
                      </span>
                    </div>
                    <Meter value={(s.value / biggest) * 100} tone="brand" className="mt-1.5" />
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground/80">
                      {money(s.weighted, data.currency)} weighted
                    </p>
                  </button>
                ))}
              </div>
            )}

            {/*
              Movement belongs to the pipeline, not beside it.

              As a card of its own it left the stage list short of the column
              next to it, so the section rendered with a hundred and twenty
              pixels of empty card under the last stage. It is three numbers
              about the same subject; it is a footer.
            */}
            {r.openCount > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                  Movement, last eight weeks
                </p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
                  <span className="text-[13px] tabular-nums text-muted-foreground">
                    <span className="text-[17px] font-semibold text-success">{data.movement.advanced}</span>
                    {' '}advanced
                  </span>
                  <span className="text-[13px] tabular-nums text-muted-foreground">
                    <span className="text-[17px] font-semibold text-foreground">{data.movement.slipped}</span>
                    {' '}slipped back
                  </span>
                  <span className="text-[13px] tabular-nums text-muted-foreground">
                    <span className="text-[17px] font-semibold text-foreground">{data.movement.total}</span>
                    {' '}moves in total
                  </span>
                </div>
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  From the stage history, so editing a deal is not counted as progress.
                </p>
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <Head
                title="Biggest open"
                count={data.topDeals.length}
                action={{ label: 'All deals', onClick: () => onGo('deals') }}
              />
              {data.topDeals.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-muted-foreground">Nothing open.</p>
              ) : (
                <div className="mt-2 flex flex-col">
                  {data.topDeals.slice(0, 5).map(d => (
                    <TRow
                      key={d.id}
                      columns="grid-cols-[minmax(0,1fr)_auto]"
                      onClick={() => onGo('deals', { type: 'deal', id: d.id })}
                      ariaLabel={`Open ${d.name}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-foreground">{d.name}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {d.company?.name ?? 'No customer'} · {STAGE_LABELS[d.stage]}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-medium tabular-nums">
                          {money(d.value, data.currency)}
                        </span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {d.probability}%
                        </span>
                      </span>
                    </TRow>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </section>

      {/* ═══ 03 Revenue ══════════════════════════════════════════════════════ */}
      <section className="flex flex-col gap-3">
        <Band index="03" title="Revenue" note="Won against lost, and who is winning it" />

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card className="p-4">
            <Head title="Closed by month" note="Twelve months" />

            {!anyClosed ? (
              <p className="px-4 py-12 text-center text-[12.5px] text-muted-foreground">
                Nothing closed in the last twelve months. Mark a deal won or lost and it appears here.
              </p>
            ) : (
              <>
                <div className="mt-4 h-[224px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
                      <CartesianGrid stroke={v.border} strokeDasharray={GRID_DASH} vertical={false} />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tick={tickStyle(v)} dy={8} />
                      <YAxis
                        tickLine={false} axisLine={false} tick={tickStyle(v)}
                        width={52} tickFormatter={axisTick} domain={[0, 'auto']}
                      />
                      <Tooltip
                        cursor={{ fill: v.border, fillOpacity: 0.35 }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0].payload as (typeof chart)[number];
                          return (
                            <TipShell title={String(label)}>
                              <TipRow
                                colour={v.cash} label={`Won (${row.wonCount})`}
                                value={exact(row.won, data.currency)}
                              />
                              <TipRow
                                colour={v.bad} label={`Lost (${row.lostCount})`}
                                value={exact(row.lost, data.currency)}
                              />
                            </TipShell>
                          );
                        }}
                      />
                      <Bar dataKey="won" fill={v.cash} radius={[3, 3, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="lost" fill={v.bad} fillOpacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border pt-3">
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: v.cash }} /> Won
                    <span className="tabular-nums text-foreground">{money(r.wonAll, data.currency)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: v.bad, opacity: 0.55 }} /> Lost
                    <span className="tabular-nums text-foreground">{money(r.lostAll, data.currency)}</span>
                  </span>
                </div>
              </>
            )}
          </Card>

          <Card className="p-4">
            <Head title="By owner" count={data.owners.length} />

            {data.owners.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-muted-foreground">
                No deals are assigned to anybody yet.
              </p>
            ) : (
              <div className="mt-3">
                <THead columns="grid-cols-[minmax(0,1fr)_5.5rem_4rem]">
                  <span>Owner</span>
                  <span className="text-right">Won</span>
                  <span className="text-right">Rate</span>
                </THead>
                <div className="flex flex-col pt-1">
                  {data.owners.slice(0, 6).map(o => (
                    <TRow key={o.memberId} columns="grid-cols-[minmax(0,1fr)_5.5rem_4rem]">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-foreground">{o.name}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {o.openCount} open · {money(o.openValue, data.currency)}
                        </span>
                      </span>
                      <span className="text-right text-[13px] font-medium tabular-nums">
                        {money(o.wonValue, data.currency)}
                      </span>
                      <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                        {percent(o.winRate)}
                      </span>
                    </TRow>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ═══ 04 Leads ════════════════════════════════════════════════════════ */}
      <section className="flex flex-col gap-3">
        <Band index="04" title="Leads" note="The funnel above the pipeline" />

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="p-4">
            <Head
              title="Lifecycle"
              count={data.leads.total}
              action={{ label: 'Open Leads', onClick: () => onGo('leads') }}
            />

            {data.leads.total === 0 ? (
              <Blank
                icon={Target}
                title="No leads yet"
                body="Add one, or bring a spreadsheet in through the Import Center."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" className="gap-1.5" onClick={() => setLeadOpen(true)}>
                      <Plus className="size-4" /> Add lead
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onGo('import')}>
                      <Upload className="size-4" /> Import
                    </Button>
                  </div>
                }
              />
            ) : (
              <>
                <div className="mt-4 flex flex-col gap-2.5">
                  {data.leads.byStatus.filter(s => s.count > 0).map(s => (
                    <button
                      key={s.status}
                      type="button"
                      onClick={() => onGo('leads')}
                      className="group rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/50"
                    >
                      {/*
                        Value first, count second - the same order as the stage
                        list above. They were the other way round here, which
                        put two numbers of different kinds next to each other in
                        the reverse of the reading the page had just taught.
                      */}
                      <div className="flex items-baseline justify-between gap-3">
                        <LeadStatusTag status={s.status} />
                        <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                          {s.value > 0 ? money(s.value, data.currency) : ''}
                          <span className="ml-2 text-[11.5px] font-normal text-muted-foreground">
                            {s.count}
                          </span>
                        </span>
                      </div>
                      <Meter
                        value={(s.count / Math.max(1, data.leads.total)) * 100}
                        tone={s.status === 'lost' ? 'critical' : s.status === 'won' ? 'accent' : 'default'}
                        className="mt-1.5"
                      />
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 divide-x divide-border border-t border-border pt-3">
                  <div className="pr-3">
                    <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                      Still open
                    </p>
                    <p className="mt-1.5 text-[19px] font-semibold leading-none tabular-nums">
                      {data.leads.open}
                    </p>
                  </div>
                  <div className="pl-3">
                    <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                      Won of decided
                    </p>
                    <p className="mt-1.5 text-[19px] font-semibold leading-none tabular-nums">
                      {percent(data.leads.conversionRate)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card className="p-4">
            <Head
              title="Not worked yet"
              count={data.leads.unworked.length}
              note="New, and nobody has been in touch"
            />

            {data.leads.unworked.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-muted-foreground">
                Every new lead has been picked up.
              </p>
            ) : (
              <div className="mt-2 flex flex-col">
                {data.leads.unworked.slice(0, 6).map(l => (
                  <TRow
                    key={l.id}
                    columns="grid-cols-[minmax(0,1fr)_auto]"
                    onClick={() => onGo('leads', { type: 'lead', id: l.id })}
                    ariaLabel={`Open ${personName(l)}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground">
                        {personName(l) || l.email || 'Unnamed lead'}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {l.companyName || 'No company'} · {l.source}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[12.5px] tabular-nums text-muted-foreground">
                        {relativeDay(l.createdAt)}
                      </span>
                      {l.estimatedValue > 0 && (
                        <span className="block text-[11.5px] tabular-nums text-foreground">
                          {money(l.estimatedValue, data.currency)}
                        </span>
                      )}
                    </span>
                  </TRow>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ═══ 05 Diary ════════════════════════════════════════════════════════ */}
      <section className="flex flex-col gap-3">
        <Band index="05" title="Diary" note="What you owe, and what has been logged" />

        {/*
          The volume trace belongs on the left, with the queue.

          Both are about *you*: what you owe and how much you have been logging.
          Recent belongs on the right because it is about the company. Splitting
          them that way is also what balances the section - the queue alone is a
          hundred and thirty pixels next to a five-hundred-pixel timeline, and
          `items-start` turned that into a visible hole rather than an empty
          card.
        */}
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
          <Card className="p-4">
            <Head
              title="Your follow-ups"
              count={data.followups.length}
              action={{ label: 'Open Activities', onClick: () => onGo('activities') }}
            />

            {/*
              A compact empty state, not the full-height one.

              `Blank` reserves fifty-six pixels of padding above and below,
              which is right in the middle of a page and wrong in a card beside
              another card - the section rendered with a small sentence floating
              in two hundred pixels of nothing.
            */}
            {data.followups.length === 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3.5">
                <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Nothing scheduled. A customer with no next action is the commonest way
                  one goes quiet.
                </p>
                <Button
                  size="sm" variant="outline" className="shrink-0 gap-1.5"
                  onClick={() => setFollowOpen(true)}
                >
                  <CornerUpRight className="size-4" /> Schedule one
                </Button>
              </div>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Chip label="Overdue" count={overdue.length} tone="critical" active={false} onClick={() => onGo('activities')} />
                  <Chip label="Today" count={today.length} tone="warning" active={false} onClick={() => onGo('activities')} />
                  <Chip label="Coming up" count={upcoming.length} tone="info" active={false} onClick={() => onGo('activities')} />
                </div>

                <div className="mt-3 border-t border-border pt-2">
                  <NextActions
                    items={[...overdue, ...today, ...upcoming].slice(0, 6)}
                    onChanged={reload}
                  />
                </div>
              </>
            )}
          </Card>

          <Card className="p-4">
            <Head title="Activity logged" note="Last eight weeks" />

            {data.activityByWeek.every(w => w.count === 0) ? (
              <p className="mt-3 text-[12.5px] text-muted-foreground">
                Nothing has been logged in the last eight weeks.
              </p>
            ) : (
              <Trace
                className="mt-4"
                values={data.activityByWeek.map(w => w.count)}
                labels={data.activityByWeek.map(w => formatDayShort(w.week))}
                colour={v.cash}
                height={72}
                onPanel={false}
                format={n => String(Math.round(n))}
              />
            )}
          </Card>
          </div>

          <Card className="p-4">
            <Head
              title="Recent"
              count={data.recentActivity.length}
              action={{ label: 'Open Activities', onClick: () => onGo('activities') }}
            />
            <div className="mt-2">
              <Timeline
                items={data.recentActivity.slice(0, 6)}
                empty={
                  <p className="py-1 text-[12.5px] text-muted-foreground">
                    Nothing logged yet.
                  </p>
                }
              />
            </div>
            <Button
              size="sm" variant="outline" className="mt-3 gap-1.5"
              onClick={() => setLogOpen(true)}
            >
              <Plus className="size-4" /> Log activity
            </Button>
          </Card>
        </div>
      </section>

      <ActivityDialog open={logOpen} onOpenChange={setLogOpen} mode="log" onSaved={reload} />
      <ActivityDialog open={followOpen} onOpenChange={setFollowOpen} mode="followup" onSaved={reload} />
      <DealDialog open={dealOpen} onOpenChange={setDealOpen} editing={null} onSaved={reload} />
      <LeadDialog open={leadOpen} onOpenChange={setLeadOpen} editing={null} onSaved={reload} />
    </div>
  );
}
