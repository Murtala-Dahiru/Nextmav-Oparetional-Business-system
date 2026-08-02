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

const densities = {
  tight: 'py-14 sm:py-16',
  default: 'py-20 sm:py-28',
  loose: 'py-24 sm:py-36',
  none: '',
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
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'text-brand flex items-center gap-2.5 text-[0.8125rem] font-medium tracking-[0.02em]',
        className,
      )}
    >
      <span aria-hidden="true" className="bg-brand/40 h-px w-6" />
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
        'flex flex-col gap-4',
        align === 'center' && 'mx-auto max-w-2xl items-center text-center',
        className,
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 id={id} className="text-display-2 text-balance-hero max-w-3xl">
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground text-lede text-pretty-body max-w-2xl">
          {description}
        </p>
      )}
    </Reveal>
  );
}
