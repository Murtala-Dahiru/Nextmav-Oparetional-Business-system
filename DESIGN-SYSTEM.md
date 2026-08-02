# NextMav Design System — Phase 1 (public + auth surface)

One source of truth for the marketing pages and the authentication screens.
Implemented in [`src/app/globals.css`](src/app/globals.css) as CSS custom
properties exposed to Tailwind v4 through `@theme inline`.

**Rule: no ad-hoc values in page code.** If a page needs a number that isn't in
this document, the number is wrong or this document is incomplete. Fix one of
those, not the page.

**Scope.** These tokens are additive. The application shell (Phase 2) still uses
`emerald-*` literals in 44 files and is untouched. The two surfaces are
deliberately different right now; reconciling them is Phase 2's first job.

---

## 1. Colour

### Why the accent changed

The previous accent was `emerald-500` / `#10b981`, written as a Tailwind literal
in 61 files. Two things were wrong with it.

**It failed contrast.** `#10b981` on white is **2.54:1**. WCAG AA requires 4.5:1
for body text. It was carrying "Forgot password?", the "Sign up" link, every
blog timestamp, every inline emphasis and every price-table highlight — text
that people had to read, in a colour too weak to read comfortably.

**It was used for everything.** Primary buttons, icon tiles, hover borders,
section headings, table highlights, the CTA band, the logo. An accent present in
every region of a page is not an accent; it is the background. Nothing could be
emphasised because everything already was.

### Resolution

The **primary action is ink**, not the brand hue. One filled element per view
gives the eye an entry point — the discipline behind Linear's and Vercel's
near-monochrome buttons. The **brand teal is reserved** for state, small
emphasis, and the mark: roughly one element per viewport.

| Token | Light | Dark | Role | Contrast |
|---|---|---|---|---|
| `--ink` | `oklch(0.19 0.008 264)` | `oklch(0.97 0.002 250)` | Primary action fill, dark panels | 18.47:1 on white |
| `--ink-fg` | `oklch(0.99 0 0)` | `oklch(0.16 0.008 264)` | Text on ink | — |
| `--ink-hover` | `oklch(0.3 0.008 264)` | `oklch(0.88 0.002 250)` | Primary hover | — |
| `--brand` | `oklch(0.505 0.085 177)` | `oklch(0.735 0.105 177)` | Accent, links, state | **5.61:1** light / **8.84:1** dark |
| `--brand-fg` | `oklch(0.99 0 0)` | `oklch(0.17 0.025 177)` | Text on brand fill | — |
| `--brand-soft` | `oklch(0.965 0.018 177)` | `oklch(0.27 0.035 177)` | Icon tiles, callouts | — |
| `--brand-line` | `oklch(0.885 0.038 177)` | `oklch(0.37 0.048 177)` | Ring on soft surfaces | — |
| `--surface` | `oklch(0.987 0.0015 250)` | `oklch(0.178 0.004 264)` | Tinted band | — |
| `--surface-2` | `oklch(0.968 0.003 250)` | `oklch(0.212 0.004 264)` | Recessed / hover | — |
| `--hairline` | `oklch(0.917 0.004 250)` | `oklch(1 0 0 / 9%)` | Default border | — |
| `--hairline-strong` | `oklch(0.86 0.005 250)` | `oklch(1 0 0 / 17%)` | Emphasised border | — |

### Measured, not assumed

Computed from the oklch values above through sRGB to WCAG relative luminance.
Every pair used for text on the in-scope surface:

| Pair | Hex | Ratio | AA |
|---|---|---|---|
| `brand` on `background` | `#1c7464` on `#ffffff` | **5.61:1** | ✓ |
| `brand` on `surface` | `#1c7464` on `#fafbfc` | **5.41:1** | ✓ |
| `brand` on `brand-soft` | `#1c7464` on `#e8f8f3` | **5.10:1** | ✓ |
| `ink` on `background` | `#121417` on `#ffffff` | **18.47:1** | ✓ |
| `ink-fg` on `ink` | `#fcfcfc` on `#121417` | **17.95:1** | ✓ |
| `brand` on dark `background` | `#53bfa8` on `#0a0a0a` | **8.84:1** | ✓ |
| `muted-foreground` on `background` *(pre-existing)* | `#737373` on `#ffffff` | **4.73:1** | ✓ |
| ~~`emerald-500` on white~~ *(replaced)* | `#10b981` on `#ffffff` | **2.54:1** | ✗ |

`muted-foreground` passes at 4.73:1 with little headroom. It is used for
secondary body text throughout, so it must not be lightened — noted here
because it is the pair most likely to be "tidied" into failure later.

**`ink` inverts in dark mode by design.** The token means "the strongest
available fill", not "dark". A black button on a black page is not a button.
This is why pages using `bg-ink text-ink-fg` need no dark-mode branch.

**The brand hue is lifted in dark mode**, not reused. `oklch(0.505 …)` is nearly
invisible on near-black; the same hue at `0.735` reads correctly. This follows
the skill's `color-dark-mode` rule — desaturated/lighter tonal variants, tested
separately, never a mechanical inversion.

**Semantic states** reuse the existing shadcn `--destructive`. Error text pairs
`--destructive` with `--background`. Per `color-not-decorative-only`, every
error also carries an icon — colour never carries meaning alone.

### Surfaces, not greys

Marketing pages previously wrote `bg-gray-50 dark:bg-gray-900/50` by hand and
drifted between files — `border-gray-100`, `-150`, `-200` and `-800/80` all
appear in the original code, plus a `bg-gray-155` that does not exist in
Tailwind and silently rendered as nothing.

---

## 2. Typography

Geist Sans + Geist Mono, already loaded in [`layout.tsx`](src/app/layout.tsx) via
`next/font` — self-hosted, so `font-display: swap` is handled and there is no
FOIT and no third-party request.

### Display scale — fluid, not per-breakpoint

| Token | Size | Line-height | Tracking | Weight | Use |
|---|---|---|---|---|---|
| `--text-display-1` | `clamp(2.75rem, 1.9rem + 3.4vw, 4.5rem)` | 1.02 | −0.035em | 560 | Page h1, once per page |
| `--text-display-2` | `clamp(2rem, 1.5rem + 2vw, 3rem)` | 1.08 | −0.03em | 560 | Section h2 |
| `--text-display-3` | `clamp(1.5rem, 1.25rem + 1vw, 2rem)` | 1.15 | −0.022em | 580 | Sub-section h3 |
| `--text-lede` | `clamp(1.0625rem, 1rem + 0.35vw, 1.25rem)` | 1.6 | −0.011em | 400 | Standfirst under an h1 |

**Weight is 560–580, not 800.** The original used `font-extrabold` and
`font-black` at `text-6xl`. Very heavy type at very large sizes reads as
shouting, and it is the most reliable visual signature of a template. Hierarchy
comes from size and tracking; weight is the smaller lever.

**Tracking tightens as size grows.** At 4.5rem, default letter-spacing looks
loose and amateur. −0.035em at display-1 easing to 0 at body is the optical
correction that makes large type look drawn rather than scaled.

**Body** stays at Tailwind's defaults — 16px minimum (`readable-font-size`),
line-height 1.5–1.6 (`line-height`). Measure is capped by container width, not
by a utility: `prose` = 46rem ≈ **68ch**, inside the 60–75ch target.

### Numerals

`font-feature-settings: 'tnum' 1, 'cv11' 1` on `body`. Tabular figures so a
column of money aligns (`number-tabular`); `cv11` gives a single-storey `l` so
`1`, `l` and `I` stay distinguishable in an invoice number.

---

## 3. Spacing & layout

4px base. Tailwind's default ramp is the scale; what this system adds is a
**rule for which step to use where**, because the original picked per page —
`py-16 sm:py-24` on four pages, `py-20` on the landing page, `mt-24` between
sections here and `space-y-24` there.

### Section density — pick from three, never type a number

| Name | Padding | Meaning |
|---|---|---|
| `tight` | `py-14 sm:py-16` | Bands that interrupt: CTA, a single idea |
| `default` | `py-20 sm:py-28` | Ordinary content sections |
| `loose` | `py-24 sm:py-36` | Openers and closers that need air |

### Container width

| Name | Max | Use |
|---|---|---|
| `prose` | 46rem | Long-form, legal, a single form |
| `default` | 75rem | Everything else |
| `wide` | 88rem | Tables, wide media |

Gutters `px-5 sm:px-8`. Both live in
[`section.tsx`](src/components/marketing/section.tsx).

### Within a component

- 2px–8px: parts of one element (icon → its label)
- 12px–20px: related elements (label → input → hint)
- 24px–40px: distinct groups inside a section
- Section density above: between sections

### Breakpoints

Tailwind defaults. Tested at **360 / 768 / 1024 / 1440 / 1920**. Mobile-first;
no horizontal scroll at any width — wide tables scroll inside their own
`overflow-x-auto` container, never the page body.

### Z-index

`0` base · `10` sticky in-page · `40` mobile nav overlay · `50` site header ·
`60` skip link · toasts owned by `sonner`.

---

## 4. Radius, borders, elevation

`--radius: 0.625rem` (existing, unchanged). `sm/md/lg/xl` derive from it.

**Borders do the work elevation usually does.** Default is a hairline. A card
that needs emphasis gets `border-ink` + `ring-1`, not a bigger shadow.

**One real shadow on the whole site**, on the hero product surface —
three layered stops approximating a single soft light source. Everywhere else,
elevation means "this floats above the page" and almost nothing does.

Rejected: an elevation ramp of 5 steps. With hairline borders carrying
separation, steps 2–4 were indistinguishable in review, and an unused scale
invites decorative use.

---

## 5. Motion

One curve: `--ease-brand: cubic-bezier(0.22, 1, 0.36, 1)`.
Entering uses it; exiting uses `--ease-brand-in` at ~70% duration
(`exit-faster-than-enter`).

| Movement | Duration |
|---|---|
| Colour / border / opacity on hover | 150ms |
| Scroll reveal | 500ms, 12px travel, **once** |
| Header background + border on scroll | 300ms |
| Button press | `active:scale-[0.985]`, instant |

**Rules.** `transform` and `opacity` only — never width, height, top or left
(`transform-performance`). Maximum 1–2 animated elements per viewport
(`excessive-motion`). Stagger caps at 6 steps × 60ms; beyond that it reads as
lag, not sequence. No parallax, no scroll-jacking, no entrance animation that
replays on scroll-up.

**`prefers-reduced-motion` is honoured in CSS**, not JavaScript, so it applies to
the server-rendered state too — reveals resolve to visible, `scroll-behavior`
goes auto, and all durations collapse to 0.01ms.

---

## 6. Focus

```css
:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
```

Replaces the shadcn default of `outline-ring/50` — a grey at half opacity, which
on a white background is close to invisible and is a keyboard user's only means
of knowing where they are. `:focus-visible`, not `:focus`, so it does not fire on
mouse clicks.

---

## 7. Component primitives

### Button — [`ui/button.tsx`](src/components/ui/button.tsx) ⚠️ shared

**44 application files import this.** Phase 1 added variants and one size; it
changed no existing variant, so the app is unaffected.

| Variant | Use |
|---|---|
| `cta` | Primary marketing action. Ink fill. One per view. |
| `ctaOutline` | Secondary. Hairline border, transparent. |
| `onInk` | Primary inside a `tone="ink"` panel, where ink would vanish. |

Size `xl` = `h-11` (44px — the touch-target minimum) with `text-[0.9375rem]`.
Existing `default`/`sm`/`lg`/`icon` untouched.

All variants carry default, hover, active (`scale-[0.985]`), focus-visible and
disabled (`opacity-50`, `pointer-events-none`).

### Field — [`forms/field.tsx`](src/components/forms/field.tsx)

Label + control + hint/error. Deliberately **outside** `components/ui` so it is
not in the app's import graph.

- Error uses `role="alert"` — announced on appearance, not on next tab
- `aria-describedby` injected onto the **control** via `cloneElement`, never onto
  a wrapper (a wrapper carrying it does nothing at all)
- Error **replaces** the hint rather than stacking, so the field does not grow by
  a line-height at the moment the user is fixing it
- `optional` marks the exception rather than asterisking the rule

### Notice — [`auth/notice.tsx`](src/components/auth/notice.tsx)

Inline message above a form. `tone` decides `role`: `warning` → `alert`
(assertive, interrupts — correct for "this link has expired"), everything else →
`status` (polite — correct for "you were signed out earlier"). The original chose
per call site and disagreed with itself.

### Section / Container / Eyebrow / SectionHeading — [`section.tsx`](src/components/marketing/section.tsx)

`Eyebrow` is a rule plus a word, replacing a shadcn `<Badge>` used on five pages
— a component meaning "this is a status" pressed into meaning "this is a
category", at several times the visual weight.

`SectionHeading` defaults to **left**. The original centred every heading on the
site, including ones introducing left-aligned grids.

### Reveal — [`reveal.tsx`](src/components/marketing/reveal.tsx)

Hidden state ships in server HTML to avoid a load flash; the marketing layout
carries a `<noscript>` rule that clears it, so a reader without JavaScript gets
the whole page rather than an empty one.

---

## 8. Voice

Direct, calm, competent, faintly warm. Verb-first, present tense.

**Banned:** empower, seamless, unlock, supercharge, revolutionise, streamline
your workflow, "in today's fast-paced…", "take your business to the next level",
"all-in-one solution for modern teams", "it's not just X — it's Y", "say goodbye
to…", "whether you're a startup or an enterprise…".

**Required:** headline ≤10 words; subhead ≤25 and carrying *new* information;
every claim provable or deleted; buttons naming their consequence ("Send reset
link", "Open this in your email app" — never "Get Started" everywhere); errors
stating cause and recovery without blame.

**The test:** if a sentence survives unchanged with a different product's name
substituted in, it is not saying anything.
