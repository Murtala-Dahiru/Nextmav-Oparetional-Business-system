# Design progress — Phase 1 (public + auth)

**Read this, then `DESIGN-SYSTEM.md`, then `git log --oneline -15`, before doing
anything else.**

Scope fence: public marketing surface and auth screens only. The authenticated
application (dashboard, modules, settings, onboarding, app shell) is **Phase 2
and out of bounds**. If unsure whether something is in scope, it isn't.

---

## Where this stands

A craft correction pass is under way. The first pass produced pages that were
structurally sound, accessible and honestly written, and **visually generic** —
because the token layer was written as a document and never enforced. Symptoms,
all measured rather than asserted:

- **104 arbitrary `text-[0.9375rem]`-style values** across thirteen pages. The
  display scale existed; `title`, `body`, `body-sm`, `caption` and `label` did
  not, so every page invented them.
- **Six radius values** in use where the system named one.
- **Hierarchy built from opacity** — `opacity-70`, `text-foreground/85`,
  `text-muted-foreground/50` — because the ramp had only two text levels.
- **The root neutrals were shadcn's pure greys at chroma 0**, on `#ffffff`. The
  Phase 1 tokens sat on top and only governed bands and borders, so the
  framework defaults stayed visible underneath every word of body copy.

Honest craft grades at the start of this pass, out of 10: header 6, sign-up 6,
login 6, landing 5, pricing 5, about 5, contact 5, features 4, footer 4,
forgot 4, reset 4. Email-verification and OTP screens **do not exist as routes**.

Order of work: tokens → landing hero → header/footer → landing §2–6 → features →
pricing → sign-up/login → forgot/reset → about/contact → `/help` `/docs`
`/status` (token conformance only, no redesign).

---

## Status

| # | Item | Status | Left to do |
|---|---|---|---|
| 0 | Stabilise — revert out-of-scope backend, fix red build | ✅ done | — |
| 1 | **Tokens + primitives + two bugs** | ✅ **done** | Commit 1 of the correction pass. See below. |
| 2 | **Landing hero** | ✅ **done** | Commit 2. **Awaiting review — do not continue past it.** |
| 3 | Header · footer | ⬜ **next**, after review | Structurally fine, craft 6 and 4 |
| 4 | Landing §2–6 | ⬜ not-started | Do **not** start before the hero is approved |
| 5 | Features | ⬜ not-started | Craft 4 — lowest score × high intent |
| 6 | Pricing | ⬜ not-started | Currency/tax line blocked (CONTENT-NEEDED #5) |
| 7 | Sign-up · login | ⬜ not-started | Shell is the fix; one file serves six screens |
| 8 | Forgot · reset | ⬜ not-started | Also still need `Field` + blur validation |
| 9 | About · contact | ⬜ not-started | — |
| 10 | `/help` `/docs` `/status` | ⬜ not-started | **Token conformance only.** In scope, no redesign. |
| 11 | Legal visual pass (privacy/terms/cookies) | ⬜ not-started | Layout and type only — do not touch a clause |
| 12 | Consistency sweep + rubric scores | ⬜ not-started | 360/768/1024/1440/1920 |

Auth screens on `AuthShell`: login, signup, forgot, reset, accept-invite,
change-password. **`onboarding` is the only file left carrying the old
`from-gray-50 to-gray-100` shell — it is Phase 2 app surface. Leave it.**

---

## Commit 1 — tokens, primitives, two bugs (done)

### What landed

**A measured neutral ramp.** Twelve steps on hue 255, namespaced `--nm-*`, with
three text levels at **18.85 : 9.04 : 6.23** — each a step on the ramp, never an
opacity. Accent moved off the framework cyan-teal (177 → 173) with chroma raised
0.085 → 0.095, and documented as a choice rather than an inheritance.

**A complete type scale** (nine tokens), **space with assigned meanings**
(eleven, usable as `gap-label` / `mt-group` / `py-section`), **three layered
neutral-tinted shadows**, **two radii plus a pill with a nesting rule**, and
**four section densities** — the fourth because with three the landing page ran
four consecutive sections at `default` and its whole middle had one rhythm.

**Primitives converted:** `button`, `input`, `Field`, `Section`, `Container`,
`Eyebrow`, `SectionHeading`, `AuthShell`.

### The scope mechanism — read before touching tokens

`.phase1` is a class on the marketing layout and `AuthShell`. Custom properties
cascade, so re-declaring `--background`, `--foreground`, `--muted-foreground`,
`--border`, `--input` and `--ring` on that wrapper re-points every descendant
**and nothing else**.

At `:root` those tokens are still shadcn's pure greys, deliberately. The
authenticated application reads the same names across 44 files, is in
production, and is used internally daily. **Verified in the browser:** inside
`.phase1`, `--background` resolves to the new ramp; at `:root` it is still
`lab(100% 0 0)` and `--muted-foreground` is still `lab(48.496% 0 0)`.

Phase 2 deletes the `.phase1` block and promotes its contents to `:root`. That
is why its values are `var()` references and not literals.

⚠️ **`--radius` is deliberately not re-pointed inside `.phase1`.** Setting it to
`--radius-surface` looked right and silently rescaled every derived step —
`rounded-md` became 12px, so the header's buttons rendered at 12px where the
spec says controls are 8px. Caught in the browser; `tsc` cannot see it.

### The two bugs

**`button.tsx` focus ring.** The base carried `outline-none
focus-visible:ring-ring/50 focus-visible:ring-[3px]`, which cancelled the one
designed focus treatment in the product for **all 61 importers**. Removed, along
with the identical override in `input.tsx` (35 importers). Every button in the
authenticated application now gets a visible focus ring — the correct blast
radius for an accessibility defect. Verified with real `Tab` focus: `2px solid`
at full-strength accent, 2px offset.

**`about/page.tsx:155`.** `text-muted-foreground/50`, computing to roughly 2:1.
Now `text-copy-3` at 6.23:1. *Correction to the original report: the element is
`aria-hidden`, so it was decorative and not a formal WCAG violation — it was a
legibility problem and an instance of the banned opacity-hierarchy pattern.*

### A third bug, found by the new script

`scripts/contrast.mjs` found a **shipped** defect on its first run. `AuthShell`'s
assurance ticks were `text-brand` on a `bg-ink` panel. Ink inverts with the mode;
the accent does not. In dark mode that was a light teal tick on a near-white
panel at **1.88:1** — invisible, on the only visual marker in the panel.

Fixed with `--nm-accent-on-ink`, which holds the *opposite* mode's accent.
`tsc` could not have caught it and neither could a light-mode screenshot.

### The gate

```bash
node scripts/contrast.mjs           # publishes the table
node scripts/contrast.mjs --check   # exits 1 if any of the 40 pairs fails
```

All 40 pairs pass. Ratios in `DESIGN-SYSTEM.md` are now generated by this
script, not asserted. Three failed on the first run; each is documented there.

### What commit 1 deliberately did **not** do

It did not convert the 104 arbitrary values across thirteen pages. Each page's
conversion happens inside that page's own pass, when someone is already in the
file and can judge whether a value was arbitrary or load-bearing. Converting
everything up front is how the previous session died.

`density="tight"` and `"loose"` remain as deprecated aliases so the twelve
existing call sites compile; each page drops its alias during its own pass.

---

## Commit 2 — the landing hero (done, awaiting review)

**Stop here.** The hero sets the vocabulary for eight more sections. Nothing
below it on the landing page has been touched, deliberately.

### What changed

**An asymmetric split above `xl`.** Text holds a 34rem measure on the left; the
product frame takes the rest and runs **56px off the right edge of the
viewport**, cropped by the section's `overflow-hidden`. Below `xl` it stacks and
the bleed switches off. Measured at 360 / 1024 / 1440 / 1920: no horizontal
scroll at any width, and the bleed is a constant 56px at both 1440 and 1920
because the margin is viewport-relative rather than a fixed negative value.

**A 5.7× scale jump.** `display-1` at 68px sits directly under the eyebrow at
12px, with nothing mid-sized between them. Verified in the browser: 5.7x.

**Accent down to exactly one element** in the whole hero — the status dot in the
frame's "Demo workspace" chip. Census above the fold returns 1. It had been
seven: three stat deltas, five progress fills, a stage chip, the active nav icon
and three trust-row dots. Each was individually defensible and collectively they
meant the accent signalled nothing. Direction is now carried by the arrows, deal
stage by weight and border, meters by length.

**The plate replaces the wash.** The substrate is anchored left and masked out
before the frame begins, so the frame sits *on* something and the composition
gains a second vertical edge — the point where the plate stops.

**The trust row is one tertiary line**, not three items each carrying a dot.

### Product imagery — what was actually done

The DOM frame is kept; the **data** was the §6 violation, not the technique.
Invented company names became record *categories* ("Manufacturing · line
retrofit"), the fabricated person in the sidebar became a role, and the frame
now states **"Demo workspace" in its own chrome** — which is what makes the
figures inside it illustrative rather than a claim about customers.

⚠️ **Known inconsistency, logged as CONTENT-NEEDED #15.** The one-record chain
section further down the same page still renders "Priya Raman — Harlow
Manufacturing". It belongs to a later pass and was left on purpose, but it must
be de-fabricated when that section is done, or the page names a customer 600px
below a frame that carefully does not.

### Things measurement caught that the eye would not have

- At a 4rem bleed the frame cleared the viewport by **24px** — which reads as a
  rendering accident, not a decision. Raised to 6rem.
- At 6rem the crop then landed **23px into the first row's value figure**. A
  cropped interface is confident; a cropped *number* is broken. The frame now
  carries an `xl:pr-14` crop margin so the bleed eats padding instead. Values
  clear the viewport edge by 13px at both 1440 and 1920.
- At 1024 the split collapses and the lede inherited the full 75rem container —
  **~108 characters a line**, past the 75 ceiling, and invisible at 1440 because
  the grid column was holding it in. Capped at 34rem. A constraint that exists
  in only one layout will be wrong in the other.
- Dark-mode elevation was documented in commit 1 and **not implemented** — the
  light shadow rendered as very nearly nothing on a dark ground. It now inverts
  to an inset top highlight. This needed `--shadow-e*` to point at `--nm-e*`:
  `@theme inline` bakes the token's value into the utility at build time, so a
  `.dark` override of the shadow token itself is never seen.

### Verified in the browser, not by eye

- 360 / 1024 / 1440 / 1920 — no horizontal scroll; bleed correctly inactive
  below `xl`; buttons 44px at narrow widths
- Accent elements above the fold: **1**
- Headline 3 lines at 1440, lede 54 characters a line (under the 75 ceiling)
- Focus ring: real `Tab` focus resolves to 2px solid accent at 2px offset
- Dark mode: the three text levels hold, and the auth panel's ticks invert with
  the panel (9.23:1 light, 5.04:1 dark) instead of vanishing at 1.88:1

⚠️ **Screenshots in this environment are heavily downscaled** — the browser pane
renders a 1440px viewport into roughly 295px of canvas, so fine detail cannot be
judged from a capture here. Everything above was verified by measuring computed
styles and geometry. A human eye on the real thing is still the last check.

### Left alone on purpose

Sections 2–6 of the landing page, the header, the footer, and every other page.
The hero is for review first.

---

## Decisions taken in this pass

1. **Neutral ramp is marketing-scoped.** Confirmed: two neutral systems until
   Phase 2 is the correct trade against a 44-file blast radius in production.
2. **Geist stays** for now. The scale is built so the display face is a single
   token swap. Revisit after the hero — if display type is still the weakest
   part of the composition then, license one.
3. **Verification and OTP are out of this pass.** Creating routes is new
   functionality, not refinement, and what the backend supports needs
   confirming first. Logged as a product gap below. The sign-up inline "check
   your email" state (`signup/page.tsx:195`) remains the only coverage.
4. **Teal was inherited, not chosen.** Now deliberate: hue 173, chroma 0.095,
   reasoning recorded in `globals.css` and `DESIGN-SYSTEM.md` §1.
5. **`/help`, `/docs`, `/status` are in scope, narrowly** — token conformance
   only, no redesign, done last.

## Product gap — email verification and OTP

Neither route exists under `src/app`. Recommended flow when it is picked up as
its own piece of work:

1. Sign-up posts, server sends a link **and** a 6-digit code to the same address.
2. `/verify-email` accepts either: the link lands verified; the code is typed
   into a 6-input group with paste-to-fill, `inputmode="numeric"`,
   `autocomplete="one-time-code"`, and one `aria-live` region for the group
   rather than six.
3. Resend is rate-limited per recipient with a visible cooldown, not a silent
   failure.
4. Copy must stay non-enumerating, exactly as `forgot-password` already does.

Blocked on: what the backend actually supports. Do not design against a guess.
---

## Health

Both must be green before any item is called done.

```bash
npx tsc --noEmit                  # verified: 0 errors
node scripts/security-check.mjs   # verified: "the API surface is guarded"
```

All 14 marketing + auth routes verified returning **200** on the dev server
(port 3100), including the five not yet redesigned.

`npm run build` **passes end to end**, including the standalone copy step.
Every marketing and auth route prerenders as **static (`○`)** — the payoff from
taking `'use client'` off the marketing layout, which had been pulling the
header, footer, link graph and every page inside it into the client bundle for
the sake of one `useState`.

### Verified by browser inspection, not by eye

- Mobile nav: Tab trap holds, Escape returns focus to the trigger, body scroll
  lock releases, all 7 panel links measure 44px, trigger measures 44×44
- No horizontal scroll at narrow width
- Login: no error during typing; after blur, `role="alert"` fires,
  `aria-invalid="true"`, and `aria-describedby` resolves **on the input**

---

## Decisions taken (reversible — say the word)

1. **Backend reverted.** `/api/contact`, migration `0026`, and the `proxy.ts`
   public-route entry are gone. They failed four `security:check` assertions and
   were out of scope. Spec preserved in `CONTENT-NEEDED.md` #11.
2. **NextMav stands** as the product name. `PLATFORM` in `lib/platform.ts` is
   renamed, which propagates into Phase 2 surface (sidebar, `<title>`, favicon).
   Flagged; not yet reverted.
3. **`ui/button.tsx` kept.** Three variants and one size added, no existing
   variant touched, so the 44 app importers are unaffected.
4. **Brief beats skill** on visual and content recommendations. The
   `ui-ux-pro-max` database recommends glassmorphism, trust-blue, logo carousels
   and stat counters for SaaS — precisely the tells the brief bans. The skill
   governs accessibility, motion, forms, navigation and performance, where the
   two agree.
5. **No dead OTP route.** Deferred; see `CONTENT-NEEDED.md` #12.
6. **Fabrications deleted, not placeheld in-page.** Listed in
   `CONTENT-NEEDED.md` instead.

---

## Environment notes

- The skill is cloned to `.claude/skills/ui-ux-pro-max-skill` and is
  **gitignored** (`.gitignore:46`).
- **Its `search.py` cannot run — Python is not installed** on this machine
  (`python`/`python3` are Windows Store alias stubs, exit 49). The CSV databases
  and `references/*.md` are being read directly instead. Ranking is unavailable;
  content is not.
- The clone ships its own `CLAUDE.md`, which auto-loads into context and
  describes *that repo's* workflow. It does not apply to NextMav.
- Dev server: `.claude/launch.json` → port **3100**.

---

## Open questions

Answered on 2026-08-05 — see "Decisions taken in this pass" above:

- ✅ Product imagery → no demo instance; keep the DOM frame, replace the data.
- ✅ Display typeface → Geist stays, revisit after the hero.
- ✅ Verification + OTP → out of this pass; logged as a product gap.
- ✅ Neutral ramp scope → marketing-scoped, `.phase1`.
- ✅ Brand accent → teal was inherited; hue 173 / chroma 0.095 is now the choice.
- ✅ `/help`, `/docs`, `/status` → in scope, token conformance only, done last.

Still open, none of them blocking:

1. Confirm NextMav over NexusCorp, and whether the `PLATFORM` rename should wait
   for Phase 2 given it touches the app shell.
2. Annual pricing for the billing toggle (CONTENT-NEEDED #5).
3. Is `/blog` in Phase 1 scope? Currently treated as credibility-fix only.
4. Real address for `/contact` (CONTENT-NEEDED #1).
