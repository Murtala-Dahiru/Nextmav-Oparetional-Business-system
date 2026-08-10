import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  Users,
  FolderKanban,
  UserCog,
  Wallet,
  Boxes,
  MessagesSquare,
  KeyRound,
  ScrollText,
  ShieldCheck,
  TimerReset,
  Layers,
  Network,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal, RevealGroup } from '@/components/marketing/reveal';
import { CrmSurface, ProjectsSurface } from '@/components/marketing/surfaces';

export const metadata: Metadata = {
  title: 'NextMav — one system of record for the whole company',
  description:
    'CRM, projects, people, finance, inventory and communication in a single application, on one permission model and one audit trail.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Landing page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Where this structure came from ───────────────────────────────────────
 *
 *  The section order is migrated from the uploaded public-experience project
 *  (`bolt landing page`), which argued the page in eight movements rather than
 *  six. Three of its sections are gone and are not coming back:
 *
 *    · the trust marquee      — eight invented org names
 *    · the testimonial row    — three named people at three named companies,
 *                               illustrated with photographs of real people
 *                               hotlinked from a stock library
 *    · the star rating        — "Rated 4.9/5 by operators"
 *
 *  Its showcase section survives with the stock photograph replaced by the
 *  product itself, which is the thing that section was reaching for anyway.
 *
 *  The *visual language* is this repository's, unchanged: the `.phase1` neutral
 *  ramp, Geist, the teal accent, `Section` densities and tones. The upload's
 *  glow orbs, gradient headline text, gold second accent and 36px radii are
 *  not here — they are the tells §14 of the brief bans, and the upload's own
 *  design document bans most of them too.
 *
 *  ── On what this page is allowed to claim ────────────────────────────────
 *
 *  The upload's copy sells Procurement, an asset register, a documents module,
 *  a configurable approvals engine and predictive analytics. `lib/constants.ts`
 *  is the real module list and contains none of them. Every capability named
 *  below is a module that exists.
 *
 *  ── On rhythm ────────────────────────────────────────────────────────────
 *
 *  No two adjacent sections share a tone: plate → surface → plain → surface →
 *  ink → plain → surface → ink. `default` density never appears more than
 *  twice in a row; that rule is enforced in `section.tsx`.
 */

/**
 * The six shown as tiles, of the eight business modules.
 *
 * `span` drives the bento, and the shape is chosen so the grid closes: one tile
 * at 2×2, two stacked beside it, three across the bottom — nine cells, three
 * rows, no gaps. A bento with a hole in it looks like a layout that failed
 * rather than one that was composed, which is what the first attempt here did
 * when a second wide tile left two cells empty on a fourth row.
 *
 * The asymmetry is the one thing worth keeping from the upload's version of
 * this section: six identical cards is a list wearing a grid's clothes.
 */
const capabilities = [
  {
    num: '01',
    icon: Wallet,
    name: 'Finance',
    body: 'Invoices and expenses tied to the customer and the project that caused them. Ageing, budgets and department spend, without a month-end reconciliation.',
    span: 'lg:col-span-2 lg:row-span-2',
    chart: true,
  },
  {
    num: '02',
    icon: Users,
    name: 'CRM',
    body: 'Leads, contacts, companies, deals and the activity behind them.',
    span: '',
    chart: false,
  },
  {
    num: '03',
    icon: FolderKanban,
    name: 'Projects',
    body: 'Boards, tasks, milestones, comments and time, against the people assigned to them.',
    span: '',
    chart: false,
  },
  {
    num: '04',
    icon: UserCog,
    name: 'People',
    body: 'The employee record, leave, attendance, departments and holidays.',
    span: '',
    chart: false,
  },
  {
    num: '05',
    icon: Boxes,
    name: 'Inventory',
    body: 'Products, warehouses, stock movements, suppliers and purchase orders.',
    span: '',
    chart: false,
  },
  {
    num: '06',
    icon: MessagesSquare,
    name: 'Communication',
    body: 'Channels, direct messages, files and meetings, beside the work they are about.',
    span: '',
    chart: false,
  },
] as const;

/**
 * The consolidation list.
 *
 * The upload's version listed an HRIS, a procurement portal and an asset
 * register — three products this one does not replace, because it does not
 * have those modules. These eight are each answered by a module that exists.
 */
const replaced = [
  'CRM tool',
  'Project tracker',
  'HR system',
  'Leave spreadsheet',
  'Invoicing tool',
  'Stock spreadsheet',
  'Helpdesk inbox',
  'Shared calendar',
];

/**
 * The architecture diagram, migrated from the upload.
 *
 * Kept because it is the one visual on that page making a claim that can be
 * checked, and because the claim it makes — that the layers below the modules
 * are shared rather than integrated — is the claim this product leads with and
 * cannot be shown with a feature list.
 *
 * Layer names are this system's, not the upload's.
 */
const layers = [
  { label: 'Modules', items: ['CRM', 'Projects', 'People', 'Finance', 'Inventory', 'Communication'] },
  { label: 'Shared model', items: ['Customers', 'Org structure', 'Records'] },
  { label: 'Access', items: ['Roles', 'Route guards', 'Sessions'] },
  { label: 'Data & audit', items: ['Row-level security', 'Audit trail', 'Export'] },
];

/**
 * Four figures, and the reason each is safe to print.
 *
 * The page this replaces claimed "10,000+ Active Teams" and "$1.2B+ Processed".
 * Every number below is a statement about the software's shape rather than
 * about the company's traction, and each is checkable from inside a trial
 * account in under a minute. That is the only kind of figure worth setting at
 * display size.
 */
const figures = [
  { val: '8', label: 'business modules on one database' },
  { val: '1', label: 'permission model, enforced in the route' },
  { val: '0', label: 'exports between departments' },
  { val: '100%', label: 'of tables carrying row-level security' },
];

const readiness = [
  {
    icon: KeyRound,
    title: 'Roles enforced beneath the interface',
    body: 'Permissions are defined once and checked in the route, not in the menu. Hiding a link is not access control; a request that should not succeed does not succeed.',
  },
  {
    icon: TimerReset,
    title: 'Sessions that actually end',
    body: 'Idle and absolute timeouts, and an administrator can revoke every session a person holds — immediately, rather than at the next token refresh.',
  },
  {
    icon: ShieldCheck,
    title: 'Isolation at the database',
    body: 'Every table carries row-level security, so a workspace boundary is enforced below the application rather than by it. A bug in a query cannot cross tenants.',
  },
];

const foundations = [
  {
    icon: ScrollText,
    title: 'An audit trail you can read',
    body: 'Who changed which record, when, and what it said before — read in the product, not requested from us as an export.',
  },
  {
    icon: Layers,
    title: 'One record, many doorways',
    body: 'Open the invoice from the project, the project from the deal, the deal from the message that mentioned it. Same row, reached from wherever you were.',
  },
  {
    icon: Network,
    title: 'Permissions travel with the record',
    body: 'Someone who cannot see finance does not see the amount, from any direction they arrive at it.',
  },
];

export default function LandingPage() {
  // No client-side auth gate here: middleware redirects signed-in visitors to
  // /dashboard before this renders. Unauthenticated visitors get the landing
  // page immediately, with no loading spinner in front of it.
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────
          The upload's composition — eyebrow, headline, lede, two actions, one
          tertiary footnote, product frame to the right — on this system's
          light ground rather than its dark one.

          Deliberately not dark. The upload's hero is a near-black band, and
          this site's header is transparent at rest and only paints a
          translucent background once scrolled: a dark hero would put
          near-black nav links on a near-black ground for the first 8px of
          scroll. Tone is visual language, and visual language stays as it is.

          The frame still runs off the right edge above `xl`, cropped by the
          section's `overflow-hidden`. A cropped interface implies it
          continues; a frame with polite margins on both sides does not. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="hero-plate pointer-events-none absolute inset-x-0 top-0 h-[46rem]"
        />

        <div className="relative mx-auto w-full max-w-[75rem] px-5 pt-band pb-section sm:px-8 xl:pt-[5.5rem]">
          <div className="grid items-start gap-band xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] xl:gap-block">
            {/* `max-w-[40rem]` matters only below `xl`, where the split
                collapses and this column would otherwise inherit the full
                75rem container — the lede measured 108 characters a line at
                1024 before it was added, and was invisible at 1440 because the
                grid column was holding it in. */}
            <div className="max-w-[40rem]">
              <Reveal>
                <Eyebrow>Business operating system</Eyebrow>
              </Reveal>

              <Reveal delay={0.05}>
                <h1 className="text-display-1 text-balance-hero mt-pair">
                  One system of record for the entire company.
                </h1>
              </Reveal>

              <Reveal delay={0.1}>
                <p className="text-copy-2 text-lede text-pretty-body mt-comp max-w-[34rem]">
                  CRM, projects, people, finance, inventory and communication in
                  a single application — where a customer, the project you are
                  running for them and the invoice it produced are one record,
                  not three exports that disagree.
                </p>
              </Reveal>

              <Reveal delay={0.15}>
                <div className="mt-group flex flex-wrap items-center gap-pair">
                  <Button asChild variant="cta" size="xl">
                    <Link href="/signup">
                      Start free
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="ctaOutline" size="xl">
                    <Link href="/contact">Talk to us</Link>
                  </Button>
                </div>
              </Reveal>

              <Reveal delay={0.2}>
                {/* One tertiary line, not three items each carrying an accent
                    dot. This is meta — the smallest, quietest thing in the
                    column — so it is set as meta. */}
                <p className="text-copy-3 text-label mt-comp uppercase">
                  14 days · no card · every module · export whenever you like
                </p>
              </Reveal>
            </div>

            {/* `xl:mt-block` lands the frame's top edge on the headline's cap
                height rather than the top of its line box, which sits ~16px
                higher and would leave the columns a half-step out. */}
            <Reveal delay={0.25} className="hero-bleed-right min-w-0 xl:mt-block">
              <CrmSurface />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Capabilities ───────────────────────────────────────────────────
          The upload's bento, rebuilt. Two tiles carry more weight than the
          other four, which is the whole reason to use a bento rather than a
          grid — six equal cards would be a list with borders.

          Icon-in-a-soft-circle is not here. The upload put one on every tile;
          it is the most reliable signature of a generated feature grid, and a
          bare glyph above a number does the same work without the furniture. */}
      <Section tone="surface" density="default" aria-labelledby="capabilities">
        <SectionHeading
          id="capabilities"
          eyebrow="What it holds"
          title="Eight modules, one database, one permission model."
          description="Not eight products behind a shared login. The same records, visible to the departments entitled to see them."
        />

        {/* Mapped by hand rather than through `RevealGroup`.
            `RevealGroup` wraps every child in its own `Reveal` div, and that
            wrapper — not the card — is the direct grid child, so a `col-span`
            written on the card applies to an element the grid never sees. The
            first version of this section did exactly that and rendered six
            equal tiles; `itemClassName` cannot help, because it is one string
            shared by every item and the spans differ per tile. Measured at
            1440: all six were 363px wide. */}
        <div className="mt-group grid gap-comp lg:grid-cols-3">
          {capabilities.map(({ num, icon: Icon, name, body, span, chart }, i) => (
            <Reveal
              key={name}
              delay={Math.min(i, 5) * 0.04}
              className={`h-full ${span}`}
            >
              <div className="border-hairline bg-background rounded-surface hover:border-hairline-strong flex h-full flex-col border p-comp transition-colors">
                <div className="flex items-center gap-pair">
                  <Icon className="text-copy-2 size-[1.125rem]" strokeWidth={1.9} />
                  <span className="text-copy-3 text-label tabular-nums">{num}</span>
                </div>
                <h3 className="text-title mt-pair">{name}</h3>
                <p className="text-copy-2 text-body-sm mt-label max-w-[34rem]">{body}</p>

                {/* An illustration, not data. Nothing here is labelled with a
                    figure, because a number in a decorative tile is a claim the
                    page cannot support — which is exactly how the upload's
                    version came to print "$2.4M" and "$847k" beside a module
                    name. `aria-hidden`: the tile's text carries the meaning.

                    One tile has one, and it is the largest tile. A figure in
                    every tile is decoration; a figure in the tile that is
                    already twice the size of its neighbours is composition. */}
                {chart && (
                  <div
                    aria-hidden="true"
                    className="mt-group flex min-h-[4rem] flex-1 items-end gap-1.5"
                  >
                    {[38, 52, 44, 61, 55, 72, 64, 80, 71, 88, 79, 96].map((h, j) => (
                      <div
                        key={j}
                        style={{ height: `${h}%` }}
                        className="bg-n-4 min-h-[6px] flex-1 rounded-[2px]"
                      />
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-group">
          <Link
            href="/features"
            className="text-title hover:text-brand group inline-flex items-center gap-label transition-colors"
          >
            Support and Calendar, and the client portal
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Reveal>
      </Section>

      {/* ── Consolidation ──────────────────────────────────────────────────
          Migrated from the upload: a before column, an arrow, one result. It
          earns its place because it states the cost of the alternative in
          objects rather than adjectives, which nothing else on the page does. */}
      <Section density="dense" aria-labelledby="consolidation">
        <div className="grid items-center gap-block md:grid-cols-2 md:gap-[4rem]">
          <Reveal>
            <Eyebrow>One system, not eight</Eyebrow>
            <h2 id="consolidation" className="text-display-2 text-balance-hero mt-pair">
              The tools aren’t the problem. The disagreement is.
            </h2>
            <p className="text-copy-2 text-body text-pretty-body mt-comp">
              Sales knows a deal closed. Delivery finds out in a spreadsheet on
              Monday. Finance invoices from a third list, and the customer’s name
              is spelled differently in all three. Nobody made a mistake — the
              systems were simply never told about each other.
            </p>
            <p className="text-copy-2 text-body mt-row">
              Integrations copy that disagreement around faster. The only thing
              that removes it is a single place where the record lives, and
              everything else reading from it.
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="flex flex-col gap-comp">
              <div className="border-hairline rounded-surface border border-dashed p-comp">
                <p className="text-copy-3 text-label uppercase">Before</p>
                <div className="mt-row flex flex-wrap gap-label">
                  {replaced.map((tool) => (
                    <span
                      key={tool}
                      className="border-hairline text-copy-2 rounded-control border px-2.5 py-1 text-caption"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              <div aria-hidden="true" className="flex justify-center">
                <ArrowRight className="text-copy-3 size-5 rotate-90" strokeWidth={1.9} />
              </div>

              <div className="border-hairline-strong bg-background rounded-surface shadow-e1 border p-comp">
                <p className="text-copy-3 text-label uppercase">After</p>
                <p className="text-display-3 mt-row">NextMav</p>
                <p className="text-copy-2 text-body-sm mt-label">
                  One application, one database, one permission model, one audit
                  trail.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── Showcase ───────────────────────────────────────────────────────
          The upload's split section, with its stock photograph of an office
          replaced by the product.

          The photograph was captioned "3.2x faster approvals" on a badge — an
          invented figure over a picture of people who have never used this
          software. What that section actually wanted was evidence, and the
          board *is* the evidence: it is the same workspace as the frame in the
          hero, one department along. */}
      <Section tone="surface" density="default" width="wide" aria-labelledby="showcase">
        {/* Splits at `xl`, not `lg`. At 1024 the two-column version gave the
            board 506px — a three-column kanban with checklists and avatars,
            at a third of the width it was designed at. It fitted, in the sense
            that nothing overflowed, which is not the same as being readable.
            Below `xl` the board takes the full `wide` container instead and
            the copy sits under it. */}
        <div className="grid items-center gap-block xl:grid-cols-[1.35fr_1fr] xl:gap-[4rem]">
          <Reveal className="min-w-0">
            <ProjectsSurface />
          </Reveal>

          <Reveal delay={0.05}>
            <Eyebrow>Same product, different department</Eyebrow>
            <h2 id="showcase" className="text-display-2 text-balance-hero mt-pair">
              Delivery works where the deal already lives.
            </h2>
            <p className="text-copy-2 text-lede text-pretty-body mt-comp">
              The project beside this was opened from the deal in the screen at
              the top of the page. Same workspace, same permissions, same audit
              trail — no export, no sync, no second login.
            </p>

            <div className="mt-group flex flex-col gap-row">
              {foundations.map(({ icon: Icon, title, body }) => (
                <div key={title} className="border-hairline flex gap-pair border-t pt-row">
                  <Icon
                    className="text-copy-2 mt-1 size-4 shrink-0"
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="text-title">{title}</h3>
                    <p className="text-copy-2 text-body-sm mt-1">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── Architecture ───────────────────────────────────────────────────
          Ink, and the only dark band before the close. The upload reserved its
          dark surfaces for technical moments and that stratification is worth
          keeping: it tells the reader the register has changed before they
          have read a word.

          The diagram is four layers, narrowing downward. It is the one place a
          diagram earns its space on this page, because the claim is about what
          sits *underneath* the modules and a feature list cannot show a
          relationship. */}
      <Section tone="ink" density="dense" aria-labelledby="architecture">
        <div className="grid items-center gap-block md:grid-cols-2 md:gap-[4rem]">
          <Reveal>
            <Eyebrow className="text-copy-on-ink-2">Architecture</Eyebrow>
            <h2 id="architecture" className="text-display-2 text-balance-hero mt-pair">
              A suite can’t do this. Only one database can.
            </h2>
            <p className="text-copy-on-ink-2 text-body text-pretty-body mt-comp">
              Every module reads the same customers, the same org structure and
              the same permission model. There is nothing between them to
              configure, nothing to keep in sync, and no webhook that can be
              down while the rest of the company keeps working.
            </p>
            <p className="text-lede mt-row">
              The layers below the modules are shared, not integrated. That is
              the whole product.
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <ol className="flex flex-col gap-2">
              {layers.map((layer, i) => (
                <li key={layer.label}>
                  <div
                    className="border-ink-fg/15 rounded-surface border p-row"
                    // Each layer sits a little narrower than the one above it,
                    // so the stack reads as a foundation rather than as four
                    // equal boxes. Inline because the inset is a ratio of the
                    // index, not one of the spacing steps.
                    style={{ marginInline: `${i * 0.75}rem` }}
                  >
                    <p className="text-copy-on-ink-2 text-label uppercase">{layer.label}</p>
                    <div className="mt-label flex flex-wrap gap-1.5">
                      {layer.items.map((item) => (
                        <span
                          key={item}
                          className="border-ink-fg/15 rounded-control border px-2 py-0.5 text-caption"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  {i < layers.length - 1 && (
                    <div
                      aria-hidden="true"
                      className="bg-ink-fg/20 mx-auto h-2 w-px"
                    />
                  )}
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </Section>

      {/* ── Figures ────────────────────────────────────────────────────────
          Migrated from the upload, and the only section of it whose numbers
          survived — because these four describe the software's shape rather
          than the company's traction, and every one can be checked in a trial
          account. `interrupt` density: this is a band that punctuates, not a
          section that argues.

          The heading is visually hidden rather than absent. This band was
          written with `aria-label` first, which does nothing: `Section` only
          forwards `aria-labelledby`, and TypeScript does not excess-check
          hyphenated JSX attributes, so the prop was dropped in silence and the
          region shipped unnamed. A screen-reader user landing here would have
          met four numbers with no statement of what they count. */}
      <Section density="interrupt" aria-labelledby="figures">
        <h2 id="figures" className="sr-only">
          The shape of the system, in four numbers
        </h2>
        <RevealGroup
          className="grid gap-comp sm:grid-cols-2 lg:grid-cols-4"
          itemClassName="h-full"
          step={0.05}
        >
          {figures.map(({ val, label }) => (
            <div key={label} className="border-hairline h-full border-t pt-row">
              <p className="text-display-2 tabular-nums">{val}</p>
              <p className="text-copy-2 text-body-sm mt-label max-w-[15rem]">{label}</p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Readiness ──────────────────────────────────────────────────────
          The upload's security section. Its three items were "role-based
          access control", "session management" and "multi-organization ready"
          — the first two are real here and the third is stated as isolation,
          which is the part that can be demonstrated. */}
      <Section tone="surface" density="default" aria-labelledby="readiness">
        <SectionHeading
          id="readiness"
          eyebrow="Why you can put the company in it"
          title="The parts nobody demos, which decide whether you can deploy it."
          description="Three things worth checking in any system that will hold your customer list and your payroll. Each is demonstrable in a trial account."
        />

        <RevealGroup
          className="mt-group grid gap-x-block gap-y-comp md:grid-cols-3"
          step={0.05}
        >
          {readiness.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="border-hairline border-t pt-comp">
              <div className="flex items-center gap-pair">
                <span className="text-copy-3 text-label tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Icon className="text-copy-2 size-4" strokeWidth={1.9} aria-hidden="true" />
              </div>
              <h3 className="text-title mt-pair">{title}</h3>
              <p className="text-copy-2 text-body-sm mt-label">{body}</p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Close ─────────────────────────────────────────────────────────
          Ink again, and the second time is deliberate: the argument opens on
          ink at the architecture band and closes on it here, so the two dark
          bands bracket the proof between them.

          The upload closed with five filled stars and "Rated 4.9/5 by
          operators" under the buttons. There is no rating. */}
      <Section tone="ink" density="interrupt" aria-labelledby="cta">
        <div className="flex flex-col items-start gap-group md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="cta" className="text-display-2 text-balance-hero max-w-[24rem]">
              Put one department on it this week.
            </h2>
            <p className="text-copy-on-ink-2 text-body mt-pair max-w-[32rem]">
              Start with the module that hurts most. The rest is already there
              when you want it, and your data comes back out whenever you ask.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-pair">
            <Button asChild variant="onInk" size="xl">
              <Link href="/signup">
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="ghost"
              className="text-ink-fg hover:bg-ink-fg/10 hover:text-ink-fg"
            >
              <Link href="/contact">Talk to us</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
