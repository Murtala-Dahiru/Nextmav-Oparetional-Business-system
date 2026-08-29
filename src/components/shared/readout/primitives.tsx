'use client';

import * as React from 'react';
import { ArrowRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Severity } from './severity';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The dashboard's building blocks
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Two failures, not one ─────────────────────────────────────────────────
 *
 * The dashboard this replaces was eighteen bordered cards in rows of three:
 * every region identical in weight, so the page had no order and the reader
 * did the prioritising.
 *
 * The first attempt to fix that swapped every card for a labelled band of
 * hairline-separated rows — and failed in exactly the same way, one step
 * quieter. Eleven-pixel eyebrow, thin rule, two-line rows, repeat. Uniformity
 * is the disease; the card was only its most obvious symptom. A page where
 * every section is drawn the same way cannot say which section matters,
 * whether the shape is a box or a list.
 *
 * ── What this vocabulary does differently ─────────────────────────────────
 *
 *   Plate      one dark surface, at the top, carrying the state of the
 *              business. The page's focal point, and the reason it reads as
 *              composed rather than assembled.
 *   Band       the divider between the page's movements. A numeral, two
 *              words, a hairline — structure, not decoration.
 *   Signal     one instrument in the plate's readout: a quantity, the parts
 *              it is made of, and whether any of that is trouble.
 *   Head       a real section heading — 15px, ink, with its count beside it
 *              and its controls at the far end. No rule: spacing does the
 *              separating, and a page of hairlines is a page washed grey.
 *   Table      columns that align. Numbers right, status left, action last.
 *   Rail       a 2px severity edge on a row, which survives greyscale and
 *              needs no coloured pill.
 *   Trace      a series at the width of its column: zero-anchored, peak
 *              marked, both ends of its range named. No library.
 *   Meter      one proportion of one whole.
 *   Bar        one whole *divided* — the composition behind a figure.
 *   Segmented  two to four exclusive options. Used for ranges, and only ever
 *              offered for ranges the data can actually fill.
 *   Chip       a count that is also a filter.
 *   Stat       one figure in a divided strip, label above, left-aligned.
 *
 * ── What used to be here ──────────────────────────────────────────────────
 *
 * `Display` (a 24–38px figure with a label and a note) and `Spark` (a 104×32
 * sparkline) were both superseded in the Executive Overview pass — the first
 * by `Signal` and by the headline the plate now sets inline, the second by
 * `Trace`. They are deleted rather than kept "in case": this repository's
 * dominant defect is complete machinery that nothing calls, and two exported
 * components with no consumer are exactly that. Add the next one *with* its
 * first caller.
 *
 * ── The type scale ────────────────────────────────────────────────────────
 *
 * 46 for the plate's headline figure, 23 for the instruments beside it, 19–26
 * for a figure inside a panel, 15 for section headings, 13 for rows, and
 * 10.5–11 for labels. Six sizes, and every one of them has a job that the
 * size above and below it does not do.
 *
 * ── Elevation ─────────────────────────────────────────────────────────────
 *
 * `shadow-e1` on every card, `shadow-e2` on the plate, nothing anywhere else.
 * The tokens invert with the mode (in dark they are an inset highlight rather
 * than a drop shadow), which is why they are tokens and not a Tailwind
 * `shadow-sm`.
 */

/* -------------------------------------------------------------------------- */
/*  Plate — the dark surface the page is anchored on                          */
/* -------------------------------------------------------------------------- */
export function Plate({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl bg-panel text-panel-fg shadow-e2',
        // A single hairline of light along the top edge. It is what stops a
        // large dark rectangle reading as a hole in the page.
        'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-panel-line',
        className,
      )}
    >
      {/*
        One light source, top-left, at four per cent.

        A flat fill this large reads as a printed block rather than a surface —
        which is most of what "it looks like a wireframe" means when the type
        and spacing are already right. The gradient is far too weak to be seen
        as a gradient; what it does is stop the panel being the same colour in
        the corner as it is in the middle. It is inert to the pointer and it is
        the only decorative element on the page.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-[10%] -top-[60%] h-[160%] w-[70%] rounded-full opacity-[0.055] blur-3xl"
        style={{ background: 'radial-gradient(closest-side, #ffffff, transparent)' }}
      />
      <div className="relative">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Head — a section heading that is actually a heading                       */
/* -------------------------------------------------------------------------- */
export function Head({
  title,
  count,
  note,
  control,
  action,
  className,
}: {
  title: string;
  /** The one number that qualifies the title, set beside it rather than under. */
  count?: number | string;
  note?: string;
  /** A control that belongs to this section — a range switch, a filter. */
  control?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-2', className)}>
      <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
      {count !== undefined && count !== null ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
      {note ? <span className="truncate text-[12px] text-muted-foreground">{note}</span> : null}
      {/*
        Controls travel together as one right-aligned group.

        Given their own `ml-auto` each, at 390px the range switch wrapped to the
        end of the first line and the "Finance →" link dropped to a second line
        on the left, which read as an orphaned link rather than as this
        section's action. As a unit they wrap as a unit.
      */}
      {control || action ? (
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {control}
          {action ? (
            <button
              type="button"
              onClick={action.onClick}
              className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {action.label}
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Severity                                                                  */
/* -------------------------------------------------------------------------- */
const RAIL: Record<Severity, string> = {
  critical: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-border',
};

const WORD: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Needs attention',
  info: 'For information',
};

/**
 * A 2px edge down the left of a row.
 *
 * Not a dot and not a tinted row: the edge is visible at a glance from the
 * far side of the page, costs no horizontal space, and — because it is a
 * position as much as a colour — still reads when the colour does not.
 */
export function Rail({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn('absolute inset-y-1 left-0 w-[2px] rounded-full', RAIL[severity])}
      aria-hidden="true"
    >
      <span className="sr-only">{WORD[severity]}</span>
    </span>
  );
}

export function severityWord(severity: Severity): string {
  return WORD[severity];
}

/* -------------------------------------------------------------------------- */
/*  Table row — columns that line up                                          */
/* -------------------------------------------------------------------------- */
/**
 * `grid` rather than flex, so every row in a section shares one column
 * template and the numbers form a straight edge. A dashboard where the right
 * column wanders by three pixels per row is the tell that nobody laid it out.
 */
export function TRow({
  columns,
  onClick,
  children,
  ariaLabel,
  className,
}: {
  /**
   * Tailwind grid-template classes, not an inline style.
   *
   * The template has to change between a phone and a desktop: a cell hidden
   * with `display:none` stops consuming its track, but only if the template
   * itself is narrower at that width. An inline style cannot hold a media
   * query, which is how the attention rows ended up with a 7.5rem hole down
   * the right-hand side of a 390px screen.
   */
  columns: string;
  onClick?: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const shared = cn(
    'group relative grid w-full items-center gap-x-4 rounded-md py-2 pl-3 pr-2 text-left',
    columns,
    className,
  );

  if (!onClick) return <div className={shared}>{children}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(shared, 'transition-colors hover:bg-accent/70')}
    >
      {children}
    </button>
  );
}

/** The column headings above a set of `TRow`s. Same template, 11px, muted. */
export function THead({
  columns,
  children,
  className,
}: {
  columns: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid items-center gap-x-4 border-b border-border pb-1.5 pl-3 pr-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80',
        columns,
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Meter                                                                     */
/* -------------------------------------------------------------------------- */
export function Meter({
  value,
  tone = 'default',
  className,
}: {
  value: number;
  tone?: 'default' | 'warning' | 'accent' | 'critical' | 'brand';
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const fill =
    tone === 'warning' ? 'bg-warning'
      : tone === 'critical' ? 'bg-destructive'
        : tone === 'accent' ? 'bg-success'
          : tone === 'brand' ? 'bg-[var(--chart-1)]'
            : 'bg-foreground/75';

  return (
    <span
      className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-border/70', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className={cn('block h-full rounded-full transition-[width] duration-500 ease-[var(--ease-brand)]', fill)}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel — the quiet container, used sparingly                               */
/* -------------------------------------------------------------------------- */
export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card shadow-e1', className)}>{children}</div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Segmented — a range control that only ever offers real ranges             */
/* -------------------------------------------------------------------------- */
/**
 * Two to four mutually exclusive options, sized for a section heading.
 *
 * Deliberately not a `Tabs`: this switches how much of one dataset is drawn,
 * not which dataset. The caller decides what to offer, and on this page that
 * decision is made from `revenueByMonth.length` — a "12M" button over six
 * months of invoices is a lie the chart would then have to tell.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  onPanel = false,
  className,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  onPanel?: boolean;
  className?: string;
}) {
  if (options.length < 2) return null;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md p-0.5',
        onPanel ? 'bg-white/[0.07]' : 'bg-muted',
        className,
      )}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[5px] px-2 py-[3px] text-[11.5px] font-medium tabular-nums transition-colors',
              on
                ? onPanel
                  ? 'bg-panel-fg text-panel shadow-sm'
                  : 'bg-card text-foreground shadow-sm'
                : onPanel
                  ? 'text-panel-muted hover:text-panel-fg'
                  : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chip — a count that is also a filter                                      */
/* -------------------------------------------------------------------------- */
/**
 * Used by the attention queue to say "three of these are critical" and to let
 * that sentence be clicked. `tone` follows the severity vocabulary rather than
 * introducing a second one.
 */
export function Chip({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: Severity;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-[11.5px] font-medium transition-colors',
        active
          ? 'border-foreground/25 bg-accent text-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-[18px] items-center justify-center rounded-full text-[10.5px] font-semibold tabular-nums',
          tone === 'critical'
            ? 'bg-destructive/12 text-destructive'
            : tone === 'warning'
              ? 'bg-warning/14 text-warning'
              : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat — one figure in a divided strip                                      */
/* -------------------------------------------------------------------------- */
/**
 * The three-across strips under Support and Stock used to be a bare `<p>` of
 * 18px and a label, repeated inline in both files. Same markup twice is how
 * two panels drift apart; and centred text with no anchor is what made them
 * read as a framework's default card.
 *
 * Left-aligned, tabular, with the label above the figure so a column of them
 * scans down the labels rather than down the numbers.
 */
export function Stat({
  label,
  value,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning' | 'critical' | 'success';
  onClick?: () => void;
}) {
  const body = (
    <>
      {/*
        Two lines of label are reserved whether or not this one needs them.

        These sit in three- and four-across strips, and the labels are not the
        same length: "Closing this month" wraps in a 146px cell where "Won this
        month" and "Gone quiet" do not, so its figure sat thirteen pixels below
        its neighbours' and the strip lost the one thing a strip is for — a row
        of numbers you can read across. Reserving the height is text-agnostic;
        shortening the words would only move the problem to the next label
        somebody writes.
      */}
      <p className="flex min-h-[2.1em] items-start text-[10.5px] font-medium uppercase leading-[1.05] tracking-[0.09em] text-muted-foreground/85">
        {label}
      </p>
      <p
        className={cn(
          'text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
          tone === 'critical'
            ? 'text-destructive'
            : tone === 'warning'
              ? 'text-warning'
              : tone === 'success'
                ? 'text-success'
                : 'text-foreground',
        )}
      >
        {value}
      </p>
    </>
  );

  if (!onClick) return <div className="px-4 py-3">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-3 text-left transition-colors hover:bg-accent/50"
    >
      {body}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  useWidth — the measured width of an element                               */
/* -------------------------------------------------------------------------- */
/**
 * A chart that fills its column has to know how wide the column is.
 *
 * The cheap alternative — one fixed `viewBox` and
 * `preserveAspectRatio="none"` — scales the drawing non-uniformly, which
 * turns a 1.75px stroke into a 1.75×N px stroke horizontally and squashes
 * every circular marker into an ellipse. `vector-effect` rescues the stroke
 * and not the markers. Measuring is ten lines and is correct.
 *
 * Returns 0 until the first observation, and callers draw nothing at 0 rather
 * than a chart one pixel wide on the first paint.
 */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      // Sub-pixel churn on a flex child would otherwise re-render the chart
      // on every layout pass.
      setWidth(prev => (Math.abs(prev - w) > 0.5 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/* -------------------------------------------------------------------------- */
/*  Trace — the headline series, at a size worth reading                      */
/* -------------------------------------------------------------------------- */
/**
 * `Spark` is 104×32 and belongs beside a figure in a table. This is its wide
 * sibling: it fills its column, sits on a real baseline, marks the high point
 * and the current point, and labels the two ends of its own range.
 *
 * ── Why it is anchored at zero ────────────────────────────────────────────
 *
 * `Spark` scales between the series' own minimum and maximum, which is right
 * for a hundred-pixel glyph whose only job is *shape*. At six hundred pixels
 * the reader starts measuring heights against one another, and a
 * minimum-anchored chart makes a month that earned 90% of the best month look
 * like it earned 10% of it. The section chart below the plate is zero-anchored
 * for the same reason, and the two must not disagree about the same series.
 *
 * ── Why the peak is marked and the trough is not ──────────────────────────
 *
 * One reference is orientation; two is a scatter of labels. The best month is
 * what an executive compares the current month against, and the current month
 * is always the rightmost point — so the pair answers "how are we doing
 * against our best" with no legend and no interaction.
 */
export function Trace({
  values,
  labels,
  colour = 'currentColor',
  height = 68,
  className,
  format,
  provisional = false,
}: {
  values: number[];
  /** One label per value. The ends are drawn; the rest position the peak. */
  labels?: string[];
  colour?: string;
  height?: number;
  className?: string;
  /** How to render the peak's value. Omitted, the peak carries no figure. */
  format?: (n: number) => string;
  /**
   * Whether the final value covers a period that has not finished.
   *
   * A month-to-date figure plotted as the twelfth of twelve draws a cliff on
   * the 28th of every month, and a cliff is the most legible thing on a
   * sparkline — so the chart's loudest statement would be an artefact of the
   * calendar. The last segment is drawn dashed instead: the same claim the
   * shaded band makes on the full chart below, in the vocabulary a line this
   * size can carry.
   */
  provisional?: boolean;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const gid = React.useId().replace(/:/g, '');

  const h = height;
  const pad = 7;

  const geometry = React.useMemo(() => {
    if (w < 40 || values.length < 2) return null;
    const max = Math.max(...values, 0);
    // Zero-anchored unless the series itself goes below zero, in which case
    // the floor is the true minimum and zero sits inside the band.
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const step = w / (values.length - 1);
    const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);

    const pts = values.map((v, i) => [i * step, y(v)] as const);
    return { pts, peak: values.indexOf(max), max, zeroY: y(0) };
  }, [w, values, h]);

  const point = ([x, y]: readonly [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const path = geometry ? geometry.pts.map(point).join(' ') : '';
  /* The solid run stops one point short when the tail is provisional, and the
     dashed segment starts at that same point so the two meet exactly. */
  const solid = geometry
    ? geometry.pts.slice(0, provisional ? -1 : undefined).map(point).join(' ')
    : '';
  const tail = geometry && provisional ? geometry.pts.slice(-2).map(point).join(' ') : '';

  return (
    <div ref={ref} className={cn('w-full', className)}>
      <div style={{ height: h }}>
        {geometry ? (
          <svg
            viewBox={`0 0 ${w} ${h}`}
            width={w}
            height={h}
            fill="none"
            aria-hidden="true"
            className="block overflow-visible"
          >
            <defs>
              <linearGradient id={`tr${gid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity={0.26} />
                <stop offset="100%" stopColor={colour} stopOpacity={0} />
              </linearGradient>
            </defs>

            <polygon points={`${path} ${w},${geometry.zeroY} 0,${geometry.zeroY}`} fill={`url(#tr${gid})`} />
            {/* The baseline, drawn at the value the fill is measured from. */}
            <line
              x1={0} x2={w} y1={geometry.zeroY} y2={geometry.zeroY}
              stroke={colour} strokeOpacity={0.22} strokeWidth={1}
            />
            {/* The peak, with a hairline drop to the baseline — the eye can
                find its position on the axis without a gridline across the
                whole chart. */}
            <line
              x1={geometry.pts[geometry.peak][0]} x2={geometry.pts[geometry.peak][0]}
              y1={geometry.pts[geometry.peak][1]} y2={geometry.zeroY}
              stroke={colour} strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 3"
            />
            <polyline
              points={solid}
              stroke={colour} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
            />
            {tail ? (
              <polyline
                points={tail}
                stroke={colour} strokeWidth={1.75} strokeLinecap="round"
                strokeDasharray="3 3" strokeOpacity={0.75}
              />
            ) : null}
            <circle
              cx={geometry.pts[geometry.peak][0]} cy={geometry.pts[geometry.peak][1]}
              r={2.5} fill={colour} fillOpacity={0.5}
            />
            <circle
              cx={geometry.pts[geometry.pts.length - 1][0]}
              cy={geometry.pts[geometry.pts.length - 1][1]}
              r={3.5} fill={colour}
            />
          </svg>
        ) : null}
      </div>

      {geometry && labels && labels.length === values.length ? (
        <div className="mt-2 flex items-baseline justify-between gap-3 text-[10.5px] tracking-[0.04em] text-panel-muted">
          <span>{labels[0]}</span>
          {format ? (
            <span className="truncate tabular-nums">
              peak {format(geometry.max)} · {labels[geometry.peak]}
            </span>
          ) : null}
          <span className="text-panel-fg/70">{labels[labels.length - 1]}</span>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Bar — a quantity split into its named parts                               */
/* -------------------------------------------------------------------------- */
/**
 * `Meter` draws one proportion of one whole. This draws a whole *divided*,
 * which is a different statement and the one most of this page's figures are
 * actually making: five active projects is three on track, one at risk and one
 * late; ₦125k of receivables is ₦101k inside terms and ₦24k past due.
 *
 * A figure with its composition beneath it answers "and what is that made of"
 * without a second panel, which is most of the distance between a KPI strip
 * and a readout. Every segment is a count or a sum already on the payload —
 * nothing is inferred to fill a bar.
 *
 * Zero-valued segments are dropped rather than drawn at zero width, because a
 * zero-width segment still paints a line at some device pixel ratios.
 */
export type BarTone = 'accent' | 'warn' | 'bad' | 'quiet' | 'claim';

export function Bar({
  segments,
  onPanel = false,
  height = 4,
  className,
}: {
  segments: { value: number; tone: BarTone; title: string }[];
  onPanel?: boolean;
  height?: number;
  className?: string;
}) {
  const live = segments.filter(s => s.value > 0);
  const total = live.reduce((sum, s) => sum + s.value, 0);

  const fill: Record<BarTone, string> = {
    accent: onPanel ? 'bg-panel-accent' : 'bg-[var(--chart-1)]',
    warn: 'bg-warning',
    bad: 'bg-destructive',
    claim: 'bg-[var(--chart-3)]',
    quiet: onPanel ? 'bg-panel-fg/25' : 'bg-foreground/15',
  };

  return (
    <span
      role="img"
      aria-label={live.map(s => `${s.title}: ${s.value}`).join(', ')}
      className={cn(
        'flex w-full overflow-hidden rounded-full',
        onPanel ? 'bg-panel-fg/10' : 'bg-border/70',
        className,
      )}
      style={{ height }}
    >
      {live.map((s, i) => (
        <span
          key={`${s.title}-${i}`}
          title={`${s.title} — ${s.value}`}
          className={cn(
            'h-full transition-[width] duration-700 ease-[var(--ease-brand)]',
            fill[s.tone],
          )}
          style={{ width: `${(s.value / total) * 100}%` }}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Band — the page's argument, made visible                                  */
/* -------------------------------------------------------------------------- */
/**
 * Ten sections drawn identically is a stack of widgets however good each one
 * is: the reader gets no help deciding where one thought ends and the next
 * begins, and a page with no visible structure is the thing people mean when
 * they say a dashboard "looks generated".
 *
 * This is the divider between the page's movements — *position*, *momentum*,
 * *delivery*, *response* — and it is deliberately the quietest thing on the
 * screen: a numeral, two words, a note, a hairline. It is structure, not
 * decoration, and it costs one row.
 */
export function Band({
  index,
  title,
  note,
  className,
}: {
  index: string;
  title: string;
  note: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="text-[10.5px] font-semibold tabular-nums tracking-[0.1em] text-muted-foreground/50">
        {index}
      </span>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground/70">
        {title}
      </span>
      <span className="hidden truncate text-[11.5px] text-muted-foreground/75 sm:inline">
        {note}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Signal — one instrument in the plate's readout strip                      */
/* -------------------------------------------------------------------------- */
/**
 * The plate used to carry five `Display`s in a grid: label, number, grey note.
 * That is a KPI strip with a dark background, and the page's own notes said it
 * was trying not to be one.
 *
 * A signal says three things instead of one — the quantity, what it is made
 * of, and whether any of that is trouble — in the same space, because the
 * composition bar costs four pixels of height. It is the difference between
 * "5 active projects · 3 at risk" as a sentence and as a shape you can read
 * without reading.
 *
 * They sit in a divided strip rather than a grid so that five of them cannot
 * orphan a sixth cell, which is what the grid did at every width between
 * `xl` and `2xl`.
 */
export function Signal({
  label,
  value,
  note,
  noteTone = 'default',
  segments,
  onClick,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  noteTone?: 'default' | 'warning' | 'critical' | 'good';
  segments?: { value: number; tone: BarTone; title: string }[];
  onClick?: () => void;
  /** Padding and dividers belong to the strip, which knows how wide it is. */
  className?: string;
}) {
  const body = (
    <>
      <p className="truncate text-[10.5px] font-medium uppercase tracking-[0.09em] text-panel-muted">
        {label}
      </p>
      <p className="mt-1.5 text-[23px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-panel-fg">
        {value}
      </p>
      {/*
        The track is drawn even where there is nothing honest to put in it.

        Without it the one signal that carries no composition — see the note in
        `index.tsx` about why "Active projects" cannot have one — pulled its own
        note up by fourteen pixels, and a `<button>` centres its content, so it
        also dragged its label *down* by eight. One cell out of five sitting on
        two different baselines from its neighbours is the kind of thing nobody
        can name and everybody sees.
      */}
      <span className="mt-3.5 block" aria-hidden={segments ? undefined : 'true'}>
        {segments && segments.some(s => s.value > 0) ? (
          <Bar segments={segments} onPanel height={3} />
        ) : (
          <span className="block h-[3px] w-full rounded-full bg-panel-fg/[0.07]" />
        )}
      </span>
      {note ? (
        <p
          className={cn(
            'mt-2.5 truncate text-[11.5px]',
            noteTone === 'critical' ? 'font-medium text-destructive'
              : noteTone === 'warning' ? 'font-medium text-warning'
                : noteTone === 'good' ? 'text-panel-accent'
                  : 'text-panel-muted',
          )}
        >
          {note}
        </p>
      ) : null}
    </>
  );

  if (!onClick) return <div className={cn('min-w-0', className)}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      /* `block`, because a button's UA style centres its content vertically
         and a strip of five instruments has to share one top edge. */
      className={cn('block min-w-0 text-left transition-colors hover:bg-white/[0.045]', className)}
    >
      {body}
    </button>
  );
}
