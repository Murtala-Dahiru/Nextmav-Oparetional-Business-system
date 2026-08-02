'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Entrance motion, applied once, on scroll.
 *
 * ── Why this is so restrained ────────────────────────────────────────────
 *
 * 12px of travel and 500ms. The temptation with scroll animation is to make
 * it legible as animation — 40px slides, staggered by 150ms, so the reader
 * can tell something happened. That reads as a template, and worse, it means
 * a reader who scrolls quickly spends the page waiting for text they can
 * already see to finish arriving. Motion here exists to draw the eye down the
 * page, not to be noticed.
 *
 * Everything reveals exactly once. `unobserve` on first intersection, so
 * scrolling back up does not replay the page — content that re-animates is
 * content that fights the reader for control of the viewport.
 *
 * ── The no-JavaScript case ───────────────────────────────────────────────
 *
 * The hidden state ships in the server-rendered HTML, because setting it from
 * an effect would show the content, hide it, then show it again — a flash on
 * every load. That trade puts the content behind JavaScript, so the marketing
 * layout carries a `<noscript>` rule that clears `[data-reveal]` outright. A
 * reader without JavaScript gets the whole page, unanimated, which is the
 * correct outcome and not the blank one that this pattern usually produces.
 *
 * `prefers-reduced-motion` is honoured in CSS rather than here, so it applies
 * to the server-rendered state too — see `globals.css`.
 */
export function Reveal({
  children,
  className,
  as: Tag = 'div',
  /** Seconds. Kept under 0.2 in practice; see the note on staggering above. */
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Already in view on load — the hero, above all — should not wait for a
    // scroll event that may never come.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.unobserve(entry.target);
      },
      // Fires a little before the element's top edge arrives, so the motion
      // completes as it enters rather than starting once it is already read.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal={shown ? 'shown' : 'hidden'}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
      className={className}
    >
      {children}
    </Tag>
  );
}

/**
 * A group whose children reveal in sequence.
 *
 * The stagger is 60ms and caps at six steps. Beyond that the last card in a
 * grid arrives most of a second after the first, which stops reading as
 * sequence and starts reading as lag.
 */
export function RevealGroup({
  children,
  className,
  /**
   * Applied to each wrapper. The wrapper is the direct grid child, so a grid
   * of equal-height cards needs its `h-full` here rather than on the card.
   */
  itemClassName,
  step = 0.06,
}: {
  children: ReactNode[];
  className?: string;
  itemClassName?: string;
  step?: number;
}) {
  return (
    <div className={cn(className)}>
      {children.map((child, i) => (
        <Reveal key={i} delay={Math.min(i, 5) * step} className={itemClassName}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
