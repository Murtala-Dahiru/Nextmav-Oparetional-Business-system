'use client';

import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Head } from '@/components/shared/readout/primitives';
import { useViz, tickStyle, GRID_DASH, TipRow, TipShell } from '@/components/shared/readout/viz';
import { exact, monthLabel } from './data';
import { SOURCE_OPTIONS, type CrmOverview, type CrmSection } from './types';

/** Text tables expose the exact chart data to keyboard and screen-reader users. */
function DataTable({ headings, rows }: { headings: string[]; rows: (string | number)[][] }) {
  return <details className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
    <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">View chart data</summary>
    <div className="mt-2 max-h-56 overflow-auto"><table className="w-full text-left">
      <thead><tr>{headings.map(h => <th scope="col" key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="px-2 py-1 tabular-nums">{cell}</td>)}</tr>)}</tbody>
    </table></div>
  </details>;
}

export function InsightCharts({ data, onGo }: { data: CrmOverview; onGo: (section: CrmSection, focus?: {type:string;id:string}) => void }) {
  const v = useViz();
  const gradient = `crm-won-${React.useId().replace(/:/g, '')}`;
  const [period, setPeriod] = React.useState(12);
  const insights = data.insights;
  if (!insights) return null;
  const months = data.revenue.byMonth.slice(-period).map(m => ({ ...m, label: monthLabel(m.period, true) }));
  const colours = [v.claim, v.cash, v.cost, v.flat, v.warn];
  const sources = insights.sources.map(s => ({ ...s, label: SOURCE_OPTIONS.find(o => o.value === s.source)?.label ?? s.source }));
  // Keep the graphic legible while retaining every source in the exact-data table.
  const slices = sources.length > 6 ? [...sources.slice(0, 5), {
    source: '__remaining', label: 'Other sources',
    count: sources.slice(5).reduce((s, r) => s + r.count, 0),
    converted: sources.slice(5).reduce((s, r) => s + r.converted, 0),
  }] : sources;
  const axisMoney = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return <section aria-label="Revenue and acquisition analysis" className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
    <Card className="min-w-0 p-4 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Closed business trend</h2><p className="mt-1 text-xs text-muted-foreground">Won deal value · {data.currency} · not invoiced or collected revenue</p></div>
        <div aria-label="Chart period" className="flex gap-1 rounded-md border border-border p-1">
          {[6, 12].map(n => <button key={n} type="button" aria-pressed={period === n} onClick={() => setPeriod(n)} className={`rounded px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${period === n ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}`}>{n} months</button>)}
        </div>
      </div>
      {months.some(m => m.wonCount > 0) ? <div className="mt-5 h-64" role="img" aria-label="Monthly won deal value; exact values available below">
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={months} margin={{ left: 0, right: 12, top: 8, bottom: 4 }} accessibilityLayer>
          <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={v.claim} stopOpacity={0.2}/><stop offset="100%" stopColor={v.claim} stopOpacity={0.01}/></linearGradient></defs>
          <CartesianGrid stroke={v.border} strokeDasharray={GRID_DASH} vertical={false}/>
          <XAxis dataKey="label" tick={tickStyle(v)} tickLine={false} axisLine={false} minTickGap={25}/>
          <YAxis tickFormatter={axisMoney} tick={tickStyle(v)} tickLine={false} axisLine={false} width={48}/>
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload;
            return <TipShell title={row.label}><TipRow colour={v.claim} label={`${row.wonCount} won deals`} value={exact(row.won, data.currency)}/></TipShell>;
          }}/>
          <Area type="linear" dataKey="won" stroke={v.claim} strokeWidth={2.5} fill={`url(#${gradient})`} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: v.surface }}/>
        </AreaChart></ResponsiveContainer>
      </div> : <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No won deals in this period.</p>}
      <DataTable headings={['Month', 'Won deals', `Value (${data.currency})`]} rows={months.map(m => [m.label, m.wonCount, exact(m.won, data.currency)])}/>
    </Card>
    <Card className="min-w-0 p-4">
      <Head title="Lead acquisition" note="All current leads" action={{ label: 'Open Leads', onClick: () => onGo('leads') }}/>
      {slices.length ? <>
        <div className="mt-3 h-48" role="img" aria-label="Lead counts by recorded source; exact values available below">
          <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={slices} dataKey="count" nameKey="label" innerRadius={52} outerRadius={77} paddingAngle={2} stroke={v.surface} isAnimationActive={false}>
            {slices.map((s, i) => <Cell key={s.source} fill={colours[i % colours.length]}/>)}
          </Pie><Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload;
            return <TipShell title={row.label}><TipRow colour={v.claim} label="Leads" value={String(row.count)}/><TipRow colour={v.cash} label="Converted" value={String(row.converted)}/></TipShell>;
          }}/></PieChart></ResponsiveContainer>
        </div>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">{slices.map((s, i) => <li key={s.source} className="min-w-0"><button type="button" onClick={()=>onGo('leads',s.source==='__remaining'?undefined:{type:'lead-source',id:s.source})} aria-label={s.source==='__remaining'?'Browse all leads for other sources':`View ${s.count} leads from ${s.label}`} className="flex w-full min-w-0 items-center gap-1.5 rounded py-1 text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"><span className="size-2 shrink-0 rounded-full" style={{ background: colours[i % colours.length] }}/><span className="truncate" title={s.label}>{s.label}</span><span className="ml-auto tabular-nums text-muted-foreground">{s.count}</span></button></li>)}</ul>
      </> : <p className="py-20 text-center text-sm text-muted-foreground">No leads to analyze yet.</p>}
      <DataTable headings={['Source', 'Leads', 'Converted']} rows={sources.map(s => [s.label, s.count, s.converted])}/>
    </Card>
    <Card className="min-w-0 p-4 lg:col-span-2">
      <Head title="Open deal aging" note="Calendar days since creation, not time in stage" action={{ label: 'Open Pipeline', onClick: () => onGo('pipeline') }}/>
      <div className="mt-4 h-52" role="img" aria-label="Open deal counts by age; exact values available below">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={insights.aging.buckets} accessibilityLayer margin={{ left: -24, right: 8 }}>
          <CartesianGrid stroke={v.border} strokeDasharray={GRID_DASH} vertical={false}/>
          <XAxis dataKey="label" tick={tickStyle(v)} axisLine={false} tickLine={false} minTickGap={8}/>
          <YAxis allowDecimals={false} tick={tickStyle(v)} axisLine={false} tickLine={false}/>
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload;
            return <TipShell title={row.label}><TipRow colour={v.claim} label="Open deals" value={String(row.count)}/><TipRow colour={v.claim} label="Pipeline value" value={exact(row.value, data.currency)}/></TipShell>;
          }}/>
          <Bar dataKey="count" fill={v.claim} radius={[4, 4, 0, 0]} maxBarSize={46} isAnimationActive={false}/>
        </BarChart></ResponsiveContainer>
      </div>
      {insights.aging.excluded > 0 && <p className="mt-2 text-xs text-muted-foreground">{insights.aging.excluded} records excluded because their creation date or value needs correction.</p>}
      <DataTable headings={['Age', 'Deals', `Value (${data.currency})`]} rows={insights.aging.buckets.map(b => [b.label, b.count, exact(b.value, data.currency)])}/>
    </Card>
    <Card className="min-w-0 p-4">
      <Head title="Why deals were lost" note="Recorded outcomes · last 12 months"/>
      {insights.lossReasons.length ? <ul className="mt-5 space-y-4">{insights.lossReasons.slice(0, 5).map(r => <li key={r.reason}>
        <div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="truncate" title={r.reason}>{r.reason}</span><span className="tabular-nums text-muted-foreground">{r.count}</span></div>
        <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ background: v.flat, width: `${r.count / Math.max(1, ...insights.lossReasons.map(r => r.count)) * 100}%` }}/></div>
      </li>)}</ul> : <p className="py-16 text-center text-sm text-muted-foreground">No lost deals in this period.</p>}
      <DataTable headings={['Reason', 'Deals']} rows={insights.lossReasons.map(r => [r.reason, r.count])}/>
    </Card>
  </section>;
}
