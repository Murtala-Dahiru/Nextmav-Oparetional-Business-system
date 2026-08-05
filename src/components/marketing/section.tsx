import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Page rhythm
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Every marketing page previously opened its own container and picked its own
 *  vertical padding by hand: `py-16 sm:py-24` on four pages, `py-20` on the
 *  landing page, `py-12 sm:py-16` in the footer, `mt-24` between sections on
 *  Features but `space-y-24` on the same page. Nothing was wrong with any one
 *  of those numbers. The problem is that a reader moving between pages feels
 *  the rhythm change without being able to say why, and "why does this feel
 *  slightly off" is the whole difference between considered and assembled.
 *
 *  Three widths and three densities, named. A page picks from them.
 */

const widths = {
  /** Reading measure. Long-form prose, legal pages, a single form. */
  prose: 'max-w-[46rem]',
  /** The default. Wide enough for three columns, narrow enough to scan. */
  default: 'max-w-[75rem]',
  /** Edge-to-edge content that still needs gutters — tables, wide media. */
  wide: 'max-w-[88rem]',
} as const;

/**
 * Four, not three — and the fourth exists because of a specific failure.
 *
 * With three densities the landing page ran four consecutive sections at
 * `default`, so its entire middle had one vertical rhythm and read as a list
 * of interchangeable blocks. Rhythm is variation; a page where every section
 * breathes identically has none, whatever the number is.
 *
 * The rule, which the pages are held to: **`default` may not appear more than
 * twice in a row.** A dense proof section and an airy statement section are
 * different kinds of content and must be given different amounts of air.
 */
const densities = {
  /** A band that interrupts: a CTA, a single sentence. */
  interrupt: 'py-band sm:py-[4.5rem]',
  /** Proof, tables, anything the reader scans rather than reads. */
  dense: 'py-band sm:py-[5rem]',
  /** Ordinary content. */
  default: 'py-[5rem] sm:py-section',
  /** Openers and closers, and the one statement a page is built around. */
  open: 'py-section sm:py-open',
  none: '',

  /* Aliases for the previous three-density set. Kept so the twelve call sites
     across six pages keep compiling; each page drops its alias during its own
     pass rather than in one sweep here. Do not use in new code. */
  /** @deprecated → `interrupt` */
  tight: 'py-band sm:py-[4.5rem]',
  /** @deprecated → `open` */
  loose: 'py-section sm:py-open',
} as const;

export function Container({
  children,
  className,
  width = 'default',
}: {
  children: ReactNode;
  className?: string;
  width?: keyof typeof widths;
}) {
  return (
    <div className={cn('mx-auto w-full px-5 sm:px-8', widths[width], className)}>
      {children}
    </div>
  );
}

export function Section({
  children,
  className,
  innerClassName,
  width = 'default',
  density = 'default',
  id,
  /**
   * A tinted band. Used to separate movements of the page — never more than
   * twice in a row, or the alternation becomes the pattern the reader sees
   * instead of the content.
   */
  tone = 'plain',
  'aria-labelledby': labelledBy,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  width?: keyof typeof widths;
  density?: keyof typeof densities;
  id?: string;
  tone?: 'plain' | 'surface' | 'ink';
  'aria-labelledby'?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        tone === 'surface' && 'bg-surface border-hairline border-y',
        tone === 'ink' && 'bg-ink text-ink-fg',
        className,
      )}
    >
      <Container width={width} className={cn(densities[density], innerClassName)}>
        {children}
      </Container>
    </section>
  );
}

/**
 * The small label above a heading.
 *
 * Was a shadcn `<Badge>` on five pages — a pill with a border and a background,
 * which is a component that means "this is a status" being used to mean "this
 * is a category". A rule and a word carries the same information at a fraction
 * of the visual weight, and stops the top of every page looking identical.
 */
export function Eyebrow({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode;
  className?: string;
  /** `accent` spends one of the three accent slots on the screen. */
  tone?: 'neutral' | 'accent';
}) {
  return (
    <p
      className={cn(
        // `text-label` carries +0.06em. Small type set solid is the most
        // common amateur tell on a page; an eyebrow is the place it shows.
        //
        // Neutral by default, not accent. The eyebrow was `text-brand` on
        // every section of every page, which by itself put the accent five or
        // six times on a screen and spent the emphasis before the page had
        // said anything. `tone="accent"` is available for the one eyebrow on a
        // page that is genuinely worth it.
        'text-label flex items-center gap-label uppercase',
        tone === 'accent' ? 'text-brand' : 'text-copy-3',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-px w-6', tone === 'accent' ? 'bg-brand/40' : 'bg-hairline-strong')}
      />
      {children}
    </p>
  );
}

/**
 * A section's heading block.
 *
 * `align` defaults to left. The old pages centred every heading on the site,
 * including ones introducing a left-aligned grid — centred text under a
 * centred eyebrow above a centred paragraph, six times per page. Centring is
 * for moments that deserve ceremony; using it everywhere spends the emphasis
 * before the page has said anything.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  id,
  align = 'left',
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  id?: string;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        // Not a uniform stack. The eyebrow sits close to the heading it
        // labels (`pair`), and the description sits further from it than the
        // eyebrow does — the rule being that space above a heading is a step
        // larger than the space below it, so the heading groups downward.
        'flex flex-col',
        align === 'center' && 'mx-auto max-w-2xl items-center text-center',
        className,
      )}
    >
      {eyebrow && <Eyebrow className="mb-pair">{eyebrow}</Eyebrow>}
      <h2 id={id} className="text-display-2 text-balance-hero max-w-3xl">
        {title}
      </h2>
      {description && (
        <p className="text-copy-2 text-lede text-pretty-body mt-row max-w-[38rem]">
          {description}
        </p>
      )}
    </Reveal>
  );
}
