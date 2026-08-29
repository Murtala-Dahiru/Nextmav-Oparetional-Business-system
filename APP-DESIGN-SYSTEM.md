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


---

## 5b. Phase 2 — Executive Overview (2026-08-28)

The screen was already good before this pass: a dark plate, a real money
chart, an attention queue that decides the right things, honest empty states.
What it did not have was **structure above the level of the component**, and
what it did have was a plate that wasted its own best space.

### The composition

```
┌──────────────────────────────────────────────────────────────────────┐
│  date · role · online            updated   [Refresh]  [+ New]        │  context
│                                                                      │
│  Good evening, Ada               COLLECTED · LAST 12 MONTHS          │
│  Revenue is down 34.2% … so far   ╱╲    ╱╲   ╱╲                      │  verdict
│  REVENUE THIS MONTH              ╱  ╲__╱  ╲_╱  ╲╌╌                   │
│  ₦94,500  ↘34.2%  · 28 of 31 days  Sep     peak · Jul        Aug     │
├───────────┬───────────┬───────────┬───────────┬──────────────────────┤
│ PIPELINE  │ RECEIVAB. │ PROJECTS  │ TICKETS   │ ATTENTION            │  readout
│ ₦578,000  │ ₦125,300  │ 5         │ 6         │ 9                    │
│ ▓▓▓▓░░░░  │ ▓▓▓▓▓▓▓█  │ ────────  │ ▓█████████│ ████▓▓▓▓░            │
│ 9 open…   │ ₦24.4k…   │ 1 past…   │ 5 past…   │ 4 critical           │
└───────────┴───────────┴───────────┴───────────┴──────────────────────┘

  01 POSITION   ──────────────────────────────────────────────────────
     Financial performance (full width)
     Receivables (full width, three regions across)

  02 MOMENTUM   ──────────────────────────────────────────────────────
     Pipeline momentum (5) │ Work & tasks (7)

  03 DELIVERY   ──────────────────────────────────────────────────────
     Project health (full width)
     Support (6) │ Stock (6)

  04 RESPONSE   ──────────────────────────────────────────────────────
     Needs attention (8) │ Upcoming (4)
     Recent activity (full width)
```

### What changed, and why

**The plate became three rows.** It was a headline in a narrow left column
with a grid of `Display`s beside it — which is a KPI strip with a dark
background, and the file's own notes said it was trying not to be one. Now:
a context line, the verdict, a divided readout strip. The grid is gone, so
five instruments can no longer orphan a sixth cell — which they did at every
width below `2xl`.

**Signals carry their composition.** Each instrument in the strip draws a
`Bar` of the parts that make up its number: receivables split into inside
terms and past due, tickets into within SLA and breached, the attention queue
into its three severities. Every one of those is an exact partition from a
single source. "Active projects" deliberately has none — `active` is counted
org-wide by `v_dashboard_stats` while `atRisk` / `delayed` / `onTrack` are
counted over the six rows of `v_project_health` the route fetches, and a bar
whose segments do not add up to the number printed above them is worse than no
bar.

**`Trace` replaced `Spark` in the plate.** 104×32 to the full column at 118px,
zero-anchored, peak marked, both ends of its range named. A twelve-month
series at 104px is a texture, not a chart.

**The page got joints.** Four `Band` dividers. One row each, the quietest
thing on the screen, and the difference between an argument and a stack.

**Receivables moved.** It had been grouped with Support and Stock by
silhouette; it now sits under the chart it explains, laid out across the page
in three regions — *how much*, *how late*, *who*.

**One entrance, once.** `nm-enter` in `globals.css`: 8px, 340ms, staggered
45ms across the movements, fired on mount when the data replaces the skeleton.
Deliberately **not** the public surface's scroll reveal — on a screen somebody
opens several times a day, content that fades in as you reach it means waiting
for information that has already arrived.

### Defects found and fixed

1. **The plate restated the shell header** — "EXECUTIVE OVERVIEW · NORTHWIND
   STUDIO" forty pixels under "NORTHWIND STUDIO / Executive Overview", then a
   second uppercase line under that.
2. **Project health listed projects that were not being delivered.**
   `v_project_health` has no status filter — correctly, since the projects
   module and the reports both read it — and `/api/dashboard` did not add one
   while ordering by `days_remaining` ascending. That ordering puts *finished*
   work first: a project completed in March has about −150 days remaining.
   `delayed` was then computed as `days_remaining < 0` with no status test, so
   completed projects were counted as past deadline and drawn with a red
   severity rail. The route now filters `status = 'active'`, which is also what
   `active_projects` counts, so the heading, the strip, the bar and the rows
   finally describe one population.
3. **Partial months were compared with whole ones.** The last row of
   `revenueByMonth` is the month in progress; the page printed it as "Revenue
   this month", divided it by a complete previous month, and plotted it as the
   twelfth point of twelve. On the 28th of a 31-day month that reads as a
   third of the revenue missing. The route now flags the row `current` and
   sends `monthToDate`; the summary sentence, the headline note, the trace's
   dashed tail and a shaded band on the chart all say so. `delivery.tsx` had
   solved exactly this for its own current week two passes ago.
4. **The attention queue carried the same word twice** — a module column
   ("Support") beside an action label ("Open support"), taking seven rems from
   the title. Removed; the queue also moved into a card, so the page's most
   important list is no longer the one region drawn loose on the background
   while its neighbour has a surface.
5. **A `<button>` centres its content**, so the one signal without a
   composition bar sat eight pixels below its neighbours *and* pulled its note
   fourteen pixels up. Fixed with `block` and a drawn-but-empty track.
6. **Day one had a half-width rule** across a full-width plate (`max-w-xl` on
   the element carrying `border-t`) and reserved an empty second column for a
   series that does not exist yet.

### Found only once the workspace had a year in it

The dataset in §5c was built to make the design judgeable. It also found six
faults that an empty database had been hiding — five of them in the UI:

1. **`formatCurrencyCompact` is not compact.** It drops the kobo and nothing
   else, so ₦149,477,678 arrived as eleven digits — at 21px in a five-across
   strip, and at 46px as the headline. The page was also contradicting itself:
   the chart's axis has always abbreviated, so a reader saw "16m" on the
   gridline and "₦149,477,678" in the figure above it. `money()` in
   `viz.tsx` now shares `axisTick`'s scale steps; tooltips keep the exact
   figure, because a reader has deliberately asked for it. The shared helper is
   untouched — around a hundred callers across thirteen modules want its
   precision.
2. **Recent activity was depending on the workspace being quiet.** It made each
   *day band* a grid cell, which is only correct when the days and the columns
   happen to be the same number. All eighteen recent events fell inside one day
   — which is what a busy company looks like — so it rendered one very long
   column and eight hundred pixels of empty page. It splits by count into three
   balanced columns now, and hoists the heading out when the whole feed is one
   day rather than printing "YESTERDAY" three times across the page.
3. **The plate's readout orphaned a cell at 1180px.** Five instruments in three
   columns leaves the second row two-thirds full. Flex below `xl`, grid at it:
   the last row grows to fill whatever the count.
4. **Two chart labels collided.** "avg collected" sat on a y-axis tick, because
   the average of a real year lands mid-range where the ticks are; the
   month-to-date band label sat on the invoiced line's peak. Both moved.
5. **A year of history inserted in ten seconds raises a year of unread
   notifications.** The triggers fired 763 and the sidebar read "99+". Settled
   by the seed — see §5c.
6. **Project health showed six of eight.** The route fetched six rows while
   `active_projects` counted eight, so the strip's "8 tracked" described rows
   the reader could not see. The route fetches eight and the table renders
   them.

### Changed

`components/modules/dashboard/{index,primitives,money,delivery,sections,viz}.tsx`,
`types.ts`, `app/api/dashboard/route.ts` (two query filters and two new fields
— no schema change, no new capability), `app/globals.css` (one keyframe).

New primitives: `Trace`, `Bar`, `Band`, `Signal`, `useWidth`.

### Not changed

No migration, RLS policy, permission grant or business calculation. No new
action the backend cannot support. Deep links, `openRecord`/`useFocusRequest`,
the realtime subscription and its debounce are all untouched.

### Still owed by the API, unchanged from before

`finance.pendingExpenseValue`, `hr.newHires`, `projects.totalBudget`,
`projects.tasksDueThisWeek`, `company.warehouses`, `crm.leadsByStatus`,
`crm.topDeals`, `finance.recentInvoices` are still pinned to constants in
`/api/dashboard`, and nothing on this screen renders them. `v_resource_allocation`
could support a real per-person workload in Work & tasks and is the next thing
that section could honestly gain.


---

## 5c. The demo dataset (2026-08-28)

Every screen in this product is unreadable against an empty workspace, and the
Executive Overview most of all. Judging a twelve-month revenue chart with two
months in it, a completion chart whose best week is 2, and a health table where
every row reads 10% tells you nothing about whether the design works.

```bash
npm run seed:demo -- --yes            # fill the demo workspace
npm run seed:demo -- --yes --reset    # empty it again
```

**The demo workspace ships empty.** The dataset is a development tool, not
product content: it is written when somebody asks for it and taken out again
when the review is over, through the same script and the same safety gates. As
of 2026-08-29 Northwind Studio holds no business data at all — its owner, its
two real members and its `General` department, and nothing else.

[`scripts/seed-demo.mjs`](scripts/seed-demo.mjs) fills **one** organisation with
a year of interlinked history. It is idempotent — it clears that organisation's
own business rows and rebuilds them — and the PRNG is seeded, so two runs
produce the same dataset.

### The rule it obeys

**It writes no number the application will later display.** It writes the
records a business would have — invoices with line items, payments against
them, expenses, deals with close dates, milestones, tasks with completion
timestamps — and lets `v_finance_monthly`, `v_project_health`,
`v_receivables_ageing` and `v_dashboard_stats` compute what the dashboard shows.
If a figure on the Executive Overview is wrong after this runs, the view is
wrong. That is the entire point of having a dataset at all.

### Safety

It talks to a live Supabase project with the service key, and that project
holds other organisations, so it is fenced five ways:

1. refuses to run without `--yes`;
2. refuses when `NODE_ENV=production`;
3. resolves **exactly one** organisation by id, and every statement it issues is
   filtered on that `organization_id` — there is no unscoped `DELETE` in the
   file;
4. that organisation must carry `settings->demo = true`. One without it is
   refused unless `--adopt` is passed, which is the single deliberate act that
   turns a workspace into the demo workspace — and it then stamps the marker and
   renames it so it cannot afterwards be mistaken for a real one;
5. it never touches `auth.users`, and never deletes a profile or a membership.

The demo workspace is **Northwind Studio (Demo)**
(`f90e4fc8-f408-47d3-b4d5-5e00f4133470`), owner `dash-demo-owner@example.com`.
`industry` reads "Development / demo data" and the org settings carry
`demoNotice`. **Day One Co** is left empty on purpose, for the day-one screen.

### What it creates

| | |
|---|---|
| 12 months | Sep 2025 – Aug 2026, the last one deliberately partial |
| 96 invoices | 195 line items, 90 payments — paid, part-paid, overdue, draft |
| 108 expenses | nine categories a month, a few unapproved in the running month |
| 60 deals | 24 won, 13 lost, 19 open across four stages, 4 gone quiet |
| 16 projects | 8 active, 2 planning, 1 on hold, 5 completed |
| 68 milestones | which is what `progress_pct` is actually computed from |
| 272 tasks | 179 done, weighted into eight weekly buckets for the work chart |
| 36 tickets | 9 live (5 past SLA, 1 critical), 27 resolved across the year |
| 18 products | 3 below reorder, 2 at zero, balances derived from the ledger |
| 150 activity rows | spread over three weeks, every one pointing at a real record |
| 14 people | 11 of them provisioned profiles with no auth identity |

Money runs ₦9.8m–₦21.3m invoiced a month against ₦8.1m–₦14.7m of spend, with a
strong December, a January collapse, and a loss-making November where an
equipment purchase lands.

### Four things the schema forced, and one it revealed

- **Invoice status is derived, never declared.** `recalculate_invoice()` fires on
  every line-item and payment write. Insert the invoice, then its lines, then
  its payments, and let the trigger decide.
- **`trg_set_updated_at` is BEFORE UPDATE**, so a deal that has "gone quiet" has
  to be INSERTed with an old `updated_at`.
- **`record_stock_movement` refuses the service key.** It is `SECURITY DEFINER`
  with an `is_org_member(org)` guard, and `auth.uid()` is null for a seed run.
  The two statements it performs are performed directly instead, preserving its
  invariant: every movement carries the running balance, and `products.stock`
  ends equal to the last one.
- **Provisioned colleagues need no auth account.** Migration 0025 dropped
  `profiles.id`'s foreign key to `auth.users` precisely so a profile can outlive
  its login, which makes a profile with no auth row a state the schema already
  models. `identity:verify` passes (82/82) with eleven of them present, and
  nobody can sign in as them.
- **A year of history inserted in ten seconds raises a year of notifications,
  all unread.** The triggers fired 763 of them and the sidebar showed "99+"
  against Finance. They are marked read at the end of the run, with three left
  unread and backdated, so the bell has a believable count.

### What the populated data then revealed about the UI

Listed in §5b under "Found only once the workspace had a year in it".

---

## 5d. Phase 3 — My Work (2026-08-29)

Everything on the feature list worked. Fast capture, lists, stars, drag
reordering, a board, a month schedule, focus mode, repeats, and a bridge to
project tasks in both directions — all of it built, all of it correct. What the
screen did not have was a **reading** of any of it: it showed twenty-four items
and never once said how the day stood.

### The composition

```
┌──────────────────────────────────────────────────────────────────────┐
│  SATURDAY, 29 AUGUST                    [Focus] [Pin a task] [⌨]     │
│  3 late, 6 due today                                                 │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                             │
│  ● 3 done ● 6 due today ● 3 late   10 ahead · 5 no date  [Move 3…]   │
├──────────────┬───────────────────────────────────────────────────────┤
│  All open 24 │  + Add something to your list…                  [N]   │
│  Today     9 │                                                       │
│  Upcoming    │  All open  24            [search]        [▤ ▥ ▦]      │
│  Starred   5 │  ⚠ OVERDUE 3 ──────────────────────────────────────   │
│  Completed   │  ○ Send Henderson the revised quote  4 days late ● ★  │
│              │  ○ Approve Tobi's expense claim      2 days late ●    │
│  LISTS     + │  ☀ TODAY  Sat, 29 Aug  6 ──────────────────────────   │
│  ● Follow-ups│  ○ Call the client back about the timeline       ● ★  │
│  ● Deep work │  ○ Submit the timesheet        Every week  ● Admin    │
└──────────────┴───────────────────────────────────────────────────────┘
```

### What changed, and why

**The header became the day.** Three things used to sit here: a second `<h1>`
reading "My Work" forty pixels under a shell header already reading "My Work";
a permanent two-line paragraph explaining that the list is private; and a 24px
ring in the far corner reading "3 of 12 done today" in the smallest type on the
screen. So the most valuable band on the page restated the title, taught the
same lesson every day forever, and buried the one sentence worth reading.

It is now a sentence at the size it deserves, over a **partition** of the day —
done · due today · late — rather than a percentage. A ratio invites "of what?",
and on a personal list the denominator changes every time something is added.
Every segment is a count the API returns and the three sum exactly to the work
owed today. Behind them, quietly: how much is scheduled ahead and how much has
no date at all, kept out of the day's own arithmetic so that "6 due today"
never silently means 24. Nothing is scored, weighted or predicted — there is no
productivity index, because a number nobody can check is a number nobody should
be shown. The private-list explanation moved to the day-one empty state, where
somebody is actually asking the question.

**Rows stopped being cards.** Each to-do was a bordered, rounded, 78px card —
title, note, metadata strip. Twenty-four of them made a field of identical
floating boxes (§`primitives.tsx`: "uniformity is the disease; the card was
only its most obvious symptom"), and **six** filled a 1440×900 laptop. A list
whose whole job is scanning was showing a quarter of itself. Now: no border, no
surface, 13.5px, meta right-aligned so the dates form one straight edge, note
on a second line only when there is one. **Twenty rows** fit where six did.

**The screen stopped repeating itself.** Every row under *Overdue* said
"Overdue"; every row under *Today* said "Today" — up to six times per group,
and again on every board card. A row is silent when its heading has already
spoken, and an overdue row says **how late** instead, which the heading does
not know. Group headings gained the concrete day (`TODAY · Sat, 29 Aug`).

**One bulk action, and only one.** An overdue pile is not a list of decisions,
it is one decision made once — *these are today's now* — and making it item by
item is why people stop opening the list. `Move N overdue to today` is N calls
to the endpoint that already exists (one to ten rows in practice), not a new
bulk route: the per-row PATCH already carries the ownership filter and the
recurrence guard, and a second way to write a due date is a second place for
those rules to be forgotten. Refusals are reported by count rather than
swallowed.

**The board names its days.** "Tomorrow" told you the category and left you to
work out the date; "Tomorrow · Sun 30 Aug" is the fact. Drop targets appear
only while something is being dragged — six permanent dashed boxes reading
"Drop here to move it to someday" are six instructions for something nobody is
doing — and the right edge fades instead of severing the fourth column
mid-card, which is why "Someday" was, for most readers, a column that did not
exist.

**The schedule became a planning surface.** Week totals in a leading gutter
("next week has eleven things in it" is a fact you cannot get by counting
cells), a per-day load bar relative to the busiest day on screen, three items
per cell instead of two, and a day panel that shows the chosen day in full.
Day cells are **dnd-kit droppables** now rather than native HTML5 drag targets:
the old note said forty-two droppables cost more than the drag was worth, but
HTML5 drag-and-drop does not fire on iOS or Android at all — so on a phone the
schedule was a calendar you could look at and not plan with — and two
coexisting drag systems meant a card in the day panel could not be dropped on
the grid beside it.

**Focus mode ends when today does.** It queued every open item, so a session
with nine things due announced "24 to go" and marched on into *Someday*. The
queue is the day now, with an explicit offer to carry on once today is clear.
It also gained **Tomorrow** — without it, a person working a list has one way
to get an item off the screen and no way to say when they will actually do it,
so it returns tomorrow unmoved and a day later.

**Completed became history.** It listed seven ticked-off titles in the server's
ordering — starred first, then by the day they had been *due*, an order that
stops meaning anything the moment work is done — and carried no date at all. It
is grouped by the day it was finished now, newest first: Today · Yesterday ·
Wed 26 Aug. `completed_at` has been stamped by a trigger since 0016 and
returned by the endpoint ever since; nothing had ever read it.

### Defects found and fixed

1. **The day's ring never moved.** `toggleDone` updated `counts.open` and
   nothing else, and ticking something off in the default view deliberately
   causes no refetch — so the one number the header exists to show sat frozen
   through an entire morning's work. Every count the readout uses now moves
   with the checkbox, and the refetch that follows confirms it.
2. **Focus mode's "done today" was always zero.** It counted completed rows
   from `todos`, and the view those come from excludes completed items by
   design. The progress bar sat at 0% no matter how much had been cleared. It
   reads the server's count now — the same one the header uses.
3. **A failed load was drawn as an empty list.** The fetch threw, a toast
   appeared for four seconds, and the screen rendered "Nothing here — add
   something above". A person who looked away was told, in the product's own
   voice, that their to-do list was empty. There is a real error state with a
   retry, and a failed *silent* refetch leaves the last good data alone.
4. **The planning layouts were filtered to one view.** Choosing Schedule while
   *Today* was selected drew a month grid holding nine items and twenty-eight
   empty days — a calendar filtered to a single day with no way to say so. The
   board and the schedule widen to "all open", exactly as search already widens
   to "all"; choosing a view returns to the list.
5. **Switching list → board tore the screen down for nothing.** Both request
   the same rows when the view is already "All open", but the fetch depended on
   `layout`, so an identical request produced a full skeleton. The dependency
   is the *effective* view now.
6. **Dates were parsed as UTC.** `formatDate` runs its argument through
   `new Date(...)`, and a bare `2026-09-03` is UTC midnight by specification —
   so in any timezone west of UTC every due date in this module rendered as the
   day before. `due_on` is a `date` precisely because it has no zone;
   `formatDay` appends `T00:00:00` to say so.
7. **Search results lost their dates.** A row stays silent about its day only
   when a heading has said it, and headings are drawn only when there is more
   than one group — search produces exactly one, so the suppression fired with
   nothing to suppress it.
8. **The schedule's day panel truncated to eight characters.** Right-aligning
   a date against a 300px panel left "Call the client back ab…". Narrow columns
   stack their meta under the title now.
9. **Mobile put the first to-do below the fold on every phone.** Roughly 1,150
   vertical pixels of chrome before row one: a duplicate title, three buttons,
   a three-line explainer, a ring, a views strip, a "LISTS +" heading, a lists
   strip, a capture box and a toolbar. Views and lists are one strip now,
   titles wrap instead of truncating, and the keyboard-shortcuts button and the
   layout switcher — a six-column board and a seven-column month grid — are not
   offered on a device that cannot use them.

### On labels, attachments and priority

Reconsidered in this pass and still excluded, for the reasons the module was
built with. Lists and the star already do what labels would; a file belongs in
Workspace where it can be found again; and the star **is** the priority scale —
a private list with four levels of importance is one nobody triages honestly.
The test each was held to: does it reduce the friction of getting personal work
done, or does it move this closer to being the task tracker it exists as a
calmer alternative to?

### Changed

`components/modules/mywork/{index,types,todo-row,views,focus-mode,dialogs}.tsx`,
and `app/api/todos/route.ts` — two additional `head: true` count queries
(`overdue`, `someday`) on the endpoint's existing `Promise.all`. No new
capability, no new route, no new field read or written.

The emerald bridge is retired from this module: `emerald-*` no longer appears
in `components/modules/mywork/` except as the stored *colour key* a user picks
for a list.

### Not changed

No migration, RLS policy, permission grant or business calculation. No
component outside `modules/mywork/`. The shared `PageHeader` and `EmptyState`
are untouched — this module simply stopped using them, because both drew a
second `<h1>` and a generic grey circle where the screen needed neither.
`openRecord`/`useFocusRequest`, the realtime subscription, the reorder endpoint
and the recurrence trigger all behave exactly as before.

### Carried forward

- **`todos` is not in the `supabase_realtime` publication**, so the module
  subscribes to `tasks` only — an assignment arrives live, but the same
  person's own list on a second device does not. Publishing a table only one
  person ever writes to is a migration for a narrow case; worth deciding, not
  worth assuming.
- **The pinned-task path could not be exercised end to end here.** The demo
  workspace holds no projects, so "Pin a task", the linked-task chip's jump
  into Projects and the edit dialog's read-only task panel were reviewed as
  code rather than run. They use `openRecord('projects', 'task', id)`, which
  `modules/projects/index.tsx` already handles.
- **Six list colours are literal hex** in `types.ts` rather than tokens,
  because `--chart-*` holds five hues and two of them contradict the name the
  user picked (mapping `violet` to `--chart-5` paints a mint dot into a swatch
  labelled violet). If a content-colour ramp is ever added to `globals.css`,
  this is its first consumer.


---

## 5e. Phase 3b — My Work as a system (2026-08-29)

§5d made My Work a good screen. This makes it a **system**: work arrives on it
from the rest of the product, it tells you when something is due, and the
capture that the whole module depends on stops requiring a key half its users
do not have.

Four capabilities, one migration, and the first schema change any redesign
phase has made.

### 1. Intake — "Add to My Work" from anywhere

A task assigned to you in Projects, a ticket escalated to you in Support, a
deal that has gone quiet in CRM. All three are work you owe; none is a plan for
your afternoon. What people did instead — reliably, in every product with this
shape — was retype the title into their own list and let the two drift.

One action now, in the row menu every table already has, from **one shared
component** (`components/shared/add-to-my-work.tsx`). Thirteen modules each
writing their own would be thirteen chances to send a different payload, forget
the label or create a duplicate.

What it creates is **not a copy of the record**. It is a personal to-do that
points at it:

```
  Book the discovery workshop
  🔗 Projects · Client Acquisition
```

The record stays the source of truth. Ticking the personal item off does not
close the ticket, does not move a burndown and appears on nobody else's screen
— the guarantee `todos` has carried since 0016, extended to four more modules.

Pressing it twice answers *"Already on your list"* and opens nothing new: a
unique partial index refuses the second write and the endpoint replies with the
item that already exists.

### 2. The Inbox

Capture without deciding. **Open, no list, no day** — that is the whole
definition, and it is why the inbox needed no column.

Deliberately not "everything unfiled": an item dated Thursday has been triaged,
and an inbox that keeps showing it is one that never empties, which is how
every abandoned inbox got abandoned. Giving something a day *or* a list takes
it out, so the count drains as you plan. Intake lands here too, which is
correct — somebody else decided it was work, you have not yet decided when.

### 3. Reminders, on the product's own infrastructure

`due_on` is *when the work should be done*; `remind_at` is *when I want to be
told*. Different statements, and deliberately different types: a `date` with no
time of day, and a `timestamptz` that survives a timezone.

Delivery is a **`pg_cron` job calling `sweep_todo_reminders()` every minute**,
writing an ordinary row into `notifications` — the table, the realtime
publication, the bell and the tray all already existed, and the `todo` prefix
was already mapped to My Work in `notification-modules.ts` with nothing
emitting it. No external service, no new moving part.

The sweep is a plain function and the schedule is one caller, which is what
makes the degradation describable rather than silent: where `pg_cron` cannot be
installed the migration still leaves a working sweep, and
`/api/todos/reminders/sweep` calls it when the module mounts. Reminders then
arrive on next use rather than on the minute. Both callers are safe together —
the sweep claims each row by stamping `reminder_sent_at` in the same statement
that selects it.

Moving a reminder re-arms it (a trigger clears the stamp), and a repeat carries
its reminder to the next occurrence at the same offset — 0022's trigger knew
nothing about reminders, so a weekly item with a Monday-morning reminder would
have reminded you exactly once, ever.

### 4. Capture that does not depend on the Enter key

**This was the module not existing on mobile.** The only way to commit a to-do
was Enter. On a desktop that is the fastest capture in the product; on a phone:

- iOS shows **return**, and a bare `<input>` in a `<div>` with no form gives it
  nothing to do — the keyboard dismisses and the text sits there uncommitted.
- Android shows **↵** or **✓** depending on the keyboard app, the locale and
  the input type. Three keyboards, three behaviours.
- Voice input, a stylus or an accessibility keyboard may have no return key at
  all.

The composer is now a real `<form>` — which is what makes the on-screen return
key work at all — with a **visible Add button that is always present**, not
hover-revealed and not conditional on the field being non-empty, because a
control that appears only once you have typed cannot be found by somebody
wondering how to commit what they typed. Disabled while empty says the same
thing without vanishing.

Measured and fixed on a 390×844 viewport:

| | before | after |
|---|---|---|
| Add button | did not exist | **44×44** (was 36 on the first pass) |
| Field font | 13.5px → iOS zooms the page on focus | **16px** |
| Reachable with a keyboard open | button at y=478, behind the keyboard on a 667px phone | **sticky at y≈153 once scrolled** |

Sticky below `sm` rather than `100vh` arithmetic: mobile browsers resize their
own viewport unpredictably when the keyboard opens, and a pinned-to-bottom bar
ends up behind it. Being pinned to the *top* of the scroll container cannot be
defeated by a browser's opinion of its own height.

Verified by driving the real UI with **no Enter key anywhere in the test**:
type, tap Add, field clears, row created.

### 5. Today as the command centre

Today is the landing view now — the question somebody opens this screen with is
"what do I need to do?", and answering it with a chronological dump of
twenty-five items answers a different one.

```
  GOOD MORNING, ADA · SATURDAY, 29 AUGUST
  3 late, 6 due today
  ████████░░░░░░░░░░░░░░░░░░░░░░░░
  ● 3 done  ● 6 due today  ● 3 late     10 ahead · 2 filed · ▤ 4 to sort · [Move 3 overdue]
  9 items left today   ★ 3 starred   🔗 1 from your work   🔔 2 will remind you
```

The bar answers *how much*; the line under it answers *of what kind*, and only
on Today, where the rows on screen genuinely are today. Two of those are facts
a to-do list has never been able to state: **"1 from your work"** is how much of
the day arrived from elsewhere in the business rather than from you — the
number that decides whether your own plans survive the afternoon, and it exists
only because intake exists — and **"2 will remind you"** is the part of the day
you can stop holding in your head.

Still no productivity score. Every figure is a count the API returns or a count
of the rows on screen, and the two are never mixed.

### 6. Focus as an execution environment

`Done · Tomorrow · Not now · Snooze an hour · Open details`, with the origin
named and openable.

**Snooze** is the one that was missing and is not the same as either
neighbour: *Tomorrow* moves the work, *Not now* moves your attention for this
sitting, and neither says "come back to me at three" — which is what somebody
in the middle of a focused hour most often means. It sets a reminder and leaves
the plan alone.

**Open details** exists because a person working a queue reaches the item whose
note they need to read, and the only way to do that was to leave the session
and find it again in the list.

### 7. Quick entry — shortcuts, not guessed language

`/today`, `/tomorrow`, `/nextweek`, `/someday`, `!` to star. Recognised only as
a whole word at either end, removed from the title, and **shown as a chip
before the item is committed**.

Deliberately not natural language. Every implementation of "Call Ahmed
tomorrow" eventually eats a word somebody meant literally — *"Review the Monday
report"*, *"Post the Friday numbers"* — and files the item on a day they did
not choose. A capture box that is occasionally wrong about what you meant is
one people stop trusting, and an untrusted capture box goes unused, which is
the one failure this module cannot survive. If real language understanding is
ever added to the product, it goes behind this same contract, with the parse
shown before it commits.

### 8. Undo on delete

`DELETE /api/todos/[id]` is a hard delete, deliberately — the route explains
why. Which made the absence of an undo the real problem: the row was gone the
instant the dialog was confirmed and the only recovery was to remember what it
said. The fields are held for as long as the toast is up and re-posted
verbatim, source included.

### Migration 0026

The first schema change in the redesign, and it earns it:

- `source_module` / `source_type` / `source_id` / `source_label` — polymorphic,
  the same shape `notifications.entity_type`/`entity_id` has carried since
  0004, because a foreign key to five tables is not a foreign key. The **label
  is stored rather than joined** so the to-do outlives its source, which is
  what `linked_task_id`'s `ON DELETE SET NULL` already promises.
- Two CHECKs. One makes the source all-or-nothing; the other requires a row
  carrying `linked_task_id` to *name that task* in the source triple, so the
  two mechanisms cannot drift into disagreeing about the same record.
- A unique partial index — one open personal item per source, per person.
- `remind_at` / `reminder_sent_at`, a partial index on exactly the sweep's
  predicate, the re-arm trigger, `sweep_todo_reminders()`, and a guarded
  `pg_cron` install + schedule.
- `spawn_next_todo_occurrence()` replaced so a repeat carries its reminder and
  its source forward.

Existing pinned rows are backfilled before the CHECK is added, and the whole
file is idempotent.

### Verified

`db:check`, `db:apply`, `db:verify` (45), `schema:check`, `security:check`,
`test:layout` (118), `test:navigation` (40), `test:dashboard` (21), `tsc`,
eslint and a production build — all pass. Driven through the real UI against
real records:

- **Intake**: the Projects row menu → *"Added to My Work"* → pressed again →
  *"Already on your list"* → exactly one row, `projects/task`, label and
  `linked_task_id` both set.
- **Reminders**: created through the API → sweep endpoint reports
  `delivered: 1` → the notification is in the tray with the right type, body
  and link → a second sweep delivers nothing → moving the time re-arms it → a
  reminder in the past is refused with *"A reminder has to be in the future."*
- **Mobile capture**: typed and committed by tapping, no Enter key involved.

### Defects found and fixed on the way

1. **A `<button>` inside a `<button>`.** Making the origin chip openable put a
   control inside the row's own title button — React reported it as a
   hydration error, and browsers resolve the nesting by closing the outer
   element early. The meta is a sibling of the title button now.
2. **Two overlapping counts in the header.** "6 with no date · 4 to sort"
   describes ten things to a reader and six to the database — the inbox is a
   subset of the undated. Every other number on that header is an exact
   partition, and this one is now too.
3. **A 36px touch target** on the control the entire mobile capture workflow
   depends on.
4. **"Open details" wrapped to a line of its own** in focus mode, pushed there
   by an `ml-auto` that made one of five equal actions look like a different
   kind of thing.

### Changed

`supabase/migrations/0026_mywork_intake_and_reminders.sql` (new),
`lib/{mywork,todo-reminder}.ts` (new),
`components/shared/add-to-my-work.tsx` (new),
`app/api/todos/reminders/sweep/route.ts` (new),
`app/api/todos/route.ts`, `app/api/todos/[id]/route.ts`,
`lib/notification-modules.ts` (one type),
`components/modules/mywork/*`, and **three lines in each of**
`modules/{projects,support,crm}/index.tsx` — an import and one menu entry, no
other change to those modules.

### Carried forward

- **Intake is wired into three modules of the five that could use it.**
  Projects tasks, Support tickets and CRM deals. Communication messages and
  Finance invoices have the vocabulary in `SOURCE_KINDS` and no button yet;
  each is one menu entry in that module's own phase.
- **`openRecord` is not received by every module** that can be a source.
  `sourceOpens()` is the honest list, and a chip whose module cannot receive
  one draws as a label rather than as a control that lands nowhere.
- **The sweep runs on one schedule for the whole database.** A tenant with a
  very large number of reminders due in the same minute would be capped at 500
  per run and catch up on the next. Worth watching, not worth pre-solving.

---

## 5f. Phase 3c - the finish (2026-08-29)

The pass that closes the loop and takes the AI tell out of the writing.

### Incoming work now completes its own chain

The chain the product was reaching for is: **assigned -> notification -> add to
my work -> personal execution**. Three of the four steps existed. Two things
were missing:

1. **`task_assigned` had no `link`.** It has written a row on every assignment
   since 0004 and never a destination, and the header opens a notification by
   parsing that field. So the one notification that meant "new work has landed
   on you" was the one notification in the product that did nothing when
   clicked. Every other assignment producer already carries one; this was the
   last on the pre-0016 shape. Migration 0027 fixes the trigger and backfills
   the unread rows.
2. **The tray had no way to act.** Each assignment row now carries an inline
   **Add to My Work**, from the same shared component the module row menus use,
   so the wording, the duplicate handling and the confirmation cannot drift.

Deliberately narrow: only *assignments* get the action (`task_assigned`,
`ticket_assigned`, `ticket_escalated`). A completion, a comment or a status
change is something to read, not something to plan, and a button on every row
is exactly the noise that makes a tray worth ignoring. `intakeFromNotification`
in `lib/mywork.ts` is that decision, in one place, and it refuses a row whose
`entity_type` does not match what its `type` promised.

No new notification architecture. The table, the triggers, the realtime
publication, the badge, the module mapping and the tray were all already there.

### No em dashes

**191 removed** across everything the module ships: the six module files, the
three new `lib`/`shared` files, the three API routes and migration 0026. Spaced
em dashes became spaced hyphens, bare ones became hyphens, and the copy pass
below removed most of the rest by rewriting the sentence.

Verified at zero, including the lines this work added to `projects`, `support`,
`crm` and `header`.

Comments in the *other twelve* modules still use them; that is the house voice
of the whole codebase and changing it belongs to those modules' own phases, not
to this one.

### Copy

Shorter, and stopped explaining.

| was | now |
|---|---|
| "Items you tick off collect here, newest first." | "Newest first." |
| "The star is this list's only priority - use it for the few things that genuinely cannot wait." | "The star is the only priority here. Keep it for what cannot wait." |
| "Nothing is due and nothing is overdue. Anything you add here is dated today." | "Nothing due, nothing overdue. Anything you add here is dated today." |
| "Search looks at titles and notes across every view, including completed items - so this is genuinely not on your list." | "Search covers titles and notes across every view, completed included." |
| "Puts a copy on your list so you can plan around it. Ticking it off here does not complete the task - do that in Projects, where your team can see it." | "Puts it on your list so you can plan around it. Completing it here does not complete the task." |
| "A way to group your own to-dos. Only you can see it." | "Your own grouping. Nobody else can see it." |
| "The list is much faster without the mouse once you know these." | "Faster without the mouse." |
| "Anything you want to remember about it" | "Anything worth remembering" |
| "This list is yours alone" | "Your list is private" |
| "Write the first one" / "Pin a task you have been assigned" | "Add the first one" / "Pin an assigned task" |
| "Drop here to move it to someday" | "Drop into someday" |
| Dialog titled "Edit", field labelled "What needs doing" | "Edit to-do", "Task" |

### Craft

Four things that were not earning their place:

- **The board's column fill.** Every column carried a permanent recessed panel,
  which under a short column drew a tall grey block containing nothing. A drop
  target is worth showing while something is being dropped; the heading and the
  cards say where the column is the rest of the time. It appears on drag and
  goes again.
- **A `kbd` hint wedged between the capture field and the Add button.** It made
  one control look like two. The shortcut is in the keyboard dialog.
- **The disabled Add button** was ink at 50% opacity, which reads as a smudge.
  It is a recessed fill now: a control waiting for input rather than a faded
  black block.
- **"Open details" in focus mode** was pushed to the far end by an `ml-auto`
  and wrapped to a line of its own, making one of five equal actions look like
  a different kind of thing.

### The mobile capture loop, tested as specified

Driven at 390x844 with **no Enter key anywhere in the test**:

| step | result |
|---|---|
| Tap the field | focused |
| Type | Add enabled, 16px so iOS does not zoom |
| Tap Add (44x44) | row appears, field clears, **focus retained** |
| Type and tap again | second row appears |
| `/tomorrow !` | chip reads "Sun, 30 Aug - starred" before commit; row lands dated the 30th and starred |

The composer is `sticky` below `sm`, so once the list scrolls it pins at the
top of the scroll container, clear of the keyboard on a 667px phone as well as
an 844px one.

### Changed

`supabase/migrations/0027_task_assignment_link.sql` (new),
`components/layout/header.tsx` (one action in the notification row),
`lib/mywork.ts` (`intakeFromNotification`), and copy and craft edits across
`components/modules/mywork/*`.

## 6. The phases

| # | Phase | State |
|---|---|---|
| 1 | Navigation / sidebar / shell | **done** |
| 2 | Executive Overview | **done** |
| 3 | My Work | **done** (3b: intake, inbox, reminders) |
| 4 | CRM | next |
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
- ~~**Two `h1`s on the dashboard.**~~ Done in Phase 2 — the greeting is an
  `h2` and the shell's header holds the only `h1`.
- **A client's navigation still lists Projects.** That is the existing grant
  (read-only, feeding portal endpoints), but the module's UI is built for staff.
  Decide it in Phase 13.
- **Charts** still pass raw hex to recharts in CRM and finance. The dashboard
  is done: every chart on it reads `--chart-*` through `useViz` in
  `modules/dashboard/viz.tsx`, which re-reads the tokens when the theme
  changes. That file is the pattern the other two should follow.
- **`formatDate` parses a bare date as UTC** — found in Phase 3 and fixed only
  inside My Work, which now has a local `formatDay(iso, opts)` that appends
  `T00:00:00` first. `new Date('2026-09-03')` is UTC midnight by
  specification, so in any timezone west of UTC a `date` column renders as the
  day before. `formatDate` is called **53 times outside My Work**, and the ones
  passing genuine `date` columns are wrong today — `holidays.holiday_date`,
  `deals.expected_close`, `tasks.due_date`, `invoices.due_date`,
  `organization_members.terminated_on` among them. Calls passing a
  `timestamptz` are unaffected. Each module's own phase should convert its
  own; when the second consumer appears, lift the helper into `lib/format.ts`
  as `formatDay` — **with** that consumer, not before it.

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
