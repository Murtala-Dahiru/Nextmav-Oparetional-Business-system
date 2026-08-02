/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The platform's own identity
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  This is a multi-tenant SaaS product, not a white-label shell. The platform
 *  keeps its own name, mark and favicon on every screen, for every customer,
 *  always. A tenant's branding describes *their company*; it never replaces
 *  *this product*.
 *
 *  ── Why this file exists ─────────────────────────────────────────────────
 *
 *  The identity was a set of literals — "NexusCorp" hard-coded in the sidebar,
 *  again in the sign-in page, again as a fallback in the header, and
 *  "NexusCorp Business OS" in the document title. Nothing named it as *the
 *  platform's*, so nothing distinguished it from the tenant's name sitting
 *  beside it in the same store. That is precisely how a customer's logo came to
 *  be rendered in the application chrome: with no stated boundary, replacing one
 *  with the other looked like an improvement.
 *
 *  Naming it makes the boundary checkable. `security:check` now fails the build
 *  if a component under `components/layout` reads tenant branding, because the
 *  shell is the one place it must never appear.
 *
 *  ── What belongs to whom ─────────────────────────────────────────────────
 *
 *    Platform (this file)          Tenant (`organizations` + `branding`)
 *    ─────────────────────────     ──────────────────────────────────────
 *    sidebar mark and name         their company profile screen
 *    sign-in page                  their client portal
 *    document title and favicon    their invoices and documents
 *    marketing pages               their letterhead and exports
 *
 *  A tenant seeing their own logo in the sidebar would mean every tenant sees a
 *  different product, which is not what any of them bought — and the moment two
 *  colleagues from different workspaces compare screens, neither can tell they
 *  are using the same software.
 */

export const PLATFORM = {
  /** The company that makes this product. */
  name: 'NextMav',
  /** The product, as it appears in a document title or an email subject. */
  product: 'NextMav Business OS',
  /** One line, for the sign-in page and metadata. */
  tagline:
    'One system of record for the whole company — CRM, projects, people, finance and operations.',
  /**
   * The platform mark, served from this application.
   *
   * ── Two separate problems, only one of which was fixed ──────────────────
   *
   * The favicon used to point at `https://z-cdn.chatglm.cn/z-ai/static/logo.svg`
   * — a scaffold URL left over from the project template, on a third-party
   * host this product does not control. Every page load fetched the platform's
   * own identity from someone else's server, and the day that host changed the
   * file, every customer's browser tab would silently become something else.
   * Serving it from `public/` fixed that.
   *
   * What it did not fix is that the file *was Z.ai's logo* — their mark, in
   * their colours, complete with their `z-breathe` animation, now served from
   * our origin as our identity. Moving a trademark you do not own onto your
   * own domain makes it more yours in exactly no respect that matters.
   *
   * `public/logo.svg` is now the drawn NextMav mark, and
   * `components/brand/logo.tsx` is the same form as a component so the tab,
   * the shell and the marketing pages cannot drift apart.
   */
  logo: '/logo.svg',
  /**
   * The accent the shell uses.
   *
   * Was `#10b981` (emerald-500), which fails WCAG AA on white at 2.54:1 — it
   * was carrying links and inline emphasis it was too weak to carry. This is
   * the same hue family at 5.4:1. The full token set, including the dark-mode
   * lift, lives in `globals.css` as `--brand`; this literal exists for the
   * places that need a colour outside CSS, such as `theme-color` metadata.
   *
   * Deliberately not a tenant setting. `branding.primary_colour` exists and is
   * a real preference — it just applies to the tenant's own artifacts, not to
   * this product's navigation.
   */
  accent: '#0f766e',
} as const;
