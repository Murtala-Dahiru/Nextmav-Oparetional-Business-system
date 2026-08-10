# Migration map — uploaded "bolt landing page" → NextMav

Phases 1 and 2 of the brief (discovery, mapping). **No files have been changed.**
Written 2026-08-10.

---

## What the uploaded project actually is

`C:\Users\murta\Downloads\bolt landing page\project` — a **Vite + React 18 SPA**
(react-router-dom v6, plain CSS, no Tailwind), 38 source files, ~200KB. It calls
itself `nextmav` and covers 19 routes. It talks to Supabase directly from the
browser via `@supabase/supabase-js` and `import.meta.env.VITE_*`.

The current project is **Next.js App Router** with Tailwind v4 `@theme`, server
components, `@supabase/ssr`, middleware auth, and 14 marketing/auth routes that
prerender static.

Nothing is portable as a file. Every migration is a **rewrite of the JSX into
the current architecture**, taking design decisions rather than code.

---

## The three findings that change the plan

### 1. The two projects describe different products

`src/lib/constants.ts` is the real module list. The uploaded project's public
copy describes a different one.

| Real module (`MODULES`) | Named in bolt's copy? |
|---|---|
| Dashboard | yes ("Operational Intelligence") |
| My Work | **no** |
| CRM | **no** |
| Projects | yes |
| Workspace | **no** |
| Communication | yes |
| Support | **no** |
| HR | yes ("People & HR") |
| Finance | yes |
| Inventory | **no** |
| Calendar | **no** |
| Client Portal | **no** |
| Admin | partly ("Identity & access") |

And bolt's copy sells six things the application **does not have**:

- **Procurement** — purchase requests, purchase orders, vendors, contracts
- **Assets** — asset register, allocation, maintenance history
- **Documents** — as a module, with version history
- **Approvals & workflows** — a configurable multi-step approval engine
- **Operational intelligence** — "AI insights, risk detection, predictive analytics"
- **Cost centres / org hierarchy / multi-org / SSO** as shipped features

Its `/features` page is twelve capability cards; **seven of the twelve are not
in the product.** Migrating that copy would put the site in breach of §21 of the
brief (do not invent product capabilities) on its highest-intent page.

### 2. The landing page is built on fabricated business information

| Location | Fabrication |
|---|---|
| `LandingPage.tsx:444–466` | Three testimonials — "Ada Okafor, CFO, Meridian Holdings", "James Okoro, COO, Vertex Industries", "Amara Eze, Head of Operations, Sterling Group" |
| `LandingPage.tsx:15–20` | Four **photographs of real people** hotlinked from Pexels, presented as those customers |
| `LandingPage.tsx:682` | "Rated 4.9/5 by operators" with five filled stars |
| `LandingPage.tsx:399` | "3.2x faster approvals" badge |
| `LandingPage.tsx:179` | Logo marquee — Holdings, Ventures, Capital, Industries, Group, Partners, Global, Systems |
| `LandingPage.tsx:13`, `SolutionsPage.tsx:8` | Stock office photography, hotlinked from a third-party CDN |
| `LandingPage.tsx:114,157` | "Acme Holdings", "Sarah Okafor" inside the product mock, with no demo marker |
| `PricingPage.tsx:35` | "$12 per user / month" — invented; real pricing is open as CONTENT-NEEDED #5 |

Commit `01601d8` in this repo is titled *"six people who did not exist, and a
funding round that did not happen"* — this is the same content class that was
deliberately removed a week ago. Taking it back in reverses that decision.

### 3. The uploaded project contradicts its own design system

`DESIGN_SYSTEM.md` (shipped inside the upload) bans, in its own "Never" list:
stock business photography, gradient text, decorative gradient washes,
uncontextualized metrics, logo soup, newsletter in the footer. It specifies
**IBM Plex Sans**, a 1.2 type scale topping out at 60px, radius 4/8/12, and
"motion is felt, not seen."

`tokens.css` — the code actually shipped — specifies **Plus Jakarta Sans +
Instrument Serif + JetBrains Mono**, a scale to 88px, radius 6/10/14/20/28/36,
gold as a second accent, `--nm-gradient-text`, `--nm-gradient-cinematic`,
`--nm-shadow-3xl`, and accent glow shadows. 105 gradient/glow references across
seven stylesheets.

The document describes a restrained direction; the CSS is a later, more
decorated one layered on top and the doc was never updated. **The document is
the better guide; the implementation drifted away from it.** The decorated layer
— glow orbs, gradient headline text, bento grid, marquee, star rating — is the
exact set of tells §14 of the brief bans as "AI-generated website".

---

## Page-by-page map

Craft grades are my read after reading both implementations. "Current" is graded
against the state after commits 1–3 of the craft pass now in flight.

| Route | Current | Bolt | Honest call |
|---|---|---|---|
| `/` | **8** — asymmetric hero, four real product surfaces, measured section rhythm, accent census of 5 on the page | **5** — stronger *page structure* (9 sections, before/after, arch diagram) but glow orbs, gradient text, marquee, fake testimonials, stock photos | **Keep current. Port three ideas** (below). Do not replace. |
| `/features` | **4** — eight identical two-column blocks, icon-in-tile | **3** — twelve identical cards, icon-in-tile, seven capabilities that don't exist | **Neither. Rebuild** on `surfaces.tsx` per the existing plan. |
| `/pricing` | **5** — three cards, featured differentiated by a ring | **5** — three cards, featured differentiated by a class; invents the price | Take bolt's **FAQ block**. Rebuild the table. |
| `/solutions` | untouched | audience split + stock photo | Take the **audience-split structure**, drop the photo. |
| `/about` | **5** — no visual content | **5** — same shape | Neither is good. Rebuild. |
| `/contact` | **5** — accent as a large panel | **5** — has an office address ("Acme Holdings" placeholder) | Take bolt's **form layout**; address is CONTENT-NEEDED #1. |
| `/blog` | credibility-fix only | list page | Leave both. Out of Phase 1. |
| `/privacy` `/terms` `/cookies` | real clauses | **shorter, thinner clauses** | **Keep current.** Do not take legal copy from a generated project. |
| Header | **6** — session-peek, focus trap, Escape, verified 44px targets, active-nav | **5** — same 5 items, no focus trap, no Escape, no scroll-lock cleanup on route change | **Keep current's behaviour.** Take the **scrolled-state border** treatment. |
| Footer | **4** — ragged grid | **4** — 3 columns + a **non-functional** newsletter (setTimeout, no endpoint) and 4 links pointing at the wrong page | Rebuild. **Do not** take the newsletter. |
| `/login` | **6** — real server auth, blur validation, `role="alert"`, four distinguished failure modes | **4** — client-side `supabase.auth.signInWithPassword`, one error string | Keep functionality. Take the **two-pane + sidebar** framing (already present as `AuthShell`). |
| `/signup` | **6** — server registration, inline "check your email" | **4** — client-side `signUp`, 8-char check only | Same. |
| `/forgot` `/reset` | **4** — non-enumerating copy | **4** | Neither. Rebuild. |
| `/verify` | **does not exist** — logged as a product gap | exists, 1.6KB, static "check your email" | **Genuinely new.** Still blocked on what the backend supports. |
| `/accept-invite` | exists | exists | Keep current. |
| 404 / 500 | `not-found.tsx`, `error.tsx` exist | exist | Keep current. |
| `/help` `/docs` `/status` | old emerald design | **no equivalent** | Token conformance pass, as already planned. |

## Preserve completely — no equivalent in the upload

Backend, database, migrations, `lib/permissions.ts`, `lib/platform.ts`,
middleware, `/api/*`, dashboard, all 13 modules, realtime, RLS, session
handling, onboarding, settings.

---

## What is genuinely worth taking

Ranked by value, and all of it is *ideas*, not files.

1. **A serif display face for emphasis spans.** Bolt sets one phrase per heading
   in Instrument Serif against the sans. It is the single best thing in the
   upload and it directly answers this repo's open decision #2 ("Geist stays for
   now… revisit after the hero — if display type is still the weakest part of the
   composition, license one"). It is.
2. **A warm neutral ramp.** Bolt's neutrals run warm (`#faf9f7`, `#16140f`);
   ours run cool (hue 255). Warm reads less like framework default. This is a
   one-line change to the `.phase1` ramp and would need the 40 contrast pairs
   re-run.
3. **The architecture layer diagram** — Departments → Capabilities → Shared
   model → Data & security. Honest, checkable, no fabrication, and it visualises
   the one claim this product actually leads with.
4. **The before/after consolidation block** — "seven tools" as tags, arrow, one
   result. Concrete and it fits the existing argument.
5. **The pricing FAQ** — five real questions, plainly answered.
6. **`nm-section-num`** — mono "01/02/03" structural numbering. Cheap, and it is
   what `foundations` already reaches for.
7. **The `/verify` route** existing at all.

## What to refuse

Fabricated testimonials · stock photography of real people as customers · the
star rating · the "3.2x" badge · the logo marquee · the invented price · gradient
headline text · glow orbs · the gold second accent · `--nm-shadow-3xl` · the
non-functional newsletter · the seven capabilities that don't exist · bolt's
legal copy · client-side Supabase auth · react-router · `@fontsource` (Next has
`next/font`).

---

## Dependencies

Nothing must be installed. `lucide-react` is already here. `@fontsource/*` is
replaced by `next/font` if a serif is adopted. `react-router-dom`,
`@supabase/supabase-js` (direct), `vite` — all rejected.
