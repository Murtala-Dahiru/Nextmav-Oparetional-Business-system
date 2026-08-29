'use client';

import * as React from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer,
} from 'recharts';

import { cn } from '@/lib/utils';
import { formatCurrencyCompact } from '@/lib/format';
import { Head, Meter, Segmented, TRow } from '@/components/shared/readout/primitives';
import {
  useViz, axisTick, tickStyle, GRID_DASH, TipShell, TipRow, Key, AreaFill, pct, money,
} from '@/components/shared/readout/viz';
import type { DashboardFinance } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Financial performance, and what is still owed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The question this section answers ─────────────────────────────────────
 *
 * Not "what is our revenue" — the plate at the top of the page already says
 * that. This section answers *how the money is moving*, which is three
 * different questions the same chart can carry:
 *
 *   Are we earning more than we spend?    revenue against spend
 *   Are we being paid for what we sell?   collected against invoiced
 *   Is that getting better or worse?      the shape of both over time
 *
 * The second is the one the previous version could not ask. `invoiced` has
 * been a column on `v_finance_monthly` since migration 0007 and the endpoint
 * simply never mapped it, so a month where the studio billed ₦171k and
 * collected ₦143k looked identical to one where it billed ₦143k and collected
 * all of it. The gap between those two lines *is* the receivables problem,
 * drawn in the place where it can be seen developing.
 *
 * ── Why three series and not five ─────────────────────────────────────────
 *
 * Everything else the payload offers — net, margin, the ageing split — is a
 * derivative of these three and belongs in the figures above the chart or in
 * the tooltip. A time-series with five lines is a plate of spaghetti; the
 * discipline is that a line has to be a *quantity measured over time*, and
 * "margin" is a ratio, so it gets a bar.
 */

/** Whole months only, and only the ones the payload can actually fill. */
const RANGES = [3, 6, 12] as const;

function rangesFor(count: number): { value: number; label: string; title: string }[] {
  const offered = RANGES.filter(r => r < count);
  // The full extent is always the last option, however odd a number it is —
  // five months of invoices offers "3M" and "5M", not "3M" and a fictional 6th.
  return [...offered, count].map(r => ({
    value: r,
    label: `${r}M`,
    title: r === count ? `All ${r} months on record` : `The last ${r} months`,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                   */
/* -------------------------------------------------------------------------- */
function MoneyTip({ active, payload, label }: any) {
  const v = useViz();
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload;
  if (!row) return null;

  const net = row.revenue - row.expenses;
  const uncollected = row.invoiced - row.revenue;

  return (
    <TipShell
      title={label}
      footer={
        <>
          <TipRow label="Net" value={formatCurrencyCompact(net)} shape="none" strong />
          {uncollected > 0 ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {formatCurrencyCompact(uncollected)} invoiced, not yet collected
            </p>
          ) : null}
          {typeof row.momRevenue === 'number' ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Collected {pct(row.momRevenue)} on {row.prevMonth}
              {row.current ? ' — so far' : ''}
            </p>
          ) : null}
          {row.current ? (
            <p className="mt-1 text-[11.5px] text-warning">
              This month is still running.
            </p>
          ) : null}
        </>
      }
    >
      <TipRow colour={v.cash} label="Collected" value={formatCurrencyCompact(row.revenue)} />
      <TipRow colour={v.claim} label="Invoiced" value={formatCurrencyCompact(row.invoiced)} shape="line" />
      <TipRow colour={v.cost} label="Spend" value={formatCurrencyCompact(row.expenses)} shape="diamond" />
    </TipShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Financial performance                                                     */
/* -------------------------------------------------------------------------- */
export function FinancialPerformance({
  finance,
  onOpenFinance,
}: {
  finance: DashboardFinance;
  onOpenFinance: () => void;
}) {
  const v = useViz();
  const months = finance.revenueByMonth;
  const options = rangesFor(months.length);
  const [range, setRange] = React.useState(months.length);

  // A payload that grows between renders (a refresh landing a new month) must
  // not leave the control pointing at a range that no longer exists.
  React.useEffect(() => { setRange(months.length); }, [months.length]);

  const window = React.useMemo(
    () => months.slice(Math.max(0, months.length - range)),
    [months, range],
  );

  /**
   * Everything below is computed from the window, not read from the payload.
   *
   * `finance.revenue` and `finance.totalExpenses` are sums over every month the
   * endpoint sent. Showing those beside a three-month chart would put a
   * six-month total over a three-month picture, which is the specific way a
   * range control turns a correct dashboard into a wrong one.
   */
  const data = React.useMemo(() => window.map((m, i) => {
    const prev = i > 0 ? window[i - 1] : null;
    return {
      ...m,
      prevMonth: prev?.month ?? null,
      momRevenue: prev && prev.revenue > 0
        ? ((m.revenue - prev.revenue) / prev.revenue) * 100
        : null,
    };
  }), [window]);

  const collected = window.reduce((s, m) => s + m.revenue, 0);
  const invoiced = window.reduce((s, m) => s + m.invoiced, 0);
  const spend = window.reduce((s, m) => s + m.expenses, 0);
  const net = collected - spend;
  const margin = collected > 0 ? (net / collected) * 100 : null;
  const avg = window.length ? collected / window.length : 0;
  // What proportion of what we billed actually arrived, over this window.
  const collectionRate = invoiced > 0 ? (collected / invoiced) * 100 : null;

  const latest = data[data.length - 1];
  const trend = latest?.momRevenue ?? null;

  /* Is the right-hand end of this window the month still running? */
  const partial = !!latest?.current;
  const mtd = finance.monthToDate ?? null;

  const plottable = window.length >= 3;
  const flat = window.length === 0 || window.every(m => !m.revenue && !m.expenses && !m.invoiced);

  const figures: {
    label: string;
    value: string;
    tone?: 'default' | 'good' | 'bad';
    note?: React.ReactNode;
    meter?: { value: number; tone: 'brand' | 'critical' | 'warning' };
  }[] = [
    {
      label: 'Collected',
      value: money(collected),
      /* A month-to-date figure divided by a whole month is not a rate of
         change, and saying so costs four words. */
      note: typeof trend === 'number' && latest?.prevMonth ? (
        <>
          {latest.month}{' '}
          <span className={cn('font-medium tabular-nums', trend >= 0 ? 'text-success' : 'text-destructive')}>
            {pct(trend)}
          </span>{' '}
          on {latest.prevMonth}
          {partial ? <span className="text-muted-foreground/75"> · part month</span> : null}
        </>
      ) : 'Paid invoices in this window',
    },
    {
      label: 'Invoiced',
      value: money(invoiced),
      note: collectionRate === null
        ? 'Nothing billed in this window'
        : `${collectionRate.toFixed(0)}% of it collected`,
      /**
       * The collection rate, drawn.
       *
       * It is the second of the two ratios on this strip with a natural
       * ceiling — you cannot collect more than you billed — so it can honestly
       * be a proportion, and it is the figure that connects this section to
       * Receivables directly beneath it: the unfilled part of this bar *is*
       * the outstanding book, accumulating in front of the reader.
       *
       * It carries no threshold colour. There was one — amber below ninety per
       * cent — and it was removed: what counts as a healthy collection rate
       * depends on the payment terms a business actually offers, which this
       * page does not know, and colouring a normal 88% as a problem is the
       * dashboard inventing an opinion. Whether the uncollected part is a
       * *problem* is answered honestly one section below, where the same money
       * is split into what is inside terms and what is past due.
       */
      meter: collectionRate === null
        ? undefined
        : {
            value: Math.max(0, Math.min(100, collectionRate)),
            tone: 'brand' as const,
          },
    },
    { label: 'Spend', value: money(spend), note: 'Approved expenses' },
    {
      label: 'Net position',
      value: money(net),
      tone: net >= 0 ? 'good' : 'bad',
      note: net >= 0 ? 'Collected above spend' : 'Spend above collected',
    },
    {
      label: 'Margin',
      value: margin === null ? '—' : `${margin.toFixed(1)}%`,
      // A bar rather than a second number: margin is the only figure here with
      // a natural ceiling, so it is the only one that can honestly be drawn as
      // a proportion.
      meter: {
        value: margin === null ? 0 : Math.max(0, margin),
        tone: margin !== null && margin >= 0 ? 'brand' : 'critical',
      },
    },
  ];

  return (
    <section className="min-w-0">
      <Head
        title="Financial performance"
        note={
          window.length
            ? `${window.length} ${window.length === 1 ? 'month' : 'months'}${range === months.length ? ' to date' : ''}`
            : undefined
        }
        control={
          options.length > 1 ? (
            <Segmented
              options={options}
              value={range}
              onChange={setRange}
              ariaLabel="How many months of financial history to show"
            />
          ) : undefined
        }
        action={{ label: 'Finance', onClick: onOpenFinance }}
      />

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        <div className="grid grid-cols-2 divide-border border-b border-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
          {figures.map((f, i) => (
            <div
              key={f.label}
              className={cn(
                'border-b border-border px-4 py-3.5 lg:border-b-0',
                // The divider grid is 2 / 3 / 5 across; only the last cell in
                // the final row should lose its bottom rule at each width.
                i >= figures.length - 1 && 'border-b-0',
                // Five cells into two columns leaves the fifth alone with an
                // empty half-row beside it. Let it take the width it is
                // already occupying.
                i === figures.length - 1 && 'max-sm:col-span-2',
              )}
            >
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                {f.label}
              </p>
              <p
                className={cn(
                  'mt-1.5 text-[21px] font-semibold leading-none tabular-nums tracking-[-0.03em]',
                  f.tone === 'good' ? 'text-success'
                    : f.tone === 'bad' ? 'text-destructive'
                      : f.value === '—' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {f.value}
              </p>
              {f.note ? (
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">{f.note}</p>
              ) : null}
              {f.meter ? (
                <div className="mt-2.5">
                  <Meter value={f.meter.value} tone={f.meter.tone} />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {flat ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
            No invoices or expenses recorded {months.length ? 'in this period' : 'yet'}.
          </p>
        ) : plottable ? (
          <>
            <div className="px-1 pb-1 pt-4">
              <div className="h-[268px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={data}
                    margin={{ top: 8, right: 18, left: 0, bottom: 0 }}
                    onClick={onOpenFinance}
                    className="cursor-pointer [&_.recharts-surface]:outline-none"
                  >
                    <defs>
                      <AreaFill id="nm-fin-collected" colour={v.cash} />
                    </defs>

                    <CartesianGrid stroke={v.border} strokeDasharray={GRID_DASH} vertical={false} />
                    <XAxis
                      dataKey="month" tickLine={false} axisLine={false}
                      tick={tickStyle(v)} dy={10} padding={{ left: 6, right: 6 }}
                    />
                    <YAxis
                      tickLine={false} axisLine={false} tick={tickStyle(v)}
                      width={54} tickFormatter={axisTick}
                      // From zero, always. An area chart on a truncated axis
                      // exaggerates every movement it draws.
                      domain={[0, 'auto']}
                    />
                    <Tooltip
                      content={<MoneyTip />}
                      cursor={{ stroke: v.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
                      allowEscapeViewBox={{ x: false, y: true }}
                      offset={12}
                    />

                    {/*
                      The month in progress, shaded.

                      Its bar is a partial measurement standing beside
                      complete ones, so on the 28th of a 31-day month the last
                      segment of every series turns downward whether or not
                      anything has gone wrong. The weekly chart in
                      `delivery.tsx` solved this by drawing the current week
                      lighter; a line chart has no bar to lighten, so the
                      *period* is marked instead — from the previous month's
                      point to the last one, which is the span whose slope is
                      not comparable with the others.

                      `ifOverflow="extendDomain"` is deliberately not set: this
                      must never change the axis the real series is drawn on.
                    */}
                    {partial && data.length >= 2 ? (
                      <ReferenceArea
                        x1={data[data.length - 2].month}
                        x2={data[data.length - 1].month}
                        fill={v.axis}
                        fillOpacity={0.05}
                        /* At the foot of the band, not the head of it: the
                           top-right corner of this chart is where the invoiced
                           line peaks, and against a full year of data the
                           label was sitting on it. */
                        label={{
                          value: mtd ? `${mtd.elapsed} of ${mtd.days} days` : 'in progress',
                          position: 'insideBottomRight',
                          fill: v.axis,
                          fontSize: 10,
                          dy: -6,
                          dx: -4,
                        }}
                      />
                    ) : null}

                    {window.length >= 4 ? (
                      <ReferenceLine
                        y={avg} stroke={v.cash} strokeOpacity={0.45} strokeDasharray="5 5"
                        /* Clear of the axis. The average of a real year lands
                           near the middle of the range, which is exactly where
                           a y-axis tick is, and the two were touching. */
                        label={{
                          value: 'avg collected', position: 'insideTopLeft',
                          fill: v.axis, fontSize: 10, dy: -5, dx: 8,
                        }}
                      />
                    ) : null}

                    {/* Collected is the subject: filled, heaviest stroke. */}
                    <Area
                      type="monotone" dataKey="revenue" name="Collected"
                      stroke={v.cash} strokeWidth={2.25} fill="url(#nm-fin-collected)"
                      dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: v.surface }}
                      animationDuration={650}
                    />
                    {/* Invoiced sits above it by definition — a dashed ceiling
                        rather than a second filled area, so the gap between the
                        two reads as the gap and not as a third quantity. */}
                    <Line
                      type="monotone" dataKey="invoiced" name="Invoiced"
                      stroke={v.claim} strokeWidth={1.75} strokeDasharray="5 4"
                      dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: v.surface }}
                      animationDuration={650}
                    />
                    <Line
                      type="monotone" dataKey="expenses" name="Spend"
                      stroke={v.cost} strokeWidth={1.75}
                      dot={{ r: 2.5, fill: v.cost, strokeWidth: 0 }}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: v.surface }}
                      animationDuration={650}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-4 py-2.5">
              <Key colour={v.cash} shape="area" label="Collected" value={money(collected)} />
              <Key colour={v.claim} shape="line" label="Invoiced" value={money(invoiced)} />
              <Key colour={v.cost} shape="line" label="Spend" value={money(spend)} />
              <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
                Select a month to open Finance
              </span>
            </div>
          </>
        ) : (
          /* Two months cannot carry a trend line, so they are drawn as what
             they are: two comparisons. */
          <ul className="p-2">
            {window.map(m => {
              const peak = Math.max(...window.map(x => Math.max(x.invoiced, x.revenue, x.expenses)), 1);
              return (
                <li key={m.month}>
                  <TRow columns="grid-cols-[2.5rem_minmax(0,1fr)]" className="py-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {m.month}
                    </span>
                    <span className="min-w-0 space-y-2">
                      {[
                        { k: 'In', v: m.revenue, tone: 'brand' as const, strong: true },
                        { k: 'Billed', v: m.invoiced, tone: 'default' as const, strong: false },
                        { k: 'Out', v: m.expenses, tone: 'warning' as const, strong: false },
                      ].map(row => (
                        <span key={row.k} className="flex items-center gap-3">
                          <span className="w-10 shrink-0 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                            {row.k}
                          </span>
                          <Meter value={(row.v / peak) * 100} tone={row.tone} className="flex-1" />
                          <span
                            className={cn(
                              'w-28 shrink-0 text-right text-[12px] tabular-nums',
                              row.strong ? 'font-medium text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {formatCurrencyCompact(row.v)}
                          </span>
                        </span>
                      ))}
                    </span>
                  </TRow>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Receivables                                                               */
/* -------------------------------------------------------------------------- */
/**
 * "How much money are we waiting to collect, and how late is it?"
 *
 * Drawn as a single stacked bar rather than as five bars or a donut. The
 * quantity being read is one pot of money divided into bands, and a stacked
 * bar is the only form where the *whole* and the *split* are both legible at a
 * glance — five separate bars lose the total, and a donut makes the reader
 * compare angles to work out whether the overdue slice is a fifth or a third.
 *
 * The bands are ordered current → 90+, so time runs left to right and the
 * right-hand end is always the worst news.
 */
const BUCKET_LABEL: Record<string, string> = {
  current: 'Not yet due',
  '1-30': '1–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': 'Over 90 days',
};

export function Receivables({
  finance,
  onOpenFinance,
  onOpenInvoice,
}: {
  finance: DashboardFinance;
  onOpenFinance: () => void;
  onOpenInvoice: ((id: string) => void) | null;
}) {
  const v = useViz();
  const r = finance.receivables;

  const shade: Record<string, string> = {
    current: v.claim,
    '1-30': v.warn,
    '31-60': v.warn,
    '61-90': v.bad,
    '90+': v.bad,
  };
  // Two bands share a colour on each side of the line, so opacity carries the
  // step between them — the severity is ordinal, not five separate meanings.
  const fade: Record<string, number> = {
    current: 1, '1-30': 0.62, '31-60': 0.92, '61-90': 0.72, '90+': 1,
  };

  const bands = r.buckets.filter(b => b.value > 0);
  const total = r.outstanding;
  const overduePct = total > 0 ? (r.overdueValue / total) * 100 : 0;

  /**
   * The oldest thing in the book, in days.
   *
   * `worst` is already ordered by `days_overdue` descending in the route, so
   * this is a read rather than a scan. It is the one figure that says how bad
   * the *tail* is, as distinct from how big it is — ₦24k spread over two weeks
   * and ₦24k that has been sitting for three months are the same number and
   * not the same problem.
   */
  const oldest = r.worst[0]?.daysOverdue ?? 0;

  return (
    <section className="min-w-0">
      <Head
        title="Receivables"
        count={r.invoiceCount || undefined}
        note={r.invoiceCount ? 'unpaid invoices' : 'Nothing outstanding'}
        action={{ label: 'Finance', onClick: onOpenFinance }}
      />

      {/*
        ── Why this is laid out across rather than down ──────────────────────

        It used to be a narrow panel in a row of three: two figures, then the
        ageing bar, then a legend, then a list, stacked. That shape was chosen
        when receivables was grouped with Support and Stock by silhouette. It
        now sits directly under the financial chart, at the width of the page,
        because it is the second half of that chart's sentence — the chart says
        what was billed and what arrived, and this says where the difference
        went.

        Three regions, left to right, which is also the order the question is
        asked in: *how much*, *how late*, *who*.
      */}
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        <div className="grid lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,20rem)]">
          {/* ── How much ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 border-b border-border lg:grid-cols-1 lg:border-b-0 lg:border-r">
            <div className="border-r border-border px-4 py-3.5 lg:border-b lg:border-r-0">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                Outstanding
              </p>
              <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-foreground">
                {money(total)}
              </p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">Invoiced, not yet paid</p>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                Overdue
              </p>
              <p
                className={cn(
                  'mt-1.5 text-[26px] font-semibold leading-none tabular-nums tracking-[-0.03em]',
                  r.overdueValue > 0 ? 'text-destructive' : 'text-success',
                )}
              >
                {money(r.overdueValue)}
              </p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                {r.overdueCount === 0
                  ? 'Every invoice is within terms'
                  : `${r.overdueCount} ${r.overdueCount === 1 ? 'invoice' : 'invoices'} · ${overduePct.toFixed(0)}% of the book`}
              </p>
            </div>
          </div>

          {/* ── How late ───────────────────────────────────────────────── */}
          {total === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground xl:col-span-2">
              Nothing is outstanding. Every invoice raised has been paid or cancelled.
            </p>
          ) : (
            <div className="border-b border-border px-4 py-4 xl:border-b-0 xl:border-r">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                  Ageing
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {oldest > 0
                    ? `Oldest is ${oldest} ${oldest === 1 ? 'day' : 'days'} past due`
                    : 'Nothing past due'}
                </p>
              </div>

              {/* One bar, five bands, time running left to right — so the
                  right-hand end is always the worst news. */}
              <div
                className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={
                  `${formatCurrencyCompact(total)} outstanding: ` +
                  bands.map(b => `${BUCKET_LABEL[b.bucket]} ${formatCurrencyCompact(b.value)}`).join(', ')
                }
              >
                {bands.map(b => (
                  <span
                    key={b.bucket}
                    className="h-full transition-[width] duration-500 ease-[var(--ease-brand)] first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${(b.value / total) * 100}%`,
                      backgroundColor: shade[b.bucket],
                      opacity: fade[b.bucket],
                    }}
                    title={`${BUCKET_LABEL[b.bucket]} — ${formatCurrencyCompact(b.value)}`}
                  />
                ))}
              </div>

              {/*
                The legend runs across at this width rather than down.

                Four bands stacked in a full-page column is four short rows
                with a metre of nothing to the right of each one; across, each
                band is a small block of label / count / value and the four sit
                as a rank, which is how they are actually compared.
              */}
              {/* Left-packed rather than a four-column grid: a workspace with
                  three live bands should not leave a quarter of the row empty
                  where a fourth band would have been. */}
              <ul className="mt-4 flex flex-wrap gap-x-9 gap-y-3">
                {bands.map(b => (
                  <li key={b.bucket} className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: shade[b.bucket], opacity: fade[b.bucket] }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-[11.5px] text-muted-foreground">
                        {BUCKET_LABEL[b.bucket]}
                      </span>
                    </span>
                    <span className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[14px] font-semibold tabular-nums tracking-[-0.02em] text-foreground">
                        {money(b.value)}
                      </span>
                      <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground/70">
                        {b.count} {b.count === 1 ? 'invoice' : 'invoices'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Who ────────────────────────────────────────────────────── */}
          {r.worst.length > 0 ? (
            <div className="px-4 py-4">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
                Most overdue
              </p>
              {/* An ageing chart says there is a problem; a list says whose. */}
              <ul className="mt-1.5 -ml-3">
                {r.worst.map(inv => (
                  <li key={inv.id}>
                    <TRow
                      columns="grid-cols-[minmax(0,1fr)_auto]"
                      onClick={onOpenInvoice ? () => onOpenInvoice(inv.id) : undefined}
                      ariaLabel={onOpenInvoice ? `Open invoice ${inv.number}` : undefined}
                      className="py-1.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-foreground">
                          {inv.company ?? inv.number}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                          {inv.number} · {inv.daysOverdue} {inv.daysOverdue === 1 ? 'day' : 'days'} overdue
                        </span>
                      </span>
                      <span className="text-[12.5px] font-medium tabular-nums text-destructive">
                        {money(inv.balance)}
                      </span>
                    </TRow>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
