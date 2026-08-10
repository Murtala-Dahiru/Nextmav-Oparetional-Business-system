import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
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
// Hand-maintained, after the generated sheet it extends. See its header.
import '@/styles/public/auth-forms.css';
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

/**
 * ── Why the aside is not the same on every screen ─────────────────────────
 *
 * It was. All seven screens carried `DEFAULT_ASIDE` — a fourteen-day trial
 * pitch — and on five of them it is the wrong thing to say to the person
 * reading it:
 *
 *   · Somebody resetting a password is locked out of an account they already
 *     have. Selling them a trial is the interface not knowing where it is.
 *   · Somebody accepting an invitation already belongs to an organisation.
 *   · Somebody changing a password is signed in and paying already.
 *
 * A panel that says the same thing regardless of what the person is doing is
 * decoration, and it reads as decoration. These say something true about the
 * screen they sit beside.
 *
 * Every claim below is one the product actually makes elsewhere in this
 * codebase — the non-enumerating reset endpoint, single-use links, the two
 * session-end reasons in `proxy.ts`, row-level isolation. Nothing here is
 * invented for the sake of filling a panel; that is what
 * `CONTENT-NEEDED.md` is for.
 */
export const ASIDES = {
  /** Sign-in. A returning user is not a prospect; do not sell to them. */
  signIn: {
    eyebrow: 'Where you left off',
    title: 'Your work is where you left it.',
    body: 'CRM, projects, people, finance, inventory and communication in one application — on one permission model and one audit trail.',
    points: [
      {
        title: 'One record, every module',
        desc: 'A customer is the same customer in projects, finance and support.',
      },
      {
        title: 'Sessions end deliberately',
        desc: 'Inactivity and maximum length are policy, and we tell you which applied.',
      },
      {
        title: 'Isolated at the database',
        desc: 'Row-level security, not a filter in application code.',
      },
    ],
  },

  /** Sign-up. The trial pitch belongs here and only here. */
  signUp: DEFAULT_ASIDE,

  /** Password reset — request and completion. */
  recovery: {
    eyebrow: 'How this works',
    title: 'Recovery that gives nothing away.',
    body: 'The reset flow is built so that using it reveals nothing about who does or does not have an account here.',
    points: [
      {
        title: 'The same answer either way',
        desc: 'This form responds identically whether or not the address is registered.',
      },
      {
        title: 'One link, one use',
        desc: 'The link stops working the moment it is redeemed.',
      },
      {
        title: 'Nothing changes until you finish',
        desc: 'Requesting a reset does not lock, alter or suspend the account.',
      },
    ],
  },

  /** Email confirmation. */
  verify: {
    eyebrow: 'One step left',
    title: 'Confirming the address keeps the account yours.',
    body: 'An unconfirmed address is one somebody could have typed by mistake — or on purpose. The link proves the inbox is yours before the account can be used.',
    points: [
      {
        title: 'It expires',
        desc: 'A link left unopened stops working rather than waiting indefinitely.',
      },
      {
        title: 'You can send another',
        desc: 'Requesting a new link invalidates the previous one.',
      },
      {
        title: 'Nothing is charged',
        desc: 'Confirming an address does not start a subscription.',
      },
    ],
  },

  /** Invitation acceptance — they already have an organisation. */
  invite: {
    eyebrow: 'Joining a workspace',
    title: 'You are being added to an existing organisation.',
    body: 'Your access is defined by the role you were invited with, and it applies the same way in every module.',
    points: [
      {
        title: 'One permission model',
        desc: 'The same role governs CRM, finance, projects and everything else.',
      },
      {
        title: 'Scoped to that organisation',
        desc: 'You see its data and no other tenant’s — enforced at the database.',
      },
      {
        title: 'Actions are attributable',
        desc: 'Changes are recorded against the person who made them.',
      },
    ],
  },
} satisfies Record<string, AuthAside>;

/**
 * The Suspense fallback for the screens that read search params.
 *
 * It renders the split-screen's own background rather than a centred spinner
 * on `bg-background` — an application token that does not exist inside
 * `.nm-public`, so the fallback was painting a colour from the other design
 * system for the moment before the form arrived. Short, but it is the very
 * first frame of the page.
 */
export function AuthLoading() {
  return (
    <div className={`nm-public ${publicFontVars}`}>
      <div
        className="nm-auth"
        style={{ placeItems: 'center', gridTemplateColumns: '1fr' }}
        role="status"
        aria-label="Loading"
      >
        <Loader2
          className="nm-spin"
          size={20}
          aria-hidden="true"
          style={{ color: 'var(--nm-ink-subtle)' }}
        />
      </div>
    </div>
  );
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  eyebrow,
  className,
  aside = DEFAULT_ASIDE,
  titleSize = 'display',
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
  aside?: AuthAside;
  /**
   * `display` for the entry screens, whose titles are two or three words.
   * `compact` for state screens, whose titles are sentences — see the note on
   * `.nm-auth-title-sm`.
   */
  titleSize?: 'display' | 'compact';
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
          <h1
            className={`nm-auth-title ${titleSize === 'compact' ? 'nm-auth-title-sm' : ''}`.trim()}
          >
            {title}
          </h1>
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
