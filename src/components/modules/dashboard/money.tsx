'use client';

import * as React from 'react';
import { useCommandPalette, ChartEmpty, CommandTooltip, Sparkline } from './chart-system';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer, Bar, BarChart, Cell,
} from 'recharts';

import { cn } from '@/lib/utils';
import { activeLocaleCode, formatCurrency } from '@/lib/format';
import { Head, Meter, TRow } from '@/components/shared/readout/primitives';
import {
  axisTick, tickStyle, GRID_DASH, TipShell, TipRow, AreaFill, pct, money,
} from '@/components/shared/readout/viz';
import type { DashboardFinance } from './types';

/** Payment receipts, issued invoices and approved costs use independent date bases.
 * Their difference is not receivables or accounting profit. */

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                   */
/* -------------------------------------------------------------------------- */
type FinancialPoint = DashboardFinance['revenueByMonth'][number] & { momRevenue: number | null; prevMonth: string | null };
function MoneyTip({ active, payload, label, currency }: {
  active?: boolean;
  payload?: { dataKey?: string | number; payload?: FinancialPoint }[];
  label?: string | number;
  currency?: string;
}) {
  const v = useCommandPalette();
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload;
  if (!row) return null;

  const net = row.revenue - row.expenses;


  return (
    <TipShell
      title={String(label ?? row.month)}
      className="cc-tooltip"
      footer={
        <>
          <TipRow label="Receipts less cost" value={formatCurrency(net, currency)} shape="none" strong />
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
      {payload.some(p=>p.dataKey==='revenue') && <TipRow colour={v.cash} label="Collected" value={formatCurrency(row.revenue, currency)} />}
      {payload.some(p=>p.dataKey==='invoiced') && <TipRow colour={v.claim} label="Invoiced" value={formatCurrency(row.invoiced, currency)} shape="line" />}
      {payload.some(p=>p.dataKey==='expenses') && <TipRow colour={v.cost} label="Spend" value={formatCurrency(row.expenses, currency)} shape="diamond" />}
    </TipShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Financial performance                                                     */
/* -------------------------------------------------------------------------- */
export function FinancialPerformance({
  finance,
  onOpenFinance,
  range = 12,
}: {
  range?: number;
  finance: DashboardFinance;
  onOpenFinance: () => void;
}) {
  const v = useCommandPalette();
  const [chartMode, setChartMode] = React.useState<'trend' | 'bars'>('trend');
  const [visible, setVisible] = React.useState({ revenue: true, expenses: true, invoiced: true });
  const toggle = (key: keyof typeof visible) => setVisible(previous => {
    if (previous[key] && Object.values(previous).filter(Boolean).length === 1) return previous;
    return { ...previous, [key]: !previous[key] };
  });
  const months = finance.revenueByMonth;
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
      momRevenue: !m.current && prev && prev.revenue > 0
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

  const latest = data[data.length - 1];
  const trend = latest?.momRevenue ?? null;

  /* Is the right-hand end of this window the month still running? */
  const partial = !!latest?.current;
  const mtd = finance.monthToDate ?? null;

  const empty = window.length === 0;
  const flat = !empty && window.every(m => !m.revenue && !m.expenses && !m.invoiced);
  const axisNumber = new Intl.NumberFormat(activeLocaleCode(), { notation: 'compact', maximumSignificantDigits: 3 });

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
      ) : 'Payments received in this window',
    },
    {
      label: 'Invoiced',
      value: money(invoiced),
      note: 'Issued invoices; excludes drafts',
    },
    { label: 'Spend', value: money(spend), note: 'Approved expenses' },
    {
      label: 'Receipts less cost',
      value: money(net),
      tone: net >= 0 ? 'good' : 'bad',
      note: net >= 0 ? 'Collected above spend' : 'Spend above collected',
    },
    {
      label: 'Surplus / receipts',
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
    <section className="min-w-0" aria-label="Financial performance: payment receipts, issued invoices and approved expenses">
      <Head
        title="Revenue & expense trends"
        note={
          window.length
            ? `${window.length} ${window.length === 1 ? 'month' : 'months'}${range === months.length ? ' to date' : ''}`
            : undefined
        }
        control={<span className="cc-segmented" role="group" aria-label="Financial chart display"><button type="button" aria-pressed={chartMode==='trend'} onClick={()=>setChartMode('trend')}>Trend</button><button type="button" aria-pressed={chartMode==='bars'} onClick={()=>setChartMode('bars')}>Bars</button></span>}
        action={{ label: 'Finance', onClick: onOpenFinance }}
      />

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{window.length ? `${window[0].month} – ${window.at(-1)?.month} · ` : ''}{finance.currency} only. Receipts use payment dates; approved costs are not cash outflows.</p>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Metric definitions & accessible data</summary><p className="my-2">Collected: recorded payments, including partial payments. Invoiced: issued invoice totals by issue date. Spend: approved or reimbursed expenses by expense date. Receipts and invoices may relate to different periods. Current month is incomplete.</p><div className="overflow-auto"><table className="w-full text-left"><caption className="sr-only">Financial history</caption><thead><tr><th>Month</th><th>Collected</th><th>Invoiced</th><th>Spend</th></tr></thead><tbody>{window.map(m => <tr key={m.month}><th>{m.month}</th><td>{formatCurrency(m.revenue, finance.currency)}</td><td>{formatCurrency(m.invoiced, finance.currency)}</td><td>{formatCurrency(m.expenses, finance.currency)}</td></tr>)}</tbody></table></div></details>
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        <div className="cc-finance-metrics">
          {figures.slice(0,3).map((f, i) => (
            <div
              key={f.label}
              className="cc-finance-metric"
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
              {i === 0 || i === 2 ? <Sparkline values={window.map(m=>i===0 ? m.revenue : m.expenses)} label={i===0 ? 'Collections by month' : 'Approved cost by month'} color={i===0 ? v.cash : v.cost}/> : null}
              {f.meter ? (
                <div className="mt-2.5">
                  <Meter value={f.meter.value} tone={f.meter.tone} />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {empty ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
            No financial periods available for this selection.
          </p>
        ) : (
          <>
            <div className="px-1 pb-1 pt-4">
              {flat && <p role="status" className="px-3 text-xs text-muted-foreground">No financial activity in this period. All reported amounts are zero.</p>}
              <div className="cc-finance-chart w-full" data-mode={chartMode}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    key={chartMode}
                    barGap={1}
                    barCategoryGap="15%"
                    accessibilityLayer
                    data={data}
                    margin={{ top: 8, right: 18, left: 0, bottom: 0 }}
                    className="[&_.recharts-surface]:outline-none"
                  >
                    <defs>
                      <AreaFill id="nm-fin-collected" colour={v.cash} />
                    </defs>

                    <CartesianGrid stroke={v.border} strokeDasharray={GRID_DASH} vertical={false} />
                    <XAxis
                      dataKey="month" tickLine={false} axisLine={false} minTickGap={30}
                      tick={tickStyle(v)} dy={10} padding={{ left: 6, right: 6 }}
                    />
                    <YAxis
                      tickLine={false} axisLine={false} tick={tickStyle(v)}
                      width={54} tickFormatter={value => axisNumber.format(value)}
                      // Always include zero, while retaining refunds and other negative values.
                      domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max) || 1]}
                    />
                    <Tooltip
                      content={<MoneyTip currency={finance.currency} />}
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

                    {visible.revenue && window.length >= 4 ? (
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

                    {/* Keep series as direct children: Recharts 2's react-is cannot unwrap React 19 fragments. */}
                      {chartMode === 'trend' && visible.revenue && <Area type="linear" dataKey="revenue" name="Collected" stroke={v.cash} strokeWidth={2.5} fill="url(#nm-fin-collected)" dot={{r: 2.5, strokeWidth: 1, fill: v.surface}} activeDot={{r:5,strokeWidth:2,stroke:v.surface}} isAnimationActive={false}/>}
                      {chartMode === 'trend' && visible.invoiced && <Line type="linear" dataKey="invoiced" name="Invoiced" stroke={v.claim} strokeWidth={1.8} strokeDasharray="5 4" dot={{r: 2.5, strokeWidth: 1, fill: v.surface}} activeDot={{r:4}} isAnimationActive={false}/>}
                      {chartMode === 'trend' && visible.expenses && <Line type="linear" dataKey="expenses" name="Spend" stroke={v.cost} strokeWidth={2} dot={{r: 2.5, strokeWidth: 1, fill: v.surface}} activeDot={{r:4}} isAnimationActive={false}/>}
                      {chartMode === 'bars' && visible.revenue && <Bar dataKey="revenue" name="Collected" fill={v.cash} radius={2} maxBarSize={22} isAnimationActive={false}/>}
                      {chartMode === 'bars' && visible.invoiced && <Bar dataKey="invoiced" name="Invoiced" fill={v.claim} radius={2} maxBarSize={22} isAnimationActive={false}/>}
                      {chartMode === 'bars' && visible.expenses && <Bar dataKey="expenses" name="Spend" fill={v.cost} radius={2} maxBarSize={22} isAnimationActive={false}/>}
                    <ReferenceLine y={0} stroke={v.border} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-4 py-2.5">
              {([{key:'revenue',label:'Collected',color:v.cash},{key:'invoiced',label:'Invoiced',color:v.claim},{key:'expenses',label:'Spend',color:v.cost}] as const).map(series=><button key={series.key} type="button" className="cc-series-toggle" aria-pressed={visible[series.key]} onClick={()=>toggle(series.key)}><span className="cc-dot" style={{background:series.color}}/>{series.label}</button>)}
              <span className="cc-chart-hint">Toggle a series · at least one stays visible</span>
            </div>
          </>

        )}
      </div>
      <div className="cc-finance-footer"><span>Receipts less approved cost <strong>{money(net)}</strong></span><span>Surplus / receipts <strong>{margin === null ? '—' : `${margin.toFixed(1)}%`}</strong></span></div>
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

export function Receivables({ finance, onOpenFinance, onOpenInvoice }: { finance: DashboardFinance; onOpenFinance:()=>void; onOpenInvoice:((id:string)=>void)|null }) {
  const v=useCommandPalette();
  const r=finance.receivables;
  const colors=[v.claim,v.warn,'#c77d42',v.bad,'#a44250'];
  const buckets=r.buckets.map((b,i)=>({...b,label:BUCKET_LABEL[b.bucket],color:colors[i]}));
  return <section aria-label="Receivables aging"><Head title="Receivables aging" note="Current outstanding balances" action={{label:'Finance',onClick:onOpenFinance}}/>
    <div className="cc-receivables-grid"><div><div className="cc-receivables-totals"><div><span>Outstanding</span><strong>{money(r.outstanding)}</strong></div><div><span>Past due</span><strong className="text-destructive">{money(r.overdueValue)}</strong></div><div><span>Unpaid invoices</span><strong>{r.invoiceCount}</strong></div></div>
      {r.outstanding > 0 ? <div className="cc-aging-chart" role="img" aria-label={buckets.map(b=>`${b.label}: ${money(b.value)} across ${b.count} invoices`).join(', ')}><ResponsiveContainer width="100%" height="100%"><BarChart data={buckets} layout="vertical" margin={{top:12,right:24,left:0,bottom:0}}><CartesianGrid horizontal={false} stroke={v.border} strokeDasharray="2 5"/><XAxis type="number" domain={[0,'auto']} tickFormatter={axisTick} tick={tickStyle(v)} axisLine={false} tickLine={false}/><YAxis dataKey="label" type="category" width={94} tick={tickStyle(v)} axisLine={false} tickLine={false}/><Tooltip content={<CommandTooltip currency/>} cursor={{fill:v.border,fillOpacity:.3}}/><Bar dataKey="value" name="Outstanding" radius={[0,4,4,0]} maxBarSize={18} isAnimationActive={false}>{buckets.map(b=><Cell key={b.bucket} fill={b.color}/>)}</Bar></BarChart></ResponsiveContainer></div> : <ChartEmpty title="No outstanding receivables" detail="No issued invoices currently have an unpaid balance."/>}
      <details className="command-data"><summary>View aging amounts</summary><table><thead><tr><th>Age</th><th>Invoices</th><th>Balance</th></tr></thead><tbody>{buckets.map(b=><tr key={b.bucket}><th>{b.label}</th><td>{b.count}</td><td>{formatCurrency(b.value)}</td></tr>)}</tbody></table></details>
    </div><div className="cc-collection-list"><div className="cc-list-heading"><h3>Collection priorities</h3><span>Oldest overdue first</span></div>{r.worst.length ? <ul>{r.worst.map(invoice=><li key={invoice.id}><TRow columns="grid-cols-[minmax(0,1fr)_auto]" onClick={onOpenInvoice?()=>onOpenInvoice(invoice.id):undefined} ariaLabel={`Open invoice ${invoice.number}`}><span><strong className="block text-sm font-medium">{invoice.company ?? invoice.number}</strong><span className="block text-xs text-muted-foreground">{invoice.number} · {invoice.daysOverdue} days overdue</span></span><strong className="text-sm font-medium tabular-nums">{money(invoice.balance)}</strong></TRow></li>)}</ul> : <p className="cc-footnote">No overdue invoices to review.</p>}<p className="cc-footnote">Invoice total less recorded payments. Partial payments are deducted once. Aging uses the organization’s local date.</p></div></div>
  </section>;
}
