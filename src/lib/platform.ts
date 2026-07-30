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
  name: 'NexusCorp',
  /** The product, as it appears in a document title or an email subject. */
  product: 'NexusCorp Business OS',
  /** One line, for the sign-in page and metadata. */
  tagline:
    'Enterprise-grade business operating system — CRM, Projects, HR, Finance, and more.',
  /**
   * The platform mark, served from this application.
   *
   * A local path, not a CDN. The favicon previously pointed at
   * `https://z-cdn.chatglm.cn/z-ai/static/logo.svg` — a scaffold URL left over
   * from the project template, on a third-party host this product does not
   * control. Every page load fetched the platform's own identity from someone
   * else's server, and the day that host changes the file, every customer's
   * browser tab silently becomes something else.
   */
  logo: '/logo.svg',
  /**
   * The accent the shell uses.
   *
   * Deliberately not a tenant setting. `branding.primary_colour` exists and is
   * a real preference — it just applies to the tenant's own artifacts, not to
   * this product's navigation.
   */
  accent: '#10b981',
} as const;
