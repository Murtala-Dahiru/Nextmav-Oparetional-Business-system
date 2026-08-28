'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { activeCurrencyCode, activeLocaleCode } from '@/lib/format';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  One data-visualisation language for the whole Executive Overview
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * There are five charts on this page now. Left to themselves, five charts
 * become five design systems: one picks green for "good", the next picks green
 * for "revenue", a third uses it for "the first series" — and a reader who has
 * learned what a colour means in the top chart is then misled by the one below
 * it. That is what makes a dense page feel chaotic rather than rich, and no
 * amount of per-chart polish fixes it.
 *
 * So the meanings are assigned once, here, and every chart imports them.
 *
 * ── The assignments ───────────────────────────────────────────────────────
 *
 *   cash      money that has actually arrived — collected revenue, won deals,
 *             completed work. The brand green. Always the subject.
 *   cost      money going out. Warm ochre: adjacent to the warning hue
 *             without being it, because spend is not a problem, it is the
 *             other half of the picture.
 *   claim     money or value that is committed but not yet realised —
 *             invoiced-not-collected, open pipeline. Blue: cool against the
 *             two warm financial series, so "promised" never reads as
 *             "banked".
 *   warn      needs attention.
 *   bad       overdue, breached, lost.
 *   flat      no signal / the baseline.
 *
 * Every value is read from a CSS custom property at runtime rather than
 * restated as hex, so all five charts invert together in dark mode. The chart
 * this page started from hard-coded `#10b981` and `#f43f5e`, which belong to
 * no palette in this product and were illegible on the dark page.
 */

export type VizRole = 'cash' | 'cost' | 'claim' | 'warn' | 'bad' | 'flat';

const TOKEN: Record<VizRole, string> = {
  cash: '--chart-1',
  cost: '--chart-4',
  claim: '--chart-3',
  warn: '--warning',
  bad: '--destructive',
  flat: '--muted-foreground',
};

/** Fallbacks for the first paint, before the computed styles are read. */
const FALLBACK: Record<VizRole, string> = {
  cash: '#2d9572',
  cost: '#b8730a',
  claim: '#2c6fa7',
  warn: '#a8650a',
  bad: '#c0392b',
  flat: '#5c544a',
};

const CHROME = ['--border', '--muted-foreground', '--card', '--foreground'] as const;

export interface VizPalette extends Record<VizRole, string> {
  border: string;
  axis: string;
  surface: string;
  ink: string;
}

/**
 * The palette, re-read whenever the theme changes.
 *
 * A component that samples `getComputedStyle` once renders last night's
 * palette after a theme switch — the values live on `:root` and `.dark`, and
 * nothing invalidates a `useState` when a class changes on `<html>`.
 */
export function useViz(): VizPalette {
  const { resolvedTheme } = useTheme();
  const [palette, setPalette] = React.useState<VizPalette>(() => ({
    ...FALLBACK,
    border: '#e8e5dd',
    axis: '#5c544a',
    surface: '#ffffff',
    ink: '#16140f',
  }));

  React.useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    setPalette({
      cash: read(TOKEN.cash, FALLBACK.cash),
      cost: read(TOKEN.cost, FALLBACK.cost),
      claim: read(TOKEN.claim, FALLBACK.claim),
      warn: read(TOKEN.warn, FALLBACK.warn),
      bad: read(TOKEN.bad, FALLBACK.bad),
      flat: read(TOKEN.flat, FALLBACK.flat),
      border: read(CHROME[0], '#e8e5dd'),
      axis: read(CHROME[1], '#5c544a'),
      surface: read(CHROME[2], '#ffffff'),
      ink: read(CHROME[3], '#16140f'),
    });
  }, [resolvedTheme]);

  return palette;
}

/* -------------------------------------------------------------------------- */
/*  Axes                                                                      */
/* -------------------------------------------------------------------------- */

/** Axis ticks: 690k, 1.2m. The currency lives in the figures above the chart. */
export function axisTick(v: number): string {
  const n = Math.abs(v);
  if (n >= 1_000_000) return `${(v / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

/* -------------------------------------------------------------------------- */
/*  Money, at the scale a summary is read at                                  */
/* -------------------------------------------------------------------------- */
/**
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `formatCurrencyCompact` is not compact. It drops the kobo and nothing else,
 * so ₦149,477,678 arrives as eleven digits — and this page put that string at
 * 21px inside a five-across strip, and its sibling at 46px as the headline.
 * The fault was invisible for as long as the demo workspace's largest figure
 * was ₦143,700, which is exactly the kind of thing an empty database hides.
 *
 * It also left the page contradicting itself: the chart's own axis has always
 * abbreviated (`axisTick` → "16m"), so a reader saw "16m" on the gridline and
 * "₦149,477,678" in the figure above it, in the same card.
 *
 * So: **abbreviated on the surface, exact on demand.** Every figure printed on
 * this page uses this; tooltips — which a reader has deliberately asked for —
 * use `formatCurrencyCompact` and give the number to the naira. The scale
 * steps are `axisTick`'s, so a figure and the axis beneath it never disagree
 * about what "m" means.
 *
 * This deliberately does not touch `formatCurrencyCompact` itself. That
 * function has around a hundred callers across thirteen modules, most of them
 * invoice lines and ledgers where the exact amount is the point, and rewriting
 * it from inside the dashboard's phase would change screens nobody has looked
 * at.
 */
function scaled(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}b`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  // Below a hundred thousand a decimal still carries information; above it,
  // "₦250.0k" is a decimal place spent on nothing.
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/**
 * The active currency's symbol and which side it sits on.
 *
 * Read from `Intl` rather than from a table: the locale decides both, and
 * `formatToParts` is the only way to ask it without guessing. Computed once
 * per call — these are cheap, and caching it would go stale the moment
 * `configureFormatting` switches workspace currency.
 */
function currencyAffix(): { symbol: string; before: boolean } {
  try {
    const parts = new Intl.NumberFormat(activeLocaleCode(), {
      style: 'currency',
      currency: activeCurrencyCode(),
      maximumFractionDigits: 0,
    }).formatToParts(1);

    const i = parts.findIndex(p => p.type === 'currency');
    if (i === -1) return { symbol: '', before: true };
    return {
      symbol: parts[i].value,
      before: i < parts.findIndex(p => p.type === 'integer'),
    };
  } catch {
    return { symbol: '', before: true };
  }
}

/** `₦7.8m`, `₦94.5k`, `-₦1.2m`. The page's one format for money in a figure. */
export function money(value: number): string {
  const n = value ?? 0;
  const { symbol, before } = currencyAffix();
  const body = scaled(Math.abs(n));
  const sign = n < 0 ? '-' : '';
  return before ? `${sign}${symbol}${body}` : `${sign}${body}${symbol}`;
}

/**
 * A whole-number axis whose ticks are evenly spaced.
 *
 * Recharts' `domain={[0, 'dataMax']}` pins the top tick to the data — so a
 * best week of 15 produced the ladder 0, 4, 8, 15, with a gap of seven between
 * the last two rungs. It is the sort of thing nobody names and everybody
 * registers as slightly wrong.
 *
 * This rounds the ceiling up to the next multiple of a sensible step and
 * returns the ladder, so the spacing is uniform and every label is an integer.
 * `dataMax` is still respected in the sense that the ceiling is never below
 * it; the bars simply stop short of the top rung, which is what a bar chart
 * should do anyway.
 */
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10]
    .map(m => m * magnitude)
    .find(s => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);

  const ceiling = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= ceiling + 1e-9; t += step) ticks.push(Math.round(t));
  return ticks;
}

/** Shared tick styling, so no chart quietly drifts to a different size. */
export function tickStyle(palette: VizPalette) {
  return { fontSize: 11, fill: palette.axis } as const;
}

/** The grid every chart uses: horizontal only, dashed, hairline. */
export const GRID_DASH = '2 5';

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                   */
/* -------------------------------------------------------------------------- */
/**
 * The container every chart's tooltip is built in.
 *
 * Recharts will happily render its own, and its own is a white box with a 1px
 * grey border and 12px Arial. Five charts each overriding that separately is
 * five slightly different boxes.
 */
export function TipShell({
  title,
  children,
  footer,
  className,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-[188px] rounded-lg border border-border bg-popover p-3 shadow-e2',
        className,
      )}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
      {footer ? <div className="mt-2 border-t border-border pt-2">{footer}</div> : null}
    </div>
  );
}

/** One `swatch — label — value` line inside a tooltip. */
export function TipRow({
  colour,
  label,
  value,
  shape = 'square',
  strong = false,
}: {
  colour?: string;
  label: string;
  value: string;
  shape?: 'square' | 'line' | 'diamond' | 'none';
  strong?: boolean;
}) {
  return (
    <p className="flex items-center gap-2.5 text-[12.5px] text-foreground">
      {shape !== 'none' && colour ? (
        <span
          className={cn(
            'shrink-0',
            shape === 'square' ? 'size-2 rounded-[2px]'
              : shape === 'diamond' ? 'size-1.5 rotate-45'
                : 'h-[3px] w-3.5 rounded-full',
          )}
          style={{ backgroundColor: colour }}
          aria-hidden="true"
        />
      ) : null}
      <span className={cn(shape === 'none' && 'text-muted-foreground')}>{label}</span>
      <span className={cn('ml-auto tabular-nums', strong ? 'font-semibold' : 'font-medium')}>
        {value}
      </span>
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  Legend                                                                    */
/* -------------------------------------------------------------------------- */
/**
 * A legend that carries its series' total.
 *
 * A key that only names the colours makes the reader look back up at the
 * figures to find out how much each line is worth. Putting the number in the
 * key costs a row that already exists.
 */
export function Key({
  colour,
  shape,
  label,
  value,
}: {
  colour: string;
  shape: 'area' | 'line' | 'bar';
  label: string;
  value?: string;
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'shrink-0',
            shape === 'line' ? 'h-[3px] w-4 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]',
          )}
          style={{ backgroundColor: colour, opacity: shape === 'area' ? 0.85 : 1 }}
          aria-hidden="true"
        />
        <span className="text-[11.5px] text-muted-foreground">{label}</span>
      </span>
      {value ? (
        <span className="text-[12px] font-medium tabular-nums" style={{ color: colour }}>
          {value}
        </span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Gradient                                                                  */
/* -------------------------------------------------------------------------- */
/**
 * An area fill, defined once per chart.
 *
 * `id` must be unique per rendered chart: SVG ids are document-global, so two
 * charts sharing one gradient id share one gradient — the second definition
 * wins for both, which is invisible while their colours agree and impossible
 * to find once they stop agreeing.
 */
export function AreaFill({ id, colour, from = 0.24 }: { id: string; colour: string; from?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={colour} stopOpacity={from} />
      <stop offset="92%" stopColor={colour} stopOpacity={0.02} />
    </linearGradient>
  );
}

/** Percentage, signed, one decimal — the page's single format for a delta. */
export function pct(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}
