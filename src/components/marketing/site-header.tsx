'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
import { MARKETING_NAV } from './nav';
import { useSessionPeek } from './use-session-peek';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Site header
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Four things the original got wrong ───────────────────────────────────
 *
 *  **No sense of place.** Five identical links on a five-page site, with no
 *  active state. Orientation is the cheapest trust signal there is.
 *
 *  **A border at rest.** A rule under a sticky header that never changes is a
 *  line drawn across the top of the hero, cutting the first impression in
 *  half. The border belongs to the scrolled state, where it separates the bar
 *  from content passing beneath it.
 *
 *  **A mobile menu that pushed the page down.** `{open && <div>}` inside the
 *  header meant opening it reflowed everything below, so the content the
 *  reader was looking at jumped away from them. It is an overlay now, with the
 *  scroll lock, Escape handling and focus management a dialog needs and the
 *  old one had none of.
 *
 *  **"Sign in" shown to people who were signed in.** See `use-session-peek`.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const session = useSessionPeek();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // `passive`: this listener never calls preventDefault, and saying so keeps
    // it off the critical path during scroll.
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Route changes close the menu. Without this, tapping a link navigates and
  // leaves the overlay sitting on top of the new page.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        // Focus goes back to the button that opened it. Without this, closing
        // the panel drops the keyboard user at the top of the document and
        // they have to tab back to where they were.
        triggerRef.current?.focus();
        return;
      }

      // A trap, because the panel covers the page. Tabbing out of a
      // full-screen overlay lands you on links you cannot see, behind it.
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Scrolling the page behind a full-screen overlay is disorienting: the
    // reader loses their position and cannot see that they have.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    // Move into the panel so the first Tab goes to the first link rather than
    // continuing from wherever focus happened to be in the page behind.
    panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * The right-hand actions.
   *
   * Rendered in a slot of reserved width so the bar does not reflow when the
   * session answer arrives — see the note on the `unknown` state in
   * `use-session-peek`.
   */
  const actions =
    session === 'unknown' ? null : session === 'authenticated' ? (
      <Button asChild variant="cta" size="sm">
        <Link href="/dashboard">
          Go to dashboard
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    ) : (
      <>
        <Button asChild variant="ghost" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="cta" size="sm">
          <Link href="/signup">Start free</Link>
        </Button>
      </>
    );

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300',
        scrolled || open
          ? 'border-hairline bg-background/80 border-b backdrop-blur-xl'
          : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[75rem] items-center gap-8 px-5 sm:px-8">
        <Link href="/" className="shrink-0 rounded-md" aria-label="NextMav — home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {MARKETING_NAV.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== '/' && pathname.startsWith(`${link.href}/`));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative rounded-md px-3 py-2 text-[0.875rem] font-medium transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {link.label}
                {/*
                  A mark under the current page, not just a colour change.
                  `nav-state-active` in the skill's navigation rules, and
                  `color-not-only` in its accessibility rules — the difference
                  between grey and near-black is not reliably visible to
                  everyone, so the state carries a second signal.
                */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="bg-brand absolute inset-x-3 -bottom-px h-[2px] rounded-full"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden min-w-[11.5rem] items-center justify-end gap-2 md:flex">
          {actions}
        </div>

        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          // 44px, per the touch-target minimum. The original was `p-2` on a
          // 20px icon — 36px, and the most-tapped control on a phone.
          className="text-muted-foreground hover:text-foreground hover:bg-surface-2 ml-auto grid size-11 place-items-center rounded-md transition-colors md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Overlaid, not inserted: see the note above on reflow. */}
      <div
        ref={panelRef}
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!open}
        className="bg-background border-hairline fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t md:hidden"
      >
        <nav className="flex flex-col gap-1 p-5" aria-label="Main">
          {MARKETING_NAV.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-lg px-3 text-base font-medium transition-colors',
                  active
                    ? 'bg-surface-2 text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {link.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="bg-brand ml-auto size-1.5 rounded-full"
                  />
                )}
              </Link>
            );
          })}

          <div className="border-hairline mt-4 flex flex-col gap-2.5 border-t pt-5">
            {session === 'authenticated' ? (
              <Button asChild variant="cta" size="xl">
                <Link href="/dashboard">
                  Go to dashboard
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ctaOutline" size="xl">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild variant="cta" size="xl">
                  <Link href="/signup">Start free</Link>
                </Button>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
