import Link from 'next/link';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Logo, LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Authentication shell
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What every auth screen looked like ───────────────────────────────────
 *
 *  Identical, and identical to the failure screens. This exact string —
 *
 *    min-h-screen flex items-center justify-center
 *    bg-gradient-to-br from-gray-50 to-gray-100
 *    dark:from-gray-950 dark:to-gray-900 p-4
 *
 *  — was written out by hand in eleven places: login, signup, the signup
 *  confirmation, forgot-password, reset-password, change-password,
 *  accept-invite, both onboarding states, the 404, and the crash screen.
 *
 *  Two things follow from that. Changing the treatment meant editing eleven
 *  files and finding all of them, which is why the padding already differed
 *  between signup and login. And, more importantly, *creating an account looked
 *  exactly like crashing*. The highest-intent moment on the site and its worst
 *  moment were rendered on the same grey gradient with the same centred card.
 *
 *  ── What replaces it ─────────────────────────────────────────────────────
 *
 *  A split. The form gets a real column with room to breathe; beside it, on
 *  large screens, a panel that answers the question somebody actually has with
 *  their hands on the keyboard — what is this, and what happens to my data.
 *
 *  The panel is deliberately not a testimonial. A fabricated quote from a
 *  fabricated VP of Operations at a company that does not exist is the single
 *  most common element on SaaS sign-up screens and the easiest to catch.
 *  Three true statements about the product are worth more than a photograph
 *  of a stock model in a lanyard.
 *
 *  Below `lg` the panel is not rendered at all — not hidden, not stacked. On a
 *  phone the only thing that matters is the form, and marketing copy pushed
 *  above it is an obstacle between somebody and the account they came to make.
 */

const assurances = [
  'Every module included during the trial, with no feature held back.',
  'Your workspace is isolated at the database, not by a filter in the code.',
  'Structured export from every module, whenever you want it.',
];

export function AuthShell({
  title,
  description,
  children,
  footer,
  /** Shown above the title on screens where the side panel is not rendered. */
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,28rem)] xl:grid-cols-[1fr_minmax(0,32rem)]">
      {/* ── Form column ───────────────────────────────────────────────── */}
      <div className="flex flex-col px-5 py-8 sm:px-8 sm:py-10">
        <header className="mx-auto w-full max-w-[25rem]">
          <Link href="/" className="inline-flex rounded-md" aria-label="NextMav — home">
            <Logo />
          </Link>
        </header>

        {/*
          `justify-center` with `my-auto` rather than a fixed vertical centre:
          a tall form — signup has five fields — must be able to grow past the
          viewport and scroll normally instead of being clipped at both ends,
          which is what `items-center` on a `min-h-screen` flex parent does.
        */}
        <main className={cn('mx-auto my-auto w-full max-w-[25rem] py-10', className)}>
          {eyebrow && (
            <p className="text-brand mb-3 text-[0.8125rem] font-medium">{eyebrow}</p>
          )}
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em]">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-2.5 text-[0.9375rem] leading-relaxed">
              {description}
            </p>
          )}
          <div className="mt-8">{children}</div>
        </main>

        {footer && (
          <footer className="text-muted-foreground mx-auto w-full max-w-[25rem] text-[0.875rem]">
            {footer}
          </footer>
        )}
      </div>

      {/* ── Assurance panel ───────────────────────────────────────────── */}
      <aside
        className="bg-ink text-ink-fg relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        aria-label="About NextMav"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        <LogoMark className="relative size-9" />

        <div className="relative">
          <p className="text-[1.5rem] leading-[1.25] font-medium tracking-[-0.025em] text-balance">
            The whole company, on one record.
          </p>
          <ul className="mt-8 space-y-4">
            {assurances.map((line) => (
              <li key={line} className="flex gap-3 text-[0.875rem] leading-relaxed">
                <Check
                  className="text-brand mt-0.5 size-4 shrink-0"
                  strokeWidth={2.4}
                  aria-hidden="true"
                />
                <span className="opacity-80">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[0.8125rem] opacity-50">
          CRM · Projects · People · Finance · Inventory · Communication · Support
          · Calendar
        </p>
      </aside>
    </div>
  );
}
