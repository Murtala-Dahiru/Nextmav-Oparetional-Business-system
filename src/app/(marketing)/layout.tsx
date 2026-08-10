import type { ReactNode } from 'react';
import { PublicHeader } from '@/components/public/header';
import { PublicFooter } from '@/components/public/footer';
import { publicFontVars } from '@/components/public/fonts';

// The uploaded project's stylesheets, scoped to `.nm-public` by
// `scripts/import-public-css.mjs`. `base.css` pulls in `tokens.css` itself.
import '@/styles/public/base.css';
import '@/styles/public/layout.css';
import '@/styles/public/components.css';
import '@/styles/public/landing.css';
import '@/styles/public/pages.css';
import '@/styles/public/auth.css';
import '@/styles/public/auth-forms.css';
import '@/styles/public/refinements.css';
// Last, deliberately: it overrides the font tokens and relies on source order.
import '@/styles/public-fonts.css';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Public shell
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The isolation boundary ───────────────────────────────────────────────
 *
 *  `.nm-public` is the entire mechanism keeping the uploaded design system off
 *  the authenticated application. In the App Router every imported stylesheet
 *  is global no matter which layout imports it, so importing these here is not
 *  isolation on its own — the isolation is in the CSS, where every `:root`,
 *  `html`, `body`, `*`, element and pseudo-element selector has been rewritten
 *  to sit under this class.
 *
 *  Three custom properties genuinely collide between the two systems
 *  (`--nm-accent`, `--nm-accent-hover`, `--nm-accent-soft`). Scoping the
 *  uploaded `:root` to this wrapper is what keeps them apart: inside here the
 *  uploaded values apply, and at `:root` the application's own ramp is
 *  untouched.
 *
 *  If you add a stylesheet to this list, run it through the script first.
 *
 *  ── Why the pages stay server components ─────────────────────────────────
 *
 *  The uploaded project is a client-rendered SPA. Ported literally, every
 *  marketing route would leave static generation for the sake of a scroll
 *  observer and a password toggle. The interactive parts live in
 *  `components/public/client.tsx` and the header and footer; the pages
 *  themselves render on the server and prerender static, as they did before.
 */

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    /*
      `nm-app` sits on a child, not on this element, for the same reason as in
      `components/auth/auth-shell.tsx`: the import script scopes every rule as
      `.nm-public <sel>`, a descendant selector, which cannot match a class on
      the wrapper itself.

      What was lost here is the sticky footer — `.nm-app { min-height: 100vh;
      display: flex; flex-direction: column }` with `> main { flex: 1 }`. With
      the wrapper falling back to `display: block` the footer simply ends where
      the content ends: measured on `/blog` at a 1400px-tall viewport, 342px of
      bare white below it.
    */
    <div className={`nm-public ${publicFontVars}`}>
      <div className="nm-app">
      {/*
        The reveal system ships its hidden state in the server HTML to avoid a
        flash on load, which puts content behind JavaScript. This hands it back
        to anyone without it — otherwise a reader with scripts disabled gets a
        header, a footer and nothing in between.
      */}
      <noscript>
        <style>{`.nm-reveal{opacity:1!important;transform:none!important}`}</style>
      </noscript>

      <a href="#main" className="nm-skip-link">
        Skip to content
      </a>

      <PublicHeader />
      <main id="main">{children}</main>
      <PublicFooter />
      </div>
    </div>
  );
}
