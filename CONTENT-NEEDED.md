# Content needed — Phase 1

Everything the public surface needs from you that cannot be designed or
invented. Each item says what was there before, why it was removed, and what
happens if it stays unanswered.

**Rule applied throughout: no claim ships that a visitor could falsify.** An
enterprise buyer checks. A fabricated metric on a pricing page is not a
placeholder, it is a term of sale.

---

## 🔴 Blocking — the page is visibly incomplete without it

### 1. Contact email address
**Where:** `src/app/(marketing)/contact/page.tsx`, constant `CONTACT_EMAIL`
**Currently:** `hello@example.com`
**Was:** `hello@nexuscorp.io` — a domain that does not resolve.
One constant, four intents fall back to it. If you want separate routing
(`sales@`, `security@`, `press@`), give me the addresses and the `INTENTS` array
takes them without touching anything else.
**If unanswered:** the contact form composes mail to `example.com`.

### 2. About page — who actually built this
**Where:** `src/app/(marketing)/about/page.tsx`
**Removed:** six fabricated executives with real-company pedigrees — "Sarah Chen,
Co-Founder & CEO, former VP of Product at Salesforce", "Marcus Williams, CTO,
ex-Principal Engineer at AWS", plus named ex-Figma, ex-Stripe staff. Named people
attributed to real employers.
**Also removed:** "founded in 2021" (invented), and a stat block reading
*10,000+ teams / 99.99% uptime / 50M+ tasks / 4.9-5 rating* (all invented).
**Needed:** real names and roles, or a decision to ship the page without a team
section. A short honest About beats a populated fictional one.

### 3. Blog — every post is fabricated
**Where:** `src/app/(marketing)/blog/page.tsx`
Eight invented articles, all linking to `href="#"`, including:
- *"NexusCorp Raises $50M Series C"* — an invented funding round
- *"Meet Our New Chief Technology Officer — Sarah Chen"*, which **contradicts the
  About page**, where the same person is CEO
- A "Load more posts" button with no handler

**Needed:** real posts, or take `/blog` off the footer until there are some.

---

## 🟠 Commercial — I will not invent these

### 4. Annual pricing
The brief asks for a billing-period toggle. The product has **only monthly flat
pricing** ($29 / $79 / custom). A 20–30% annual discount is the convention and it
is a commercial decision, not a design one.
**Needed:** annual rates, or confirmation to ship monthly-only. Currently
monthly-only, no toggle.

### 5. Currency and tax
Prices show `$` with no jurisdiction and no VAT/sales-tax statement. For a
product sold into the UK or EU this is a purchase blocker.
**Needed:** currency, and whether displayed prices include or exclude tax.

### 6. The Enterprise plan's real terms
**Removed from the plan card and comparison table:**
- **"White-label options"** — the architecture explicitly forbids this.
  `lib/platform.ts`, `components/layout/platform-mark.tsx` and
  `lib/org-settings.ts` all document the boundary, `security:check` fails the
  build if the shell reads tenant branding, and migration `0021` deliberately
  *removed* the two settings that would have enabled it. The pricing page was
  selling the one capability the product is built to refuse.
- **"SSO / SAML"** — no SSO or SAML exists anywhere in the codebase. It is also
  the first thing an enterprise buyer asks about, so it was the claim most
  certain to be tested.
- **"SOC 2 compliant"** — a certification with a named auditor and a report you
  will be asked to produce.
- **"99.99% uptime SLA"** — replaced with "a written availability commitment".

**Needed:** which of these are real, contracted, or roadmap. The pricing FAQ
currently answers "not yet" to SSO and "no, by design" to white-label. Both are
defensible and both are reversible.

### 7. Response-time promise
The contact page states **"first reply within one working day"**. Invented by me
as a plausible commitment.
**Needed:** confirm or replace. It is the only SLA a prospect can test before
buying, so it should be one you will meet.

---

## 🟡 Proof — currently absent rather than faked

### 8. Customer logos, testimonials, case studies
**None on the site.** Deliberately: the alternative was a logo strip of companies
that are not customers.
**Needed if wanted:** named customers with written permission. Until then the
landing page argues from what the software demonstrably does, which is weaker
than real proof and stronger than invented proof.

### 9. Product screenshots
The hero renders a **real interface in DOM** — sidebar, KPI row, deal table —
using illustrative but plausible data (Harlow Manufacturing, $184,000). It is
labelled as an illustration to screen readers and is not presented as a
screenshot of a customer's workspace.
**Needed if preferred:** exported screenshots from a real demo workspace. The DOM
version stays sharp at any zoom, follows dark mode and re-flows on a phone, so
the bar for replacing it is high.

### 10. Social accounts
The footer previously carried Twitter, GitHub, LinkedIn and YouTube icons, **all
with `href="#"`**. Removed. They return when there are accounts to link.

---

## ⚪ Deferred to Phase 2 — specified, not built

### 11. Contact form transport
The form is complete — intent routing, blur validation, error binding, submitted
state — and composes a `mailto:` because Phase 1 is fenced out of the backend.
The button says "Open this in your email app" rather than claiming a send.

**Phase 2 spec:** `POST /api/contact`, public in `proxy.ts`, rate-limited on
`RATE_LIMITS.emailDispatch`, field caps 120/254/200/5000, writing to a
platform-level `contact_enquiries` table with RLS enabled and no policies
(service-role only). **Note:** that shape trips three existing `security:check`
invariants — no auth context, service-role in a route, RLS-without-policy — so
the checker needs its public-route list and its RLS exemptions updated in the
same change. Only `handleSubmit` changes on the front end.

### 12. OTP entry screen
**No OTP exists anywhere in the codebase** — no route, no endpoint, no
verification step. The brief specifies per-digit entry, paste, auto-submit,
expiry countdown and resend cooldown.

Building the screen now would create a route nothing links to and nothing can
satisfy — dead machinery, which is this repository's most common existing
defect. **Deferred until there is a backend to verify against.**

### 13. Email verification as a route
Currently a **state inside signup**, which is correct: it is only reachable as
the result of a submission that just happened. A standalone `/verify-email`
would render "we sent a link to " with nothing after it when opened directly.
Improved in place instead.
