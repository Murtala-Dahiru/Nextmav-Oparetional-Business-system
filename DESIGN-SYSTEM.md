# NextMav Design System — Phase 1 (public + auth surface)

One source of truth for the marketing pages and the authentication screens.
Implemented in [`src/app/globals.css`](src/app/globals.css) as CSS custom
properties exposed to Tailwind v4 through `@theme inline`.

**Rule: no ad-hoc values in page code.** If a page needs a number that isn't in
this document, the number is wrong or this document is incomplete. Fix one of
those, not the page.

**Scope.** These tokens are additive, and this document describes the *public*
surface only.

> **Since 2026-08-22 the authenticated application has its own record:**
> [`APP-DESIGN-SYSTEM.md`](APP-DESIGN-SYSTEM.md). The reconciliation described
> below as "Phase 2's first job" has happened — the application's `:root` tokens
> are now the warm ramp, and `emerald-*` is re-pointed at the brand. Read that
> file before changing anything inside the product.

---

## 1. Colour

### The ramp

Twelve steps on a **single hue (255)**, each with one job. Chroma peaks in the
mid-tones and tapers at both ends: near-white and near-black cannot hold chroma
without reading as tinted rather than as a chosen neutral.

The previous ramp was shadcn's, at **chroma 0** — `oklch(0.556 0 0)` for
secondary text on `oklch(1 0 0)` for the page. Mathematically pure grey on pure
white is the single most reliable signature of an untouched framework, and it
was carrying every word of body copy on the site. The Phase 1 tokens sat on top
of it and only ever governed bands and borders, so the defaults stayed visible
underneath everything.

| Token | Light | Dark | Job |
|---|---|---|---|
| `--nm-n-0` | `oklch(0.994 0.002 255)` | `oklch(0.168 0.012 255)` | Page background — **not `#ffffff`** |
| `--nm-n-1` | `oklch(0.982 0.004 255)` | `oklch(0.203 0.013 255)` | Tinted band (`surface`) |
| `--nm-n-2` | `oklch(0.965 0.006 255)` | `oklch(0.243 0.014 255)` | Recessed, hover fill (`surface-2`) |
| `--nm-n-3` | `oklch(0.92 0.009 255)` | `oklch(0.295 0.014 255)` | **Hairline** — the default border |
| `--nm-n-4` | `oklch(0.872 0.011 255)` | `oklch(0.355 0.015 255)` | Emphasis border, disabled border |
| `--nm-n-5` | `oklch(0.826 0.012 255)` | `oklch(0.44 0.016 255)` | Disabled fill; secondary text **on ink** |
| `--nm-n-6` | `oklch(0.715 0.014 255)` | `oklch(0.52 0.016 255)` | Placeholder, resting icon — **never text** |
| `--nm-n-7` | `oklch(0.598 0.018 255)` | `oklch(0.62 0.016 255)` | 3.91:1 — **large text and non-text only** |
| `--nm-n-8` | `oklch(0.487 0.02 255)` | `oklch(0.7 0.016 255)` | Text tertiary (`copy-3`) |
| `--nm-n-9` | `oklch(0.4 0.019 255)` | `oklch(0.8 0.012 255)` | Text secondary (`copy-2`) |
| `--nm-n-10` | `oklch(0.243 0.014 255)` | `oklch(0.89 0.008 255)` | Strong fill, primary hover |
| `--nm-n-11` | `oklch(0.168 0.012 255)` | `oklch(0.965 0.004 255)` | Text primary, ink (`copy`) |

### Three text levels, and why there is no fourth

**18.85 : 9.04 : 6.23** on the page background. Each is a measured step on the
ramp, not the one above it at reduced opacity.

That distinction is the whole point. Four pages had reached for
`text-muted-foreground/50`, `/60`, `opacity-70` and `text-foreground/85` to
manufacture levels the ramp did not provide — and an opacity does not have a
contrast ratio, it has whatever ratio the thing behind it happens to give. The
same `/50` was 2:1 on the page and 6:1 on a tinted band.

There is deliberately no fourth level. `n-7` is 3.91:1 and is restricted to
large text and non-text. Below tertiary, hierarchy comes from **size and
weight**, which is where it should have come from in the first place.

### The accent

`--nm-accent: oklch(0.505 0.095 173)` light, `oklch(0.755 0.115 173)` dark.

**Chosen, not inherited.** The previous teal was a survivor of the original
`emerald-500` — kept because it was already in the file, not because anyone
picked it. The hue is now moved off **177**, the exact cyan-teal that ships in
every framework palette, to **173**; and the chroma is raised from 0.085 to
0.095 so it reads as a decision rather than as a desaturated accident.

One rule, and it is the only reason an accent exists:

> **At most three accent-coloured elements in any viewport**, and never as a
> background panel larger than an icon tile.

The primary action is **ink**, not the accent. An accent present in every region
of a page is not an accent, it is the background, and nothing on that page can
be emphasised. This is why `Eyebrow` now defaults to `tone="neutral"`: it was
`text-brand` on every section of every page, which by itself spent three or four
of the three available slots before the page had said anything.

### `--nm-accent-on-ink`, and the bug that produced it

An ink panel **inverts with the mode** — near-black on a light page, near-white
on a dark one. The page around it does not. So the accent sitting on that panel
has to be the *other* mode's accent.

Reusing `--brand` there put a light teal tick on a near-white panel at
**1.88:1** in the auth shell's assurance list, in dark mode: invisible, on the
only visual marker in the panel. It had shipped. `tsc` cannot see it, a
light-mode screenshot cannot see it, and the rendered page looks fine to anyone
not in dark mode. `scripts/contrast.mjs` found it on the first run.

### Measured, not asserted

Every pair below is computed from the oklch values through OKLab → linear sRGB
→ WCAG relative luminance, with out-of-gamut colours clipped in linear space
first, because the ratio that matters is the one the display actually produces.

```bash
node scripts/contrast.mjs           # the table
node scripts/contrast.mjs --check   # exits 1 if any pair fails
```

**All 40 pairs clear their threshold.** `--check` is the gate: a token edit that
breaks AA fails here rather than in an audit.

| Pair | Light | Dark | Min |
|---|---|---|---|
| text primary on background | **18.85** | **17.33** | 4.5 |
| text secondary on background | **9.04** | **10.27** | 4.5 |
| text tertiary on background | **6.23** | **7.19** | 4.5 |
| text primary on surface | **18.21** | **16.25** | 4.5 |
| text secondary on surface | **8.74** | **9.63** | 4.5 |
| text tertiary on surface | **6.02** | **6.74** | 4.5 |
| text tertiary on surface-2 | **5.73** | **6.11** | 4.5 |
| `n-7` as large text | 3.91 | 5.27 | 3.0 |
| accent on background | **5.49** | **9.23** | 4.5 |
| accent on surface | **5.30** | **8.66** | 4.5 |
| accent on accent-soft | **5.09** | **7.11** | 4.5 |
| accent-hover on background | **7.22** | **11.29** | 4.5 |
| background on ink | **18.85** | **17.33** | 4.5 |
| `n-5` on ink | **11.21** | **7.01** | 4.5 |
| **accent-on-ink on ink** | **9.23** | **5.04** | 3.0 |
| hairline on background | 1.24 | 1.38 | 1.2 |
| hairline-strong on background | 1.45 | 1.73 | 1.4 |
| focus ring on background | **5.49** | **9.23** | 3.0 |
| focus ring on surface | **5.30** | **8.66** | 3.0 |
| error text on background | **4.68** | **6.63** | 4.5 |

The three that failed on the first run, and what each cost:

1. `hairline` at 1.19:1 — the border was too faint to see. `n-3` darkened.
2. `hairline-strong` at 1.36:1 — same. `n-4` darkened.
3. `accent on ink` at **1.88:1 in dark mode** — the shipped bug above.

### Scope: how two ramps coexist

`.phase1` is a class on the marketing layout and the auth shell. Custom
properties cascade, so re-declaring `--background`, `--foreground`,
`--muted-foreground`, `--border`, `--input` and `--ring` on that wrapper
re-points every descendant **and nothing else**.

At `:root` those tokens are still shadcn's pure greys, because the
authenticated application reads the same names across 44 files, is in
production, and is used internally every day. A ramp change propagating into it
is not a design decision, it is an outage.

Phase 2 deletes the `.phase1` block and promotes its contents to `:root`. That
is the whole reason the values inside it are `var()` references and not
literals, and the whole reason the ramp is namespaced `--nm-*`: reconciliation
is a rename, not an excavation.

**`--radius` is deliberately *not* re-pointed in `.phase1`.** Setting it to
`--radius-surface` looked correct and silently rescaled every derived step with
it — `rounded-md` became 12px, so the header's buttons rendered at 12px where
the specification says controls are 8px. Caught in the browser, not by `tsc`.

---

## 2. Typography

Geist Sans + Geist Mono, self-hosted via `next/font`. Geist thins out above
about 3.5rem and a display face is a live question — the scale is built so that
swapping it is one token, not a pass over thirteen pages.

### The scale

Nine tokens. They replace the **104 arbitrary `text-[0.9375rem]`-style values**
that were spread across the in-scope surface — which is what the previous
version of this document's "no ad-hoc values in page code" rule was worth
without a scale complete enough to obey it. The gap was `title`, `body`,
`body-sm`, `caption` and `label`: everything below a heading, which is most of
the words on the site.

| Token | Size | Line-height | Tracking | Weight |
|---|---|---|---|---|
| `text-display-1` | `clamp(2.5rem, 1.6rem + 3.6vw, 4.25rem)` | 1.02 | −0.038em | 500 |
| `text-display-2` | `clamp(1.875rem, 1.35rem + 2.1vw, 2.75rem)` | 1.08 | −0.032em | 500 |
| `text-display-3` | `clamp(1.375rem, 1.15rem + 0.9vw, 1.75rem)` | 1.18 | −0.024em | 550 |
| `text-title` | 1.0625rem | 1.35 | −0.016em | 550 |
| `text-lede` | `clamp(1.0625rem, 1rem + 0.35vw, 1.1875rem)` | 1.62 | −0.010em | 400 |
| `text-body` | 0.9375rem | 1.65 | 0 | 400 |
| `text-body-sm` | 0.875rem | 1.60 | 0 | 400 |
| `text-caption` | 0.8125rem | 1.50 | +0.005em | 400 |
| `text-label` | 0.75rem | 1.40 | **+0.06em** | 550 |

**Tracking runs negative at display sizes and turns positive at `label`.** At
4.25rem, default letter-spacing looks loose and scaled-up rather than drawn;
−0.038em is the optical correction. At 0.75rem the opposite is true — small type
set solid is the most common amateur tell on a page, and an eyebrow is where it
shows. `label` is uppercase and used for eyebrows, table headings and meta.

**Weights are 400 / 500 / 550**, with 600 reserved for the single strongest
label in a view. Display weight came *down* from 560: hierarchy comes from size
and tracking, and very heavy type at very large sizes reads as shouting.

**Measure** is capped at 60–75 characters by container, never by full width.

### Numerals

`font-feature-settings: 'tnum' 1, 'cv11' 1` on `body`. Tabular figures so a
column of money aligns; `cv11` gives a single-storey `l` so `1`, `l` and `I`
stay distinguishable in an invoice number.

---

## 3. Space, with meanings

The ramp was never the problem — Tailwind's default already gives these eleven
steps. What was missing is a **rule for which one goes where**, so every gap was
picked per file and nothing grouped.

| Token | px | Meaning |
|---|---|---|
| `nudge` | 2 | Optical only — icon to baseline, hairline offset |
| `control` | 4 | Inside a control |
| `label` | 8 | Label → control, icon → text |
| `pair` | 12 | A heading and its own subtitle |
| `row` | 16 | List rows, card padding ≤768 |
| `comp` | 24 | Card padding, grid gutter ≤768 |
| `group` | 32 | Heading block → the grid below it |
| `block` | 48 | Intra-section break, grid gutter ≥1024 |
| `band` | 64 | Section padding, small viewports |
| `section` | 96 | Inter-section, the default |
| `open` | 128 | Openers and closers only |

Usable as `gap-label`, `mt-group`, `py-section` — the name is the reason.

**Two rules govern all of them.**

1. **Space above a heading is one step larger than the space below it.** Always.
   A heading must group downward with what it introduces, or it reads as the
   end of the section above.
2. **Related things nearly touch; unrelated things are far apart.** If
   everything is 24px from everything, there is no grouping, only a mesh.

### Section density — four, not three

| Name | Padding | Meaning |
|---|---|---|
| `interrupt` | `py-band sm:py-[4.5rem]` | A band that interrupts: a CTA, one sentence |
| `dense` | `py-band sm:py-[5rem]` | Proof, tables, anything scanned rather than read |
| `default` | `py-[5rem] sm:py-section` | Ordinary content |
| `open` | `py-section sm:py-open` | Openers, closers, the one statement a page is built around |

> **`default` may not appear more than twice in a row.**

The fourth density exists because of a specific failure: with three, the landing
page ran **four consecutive sections at `default`**, so its entire middle had
one vertical rhythm and read as a list of interchangeable blocks. Rhythm *is*
variation. A dense proof section and an airy statement section are different
kinds of content and must be given different amounts of air.

`tight` and `loose` remain as deprecated aliases so the twelve existing call
sites keep compiling; each page drops its alias during its own pass.

### Container width

| Name | Max | Use |
|---|---|---|
| `prose` | 46rem | Long-form, legal, a single form |
| `default` | 75rem | Everything else |
| `wide` | 88rem | Tables, wide media |

Gutters `px-5 sm:px-8`. Both live in
[`section.tsx`](src/components/marketing/section.tsx).

### Breakpoints

Tailwind defaults. Tested at **360 / 768 / 1024 / 1440 / 1920**. Mobile-first;
no horizontal scroll at any width — wide tables scroll inside their own
`overflow-x-auto` container, never the page body.

### Z-index

`0` base · `10` sticky in-page · `40` mobile nav overlay · `50` site header ·
`60` skip link · toasts owned by `sonner`.

---

## 4. Radius, borders, elevation

### Radius — two values and a pill

| Token | Value | Use |
|---|---|---|
| `rounded-control` | 8px | Buttons, inputs, chips, nav items |
| `rounded-surface` | 14px | Cards, panels, the product frame |
| `rounded-full` | — | Badges, avatars, progress |

Down from the **six** in use (`sm`, `md`, `lg`, `xl`, `2xl`, `full`), which was
why the pricing cards were `rounded-2xl` and every other card on the site was
`rounded-xl`.

> **Nesting rule:** a child inside a `surface` container with padding *p* takes
> `14px − p`, floored at `control`. A 14px card with 24px padding holds **8px**
> children — never 14.

Matched radii on nested boxes is what makes a card look printed rather than
drawn.

### Borders

One hairline (`n-3`), one emphasis (`n-4`). Never 2px except focus. **Borders do
the work elevation usually does** — in enterprise UI a hairline separates more
cleanly than a shadow, and it does not imply a light source the rest of the page
has to agree with.

### Elevation — three levels, tinted, layered

| Token | Use |
|---|---|
| `shadow-e1` | Resting. Rare — for a card that must lift off a band it shares a value with |
| `shadow-e2` | Raised: popover, dropdown, the hero product frame |
| `shadow-e3` | Overlay: dialog, mobile nav |

Each is two or three stops with different blurs and opacities, **tinted with
`n-11` rather than black**. A single `0 4px 6px rgba(0,0,0,0.1)` is the
framework default and reads as one from across the room; a black shadow on a
hue-biased neutral also goes slightly muddy, because it is the only element on
the page not on the ramp.

In dark mode `e1` degrades to a border, and `e2`/`e3` halve their opacity and
gain an `inset 0 1px 0 white/6%` top highlight — a shadow carries almost no
information on a dark ground, and a highlight does the lifting instead.

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

**This rule existed and reached nothing.** `button.tsx` and `input.tsx` both
opened with `outline-none focus-visible:border-ring focus-visible:ring-ring/50
focus-visible:ring-[3px]`, which cancelled it for **every button and every input
in the product** — 61 and 35 importers respectively, zero of them receiving the
designed treatment. Three consequences, none intended:

1. `outline-none` removed the accent outline entirely.
2. What replaced it was grey, on grey, at half strength.
3. `focus-visible:border-ring` moved the *border* too, so a focused outline
   button changed shape by a pixel.

Both overrides are gone. Repairing it is a product-wide change and that is the
correct blast radius for an accessibility defect: every button in the
authenticated application gets a visible focus ring out of it.

`--brand` and not `--ring`, because `--ring` is a shadcn token the application
reads for its own treatments and is grey at `:root`; re-pointing it there would
reach outside the Phase 1 fence.

The `border-radius: calc(var(--radius) - 4px)` that used to sit in this rule has
gone. It applied to every focused element regardless of the element's own shape,
so a focused pill got a 6px-cornered outline around it. `outline` follows the
element's radius on its own.

**Verified in the browser, not by eye.** Real `Tab` focus resolves to
`2px solid` at the full-strength accent with a 2px offset. `outline-color` is
part of Tailwind v4's `transition-colors` set, so a reading taken in the same
tick as `.focus()` returns a mid-transition value — measure after it settles.

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

Size `xl` = `h-11` (44px — the touch-target minimum), `rounded-control`,
`text-body`. Existing `default`/`sm`/`lg`/`icon` untouched.

**Hover moves by a real step on the ramp**, `n-11` → `n-10`, not by an opacity.
A translucent button picks up whatever is behind it, so the same button on a
tinted band and on the page hover to two different colours — "hover" ends up
meaning two things.

**Disabled drops to a neutral fill** (`bg-n-5` / `text-n-7`) with
`cursor-not-allowed` and no shadow, rather than going see-through at
`opacity-50`. A ghosted button still reads as the primary action, only broken.

**`loading` reserves the width.** Swapping the label for "Sending…" resizes the
control mid-action, so the thing under the user's cursor moves at the exact
moment they are watching it. The label stays in the layout at `invisible`
inside a `display: contents` wrapper — the children remain flex items and keep
their box, `visibility` inherits, so the width is unchanged — and the spinner is
positioned over it. `aria-busy` and an `aria-live` region carry the state to a
screen reader, which a spinner alone does not. Opt-in, so the 61 existing call
sites are unaffected; ignored under `asChild`, where `Slot` needs a single child.

### Input — [`ui/input.tsx`](src/components/ui/input.tsx) ⚠️ shared

**35 importers.** `h-9` is unchanged and deliberately so: nearly all of them are
in the application, where control height is load-bearing against table rows and
toolbars. The Phase 1 form scale is `size="lg"` — `h-11`, `rounded-control`,
`text-body` — which matches `Button size="xl"`.

Focus now reads as two things at once: the border changes to the accent, and the
outline appears outside it.

### Field — [`forms/field.tsx`](src/components/forms/field.tsx)

Label + control + hint/error. Deliberately **outside** `components/ui` so it is
not in the app's import graph.

- Error uses `role="alert"` — announced on appearance, not on next tab
- `aria-describedby` injected onto the **control** via `cloneElement`, never onto
  a wrapper (a wrapper carrying it does nothing at all)
- Error **replaces** the hint rather than stacking, so the field does not grow by
  a line-height at the moment the user is fixing it
- `optional` marks the exception rather than asterisking the rule
- **`reserveMessage` (default on) holds a line of space for the message slot
  even when it is empty.** Replacing the hint was only half the problem: a field
  with *no* hint still grew when an error appeared, which moved every field
  below it and the submit button while the user was reaching for them. The slot
  now occupies its line from first paint.

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
