'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/format';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Performance vocabulary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The shared parts of a module about people and numbers. Two rules govern
 * everything here, and both come from the module's subject rather than from
 * taste:
 *
 *   · **A figure is never shown without what it is measured against.** A
 *     percentage with no pace, or a total with no target, is a number that
 *     looks like a judgement and is not one.
 *
 *   · **Nobody is dropped for doing badly.** A leaderboard that hides the
 *     bottom of the team is the gamified version of this screen, and it is
 *     useless to the one person it exists for - the manager looking for who
 *     needs help.
 */

/* -------------------------------------------------------------------------- */
/*  Section heading                                                           */
/* -------------------------------------------------------------------------- */

export function SectionHead({
  title, note, count, children,
}: {
  title: string;
  note?: string;
  count?: number | string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
      {count !== undefined && count !== null && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      {note && <p className="text-[12.5px] text-muted-foreground">{note}</p>}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Person                                                                    */
/* -------------------------------------------------------------------------- */

export function Avatar({
  name, url, size = 'md',
}: {
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim = size === 'lg' ? 'size-11 text-[14px]' : size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-[11.5px]';
  const parts = name.trim().split(/\s+/);
  const initials = getInitials(parts[0] ?? '', parts[1] ?? '');

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn('shrink-0 rounded-full object-cover', dim)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold uppercase text-muted-foreground',
        dim,
      )}
    >
      {initials || '?'}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Standing                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How somebody is doing against a target, in a word.
 *
 * The word carries the meaning and the colour reinforces it, never the other
 * way round: a reader who cannot distinguish the tones still gets the
 * judgement, and a screenshot in a report still says something.
 */
export function Standing({
  tone, word,
}: {
  tone: 'success' | 'warning' | 'critical' | 'default';
  word: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px] font-medium',
        tone === 'success' ? 'text-success'
          : tone === 'warning' ? 'text-warning'
            : tone === 'critical' ? 'text-destructive'
              : 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          tone === 'success' ? 'bg-success'
            : tone === 'warning' ? 'bg-warning'
              : tone === 'critical' ? 'bg-destructive'
                : 'bg-muted-foreground/50',
        )}
      />
      {word}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Target bar                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Progress against a target, with the period's pace marked on it.
 *
 * The tick is the whole point. A bar at 62% tells you nothing on its own; a
 * bar at 62% with the pace marker sitting at 71% tells you the person is
 * behind, at a glance, without arithmetic. It is one absolutely-positioned
 * line and it is the difference between a chart and a decoration.
 */
export function TargetBar({
  progress, pace, tone = 'default', className,
}: {
  progress: number | null;
  pace: number;
  tone?: 'success' | 'warning' | 'critical' | 'default';
  className?: string;
}) {
  const filled = Math.max(0, Math.min(1, progress ?? 0));
  const marker = Math.max(0, Math.min(1, pace));

  return (
    <span className={cn('relative block h-2 w-full overflow-hidden rounded-full bg-border/70', className)}>
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-500',
          tone === 'success' ? 'bg-success'
            : tone === 'warning' ? 'bg-warning'
              : tone === 'critical' ? 'bg-destructive'
                : 'bg-[var(--chart-1)]',
        )}
        style={{ width: `${filled * 100}%` }}
      />
      {/*
        Only drawn once the period is genuinely under way. On day one the
        marker sits at the far left and reads as "you have achieved nothing",
        which is true and unhelpful.
      */}
      {marker > 0.02 && marker < 0.995 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-foreground/45"
          style={{ left: `${marker * 100}%` }}
          title={`${Math.round(marker * 100)}% of the period gone`}
        />
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Figure                                                                    */
/* -------------------------------------------------------------------------- */

/** One number with its name, sized to be read across a row. */
export function Figure({
  label, value, sub, tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'critical';
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="flex min-h-[2.1em] items-start text-[10.5px] font-medium uppercase leading-[1.05] tracking-[0.09em] text-muted-foreground/85">
        {label}
      </p>
      <p
        className={cn(
          'truncate text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
          tone === 'success' ? 'text-success'
            : tone === 'warning' ? 'text-warning'
              : tone === 'critical' ? 'text-destructive'
                : 'text-foreground',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** A row of figures, divided rather than boxed. */
export function FigureRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl',
        'border border-border bg-card shadow-e1 sm:divide-y-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  States                                                                    */
/* -------------------------------------------------------------------------- */

export function Blank({
  icon: Icon, title, body, action,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-[18px]" />
      </span>
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/**
 * A read that failed, said out loud with the way back.
 *
 * Same shape as the CRM's, deliberately: a person who has learned what a
 * failed panel looks like in one module should not have to learn it again in
 * the next.
 */
export function Broken({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/[0.04] px-4 py-6 text-center">
      <p className="text-[13px] font-medium text-foreground">This did not load</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-accent"
      >
        Try again
      </button>
    </div>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/* -------------------------------------------------------------------------- */
/*  Period control                                                            */
/* -------------------------------------------------------------------------- */

export interface PeriodChoice {
  id: string;
  label: string;
  from: string | null;
  to: string | null;
}

/**
 * The periods a performance screen is read in.
 *
 * Quarters, because a sales target is almost never monthly and a window that
 * disagrees with the window targets are set in shows progress against
 * nothing. The current quarter is the default and is computed here so it
 * matches what the endpoint would resolve on its own.
 */
export function periodChoices(): PeriodChoice[] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3);

  const quarter = (year: number, index: number): PeriodChoice => {
    const startMonth = index * 3 + 1;
    const from = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, startMonth + 2, 0)).toISOString().slice(0, 10);
    return { id: `${year}-Q${index + 1}`, label: `Q${index + 1} ${year}`, from, to };
  };

  const prevIndex = q === 0 ? 3 : q - 1;
  const prevYear = q === 0 ? y - 1 : y;

  return [
    { ...quarter(y, q), label: 'This quarter' },
    { ...quarter(prevYear, prevIndex), label: 'Last quarter' },
    { id: `${y}`, label: `${y}`, from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}
