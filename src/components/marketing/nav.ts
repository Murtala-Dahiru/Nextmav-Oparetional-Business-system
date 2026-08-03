/**
 * The site's link graph, in one place.
 *
 * ── Why this is centralised ────────────────────────────────────────────────
 *
 * The header and the footer each kept their own copy, and the copies disagreed
 * with reality in ways a visitor could feel:
 *
 *   Careers      → /about        a role that does not exist, on a page that
 *                                never mentions hiring
 *   Integrations → /docs         a page with no integrations on it
 *   Changelog    → /blog         a marketing index, not a changelog
 *   API Reference→ /docs         the same destination as "Documentation",
 *                                listed twice as if they were two things
 *
 * Four of the fourteen footer links went somewhere other than where they said.
 * Individually each is trivial; together they are the reason a careful visitor
 * stops trusting the navigation and starts using the back button. A footer is
 * read by people who are looking for something specific — the ones closest to
 * buying — so its links are the ones that can least afford to be decorative.
 *
 * Every destination below resolves to a page that exists and is about what the
 * label says. Anything not yet built is simply not listed.
 */

/**
 * Typed as `string` rather than left to `as const` inference.
 *
 * With `as const` the `href` field narrows to the union of the five literals
 * present, so the active-state check in `SiteHeader` — `href !== '/'`, guarding
 * against the home link matching every path as a prefix — became a comparison
 * between disjoint types and failed to compile (TS2367). The guard is correct
 * and has to survive somebody later adding `{ label: 'Home', href: '/' }`;
 * widening the type is what keeps it meaningful instead of deleting it.
 */
export const MARKETING_NAV: readonly { label: string; href: string }[] = [
  { label: 'Product', href: '/features' },
  { label: 'Solutions', href: '/solutions' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Docs', href: '/docs' },
  { label: 'Company', href: '/about' },
] as const;

export const FOOTER_NAV: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Modules', href: '/features' },
      { label: 'Solutions', href: '/solutions' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Security', href: '/features#platform' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Help centre', href: '/help' },
      { label: 'Blog', href: '/blog' },
      { label: 'System status', href: '/status' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      /*
       * No Careers link.
       *
       * The original footer pointed "Careers" at /about — a page that never
       * mentioned hiring — and this file's own header comment calls that out
       * as one of four links that went somewhere other than where they said.
       * The first rewrite then pointed it at /careers, which 404s. Removing
       * four dead links and adding a fifth is not an improvement.
       *
       * It comes back when there is a page with roles on it. See
       * CONTENT-NEEDED.md.
       */
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Cookies', href: '/cookies' },
    ],
  },
];
