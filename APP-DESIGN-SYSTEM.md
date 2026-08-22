# The authenticated application — design system and redesign log

**If you are starting a new session on the internal product, read this file
first.** It is the record of what the signed-in application is supposed to look
like, why, and how far the redesign has got. `DESIGN-SYSTEM.md` and
`DESIGN-PROGRESS.md` are the *public* surface's equivalents and were written
while the application was explicitly out of bounds — they say so in their own
opening lines. This file is the other half.

Order to read things in:

1. this file,
2. [`src/lib/navigation.ts`](src/lib/navigation.ts) — the information architecture,
3. [`src/app/globals.css`](src/app/globals.css) — the tokens, with the reasoning in comments,
4. `git log --oneline -15`.

---

## 0. The standing brief

The product works. The engine — database, RLS, API routes, permissions,
realtime, business logic — is **not** what is being changed. What is being
changed is the experience: hierarchy, information architecture, typography,
spacing, consistency, restraint.

The target is a mature enterprise product. Specifically **not**: gradients,
glassmorphism, huge rounded cards, floating blobs, decorative illustrations,
enormous shadows, an accent colour in every corner, or a screen made of
identical floating cards.

Two rules that govern every phase:

- **One phase at a time, then stop for review.** The order is fixed (§6). Do not
  start the next phase without being asked.
- **No invented functionality.** If a screen needs data or an action that does
  not exist, say so — do not fabricate a chart, a metric, a button or a
  success state. The existing implementation is the source of truth.

---

## 1. Colour

All of it lives in `:root` and `.dark` in
[`src/app/globals.css`](src/app/globals.css). These tokens belong to the
authenticated product **and only to it** — the public surface uses
`components/public/*` with `styles/public/*` scoped to `.nm-public`, and reads
none of them. That is what makes this block safe to change.

The values are the warm neutral ramp the public surface already uses, so the
signed-in application and the site that sells it read as one product.

### Light

| Token | Value | Role |
|---|---|---|
| `--background` | `#faf9f7` | the page — warm off-white, never `#ffffff` |
| `--card` / `--popover` | `#ffffff` | the raised surface |
| `--foreground` | `#16140f` | primary text — 17.8:1 on the page |
| `--muted-foreground` | `#5c544a` | secondary text — 7.0:1 (was 4.6:1 with no headroom) |
| `--muted` | `#f3f1ec` | recessed fill |
| `--accent` | `#edeae2` | hover fill |
| `--secondary` | `#f0ede6` | secondary fill |
| `--border` | `#e8e5dd` | the hairline |
| `--input` | `#ddd9cf` | control border |
| `--primary` | `#16140f` | **ink** — the primary action |
| `--ring` | `#2d9572` | the brand green |
| `--destructive` | `#c0392b` | |
| `--sidebar` | `#f5f3ee` | navigation chrome, one step recessed from the page |
| `--sidebar-accent` | `#e7e3d9` | the selected navigation row |

### Dark

Not an inversion. Three deliberate differences: the page is the *darkest*
surface and panels rise from it; borders are opaque steps on the ramp, never
white at 10% (an alpha hairline over a card and over the page are two different
colours, which is why panel edges used to vanish where they crossed a fill);
and the accent is lifted, because `#2d9572` reads as almost black on `#100e0b`.

| Token | Value |
|---|---|
| `--background` | `#100e0b` |
| `--card` | `#1a1813` |
| `--popover` | `#201d18` |
| `--foreground` | `#f0ede8` (16.9:1) |
| `--muted-foreground` | `#a8a094` (7.5:1) |
| `--muted` / `--secondary` | `#23211d` |
| `--accent` | `#2a2721` |
| `--border` | `#2a2721` |
| `--input` | `#363129` |
| `--primary` | `#f0ede8` (ink inverts — a near-black button on a near-black page is not a button) |
| `--ring` | `#3fae8a` |
| `--destructive` | `#e0685c` |
| `--sidebar` | `#0b0a07` |
| `--sidebar-accent` | `#23211d` |

### Charts

`--chart-1…5` = `#2d9572`, `#d4a93f`, `#2c6fa7`, `#b8730a`, `#6fc9ac`. The
brand first, then gold, then two supporting hues that stay distinguishable in
greyscale. Modules currently pass raw hex to recharts (`#10b981`, `#f43f5e`);
each module's phase should move to these tokens.

### The accent, and the rule that governs it

The brand green is `#2d9572` (`PLATFORM.accent`, and the public surface's
accent). **The primary action is ink, not the accent.** At most a few
accent-coloured elements in a viewport, and never as a background panel larger
than an icon tile. A saturated button competing with a saturated badge and a
saturated chart is how a dense screen ends up with no focal point.

In the shell the accent appears in exactly two places: the platform mark, and
the focus ring. The selected navigation row is a **neutral** fill on purpose.

### The `emerald-*` bridge — read this before touching a module

The application reaches for Tailwind's `emerald-*` **610 times across thirteen
modules**: status pills, active states, positive figures, avatar fallbacks. It
is the product's accent in everything but name — and the name was the problem,
because `emerald-500` is `#10b981`, a brighter cooler green that belongs to a
framework, and it fails AA on white at 2.5:1 while carrying text.

So the *scale itself* is re-pointed at the brand ramp, in `@theme inline`:

```
--color-emerald-50  #edf8f4     --color-emerald-500 #2d9572
--color-emerald-100 #ddf0e7     --color-emerald-600 #237a5d
--color-emerald-200 #c8e8da     --color-emerald-700 #1a6149
--color-emerald-300 #6fc9ac     --color-emerald-800 #0f4a37
--color-emerald-400 #3fae8a     --color-emerald-900 #0b3729
                                --color-emerald-950 #06231a
```

Same lightness order, so every existing pairing (a `-600` label on a `-50` fill,
a `-300` in dark mode) keeps the relationship it was written to have. Nothing on
the public surface uses Tailwind emerald utilities, so the bridge cannot reach
it.

**It is a bridge, not a destination.** As each module is redesigned, replace its
`emerald-*` classes with the semantic token that says what is meant
(`text-foreground`, `bg-primary`, `text-[--ring]`, a status colour), and the
block shrinks. Do not add new `emerald-*` usage.

---

## 2. Type, space, radius, motion — as applied in the shell

The application uses **Geist** (`--font-geist-sans`), with
`font-feature-settings: 'tnum' 1, 'cv11' 1` on `body` — tabular figures so a
column of money aligns, and a single-storey `l` so `1/l/I` do not collapse in an
invoice number. The public surface's Plus Jakarta Sans / Instrument Serif pair
is deliberately *not* used here: this is dense, all-day, data-heavy UI, and
changing the face would reflow every table in the product.

Sizes actually in use in the shell, and what they are for:

| Size | Where |
|---|---|
| `17px / -0.018em / 600` | the page title in the header (the only `h1`) |
| `15px / -0.012em / 600` | the platform wordmark |
| `13px` | navigation rows, search field — the product's dense default |
| `12.5px` | the account name, the collapse control |
| `11px / uppercase / 0.08em` | the workspace eyebrow |
| `10.5px / uppercase / 0.09em / 600` | navigation group headings |

Small type set solid is the most common amateur tell: everything at 11px and
below carries **positive** tracking.

- **Radius**: `rounded-md` (8px) for controls and navigation rows; cards keep
  shadcn's `rounded-xl`. `--radius` is deliberately left alone — changing it
  silently rescales every derived step.
- **Elevation**: borders do the work. The shell uses no shadows at all.
- **Motion**: colour transitions at 150ms, the rail's width at 200ms, both
  `motion-reduce:transition-none`. Navigation is not a place to spend motion —
  the 400ms module cross-fade was removed, because a person clicking Finance is
  waiting for the invoice, not admiring the transition.

---

## 3. The shell — what exists now

```
┌────────────┬───────────────────────────────────────────────┐
│  mark      │  WORKSPACE NAME            search   bell      │  64px
│  ┄┄┄┄┄┄┄┄  │  Module title                                 │
│  nav       ├───────────────────────────────────────────────┤
│  (grouped) │                                               │
│            │  the module renders here, own padding         │
│  ┄┄┄┄┄┄┄┄  │  (p-4 md:p-6 — the header matches it)         │
│  account   │                                               │
│  collapse  │                                               │
└────────────┴───────────────────────────────────────────────┘
   264 / 68px
```

**Sidebar** ([`sidebar.tsx`](src/components/layout/sidebar.tsx)) — 264px
expanded, 68px rail. Platform mark at the top (never tenant branding: the
boundary is enforced by `npm run security:check`). Grouped navigation. Account
menu and collapse control pinned at the foot. Collapsed rows are 40×40 with a
tooltip carrying the module's one-line summary; expanded rows are 34px, or 44px
inside the mobile sheet, where a thumb is doing the pointing. Below `lg` the
whole thing becomes a sheet, opened from the header — both gated on the *same*
breakpoint, in CSS.

**Header** ([`header.tsx`](src/components/layout/header.tsx)) — answers one
question: *which workspace, which screen*. Workspace name as an eyebrow over the
module title, then a real search field (with `⌘K`/`Ctrl K` shown) and the
notification bell. Identity, role and appearance are **not** here; they are in
the sidebar's account menu, because the header describes the page and the
sidebar describes the person. This file is the one place in
`components/layout/` permitted to read the workspace's name.

**Unread** — counts are quiet: a neutral pill on the row, a small ink dot on the
rail's icon, never a red siren. Urgency belongs to the overdue invoice inside
the module, not to the furniture.

**Keyboard** — `⌘K`/`Ctrl K` opens the palette, `[` toggles the rail (ignored
while typing), a skip link is first in the tab order, and there is exactly one
focus treatment for the whole product (the 2px accent outline in `globals.css`
— components must not add their own ring).

---

## 4. Information architecture

Defined once, in [`src/lib/navigation.ts`](src/lib/navigation.ts), and read by
both the sidebar and the command palette so they cannot drift.

```
  Dashboard · My Work          (no heading — the two screens opened every morning)
  COLLABORATION                Communication · Calendar · Workspace
  CUSTOMERS                    CRM · Support · Client Portal
  OPERATIONS                   Projects · Finance · HR · Inventory
  ADMINISTRATION               Admin
```

It answers, in the order people ask: *what is mine right now* → *who am I
working with* → *who do we sell to and serve* → *what do we run the company on*
→ *how is this configured*. CRM, Support and Client Portal sit together because
they are the same person from three angles. Admin is alone because it configures
the other twelve.

Contract:

- `navigationFor(allowed, role)` takes the session's capability list and can
  only ever **remove** from it. Access is decided by `lib/permissions.ts` and
  the server; grouping is presentation.
- Empty groups are dropped, so nobody sees a heading with nothing under it.
- **External roles get a flat, unlabelled list** — a client sees three items,
  and "Operations" describes a company they do not work at.
- A module in `MODULES` but in no group still renders, under "More", rather than
  becoming a feature nobody can find.
- `MODULE_META` is a *total* record: adding a module without an icon and a
  one-line summary is a compile error. (Two modules used to draw the dashboard's
  icon because the old name→component map had no entry for them.)

Guarded by `npm run test:navigation`, which walks all nine roles and compares
what renders against `allowedModules()`.

---

## 5. Phase 1 — done (2026-08-22)

Navigation, sidebar, shell arrangement, and the palette underneath them.

**Changed**: `src/lib/navigation.ts` (new), `components/layout/{sidebar,header,
platform-mark,module-content,command-palette,app-shell}.tsx`,
`components/brand/logo.tsx` (additive `nameClassName`), `store/app-store.ts`
(collapse persists), `app/globals.css` (the palette + the emerald bridge),
`scripts/navigation.test.mts` (new, wired into `verify:all`).
`components/layout/theme-toggle.tsx` deleted — replaced by Light/Dark/**System**
in the account menu, which is the first time "follow my computer" was reachable
from any screen.

**Defects fixed on the way**:

- My Work and Client Portal drew the dashboard's icon on every screen.
- Between 768px and 1023px there was **no navigation at all** — the sidebar was
  gated at `lg` in CSS while the menu button was gated at 768 in JavaScript.
- The command palette advertised `[` for the sidebar and `⇧D` for the theme;
  nothing listened for either. `[` is implemented; the `⇧D` hint was removed.
- Collapsing the rail was forgotten on every reload.
- Icon-only rail buttons had no accessible name.

**Not changed**: no API route, migration, RLS policy, permission grant or
business calculation. Deep links (`?module=`), `openRecord`/`useFocusRequest`,
the notification socket-plus-poll fallback, badge clearing on module open.

---

## 6. The phases

| # | Phase | State |
|---|---|---|
| 1 | Navigation / sidebar / shell | **done** |
| 2 | Dashboard | next |
| 3 | My Work | |
| 4 | CRM | |
| 5 | Projects | |
| 6 | Finance | |
| 7 | HR | |
| 8 | Communication | |
| 9 | Support | |
| 10 | Inventory | |
| 11 | Calendar | |
| 12 | Workspace | |
| 13 | Client Portal | |
| 14 | Admin | |

### What each module phase should do

1. Read the module first — its tabs, its API calls, its permissions. Use the
   data that exists.
2. Replace its `emerald-*` classes with semantic tokens (§1) and its raw chart
   hex with `--chart-*`.
3. Replace ad-hoc type sizes with the scale in §2; ad-hoc gaps with a consistent
   rhythm.
4. Fix the module's own hierarchy: sections and tables over a field of identical
   floating cards; primary action in ink; one focal point per screen.
5. Keep every existing action working, and add none that the backend cannot
   support.
6. Run it locally and look at it — light and dark, 1440 / 900 / 390.

### Carried forward — pick these up in the right phase

- **Module tabs are not in the navigation.** Leads / Invoices / Attendance and
  the rest live in local `useState` inside each module, so promoting them to
  sidebar sub-items means touching all thirteen. Each module's own phase is
  where its sections should be lifted — and if a shared mechanism is added for
  it, add it *with* its first consumer, never before (this repo's dominant
  defect is complete machinery that nothing calls).
- **Two `h1`s on the dashboard.** The shell's header holds the page title; the
  dashboard's greeting should become an `h2` in Phase 2.
- **A client's navigation still lists Projects.** That is the existing grant
  (read-only, feeding portal endpoints), but the module's UI is built for staff.
  Decide it in Phase 13.
- **Charts** still pass raw hex to recharts in dashboard, CRM and finance.

---

## 7. Verifying

```bash
npm run test:navigation   # nav vs permissions, all nine roles
npm run security:check    # includes: no tenant branding in the shell
npm run schema:check
npm run test:layout
npx tsc --noEmit
```

`npm run app:verify` needs the dev server and a reachable Supabase; it is
flaky in this environment (the local resolver intermittently fails on the
Supabase host, and its account creation hits the project's email rate limit),
so treat a handful of `401 Authentication required` failures in the
record-editing sections as environmental unless they reproduce.

**Screenshots**: the in-app Browser pane cannot composite frames here — its DOM
and CSS tools work, capture does not. Drive the installed Chrome over CDP
instead (`--headless=new --remote-debugging-port=…`, `Target.createTarget` →
`Target.attachToTarget` → `Emulation.setDeviceMetricsOverride` →
`Page.captureScreenshot`), and prefix commands with `MSYS_NO_PATHCONV=1` so Git
Bash does not mangle a bare `/` argument.
