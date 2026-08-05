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
  LifeBuoy,
  CalendarDays,
  ShieldCheck,
  ScrollText,
  KeyRound,
  Radio,
  DownloadCloud,
  TimerReset,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal, RevealGroup } from '@/components/marketing/reveal';
import { ProductSurface } from '@/components/marketing/product-surface';

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
 *  ── What the previous page argued ────────────────────────────────────────
 *
 *  Nothing, in order. It opened with a pulsing badge announcing a version
 *  number, made a generic claim ("the all-in-one operating system for modern
 *  business"), showed a grey wireframe, listed eight modules as eight
 *  identical cards, asserted four unverifiable numbers, and asked for the
 *  sale. Between the headline and the call to action the reader learned one
 *  fact: the product has modules.
 *
 *  That is the shape of a template. The sections could be reordered or deleted
 *  without changing the meaning of the page, which is the test — a page that
 *  survives shuffling was never making an argument.
 *
 *  ── What this page argues ────────────────────────────────────────────────
 *
 *    1. The problem is not that you have many tools. It is that they disagree.
 *    2. Here is the product, actually rendered, in the first screen.
 *    3. Here is what it holds.
 *    4. Here is why it can be trusted with it — six specific, checkable
 *       engineering facts, in place of "SOC-2" and "10,000+ teams".
 *    5. Here is the one thing a suite of separate apps structurally cannot do.
 *
 *  Each section depends on the one before it. None of the claims require the
 *  reader to take our word for anything they could not verify in a trial.
 */

const modules = [
  {
    icon: Users,
    name: 'CRM',
    line: 'Leads, contacts, companies, deals and the activity behind them.',
  },
  {
    icon: FolderKanban,
    name: 'Projects',
    line: 'Boards, tasks, comments, time and the people assigned to them.',
  },
  {
    icon: UserCog,
    name: 'People',
    line: 'The employee record, leave, attendance, departments and holidays.',
  },
  {
    icon: Wallet,
    name: 'Finance',
    line: 'Invoices and expenses, tied to the customer and project that caused them.',
  },
  {
    icon: Boxes,
    name: 'Inventory',
    line: 'Products, warehouses, stock movements, suppliers and purchase orders.',
  },
  {
    icon: MessagesSquare,
    name: 'Communication',
    line: 'Channels, direct messages, files and meetings, beside the work.',
  },
  {
    icon: LifeBuoy,
    name: 'Support',
    line: 'Tickets with owners and response times, and a portal for clients.',
  },
  {
    icon: CalendarDays,
    name: 'Calendar',
    line: 'One schedule drawn from projects, leave, meetings and deadlines.',
  },
];

/**
 * The trust section.
 *
 * ── Why these six, and not badges ────────────────────────────────────────
 *
 * The page this replaces claimed "10,000+ Active Teams", "$1.2B+ Processed",
 * "99.99% Uptime SLA" and "SOC-2 Certified" in 4xl type. Every one of those is
 * a statement about the company rather than the software, none can be checked
 * from outside, and the last is a certification with a named auditor and a
 * report you can be asked for — which makes asserting it casually the most
 * expensive sentence on the site.
 *
 * The buyer this page is written for does not believe round numbers. They ask
 * what happens when someone leaves, who can see the finance module, and
 * whether they can get their data back out. Every item below answers a
 * question of that kind, and every one is demonstrable in a trial account in
 * under a minute — which is the only kind of proof worth printing.
 */
const foundations = [
  {
    icon: KeyRound,
    title: 'One permission model',
    body: 'Roles are defined once and enforced in the route, not in the interface. Hiding a menu item is not access control; a request that should not succeed does not succeed.',
  },
  {
    icon: ScrollText,
    title: 'An audit trail you can read',
    body: 'Who changed which record, when, and what it said before. Administrators can read it in the product rather than requesting an export from us.',
  },
  {
    icon: ShieldCheck,
    title: 'Isolation at the database',
    body: 'Every table carries row-level security, so a workspace boundary is enforced beneath the application rather than by it. A bug in a query cannot cross tenants.',
  },
  {
    icon: TimerReset,
    title: 'Sessions that end',
    body: 'Idle and absolute timeouts, and an administrator can revoke every session a person holds — immediately, not at the next token refresh.',
  },
  {
    icon: Radio,
    title: 'Live by default',
    body: 'Changes arrive in other people’s screens as they happen. No refresh button, and no stale record being edited by two people at once.',
  },
  {
    icon: DownloadCloud,
    title: 'Your data, on request',
    body: 'Structured export from every module, at any time, without a support ticket. Software you cannot leave is not software you should adopt.',
  },
];

export default function LandingPage() {
  // No client-side auth gate here: middleware redirects signed-in visitors to
  // /dashboard before this renders. Unauthenticated visitors get the landing
  // page immediately, with no loading spinner in front of it.
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────
          ── What this replaces ───────────────────────────────────────────

          A single left-aligned stack: eyebrow, headline, lede, buttons, trust
          row and the product frame all on the same left edge inside the same
          75rem box, with the frame centred and given equal air on both sides.

          Three things followed. The reveal delays walked the eye straight down
          a line, which is the least interesting path available. The scale ran
          68px → 19px → 13px → a frame of uniform 13px UI: a smooth ramp, which
          is the opposite of contrast. And nothing ever touched an edge, so the
          page read as content placed inside a container rather than as a
          composition.

          ── What it does now ─────────────────────────────────────────────

          An asymmetric split above `xl`. The text holds a 34rem measure on the
          left; the frame takes the rest and runs off the right edge of the
          viewport, cropped. The plate behind them stops where the frame
          begins, so the frame sits *on* something.

          Eye path: the headline first — largest object, top-left, highest
          contrast, and the only thing on the page at `display-1`. Then the
          frame's cropped edge, because a cut-off object pulls harder than a
          contained one and the crop points right. Then the primary button,
          which is the only filled element and sits at the elbow between them.

          Rejected: centring the hero over a full-bleed frame — the shape every
          developer-tools company currently uses. It forces the headline short
          enough to centre, it puts the product below the fold on a 768 laptop,
          and it is the most-copied hero on the internet. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="hero-plate pointer-events-none absolute inset-x-0 top-0 h-[42rem]"
        />

        <div className="relative mx-auto w-full max-w-[75rem] px-5 pt-band pb-section sm:px-8 xl:pt-[5.5rem]">
          <div className="grid items-start gap-band xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] xl:gap-block">
            {/* ── The claim ───────────────────────────────────────────
                `max-w-[40rem]` matters only below `xl`, where the split
                collapses and this column would otherwise inherit the full
                75rem container. Measured at 1024 before it was added: the lede
                ran 945px wide at roughly 108 characters a line — comfortably
                past the 75 ceiling, and invisible at 1440 because the grid
                column was holding it in. A constraint that only exists in one
                layout is a constraint that will be wrong in the other. */}
            <div className="max-w-[40rem]">
              {/*
                12px against 68px directly beneath it — a 5.7× jump with
                nothing mid-sized in between. Timid, mid-sized everything is
                what "just there" means; contrast of scale is the cheapest way
                out of it and it costs no space.
              */}
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
                    <Link href="/features">Explore the product</Link>
                  </Button>
                </div>
              </Reveal>

              <Reveal delay={0.2}>
                {/*
                  One tertiary line, not three items each carrying an accent
                  dot. The dots put three accent instances in the hero before
                  the frame had used its one, which is most of a screen's
                  budget spent on punctuation. This is meta — the smallest,
                  quietest thing in the column — so it is set as meta.
                */}
                <p className="text-copy-3 text-label mt-comp uppercase">
                  14 days · no card · every module · export whenever you like
                </p>
              </Reveal>
            </div>

            {/* ── The product ───────────────────────────────────────── */}
            <Reveal
              delay={0.25}
              // `xl:mt-block` lands the frame's top edge on the headline's
              // cap height — the top of the letterforms, not the top of the
              // line box, which sits ~16px higher and would leave the two
              // columns looking a half-step out. Aligning to a *box* edge is
              // what makes two columns read as placed rather than composed.
              className="hero-bleed-right min-w-0 xl:mt-block"
            >
              <ProductSurface />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── The problem ────────────────────────────────────────────────────
          One idea, given a whole band and almost no ornament. The old page had
          no section like this at all: it went from a claim straight to a
          feature list, so the features answered a question the reader had not
          been asked yet. */}
      <Section tone="surface" density="tight" aria-labelledby="problem">
        <div className="grid gap-8 md:grid-cols-[1fr_1.15fr] md:gap-16">
          <Reveal>
            <h2 id="problem" className="text-display-3 text-balance-hero">
              The tools aren’t the problem. The disagreement is.
            </h2>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="text-muted-foreground space-y-4 text-[0.9375rem] leading-relaxed">
              <p>
                Sales knows a deal closed. Delivery finds out in a spreadsheet on
                Monday. Finance invoices from a third list, and the customer’s
                name is spelled differently in all three. Nobody made a mistake —
                the systems were simply never told about each other.
              </p>
              <p className="text-foreground">
                Integrations copy that disagreement around faster. The only thing
                that removes it is a single place where the record lives, and
                everything else reads from it.
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── Modules ─────────────────────────────────────────────────────── */}
      <Section aria-labelledby="modules">
        <SectionHeading
          id="modules"
          eyebrow="What it holds"
          title="Eight modules, one database, one permission model."
          description="Not eight products behind a shared login. The same records, visible to the departments entitled to see them."
        />

        <RevealGroup
          className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4"
          step={0.04}
        >
          {modules.map(({ icon: Icon, name, line }) => (
            <div key={name} className="border-hairline border-t pt-5">
              <Icon className="text-brand size-[1.125rem]" strokeWidth={1.9} />
              <h3 className="mt-3 text-[0.9375rem] font-semibold tracking-[-0.01em]">
                {name}
              </h3>
              <p className="text-muted-foreground mt-1.5 text-[0.875rem] leading-relaxed">
                {line}
              </p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Foundations ─────────────────────────────────────────────────── */}
      <Section tone="surface" aria-labelledby="foundations">
        <SectionHeading
          id="foundations"
          eyebrow="Why you can put the company in it"
          title="The parts nobody demos, which decide whether you can deploy it."
          description="Six things worth checking in any system that will hold your customer list and your payroll. Each is demonstrable in a trial account."
        />

        <RevealGroup
          className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2 lg:grid-cols-3"
          step={0.04}
        >
          {foundations.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <div className="bg-brand-soft text-brand ring-brand-line flex size-9 items-center justify-center rounded-lg ring-1">
                <Icon className="size-[1.0625rem]" strokeWidth={1.9} />
              </div>
              <h3 className="mt-4 text-[0.9375rem] font-semibold tracking-[-0.01em]">
                {title}
              </h3>
              <p className="text-muted-foreground mt-2 text-[0.875rem] leading-relaxed">
                {body}
              </p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── The structural argument ─────────────────────────────────────── */}
      <Section aria-labelledby="one-record">
        <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
          <Reveal>
            <Eyebrow>The difference</Eyebrow>
            <h2 id="one-record" className="text-display-2 text-balance-hero mt-5">
              A suite can’t do this. Only one database can.
            </h2>
            <p className="text-muted-foreground text-pretty-body mt-5 text-[0.9375rem] leading-relaxed">
              Open the invoice from the project. Open the project from the deal.
              Open the deal from the message where somebody mentioned it. Nothing
              is copied, nothing is synced, and nothing is waiting on a webhook —
              it is the same row, reached from wherever you happened to be.
            </p>
            <p className="text-muted-foreground mt-4 text-[0.9375rem] leading-relaxed">
              Permissions travel with it. Someone who cannot see finance does not
              see the amount, from any direction they arrive.
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            {/*
              A chain, drawn plainly. This is the one place on the page where a
              diagram earns its space, because the claim is about relationships
              and a list of features cannot show a relationship.
            */}
            <ol className="border-hairline bg-surface divide-hairline divide-y rounded-xl border">
              {[
                { k: 'Contact', v: 'Priya Raman — Harlow Manufacturing' },
                { k: 'Deal', v: 'Line 3 automation · $184,000' },
                { k: 'Project', v: 'Harlow retrofit · 6 people · 31 tasks' },
                { k: 'Invoice', v: 'INV-2043 · $61,300 · due in 14 days' },
              ].map((row, i) => (
                <li key={row.k} className="flex items-center gap-4 px-5 py-4">
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground/60 w-4 shrink-0 text-[0.75rem] tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <span className="w-[4.5rem] shrink-0 text-[0.8125rem] font-semibold">
                    {row.k}
                  </span>
                  <span className="text-muted-foreground truncate text-[0.8125rem]">
                    {row.v}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground mt-3 text-center text-[0.75rem]">
              Four records. One customer. No export in between.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* ── Close ───────────────────────────────────────────────────────── */}
      <Section tone="ink" density="tight" aria-labelledby="cta">
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="cta" className="text-display-3 text-balance-hero max-w-xl">
              Put one department on it this week.
            </h2>
            <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed opacity-70">
              Start with the module that hurts most. The rest is already there
              when you want it, and your data comes back out whenever you ask.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
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
