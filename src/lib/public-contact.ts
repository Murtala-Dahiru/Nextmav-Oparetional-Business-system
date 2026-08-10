/**
 * The public surface's contact addresses.
 *
 * ── Why these are on the product's own domain ────────────────────────────
 *
 * They were `@example.com`, deliberately, so that an unconfirmed address could
 * not be mistaken for a working one. That was the right call while the public
 * pages were being rebuilt and the wrong one to ship: `example.com` is the
 * single clearest signal on a website that nobody has finished it, and a
 * visitor evaluating enterprise software reads it as "this is a prototype"
 * long before they read it as "this address is pending".
 *
 * ⚠️ **These mailboxes must be created before the site goes public.** They are
 * the product's own domain rather than an invented third party, so nothing here
 * is a claim about anyone else — but an address that bounces is still worse
 * than one that is obviously provisional. Tracked as CONTENT-NEEDED #1.
 *
 * Central because five surfaces reference them — the contact channels, the
 * contact form, the footer's update list, and the privacy, terms and cookies
 * pages. Three of those had their own hardcoded copy of the string, which is
 * how a domain change ships with two of them still pointing at the old one.
 */

/** General enquiries, and where the contact form and footer compose to. */
export const CONTACT_EMAIL = 'hello@nextmav.com';

/** Pricing, evaluation and procurement. */
export const SALES_EMAIL = 'sales@nextmav.com';

/** Existing customers with a technical problem. */
export const SUPPORT_EMAIL = 'support@nextmav.com';

/** Data-protection requests, named in the privacy and cookies policies. */
export const PRIVACY_EMAIL = 'privacy@nextmav.com';

/** Contractual notices, named in the terms. */
export const LEGAL_EMAIL = 'legal@nextmav.com';
