import * as React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatCardProps {
  /** Short label describing the metric */
  label: string;
  /** The primary value to display */
  value: string | number;
  /** Percentage change, e.g. 12.5 or -3.2 */
  change?: number;
  /** Contextual label for the change, e.g. "vs last month" */
  changeLabel?: string;
  /** Lucide icon rendered in the accent circle */
  icon: React.ElementType;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(value: string | number): string {
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-US').format(value);
  }
  return value;
}

function ChangeIndicator({ change, label }: { change?: number; label?: string }) {
  if (change === undefined) return null;

  const isPositive = change > 0;
  const isNeutral = change === 0;

  return (
    <div className="flex items-center gap-1 text-xs font-medium">
      {isNeutral ? (
        <Minus className="size-3.5 text-muted-foreground" />
      ) : isPositive ? (
        <TrendingUp className="size-3.5 text-emerald-600" />
      ) : (
        <TrendingDown className="size-3.5 text-red-500" />
      )}
      <span
        className={cn(
          isNeutral && 'text-muted-foreground',
          isPositive && 'text-emerald-600',
          !isPositive && !isNeutral && 'text-red-500',
        )}
      >
        {isPositive ? '+' : ''}
        {change.toFixed(1)}%
      </span>
      {label && (
        <span className="text-muted-foreground">{label}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  change,
  changeLabel,
  icon: Icon,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-lg border p-4 transition-shadow duration-200 hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm font-medium">{label}</span>
          <span className="text-foreground text-2xl font-bold tracking-tight">
            {formatValue(value)}
          </span>
          <ChangeIndicator change={change} label={changeLabel} />
        </div>
        <div className="bg-emerald-500/10 text-emerald-600 flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}