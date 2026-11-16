'use client';

import * as React from 'react';
import { ArrowUpRight, ChartNoAxesCombined } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useViz, money } from '@/components/shared/readout/viz';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Bar as Composition } from '@/components/shared/readout/primitives';
import type { KpiCardProps } from '@/components/shared/kpi-card';

/** Dashboard-local semantic palette; other modules keep their existing colours. */
export function useCommandPalette() {
  const base = useViz();
  return { ...base, cash: '#4263eb', cost: '#8392a5', claim: '#3697bd', good: '#24977d', warn: '#d49332', bad: '#d16069' };
}

export function SectionHeading({ index, title, description, meta }: { index: string; title: string; description: string; meta?: string }) {
  return <header className="cc-section-heading"><span className="cc-section-index" aria-hidden="true">{index}</span><div><h2>{title}</h2><p>{description}</p></div>{meta && <span className="cc-section-meta">{meta}</span>}</header>;
}

export function ChartEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className="cc-chart-empty"><ChartNoAxesCombined size={24} strokeWidth={1.4} aria-hidden="true"/><strong>{title}</strong><p>{detail}</p></div>;
}

type TipEntry = { name?: string; value?: number | string; color?: string; payload?: { label?: string; name?: string; count?: number } };
export function CommandTooltip({ active, payload, label, currency = false }: { active?: boolean; payload?: TipEntry[]; label?: string | number; currency?: boolean }) {
  if (!active || !payload?.length) return null;
  return <div className="cc-tooltip"><p>{payload[0].payload?.label ?? label ?? payload[0].name}</p>{payload.map((entry, i) => <div key={`${entry.name}-${i}`}><span className="cc-dot" style={{ background: entry.color }}/><span>{entry.name}</span><strong>{currency ? formatCurrency(Number(entry.value)) : formatNumber(Number(entry.value))}</strong></div>)}{payload[0].payload?.count !== undefined && <small>{formatNumber(payload[0].payload.count)} records in this stage</small>}</div>;
}

export type RingItem = { name: string; value: number; color: string };
export function DistributionRing({ items, label, currency = false, selected, onSelect }: { items: RingItem[]; label: string; currency?: boolean; selected?: string; onSelect?: (name: string) => void }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const display = (n: number) => currency ? money(n) : formatNumber(n);
  if (total <= 0) return <ChartEmpty title="No distribution to show" detail="This view fills in when matching records are available."/>;
  return <div className="cc-distribution"><div className="cc-ring" role="img" aria-label={`${label}: ${items.map(i => `${i.name} ${currency ? formatCurrency(i.value) : formatNumber(i.value)}`).join(', ')}`}>
    <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={items.filter(i => i.value > 0)} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="90%" startAngle={90} endAngle={-270} paddingAngle={items.filter(i => i.value > 0).length > 1 ? 3 : 0} stroke="none" isAnimationActive={false}>{items.filter(i => i.value > 0).map(item => <Cell key={item.name} fill={item.color} opacity={selected && selected !== item.name ? .25 : 1}/>)}</Pie><Tooltip content={<CommandTooltip currency={currency}/>}/></PieChart></ResponsiveContainer>
    <div className="cc-ring-label"><strong>{display(total)}</strong><span>{label}</span></div>
  </div><ul className="cc-distribution-key">{items.map(item => {
    const content = <><span className="cc-dot" style={{background:item.color}}/><span>{item.name}</span><strong title={currency ? formatCurrency(item.value) : undefined}>{display(item.value)}</strong><small>{(item.value / total * 100).toFixed(0)}%</small></>;
    return <li key={item.name}>{onSelect ? <button type="button" aria-pressed={selected === item.name} onClick={() => onSelect(item.name)}>{content}</button> : <div>{content}</div>}</li>;
  })}</ul></div>;
}

export function Sparkline({ values, label, color = '#4263eb' }: { values: number[]; label: string; color?: string }) {
  const id = React.useId();
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values.map((v,i) => `${2 + i / (values.length - 1) * 116},${38 - v / max * 32}`);
  return <svg className="cc-sparkline" viewBox="0 0 120 42" role="img" aria-labelledby={id}><title id={id}>{label}: {values.map(formatNumber).join(', ')}</title><path d={`M${points.join(' L')} L118,41 L2,41 Z`} fill={color} fillOpacity=".06"/><polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="118" cy={38-values.at(-1)!/max*32} r="2.5" fill={color}/></svg>;
}

export function PulseCard({ label, value, note, onClick, segments, tone, comparison, history, historyLabel }: KpiCardProps & { history?: number[]; historyLabel?: string }) {
  const content = <><span className="nm-kpi-label">{label}{onClick && <ArrowUpRight size={14} aria-hidden="true"/>}</span><span className="cc-pulse-value"><span className="nm-kpi-value">{value}</span>{history && <Sparkline values={history} label={historyLabel ?? label}/>}</span>{segments?.some(s=>s.value>0) && <span className="nm-kpi-composition"><Composition segments={segments} height={3}/></span>}<span className={`nm-kpi-note ${tone === 'critical' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : ''}`}>{comparison != null && <strong>{comparison > 0 ? '+' : ''}{comparison}% </strong>}{note}</span>{history && <span className="cc-spark-caption">{historyLabel}</span>}</>;
  return onClick ? <button type="button" className="nm-kpi cc-pulse" onClick={onClick}>{content}</button> : <div className="nm-kpi cc-pulse">{content}</div>;
}
