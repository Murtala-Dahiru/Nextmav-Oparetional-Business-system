import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Marketing shell
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this is no longer a client component ─────────────────────────────
 *
 *  It was `'use client'` for one reason: a `useState` holding whether the
 *  mobile menu was open. That single boolean opted the header, the footer, the
 *  entire link graph and every page that renders inside this layout out of
 *  server rendering — so a visitor on a phone downloaded and executed
 *  JavaScript before they could read a footer that never changes.
 *
 *  The state moved into `SiteHeader`, which is the only thing that needs it.
 *  Everything else renders on the server. It is the same pattern the rest of
 *  this codebase already uses, and the reason the landing page can now be
 *  static.
 */

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // `phase1` re-points the neutral tokens for this subtree only. The
    // authenticated application reads the same token names from `:root` and
    // is deliberately left on shadcn's ramp until Phase 2 reconciles the two
    // — a ramp change propagating into 44 app files is not a design decision,
    // it is an outage. See the block in `globals.css`.
    <div className="phase1 flex min-h-screen flex-col">
      {/*
        The scroll-reveal system ships its hidden state in the server HTML to
        avoid a flash on load (see `Reveal`). That trade puts the page's
        content behind JavaScript, so this hands it back to anyone who does not
        have it. Without these three lines a reader with scripts disabled gets
        a site with a header, a footer and nothing in between.
      */}
      <noscript>
        <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>

      {/* Keyboard users should not have to tab the whole nav on every page. */}
      <a
        href="#main"
        className="bg-ink text-ink-fg focus-visible:ring-brand sr-only z-[60] rounded-md px-4 py-2 text-sm font-medium focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3"
      >
        Skip to content
      </a>

      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
