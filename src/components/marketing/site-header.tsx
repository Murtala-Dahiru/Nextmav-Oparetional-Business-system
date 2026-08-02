'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
import { MARKETING_NAV } from './nav';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Site header
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Three things the old header got wrong ────────────────────────────────
 *
 *  It never showed you where you were. Five identical links, no active state,
 *  on a five-page site. Orientation is the cheapest trust signal there is and
 *  it was simply absent.
 *
 *  It had a border at rest. A rule under a sticky header that never changes is
 *  a line drawn across the top of the hero — it cuts the first impression in
 *  half. The border belongs to the scrolled state, where it does actual work
 *  separating the bar from content passing underneath.
 *
 *  Its mobile menu pushed the page down. `{open && <div>}` inside the header
 *  meant opening the menu reflowed everything below it, so the content the
 *  reader was looking at jumped. It is a panel now, laid over the page, with
 *  the scroll lock and Escape handling that a panel needs and that the old one
 *  had neither of.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // `passive`: this listener never calls preventDefault, and saying so keeps
    // it off the main thread's critical path during scroll.
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Scrolling the page behind a full-screen overlay is disorienting: the
    // reader loses their position and cannot see that they have.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        <Link
          href="/"
          className="shrink-0 rounded-md"
          aria-label="NextMav — home"
        >
          <Logo />
        </Link>

        <nav
          className="hidden items-center gap-1 md:flex"
          aria-label="Main"
        >
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
                  'rounded-md px-3 py-2 text-[0.875rem] font-medium transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="cta" size="sm">
            <Link href="/signup">Start free</Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="text-muted-foreground hover:text-foreground hover:bg-surface-2 ml-auto rounded-md p-2 transition-colors md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Overlaid, not inserted: see the note above on reflow. */}
      <div
        id="mobile-nav"
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
                  'rounded-lg px-3 py-3 text-base font-medium transition-colors',
                  active
                    ? 'bg-surface-2 text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}

          <div className="mt-4 flex flex-col gap-2.5">
            <Button asChild variant="ctaOutline" size="xl">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="cta" size="xl">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
