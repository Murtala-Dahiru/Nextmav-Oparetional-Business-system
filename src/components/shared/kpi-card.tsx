import * as React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Bar, type BarTone } from '@/components/shared/readout/primitives';

export interface KpiCardProps {
  label: string;
  value: string;
  note?: string;
  tone?: 'default' | 'warning' | 'critical' | 'good';
  comparison?: number | null;
  onClick?: () => void;
  segments?: { value: number; tone: BarTone; title: string }[];
}

/** Presentation only: values, comparisons and destinations come from the caller. */
export function KpiCard({ label, value, note, tone = 'default', comparison, onClick, segments }: KpiCardProps) {
  const content = <>
    <span className="nm-kpi-label">{label}{onClick && <ArrowUpRight size={14} aria-hidden="true" />}</span>
    <span className="nm-kpi-value">{value}</span>
    {segments?.some(s => s.value > 0) && <span className="nm-kpi-composition"><Bar segments={segments} height={3} /></span>}
    <span className={cn('nm-kpi-note', tone === 'critical' && 'text-destructive', tone === 'warning' && 'text-warning', tone === 'good' && 'text-success')}>
      {typeof comparison === 'number' && <span className={cn('nm-kpi-change', comparison >= 0 ? 'text-success' : 'text-destructive')}>
        {comparison >= 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
        {Math.abs(comparison)}%
      </span>}
      {note}
    </span>
  </>;
  return onClick
    ? <button type="button" className="nm-kpi" onClick={onClick}>{content}</button>
    : <div className="nm-kpi">{content}</div>;
}
