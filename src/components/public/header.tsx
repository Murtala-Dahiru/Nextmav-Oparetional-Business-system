'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ArrowRight } from 'lucide-react';
import { Logo, buttonClass } from './ui';
import { useSessionPeek } from '@/components/marketing/use-session-peek';

/**
 * The uploaded project's header, on this application's routes.
 *
 * Markup and class names are the upload's, so `layout.css` styles it exactly as
 * written. Three things are carried over from the implementation it replaces,
 * none of them cosmetic:
 *
 *   · **Escape closes the panel and returns focus to the trigger**, and Tab is
 *     trapped inside it. The panel covers the page; without a trap, tabbing
 *     leaves you on links you cannot see behind it.
 *   · **The route-change close and the scroll-lock cleanup**, so navigating
 *     from the panel does not leave it open over the new page with the body
 *     still locked.
 *   · **Session awareness.** A visitor who is already signed in is offered
 *     their dashboard rather than a sign-in link. This is existing
 *     functionality wired to the existing auth, not a design decision.
 */

const NAV = [
  { label: 'Platform', href: '/features' },
  { label: 'Solutions', href: '/solutions' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Company', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

export function PublicHeader() {
  const pathname = usePathname();
  const session = useSessionPeek();
  const [scrolled, setScrolled] = useState(false);

  /**
   * The menu is derived from *where* it was opened, not from a boolean synced
   * back to the route.
   *
   * The obvious version — `useEffect(() => setOpen(false), [pathname])` — sets
   * state synchronously inside an effect, which cascades an extra render on
   * every navigation and is what `react-hooks/set-state-in-effect` exists to
   * catch. Storing the path the panel was opened at makes "a navigation
   * happened" and "the panel is closed" the same fact, so nothing has to
   * synchronise them.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === pathname;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    setOpenedAt(value ? pathname : null);
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
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

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className={`nm-header ${scrolled || open ? 'nm-header-scrolled' : ''}`}>
      <div className="nm-header-inner">
        <Link href="/" className="nm-header-logo" aria-label="NextMav — home">
          <Logo size={28} />
        </Link>

        <nav className="nm-header-nav" aria-label="Primary">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`nm-nav-link ${active ? 'nm-nav-link-active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Reserved width, so the bar does not reflow when the session answer
            arrives — see `use-session-peek`. */}
        <div className="nm-header-actions" style={{ minWidth: '11.5rem' }}>
          {session === 'unknown' ? null : session === 'authenticated' ? (
            <Link href="/dashboard" className={buttonClass('primary', 'sm')}>
              Go to dashboard
              <ArrowRight size={14} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="nm-nav-link nm-header-signin">
                Sign in
              </Link>
              <Link href="/signup" className={buttonClass('primary', 'sm')}>
                Get started
                <ArrowRight size={14} />
              </Link>
            </>
          )}
        </div>

        <button
          ref={triggerRef}
          type="button"
          className="nm-header-menu-btn"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="nm-mobile-nav"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <div
        ref={panelRef}
        id="nm-mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!open}
        className="nm-header-mobile"
      >
        <nav aria-label="Mobile" className="nm-header-mobile-nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="nm-header-mobile-link">
              <span>{item.label}</span>
              <ArrowRight size={18} className="nm-header-mobile-arrow" />
            </Link>
          ))}
          <hr className="nm-divider" style={{ margin: 'var(--nm-space-4) 0' }} />
          {session === 'authenticated' ? (
            <Link href="/dashboard" className={buttonClass('primary', 'lg', 'nm-header-mobile-cta')}>
              Go to dashboard
              <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="nm-header-mobile-link">
                <span>Sign in</span>
              </Link>
              <Link href="/signup" className={buttonClass('primary', 'lg', 'nm-header-mobile-cta')}>
                Get started
                <ArrowRight size={16} />
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
