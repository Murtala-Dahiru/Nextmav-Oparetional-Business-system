import { cn } from '@/lib/utils';
import { PLATFORM } from '@/lib/platform';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The platform mark
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this file exists ─────────────────────────────────────────────────
 *
 *  The product had two marks and owned neither.
 *
 *  The browser tab showed `public/logo.svg`, which was the Z.ai/ChatGLM logo
 *  left behind by the project scaffold. `lib/platform.ts` documents at length
 *  how that file was rescued from a third-party CDN and served locally — a
 *  real fix to a real problem, applied to somebody else's trademark.
 *
 *  Every screen inside the application showed something different: lucide's
 *  `Hexagon`, a stock icon from a general-purpose icon set, tinted emerald.
 *  It appeared in the sidebar, on the sign-in page, in the marketing header,
 *  the footer, the 404 and the signup confirmation — six independent
 *  copies of `<Hexagon className="size-8 text-emerald-500" />`, which is why
 *  changing the mark previously meant finding all six.
 *
 *  A mark nobody owns cannot do the one job a mark has, which is to be
 *  recognised as this product and not another. This is the drawn form, in one
 *  file, in `currentColor` so it inherits its context.
 *
 *  ── The form ─────────────────────────────────────────────────────────────
 *
 *  An N whose closing stem overshoots into an arrowhead — the letter and the
 *  direction in a single stroke. Monoline, geometric, no fills, so it holds
 *  at 16px in a browser tab and at 96px on a login screen without a separate
 *  "simplified" variant to keep in sync.
 */

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('size-8', className)}
    >
      {/*
        The badge is the only filled shape. `currentColor` at low alpha rather
        than a fixed ink value, so the mark sits correctly on a white header,
        a dark footer and a coloured CTA panel without three variants.
      */}
      <rect width="32" height="32" rx="8" className="fill-ink" />
      <g
        className="stroke-brand"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 22.5V11" />
        <path d="M11 11l10 11.5" />
        <path d="M21 22.5V9.5" />
        <path d="M17.6 12.9 21 9.5l3.4 3.4" />
      </g>
    </svg>
  );
}

/**
 * Mark plus name.
 *
 * The name comes from `PLATFORM`, never from a literal and never from tenant
 * branding — see the boundary described in `lib/platform.ts`. `security:check`
 * enforces the same rule for anything under `components/layout`.
 */
export function Logo({
  className,
  markClassName,
  /**
   * The wordmark's own type, for the one surface that needs different type
   * from the marketing header: the application sidebar, where the name sits
   * above a 13px navigation column and has to be quieter than it is on a
   * landing page. Additive — omitted, the mark renders exactly as before.
   */
  nameClassName,
  showName = true,
}: {
  className?: string;
  markClassName?: string;
  nameClassName?: string;
  showName?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={cn('size-7', markClassName)} />
      {showName && (
        <span className={cn('text-[0.975rem] font-semibold tracking-[-0.02em]', nameClassName)}>
          {PLATFORM.name}
        </span>
      )}
    </span>
  );
}
