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
  KeyRound,
  ScrollText,
  ShieldCheck,
  TimerReset,
  Radio,
  DownloadCloud,
  Check,
  Database,
  Network,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal, RevealGroup } from '@/components/marketing/reveal';
import { AttendanceSurface, FinanceSurface } from '@/components/marketing/surfaces';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Product — NextMav',
  description:
    'Eight modules on one database and one permission model: CRM, projects, people, finance, inventory, communication, support and calendar.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Product
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this page already had right, and keeps ──────────────────────────
 *
 *  Eight real modules with four concrete specifics each — thirty-two lines
 *  drawn from tables and routes that exist. The second uploaded public-
 *  experience project offers twelve capability cards in their place, of which
 *  **seven describe software this product does not have** (procurement, an
 *  asset register, documents-as-a-module, a configurable approvals engine,
 *  predictive analytics, cost centres, SSO). A features page is the promise a
 *  trial gets measured against, so the truthful list wins and is not up for
 *  negotiation. The jump-link contents nav and the `#platform` anchor the
 *  footer depends on are kept for the same reason.
 *
 *  ── What the upload genuinely improved, and what came across ─────────────
 *
 *  Two things, both structural:
 *
 *    · **A pillar trio ahead of the detail.** Three statements of *why* one
 *      platform differs, before eight modules of *what*. Argument order, and
 *      it was the missing rung — the page used to go from a headline straight
 *      into a list. The upload's own three cite cost centres and a
 *      procurement-to-budget check, so the structure came and the copy did not.
 *
 *    · **An architecture band with a checklist.** The one place the upload's
 *      copy is verifiable *here*: structured logging, request tracing, rate
 *      limiting. Each item below is asserted by `scripts/security-check.mjs`,
 *      which is why the section can name the command that proves it.
 *
 *  Rejected: two more hotlinked stock photographs ("analytics dashboard",
 *  "code on a dark screen"), gradient headline text, and the glow orbs.
 *
 *  ── The craft pass, which is independent of the upload ───────────────────
 *
 *  This page was the last one still carrying the pre-token treatment: an
 *  accent icon tile on all eight modules, thirty-two accent ticks beside
 *  them, `opacity-70` and `text-foreground/85` doing the work of a text ramp,
 *  and about twenty arbitrary `text-[0.9375rem]` values where nine type tokens
 *  exist. Accent census on the old page ran past forty; the rule is three per
 *  viewport.
 *
 *  It also showed no product at all, while `AttendanceSurface` and
 *  `FinanceSurface` sat in `surfaces.tsx` with no importer anywhere in the
 *  repository. They belong here, and they are here now.
 */

type Module = {
  id: string;
  icon: typeof Users;
  name: string;
  summary: string;
  holds: string[];
};

const modules: Module[] = [
  {
    id: 'crm',
    icon: Users,
    name: 'CRM & sales',
    summary:
      'The customer, from first contact to signed deal, with the history attached rather than remembered.',
    holds: [
      'Leads, contacts and companies with custom fields',
      'A deal pipeline with stages you define, dragged between them',
      'Activities logged against the record they concern',
      'Deals that open the project and invoices they produced',
    ],
  },
  {
    id: 'projects',
    icon: FolderKanban,
    name: 'Projects',
    summary:
      'The work itself: who is doing it, what it depends on, and how much of it is left.',
    holds: [
      'Boards and task lists, with drag-and-drop ordering',
      'Milestones, progress and client approvals',
      'Comments and attachments on the task, not in an inbox',
      'Time logged against tasks and rolled up per project',
    ],
  },
  {
    id: 'people',
    icon: UserCog,
    name: 'People',
    summary:
      'The employee record, and the processes that touch it, in the same place as the work they do.',
    holds: [
      'Employee profiles, departments and reporting lines',
      'Leave requests with approval, balances and a holiday calendar',
      'Attendance, with the working pattern the workspace actually uses',
      'Invitations, roles, suspension and offboarding',
    ],
  },
  {
    id: 'finance',
    icon: Wallet,
    name: 'Finance',
    summary:
      'Money tied to the customer and project that caused it, so a number can always be explained.',
    holds: [
      'Invoices with line items, status and payment tracking',
      'Expenses with categories and approval',
      'Figures that reconcile because they share one source',
      'Export to the format your accountant asked for',
    ],
  },
  {
    id: 'inventory',
    icon: Boxes,
    name: 'Inventory',
    summary:
      'What you hold, where it is, and what is about to run out — before somebody promises it to a customer.',
    holds: [
      'Products, variants and stock levels per warehouse',
      'Movements, so a discrepancy has a history to read',
      'Suppliers and purchase orders',
      'Low-stock alerts on thresholds you set',
    ],
  },
  {
    id: 'communication',
    icon: MessagesSquare,
    name: 'Communication',
    summary:
      'The conversation beside the record it is about, instead of in a separate product with separate permissions.',
    holds: [
      'Channels and direct messages, delivered live',
      'File sharing, with retention the workspace controls',
      'Meetings, peer-to-peer between participants',
      'Search across everything you are entitled to see',
    ],
  },
  {
    id: 'support',
    icon: LifeBuoy,
    name: 'Support',
    summary:
      'Customer problems as tracked records with owners and clocks, visible to the people who can fix them.',
    holds: [
      'Tickets with priority, category and assignee',
      'Response targets assigned when the ticket is raised',
      'A client portal, where the customer sees only their own',
      'Tickets linked to the contact and company they came from',
    ],
  },
  {
    id: 'calendar',
    icon: CalendarDays,
    name: 'Calendar',
    summary:
      'One schedule, assembled from everything else, rather than a calendar nobody keeps up to date.',
    holds: [
      'Events, meetings and deadlines in one view',
      'Leave and holidays from the People module',
      'Project milestones as they move',
      'Per-person and per-team views',
    ],
  },
];

/**
 * The pillar trio, structure taken from the second upload.
 *
 * Three statements of the mechanism, before eight modules of inventory. Each
 * one is about something the reader can check rather than something they have
 * to believe, which is the same test every other proof block on this site is
 * held to.
 */
const pillars = [
  {
    icon: Database,
    title: 'One database, not one login',
    body: 'Every module reads the same rows. There is no synchronisation step because there is nothing to synchronise, and no integration to maintain between two halves of your own company.',
  },
  {
    icon: Network,
    title: 'Permissions come from the org, not the screen',
    body: 'Roles are declared once and checked in the route on every request. What a person can see follows them into every module, and into the API, without being restated in each one.',
  },
  {
    icon: Link2,
    title: 'The link is the point',
    body: 'A deal opens the project it became; the project opens the invoice it produced. Those are relationships between rows, not exports between products — which is the one thing a suite of separate applications cannot reproduce.',
  },
];

const platform = [
  {
    icon: KeyRound,
    title: 'Roles enforced in the route',
    body: 'Permissions are declared once and checked server-side on every request. Hiding a menu item is not access control — a request that should not succeed does not succeed, whether it came from the interface or from curl.',
  },
  {
    icon: ShieldCheck,
    title: 'Tenant isolation at the database',
    body: 'Row-level security on every table, so the workspace boundary is enforced beneath the application rather than by it. A mistake in a query cannot return another company’s rows.',
  },
  {
    icon: ScrollText,
    title: 'An audit trail administrators can read',
    body: 'Who changed which record, when, and what it said before. In the product, without a support request, because the people who need it during an incident cannot wait for us.',
  },
  {
    icon: TimerReset,
    title: 'Session policy that ends sessions',
    body: 'Idle and absolute timeouts, applied at the edge. Suspending a person revokes every session they hold immediately, rather than at the next token refresh.',
  },
  {
    icon: Radio,
    title: 'Real time, throughout',
    body: 'Records update in other people’s screens as they change. Not a polling loop on a timer — a subscription, so two people cannot spend an afternoon editing different versions of the same row.',
  },
  {
    icon: DownloadCloud,
    title: 'Export, on your terms',
    body: 'Structured export from every module, whenever you want it, without asking us. Software you cannot leave is not software you should put your company inside.',
  },
];

/**
 * The architecture checklist.
 *
 * Structure and subject taken from the second upload; every line rewritten to
 * something this repository actually asserts. Each of the four is a named check
 * in `scripts/security-check.mjs`, which is what makes it printable — the
 * difference between this and a trust badge is that a reader can run the
 * command.
 *
 * `Row-level security` is deliberately not repeated here. It is the second item
 * in `platform` above, and a proof list that restates the section before it
 * reads as padding.
 */
const architecture = [
  'Structured logging throughout, never console — and every request carries a correlation id from the proxy inward',
  'Rate limiting on all eight endpoints that accept or issue credentials, switchable by configuration rather than by deployment',
  'Unhandled failures captured framework-wide and recorded, and never described back to the caller in a 5xx',
  'Security headers on every response: framing denied outright, MIME sniffing off, referrer and permissions policies set',
];

export default function FeaturesPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Container className="pt-band pb-pair sm:pt-[6rem]">
        <div className="max-w-[44rem]">
          <Reveal>
            <Eyebrow>Product</Eyebrow>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-display-1 text-balance-hero mt-pair">
              Eight modules. One database.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-copy-2 text-lede text-pretty-body mt-comp">
              Not a suite of products behind a shared login. The same records,
              the same permissions, the same audit trail — visible to the
              departments entitled to see them, and to nobody else.
            </p>
          </Reveal>
        </div>

        {/* A contents list, because this is a long page and a reader
            evaluating software arrives wanting one specific module. */}
        <Reveal delay={0.15}>
          <nav
            aria-label="Modules"
            className="border-hairline mt-block flex flex-wrap gap-x-comp gap-y-label border-t pt-comp"
          >
            {modules.map((m) => (
              <a
                key={m.id}
                href={`#${m.id}`}
                className="text-copy-2 hover:text-copy text-body-sm rounded-sm transition-colors"
              >
                {m.name}
              </a>
            ))}
            {/* The one accent on this screen. It is the destination the rest of
                the nav is not: a section rather than a module. */}
            <a href="#platform" className="text-brand text-body-sm rounded-sm font-medium">
              Platform
            </a>
          </nav>
        </Reveal>
      </Container>

      {/* ── Pillars ──────────────────────────────────────────────────────
          Structure from the second upload. The page used to go from its
          headline straight into an eight-item inventory, which asks the reader
          to hold the *why* in their head while being given the *what*. */}
      <Section tone="surface" density="dense" aria-labelledby="pillars">
        <h2 id="pillars" className="sr-only">
          Why one platform behaves differently from a suite
        </h2>
        <RevealGroup
          className="grid gap-x-block gap-y-comp md:grid-cols-3"
          step={0.05}
        >
          {pillars.map(({ icon: Icon, title, body }, i) => (
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

      {/* ── Modules, first four ──────────────────────────────────────────
          Alternating. The point is not decoration — it is that a reader cannot
          fall into a rhythm and stop reading, which is exactly what the
          eighteen identical cards this page began life as produced.

          The accent icon tile that used to sit above each name is gone. An
          icon in a soft coloured circle is the most reliable signature of a
          generated feature grid, and eight of them put the accent eight times
          on a page whose rule is three per viewport. */}
      <Container className="pb-block">
        <ModuleList items={modules.slice(0, 4)} offset={0} />
      </Container>

      {/* ── The product, mid-page ────────────────────────────────────────
          A long list needs a place to stop, and the two screens below are the
          ones the People and Finance entries above have just described. Until
          this landed, both components existed in `surfaces.tsx` with no
          importer anywhere in the repository. */}
      <Section tone="surface" density="dense" width="wide" aria-labelledby="surfaces">
        <SectionHeading
          id="surfaces"
          eyebrow="Two of them, actually rendered"
          title="Attendance feeds the timesheet. The timesheet feeds the invoice."
          description="The same workspace, one department apart. Nothing between these two screens is retyped, and nothing is reconciled at month end."
        />
        <RevealGroup className="mt-group grid gap-comp lg:grid-cols-2" step={0.06}>
          <AttendanceSurface />
          <FinanceSurface />
        </RevealGroup>
      </Section>

      {/* ── Modules, remaining four ──────────────────────────────────────── */}
      <Container className="py-block">
        <ModuleList items={modules.slice(4)} offset={4} />
      </Container>

      {/* ── Platform ─────────────────────────────────────────────────────
          `id="platform"` is the destination of the footer's "Security" link.
          Named here rather than promised by a link to a page that does not
          exist, which is what the old footer did four separate times. */}
      <Section id="platform" tone="surface" aria-labelledby="platform-heading">
        <SectionHeading
          id="platform-heading"
          eyebrow="Platform"
          title="The part that decides whether you can actually deploy it."
          description="Every item here is demonstrable in a trial account. None of it is a badge."
        />

        <RevealGroup
          className="mt-group grid gap-x-block gap-y-comp md:grid-cols-2"
          step={0.04}
        >
          {platform.map(({ icon: Icon, title, body }) => (
            <div key={title} className="border-hairline flex gap-pair border-t pt-comp">
              <Icon
                className="text-copy-2 mt-1 size-[1.125rem] shrink-0"
                strokeWidth={1.9}
                aria-hidden="true"
              />
              <div>
                <h3 className="text-title">{title}</h3>
                <p className="text-copy-2 text-body-sm mt-label">{body}</p>
              </div>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Architecture ─────────────────────────────────────────────────
          Migrated from the second upload, on ink because it is a change of
          register — this is the section written for whoever the buyer forwards
          the page to. Its four claims are the four the upload made and the
          only ones of them that are true here, each rewritten against what the
          gate script actually asserts. */}
      <Section tone="ink" density="dense" aria-labelledby="architecture">
        <div className="grid gap-block md:grid-cols-[1fr_1.15fr] md:gap-[4rem]">
          <Reveal>
            <Eyebrow className="text-copy-on-ink-2">Architecture</Eyebrow>
            <h2 id="architecture" className="text-display-2 text-balance-hero mt-pair">
              Written down, and checked on every commit.
            </h2>
            <p className="text-copy-on-ink-2 text-body text-pretty-body mt-comp">
              The four below are not aspirations and they are not a badge. Each
              is a named assertion in the repository’s own security gate, which
              fails the build rather than filing a warning.
            </p>
            <p className="text-copy-on-ink-2 text-label mt-comp uppercase">
              npm run security:check
            </p>
          </Reveal>

          <RevealGroup className="flex flex-col" step={0.05}>
            {architecture.map((line) => (
              <div
                key={line}
                className="border-ink-fg/15 flex gap-pair border-b py-row last:border-b-0"
              >
                {/* Tertiary on ink, not `text-accent-on-ink`. Four of these
                    sit in one viewport, and the accent rule is three — the
                    same reason the module ticks two sections above are not
                    accent either. Four coloured marks in a column read as a
                    texture, and a texture emphasises nothing. */}
                <Check
                  className="text-copy-on-ink-2 mt-1 size-4 shrink-0"
                  strokeWidth={2.4}
                  aria-hidden="true"
                />
                <span className="text-body">{line}</span>
              </div>
            ))}
          </RevealGroup>
        </div>
      </Section>

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <Section tone="surface" density="interrupt" aria-labelledby="features-cta">
        <div className="flex flex-col items-start gap-group md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="features-cta" className="text-display-2 text-balance-hero max-w-xl">
              See it against your own data.
            </h2>
            <p className="text-copy-2 text-body mt-pair max-w-lg">
              Fourteen days, every module, no card. Import a customer list and
              judge it on that rather than on this page.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-pair">
            <Button asChild variant="cta" size="xl">
              <Link href="/signup">
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="ctaOutline" size="xl">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

/**
 * A run of module rows.
 *
 * Extracted because the list is now interrupted by the product surfaces at its
 * midpoint, and `offset` keeps the left/right alternation continuous across the
 * break — restarting it at the second run would put two identical orientations
 * either side of the interruption, which is the one place it would be visible.
 */
function ModuleList({ items, offset }: { items: Module[]; offset: number }) {
  return (
    <div className="divide-hairline divide-y">
      {items.map(({ id, icon: Icon, name, summary, holds }, i) => (
        <Reveal key={id} as="section" className="scroll-mt-24">
          <div
            id={id}
            className={cn(
              'grid gap-comp py-band md:grid-cols-2 md:gap-block',
              (i + offset) % 2 === 1 && 'md:[&>*:first-child]:order-2',
            )}
          >
            <div>
              <Icon
                className="text-copy-2 size-[1.125rem]"
                strokeWidth={1.9}
                aria-hidden="true"
              />
              <h2 className="text-display-3 mt-pair">{name}</h2>
              <p className="text-copy-2 text-body text-pretty-body mt-row max-w-md">
                {summary}
              </p>
            </div>

            <ul className="space-y-pair md:pt-2">
              {holds.map((line) => (
                <li key={line} className="text-body flex gap-pair">
                  {/* Tertiary, not accent. Thirty-two accent ticks on one page
                      is not emphasis, it is a texture. */}
                  <Check
                    className="text-copy-3 mt-[0.35rem] size-3.5 shrink-0"
                    strokeWidth={2.6}
                    aria-hidden="true"
                  />
                  <span className="text-copy">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
