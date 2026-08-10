/**
 * The public surface's contact address.
 *
 * A placeholder, deliberately, and tracked as CONTENT-NEEDED #1. It was
 * `hello@nexuscorp.io`, a domain that does not resolve; publishing an address
 * that bounces is worse than publishing one that is obviously a placeholder,
 * because only the second kind gets noticed and fixed.
 *
 * Central because three separate surfaces now compose mail to it — the contact
 * form, the footer's update list, and the routed enquiry intents. Two of them
 * had their own copy of the string, which is how a domain change ships with one
 * of them still pointing at the old one.
 *
 * Replace this one constant when the real address exists. Nothing else needs
 * touching.
 */
export const CONTACT_EMAIL = 'hello@example.com';
