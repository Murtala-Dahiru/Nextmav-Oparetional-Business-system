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
import {
  CrmSurface,
  ProjectsSurface,
  AttendanceSurface,
  FinanceSurface,
} from '@/components/marketing/surfaces';

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
 *  ── The argument, in order ───────────────────────────────────────────────
 *
 *    1. The problem is not that you have many tools. It is that they disagree.
 *    2. Here is the product, actually rendered, in the first screen.
 *    3. Here is the same product doing four different departments' work —
 *       because "one system" is a claim you have to *show*, not assert.
 *    4. Here is what it holds.
 *    5. Here is the one thing a suite of separate apps structurally cannot do.
 *    6. Here is why it can be trusted with it — six checkable engineering
 *       facts, in place of "SOC-2" and "10,000+ teams".
 *
 *  Each section depends on the one before it. None of the claims requires the
 *  reader to take our word for anything they could not verify in a trial.
 *
 *  ── On rhythm ────────────────────────────────────────────────────────────
 *
 *  No two adjacent sections share a treatment. The page alternates contained
 *  and full-bleed, plain and tinted and ink, dense and open — because a page
 *  where eight sections are structurally identical is the definition of bland,
 *  however good any one of them is. `default` density never appears more than
 *  twice in a row; that rule is enforced in `section.tsx`.
 */

const modules = [
  { icon: Users, name: 'CRM', line: 'Leads, contacts, companies, deals and the activity behind them.', detail: 'Pipeline · Forecast · Activity' },
  { icon: FolderKanban, name: 'Projects', line: 'Boards, tasks, comments, time and the people assigned to them.', detail: 'Boards · Time · Checklists' },
  { icon: UserCog, name: 'People', line: 'The employee record, leave, attendance, departments and holidays.', detail: 'Records · Leave · Attendance' },
  { icon: Wallet, name: 'Finance', line: 'Invoices and expenses, tied to the customer and project that caused them.', detail: 'Invoices · Expenses · Ageing' },
  { icon: Boxes, name: 'Inventory', line: 'Products, warehouses, stock movements, suppliers and purchase orders.', detail: 'Stock · Suppliers · POs' },
  { icon: MessagesSquare, name: 'Communication', line: 'Channels, direct messages, files and meetings, beside the work.', detail: 'Channels · DMs · Meetings' },
  { icon: LifeBuoy, name: 'Support', line: 'Tickets with owners and response times, and a portal for clients.', detail: 'Tickets · SLAs · Portal' },
  { icon: CalendarDays, name: 'Calendar', line: 'One schedule drawn from projects, leave, meetings and deadlines.', detail: 'Schedule · Deadlines · Leave' },
];

/**
 * ── Why these six, and not badges ────────────────────────────────────────
 *
 * The page this replaces claimed "10,000+ Active Teams", "$1.2B+ Processed",
 * "99.99% Uptime SLA" and "SOC-2 Certified" in 4xl type. Every one is a
 * statement about the company rather than the software, none can be checked
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
  { icon: KeyRound, title: 'One permission model', body: 'Roles are defined once and enforced in the route, not in the interface. Hiding a menu item is not access control; a request that should not succeed does not succeed.' },
  { icon: ScrollText, title: 'An audit trail you can read', body: 'Who changed which record, when, and what it said before. Administrators read it in the product rather than requesting an export from us.' },
  { icon: ShieldCheck, title: 'Isolation at the database', body: 'Every table carries row-level security, so a workspace boundary is enforced beneath the application rather than by it. A bug in a query cannot cross tenants.' },
  { icon: TimerReset, title: 'Sessions that end', body: 'Idle and absolute timeouts, and an administrator can revoke every session a person holds — immediately, not at the next token refresh.' },
  { icon: Radio, title: 'Live by default', body: 'Changes arrive in other people’s screens as they happen. No refresh button, and no stale record being edited by two people at once.' },
  { icon: DownloadCloud, title: 'Your data, on request', body: 'Structured export from every module, at any time, without a support ticket. Software you cannot leave is not software you should adopt.' },
];

/**
 * The chain.
 *
 * Previously "Priya Raman — Harlow Manufacturing", a fabricated person at a
 * fabricated company presented as a record — the same thing the product
 * surfaces were cleaned of, still sitting 600px below them. Records are
 * described by kind now, which costs the illustration nothing: the claim is
 * about *relationships between rows*, and a relationship does not need a name.
 */
const chain = [
  { k: 'Contact', v: 'Operations lead · manufacturing', m: 'CRM' },
  { k: 'Deal', v: 'Line 3 automation · $184,000', m: 'CRM' },
  { k: 'Project', v: 'Line 3 retrofit · 6 people · 31 tasks', m: 'Projects' },
  { k: 'Timesheet', v: '214 hours · 4 people · 3 weeks', m: 'People' },
  { k: 'Invoice', v: 'INV-2043 · $61,300 · due in 14 days', m: 'Finance' },
];

export default function LandingPage() {
  // No client-side auth gate here: middleware redirects signed-in visitors to
  // /dashboard before this renders. Unauthenticated visitors get the landing
  // page immediately, with no loading spinner in front of it.
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────
          An asymmetric split above `xl`: the text holds a 34rem measure, the
          product takes the rest and runs off the right edge of the viewport,
          cropped. The plate behind them stops where the frame begins, so the
          frame sits *on* something rather than floating over a wash.

          Eye path: the headline (largest object, top-left, highest contrast,
          the only thing on the page at `display-1`), then the frame's cropped
          edge (a cut-off object pulls harder than a contained one, and the
          crop points right), then the primary button (the only filled element,
          sitting at the elbow between the two). */}
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
              {/* 12px against 68px directly beneath it — a 5.7× jump with
                  nothing mid-sized between. Timid, mid-sized everything is
                  what "just there" means, and contrast of scale costs no
                  space to fix. */}
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

      {/* ── The problem ────────────────────────────────────────────────────
          Ink, full width, and almost no ornament. The page needs one moment
          that stops rather than continues, and it belongs here — before the
          feature list, so the features answer a question the reader has
          actually been asked. */}
      <Section tone="ink" density="dense" aria-labelledby="problem">
        <div className="grid gap-block md:grid-cols-[1fr_1.2fr] md:gap-[4rem]">
          <Reveal>
            <Eyebrow className="text-copy-on-ink-2">The problem</Eyebrow>
            <h2
              id="problem"
              className="text-display-2 text-balance-hero mt-pair"
            >
              The tools aren’t the problem. The disagreement is.
            </h2>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="text-body space-y-row md:pt-2">
              <p className="text-copy-on-ink-2">
                Sales knows a deal closed. Delivery finds out in a spreadsheet on
                Monday. Finance invoices from a third list, and the customer’s
                name is spelled differently in all three. Nobody made a mistake —
                the systems were simply never told about each other.
              </p>
              <p className="text-lede">
                Integrations copy that disagreement around faster. The only thing
                that removes it is a single place where the record lives, and
                everything else reads from it.
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── The product, at scale ──────────────────────────────────────────
          A full-bleed board, larger than anything else on the page. "One
          system" is a claim you have to show; a second department's screen,
          in the same chrome as the first, is the only way to show it. */}
      <section className="relative overflow-hidden py-section">
        <Container>
          <div className="grid items-end gap-comp md:grid-cols-[1fr_auto]">
            <Reveal>
              <Eyebrow>Same product, different department</Eyebrow>
              <h2 className="text-display-2 text-balance-hero mt-pair max-w-[26rem]">
                Delivery works where the deal already lives.
              </h2>
            </Reveal>
            <Reveal delay={0.05}>
              <p className="text-copy-2 text-body max-w-[30rem] md:pb-1.5">
                The project below was opened from the deal in the screen above
                it. Same workspace, same permissions, same audit trail — no
                export, no sync, no second login.
              </p>
            </Reveal>
          </div>
        </Container>

        {/* Wider than the reading container and centred on it: the board is
            the widest object on the page and is allowed to say so. */}
        <Reveal delay={0.1} className="mt-group">
          <div className="mx-auto w-full max-w-[88rem] px-5 sm:px-8">
            <ProjectsSurface />
          </div>
        </Reveal>
      </section>

      {/* ── Two more, side by side ─────────────────────────────────────────
          Dense, tinted, and two-up — a deliberately different rhythm from the
          single large board above it. */}
      <Section tone="surface" density="dense" width="wide" aria-labelledby="more">
        <SectionHeading
          id="more"
          eyebrow="And the rest of it"
          title="People and finance, on the same record."
          description="Attendance feeds the timesheet. The timesheet feeds the invoice. Nothing is retyped, and nothing is reconciled at month end."
        />

        <RevealGroup className="mt-group grid gap-comp lg:grid-cols-2" step={0.06}>
          <AttendanceSurface />
          <FinanceSurface />
        </RevealGroup>
      </Section>

      {/* ── Modules ───────────────────────────────────────────────────────
          A rule-topped grid, not eight cards. Cards would give eight items
          eight borders and eight shadows, which is a lot of furniture for a
          list — and it is a list. */}
      <Section aria-labelledby="modules">
        <SectionHeading
          id="modules"
          eyebrow="What it holds"
          title="Eight modules, one database, one permission model."
          description="Not eight products behind a shared login. The same records, visible to the departments entitled to see them."
        />

        <RevealGroup
          className="mt-group grid gap-x-block gap-y-comp sm:grid-cols-2 lg:grid-cols-4"
          step={0.04}
        >
          {modules.map(({ icon: Icon, name, line, detail }) => (
            <div
              key={name}
              className="border-hairline hover:border-hairline-strong group border-t pt-comp transition-colors"
            >
              <Icon className="text-copy-2 size-[1.125rem]" strokeWidth={1.9} />
              <h3 className="text-title mt-pair">{name}</h3>
              <p className="text-copy-2 text-body-sm mt-label">{line}</p>
              <p className="text-copy-3 text-label mt-pair uppercase">{detail}</p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── The structural argument ───────────────────────────────────────
          The one place on the page where a diagram earns its space, because
          the claim is about relationships and a feature list cannot show a
          relationship. */}
      <Section tone="surface" density="dense" aria-labelledby="one-record">
        <div className="grid items-center gap-block md:grid-cols-2 md:gap-[4rem]">
          <Reveal>
            <Eyebrow>The difference</Eyebrow>
            <h2 id="one-record" className="text-display-2 text-balance-hero mt-pair">
              A suite can’t do this. Only one database can.
            </h2>
            <p className="text-copy-2 text-body text-pretty-body mt-comp">
              Open the invoice from the project. Open the project from the deal.
              Open the deal from the message where somebody mentioned it. Nothing
              is copied, nothing is synced, and nothing is waiting on a webhook —
              it is the same row, reached from wherever you happened to be.
            </p>
            <p className="text-copy-2 text-body mt-row">
              Permissions travel with it. Someone who cannot see finance does not
              see the amount, from any direction they arrive.
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <ol className="border-hairline bg-background rounded-surface shadow-e1 divide-hairline divide-y overflow-hidden border">
              {chain.map((row, i) => (
                <li key={row.k} className="flex items-center gap-pair px-comp py-3.5">
                  <span
                    aria-hidden="true"
                    className="text-copy-3 w-4 shrink-0 text-label tabular-nums"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="w-[5rem] shrink-0 text-caption font-semibold">
                    {row.k}
                  </span>
                  <span className="text-copy-2 min-w-0 flex-1 truncate text-caption">
                    {row.v}
                  </span>
                  <span className="border-hairline text-copy-3 text-label hidden shrink-0 rounded-full border px-2 py-0.5 uppercase sm:block">
                    {row.m}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-copy-3 text-caption mt-pair text-center">
              Five records. One customer. No export in between.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* ── Foundations ───────────────────────────────────────────────────
          Numbered, not iconed-in-a-tile. An icon in a soft circle is the most
          reliable signature of a generated feature grid, and these six are
          claims to be checked rather than features to be browsed — so they
          are set as a numbered list of arguments. */}
      <Section aria-labelledby="foundations">
        <SectionHeading
          id="foundations"
          eyebrow="Why you can put the company in it"
          title="The parts nobody demos, which decide whether you can deploy it."
          description="Six things worth checking in any system that will hold your customer list and your payroll. Each is demonstrable in a trial account."
        />

        <RevealGroup
          className="mt-group grid gap-x-block gap-y-comp md:grid-cols-2 lg:grid-cols-3"
          step={0.04}
        >
          {foundations.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="border-hairline border-t pt-comp">
              <div className="flex items-center gap-pair">
                <span className="text-copy-3 text-label tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Icon className="text-copy-2 size-4" strokeWidth={1.9} />
              </div>
              <h3 className="text-title mt-pair">{title}</h3>
              <p className="text-copy-2 text-body-sm mt-label">{body}</p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Close ─────────────────────────────────────────────────────────
          Ink again, and the second time is deliberate: the page opened its
          argument on ink and closes it there, so the two dark bands bracket
          everything between them. */}
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
