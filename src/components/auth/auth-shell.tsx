import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';
import { Logo } from '@/components/public/ui';
import { publicFontVars } from '@/components/public/fonts';

// The uploaded public design system. Scoped to `.nm-public` by
// `scripts/import-public-css.mjs`; imported here because the auth routes sit
// outside the `(marketing)` group and so do not inherit that layout's imports.
// Next deduplicates these against the marketing layout's copies.
import '@/styles/public/base.css';
import '@/styles/public/layout.css';
import '@/styles/public/components.css';
import '@/styles/public/pages.css';
import '@/styles/public/auth.css';
import '@/styles/public-fonts.css';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Auth shell — the uploaded project's two-pane layout
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why the replacement happened here and not in the pages ───────────────
 *
 *  All four auth screens carry real logic worth protecting: four distinguished
 *  failure modes on sign-in, blur-then-reveal validation, a resend-confirmation
 *  call, non-enumerating copy on password reset, and a full-document navigation
 *  after login because the session cookie is httpOnly and middleware has to
 *  re-evaluate it on a fresh request.
 *
 *  None of that is presentation. So the props here are **unchanged** — `title`,
 *  `description`, `children`, `footer`, `eyebrow`, `className` — and only what
 *  this component renders has been swapped for the uploaded design. Every page
 *  changed appearance without a line of its own logic being touched, which is
 *  the smallest possible boundary for "replace the presentation layer".
 *
 *  `aside` is new and optional. The uploaded design gives each screen its own
 *  side panel; the default below is the one this product can actually stand
 *  behind, and sign-up overrides it.
 */

const DEFAULT_ASIDE = {
  eyebrow: 'Why teams move',
  title: 'One system of record for the whole company.',
  body: 'CRM, projects, people, finance, inventory and communication in a single application — on one permission model and one audit trail.',
  points: [
    {
      title: 'Every module in the trial',
      desc: 'Fourteen days, nothing held back, no card.',
    },
    {
      title: 'Isolated at the database',
      desc: 'Row-level security, not a filter in application code.',
    },
    {
      title: 'Your data, on request',
      desc: 'Structured export from every module, whenever you want it.',
    },
  ],
};

export type AuthAside = typeof DEFAULT_ASIDE;

export function AuthShell({
  title,
  description,
  children,
  footer,
  eyebrow,
  className,
  aside = DEFAULT_ASIDE,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
  aside?: AuthAside;
}) {
  return (
    /*
      ── Why `nm-auth` is on a child and not on this element ──────────────────

      `scripts/import-public-css.mjs` rewrites every rule to `.nm-public <sel>`
      — a *descendant* selector. So a class that also sits on the wrapper itself
      is styled by nothing: `.nm-public .nm-auth` cannot match an element that
      is `.nm-public.nm-auth`.

      That is not a subtle loss. `.nm-auth` is the entire split-screen: the
      `grid-template-columns: 1fr 1fr` that puts the form beside the dark brand
      panel. Without it the wrapper fell back to `display: block`, so the form
      column rendered 400px wide inside 1265px of empty white and the aside —
      still `min-height: 100vh` — was pushed a full screen below the fold, where
      nobody signing in will ever scroll to find it. Every auth screen has been
      rendering as a bare form on an empty page.

      Nesting fixes it without touching a generated stylesheet.
    */
    <div className={`nm-public ${publicFontVars}`}>
      <div className={`nm-auth ${className ?? ''}`.trim()}>
      <div className="nm-auth-form-side">
        <div className="nm-auth-top">
          <Link href="/" aria-label="NextMav — home">
            <Logo size={24} />
          </Link>
        </div>

        <div className="nm-auth-form-wrap">
          {eyebrow && <span className="nm-eyebrow">{eyebrow}</span>}
          <h1 className="nm-auth-title">{title}</h1>
          {description && <p className="nm-auth-subtitle">{description}</p>}
          {children}
          {footer && <div className="nm-auth-switch">{footer}</div>}
        </div>

        <div className="nm-auth-bottom">
          <Link href="/" className="nm-arrow-link">
            <ArrowLeft size={14} aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </div>

      {/*
        Decorative in the sense that it repeats nothing the form needs — a
        screen-reader user reaching the form has everything required to complete
        it. It is not `aria-hidden`, because the assurances are real content a
        person may want; it simply sits after the form in the document order.
      */}
      <aside className="nm-auth-aside nm-dark-surface">
        <div className="nm-auth-aside-inner">
          <span className="nm-auth-aside-eyebrow">{aside.eyebrow}</span>
          <h2 className="nm-auth-aside-title">{aside.title}</h2>
          <p className="nm-auth-aside-body">{aside.body}</p>
          <div className="nm-auth-aside-features">
            {aside.points.map((point) => (
              <div key={point.title} className="nm-auth-aside-feature">
                <div className="nm-auth-aside-feature-icon">
                  <Check size={16} aria-hidden="true" />
                </div>
                <div className="nm-auth-aside-feature-text">
                  <span className="nm-auth-aside-feature-title">{point.title}</span>
                  <span className="nm-auth-aside-feature-desc">{point.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="nm-auth-aside-foot nm-mono">
          NextMav · Business Operating System
        </div>
      </aside>
      </div>
    </div>
  );
}
