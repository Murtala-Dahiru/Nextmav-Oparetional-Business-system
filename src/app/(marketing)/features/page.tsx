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
import { EditorialImage, PHOTO } from '@/components/marketing/media';
import {
  CAPABILITIES,
  LIVE_CAPABILITIES,
  FORTHCOMING_CAPABILITIES,
} from '@/components/marketing/capabilities';
import { CapabilityCards, CapabilityRoadmap } from '@/components/marketing/capability-grid';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Platform — NextMav',
  description:
    'Sixteen capability areas on one database and one permission model — CRM, projects, people, finance, inventory, communication, support and more, with what is live and what is being built stated plainly.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Platform
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The two questions this page answers, in order ────────────────────────
 *
 *  A buyer evaluating an operating system for their company asks *breadth*
 *  first — does this cover what my company does — and only then asks *depth*
 *  — is the part I care about any good. An earlier version of this page
 *  answered only the second, with eight modules in sequence; the uploaded
 *  public-experience project answered only the first, with sixteen cards of
 *  equal weight. Neither alone is the page.
 *
 *  So: pillars, then the whole capability map with its status stated, then the
 *  core modules in depth with the product actually rendered, then the
 *  engineering the whole thing rests on.
 *
 *  ── On the capabilities that are not built yet ───────────────────────────
 *
 *  They are on the page, and each says where the line falls. The reasoning is
 *  in `capabilities.ts`; the short version is that deleting them made the
 *  product look smaller than it is, and printing them as shipped would be a
 *  promise a trial cannot keep. A stated roadmap is the normal artefact here —
 *  it is how a buyer plans a rollout — and it is the only version of this that
 *  is both rich and true.
 *
 *  ── On the photography ───────────────────────────────────────────────────
 *
 *  Editorial, and graded through one treatment so six shoots read as one
 *  publication — see `media.tsx`. No photograph on this page is captioned with
 *  a person, a company or a result. That is the line, and it is a different
 *  line from "no photographs", which is what an earlier pass mistakenly drew.
 */

type Module = {
  id: string;
  icon: typeof Users;
  name: string;
  summary: string;
  holds: string[];
};

/**
 * The eight in depth.
 *
 * These are the core operational areas, not an exhaustive list of what the
 * workspace contains — the dashboard, personal work lists, the client portal
 * and administration are all real and are simply not what this section is for.
 * The heading says "core", which is why it can say eight without the number
 * becoming a claim about the whole product.
 */
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

const pillars = [
  {
    icon: Database,
    title: 'One database, not one login',
    body: 'Every capability reads the same rows. There is no synchronisation step because there is nothing to synchronise, and no integration to maintain between two halves of your own company.',
  },
  {
    icon: Network,
    title: 'Permissions come from the org',
    body: 'Roles are declared once and checked in the route on every request. What a person can see follows them into every module, and into the API, without being restated in each one.',
  },
  {
    icon: Link2,
    title: 'The link is the point',
    body: 'A deal opens the project it became; the project opens the invoice it produced. Those are relationships between rows, not exports between products — the one thing a suite of separate applications cannot reproduce.',
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
 * Each line is a named assertion in `scripts/security-check.mjs`, which is what
 * makes it printable — the difference between this and a trust badge is that a
 * reader can run the command. Row-level security is deliberately absent: it is
 * the second item in `platform` above, and a proof list that restates the
 * section beside it reads as padding.
 */
const architecture = [
  'Structured logging throughout, never console — and every request carries a correlation id from the proxy inward',
  'Rate limiting on all eight endpoints that accept or issue credentials, switchable by configuration rather than by deployment',
  'Unhandled failures captured framework-wide and recorded, and never described back to the caller in a 5xx',
  'Security headers on every response: framing denied outright, MIME sniffing off, referrer and permissions policies set',
];

const contents = [
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#roadmap', label: 'What we’re building' },
  { href: '#modules', label: 'The core modules' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#platform', label: 'Platform' },
];

export default function FeaturesPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Container className="pt-band pb-pair sm:pt-[6rem]">
        <div className="max-w-[44rem]">
          <Reveal>
            <Eyebrow>Platform</Eyebrow>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-display-1 text-balance-hero mt-pair">
              Sixteen capability areas. One database.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-copy-2 text-lede text-pretty-body mt-comp">
              Not a suite of products behind a shared login. The same records,
              the same permissions, the same audit trail — visible to the
              departments entitled to see them, and to nobody else. Ten areas are
              available today; the rest say exactly where they are.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.15}>
          <nav
            aria-label="On this page"
            className="border-hairline mt-block flex flex-wrap gap-x-comp gap-y-label border-t pt-comp"
          >
            {contents.map((c, i) => (
              <a
                key={c.href}
                href={c.href}
                className={cn(
                  'text-body-sm rounded-sm transition-colors',
                  // One accent on this screen, on the section a technical
                  // reader skips straight to.
                  i === contents.length - 1
                    ? 'text-brand font-medium'
                    : 'text-copy-2 hover:text-copy',
                )}
              >
                {c.label}
              </a>
            ))}
          </nav>
        </Reveal>
      </Container>

      {/* ── Pillars ──────────────────────────────────────────────────────
          Three statements of mechanism before any inventory. The page used to
          go from its headline straight into a list, which asks the reader to
          hold the *why* in their head while being handed the *what*. */}
      <Section tone="surface" density="dense" aria-labelledby="pillars">
        <h2 id="pillars" className="sr-only">
          Why one platform behaves differently from a suite
        </h2>
        <RevealGroup className="grid gap-x-block gap-y-comp md:grid-cols-3" step={0.05}>
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

      {/* ── How it works ─────────────────────────────────────────────────
          Migrated from the second upload, whose version of this split carried
          a photograph and three pillars. The pillars moved above; the image
          stays, because a page of pure text between here and the module list
          is where an enterprise site starts reading as documentation. */}
      <Section density="default" aria-labelledby="how">
        <div className="grid items-center gap-block lg:grid-cols-2 lg:gap-[4rem]">
          <Reveal>
            <EditorialImage
              src={PHOTO.analytics}
              alt="A wall of screens showing charts and operational readouts"
              ratio="photo"
              eyebrow="One operational layer"
              caption="Every figure on this page comes out of the same rows the work is done in."
              sizes="(min-width: 1024px) 46vw, 92vw"
            />
          </Reveal>
          <Reveal delay={0.05}>
            <Eyebrow>How it fits together</Eyebrow>
            <h2 id="how" className="text-display-2 text-balance-hero mt-pair">
              One system where the departments already agree.
            </h2>
            <p className="text-copy-2 text-lede text-pretty-body mt-comp">
              Most organisations run seven or more tools that each hold a partial
              copy of the same company. The cost is not the licences — it is the
              duplicated records, the broken handoffs, and the approvals that
              disappear between inboxes.
            </p>
            <p className="text-copy-2 text-body mt-row">
              NextMav replaces them with one operational layer, where a person, a
              customer, a project and the money attached to them are the same
              rows seen from different angles.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* ── Capability map ───────────────────────────────────────────────
          Breadth, with status. Available first as cards, then what is being
          built as a denser register — the difference in density is the
          hierarchy, and it is why sixteen items do not read as sixteen
          identical boxes. */}
      <Section tone="surface" density="default" aria-labelledby="capabilities">
        <SectionHeading
          id="capabilities"
          eyebrow={`Available today · ${LIVE_CAPABILITIES.length} of ${CAPABILITIES.length}`}
          title="What a workspace can do the day you open it."
          description="Every area below is usable in a trial account, by anyone with the role for it, without contacting us first."
        />
        <CapabilityCards items={LIVE_CAPABILITIES} className="mt-group" />

        <div className="mt-open">
          <Reveal>
            <Eyebrow>In development</Eyebrow>
            <h2 id="roadmap" className="text-display-3 mt-pair max-w-[34rem]">
              What we’re building, and where each one currently stands.
            </h2>
            <p className="text-copy-2 text-body text-pretty-body mt-row max-w-[42rem]">
              Published because a rollout has to be planned against something.
              Four of the six below are already partly usable — approvals,
              organization structure, purchase orders and file storage all exist
              today inside other modules — and each entry says which part.
            </p>
          </Reveal>
          <CapabilityRoadmap items={FORTHCOMING_CAPABILITIES} className="mt-group" />
        </div>
      </Section>

      {/* ── The core modules, in depth ────────────────────────────────────
          Alternating, so a reader cannot fall into a rhythm and stop reading —
          which is exactly what the eighteen identical cards this page began
          life as produced. */}
      <Container className="pt-open pb-block">
        <Reveal>
          <Eyebrow>In depth</Eyebrow>
          <h2 id="modules" className="text-display-2 text-balance-hero mt-pair max-w-[34rem]">
            The eight core modules, and what each one actually holds.
          </h2>
          <p className="text-copy-2 text-lede text-pretty-body mt-comp max-w-[42rem]">
            The operational centre of the workspace. The dashboard, personal work
            lists, the client portal and administration sit alongside these and
            are covered in the capability map above.
          </p>
        </Reveal>
        <div className="mt-group">
          <ModuleList items={modules.slice(0, 4)} offset={0} />
        </div>
      </Container>

      {/* ── The product, mid-page ────────────────────────────────────────
          A long list needs a place to stop, and these are the two screens the
          People and Finance entries have just described. */}
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

      {/* ── Remaining four ───────────────────────────────────────────────── */}
      <Container className="py-block">
        <ModuleList items={modules.slice(4)} offset={4} />
      </Container>

      {/* ── Architecture ─────────────────────────────────────────────────
          Ink, and a change of register: this is the section written for
          whoever the buyer forwards the page to. */}
      <Section tone="ink" density="dense" aria-labelledby="architecture">
        <div className="grid items-center gap-block lg:grid-cols-[1.1fr_1fr] lg:gap-[4rem]">
          <Reveal>
            <Eyebrow className="text-copy-on-ink-2">Architecture</Eyebrow>
            <h2 id="architecture" className="text-display-2 text-balance-hero mt-pair">
              Written down, and checked on every commit.
            </h2>
            <p className="text-copy-on-ink-2 text-body text-pretty-body mt-comp">
              The four below are not aspirations and they are not a badge. Each is
              a named assertion in the repository’s own security gate, which fails
              the build rather than filing a warning.
            </p>

            <div className="mt-group flex flex-col">
              {architecture.map((line) => (
                <div
                  key={line}
                  className="border-ink-fg/15 flex gap-pair border-b py-row last:border-b-0"
                >
                  {/* Tertiary on ink, not accent. Four coloured marks in a
                      column is a texture, and a texture emphasises nothing. */}
                  <Check
                    className="text-copy-on-ink-2 mt-1 size-4 shrink-0"
                    strokeWidth={2.4}
                    aria-hidden="true"
                  />
                  <span className="text-body">{line}</span>
                </div>
              ))}
            </div>

            <p className="text-copy-on-ink-2 text-label mt-comp uppercase">
              npm run security:check
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <EditorialImage
              src={PHOTO.engineering}
              alt="Source code on a dark screen"
              ratio="photo"
              tone="deep"
              sizes="(min-width: 1024px) 44vw, 92vw"
              className="border-ink-fg/15"
            />
          </Reveal>
        </div>
      </Section>

      {/* ── Platform guarantees ─────────────────────────────────────────
          `id="platform"` is the destination of the footer's "Security" link.
          Named here rather than promised by a link to a page that does not
          exist, which is what the old footer did four separate times. */}
      <Section id="platform" density="default" aria-labelledby="platform-heading">
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

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <Section tone="surface" density="interrupt" aria-labelledby="features-cta">
        <div className="flex flex-col items-start gap-group md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="features-cta" className="text-display-2 text-balance-hero max-w-xl">
              See it against your own data.
            </h2>
            <p className="text-copy-2 text-body mt-pair max-w-lg">
              Fourteen days, every available module, no card. Import a customer
              list and judge it on that rather than on this page.
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
 * Extracted because the list is interrupted by the product surfaces at its
 * midpoint, and `offset` keeps the left/right alternation continuous across the
 * break — restarting it would put two identical orientations either side of the
 * interruption, which is the one place it would be visible.
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
              <h3 className="text-display-3 mt-pair">{name}</h3>
              <p className="text-copy-2 text-body text-pretty-body mt-row max-w-md">
                {summary}
              </p>
            </div>

            <ul className="space-y-pair md:pt-2">
              {holds.map((line) => (
                <li key={line} className="text-body flex gap-pair">
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
