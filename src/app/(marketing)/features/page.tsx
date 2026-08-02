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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal, RevealGroup } from '@/components/marketing/reveal';
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
 *  ── What was wrong ───────────────────────────────────────────────────────
 *
 *  Six sections, each a centred heading over three identical cards, each card
 *  an emerald icon tile above a name and one sentence. Eighteen cards. By the
 *  fourth section the reader has learned the template and stops reading the
 *  contents, which is the worst possible outcome on the page whose entire job
 *  is to describe what the product does.
 *
 *  It also described a different product from the one in this repository.
 *  "Gantt charts", "email campaigns", "50+ pre-built integrations",
 *  "satisfaction surveys", "onboarding checklists", "SSO/SAML", "SOC 2
 *  compliant" — none of these exist in the codebase. A features page is a
 *  promise a trial is measured against; every invented line on it converts a
 *  prospect into a disappointed one at the exact moment they were closest to
 *  buying.
 *
 *  ── What replaces it ─────────────────────────────────────────────────────
 *
 *  Eight modules, alternating left and right so the eye has to re-anchor and
 *  cannot skim on autopilot, each listing what it actually holds — drawn from
 *  the tables and routes that exist. Then the platform section, which is where
 *  the argument for an enterprise buyer actually lives.
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

export default function FeaturesPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Container className="pt-16 pb-4 sm:pt-24">
        <div className="max-w-[44rem]">
          <Reveal>
            <Eyebrow>Product</Eyebrow>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-display-1 text-balance-hero mt-5">
              Eight modules. One database.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-muted-foreground text-lede text-pretty-body mt-6">
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
            className="border-hairline mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t pt-6"
          >
            {modules.map((m) => (
              <a
                key={m.id}
                href={`#${m.id}`}
                className="text-muted-foreground hover:text-foreground rounded-sm text-[0.875rem] transition-colors"
              >
                {m.name}
              </a>
            ))}
            <a
              href="#platform"
              className="text-brand rounded-sm text-[0.875rem] font-medium"
            >
              Platform
            </a>
          </nav>
        </Reveal>
      </Container>

      {/* ── Modules ──────────────────────────────────────────────────────── */}
      <Container className="py-8 sm:py-12">
        <div className="divide-hairline divide-y">
          {modules.map(({ id, icon: Icon, name, summary, holds }, i) => (
            <Reveal key={id} as="section" className="scroll-mt-24">
              <div
                id={id}
                className={cn(
                  'grid gap-8 py-14 sm:py-16 md:grid-cols-2 md:gap-16',
                  // Alternating. The point is not decoration — it is that a
                  // reader cannot fall into a rhythm and stop reading, which
                  // is exactly what eighteen identical cards produced.
                  i % 2 === 1 && 'md:[&>*:first-child]:order-2',
                )}
              >
                <div>
                  <div className="bg-brand-soft text-brand ring-brand-line flex size-10 items-center justify-center rounded-lg ring-1">
                    <Icon className="size-[1.125rem]" strokeWidth={1.9} />
                  </div>
                  <h2 className="text-display-3 mt-5">{name}</h2>
                  <p className="text-muted-foreground text-pretty-body mt-4 max-w-md text-[0.9375rem] leading-relaxed">
                    {summary}
                  </p>
                </div>

                <ul className="space-y-3.5 md:pt-2">
                  {holds.map((line) => (
                    <li key={line} className="flex gap-3 text-[0.9375rem] leading-relaxed">
                      <Check
                        className="text-brand mt-[0.3rem] size-3.5 shrink-0"
                        strokeWidth={2.6}
                        aria-hidden="true"
                      />
                      <span className="text-foreground/85">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
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
          className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2"
          step={0.04}
        >
          {platform.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <Icon
                className="text-brand mt-1 size-[1.125rem] shrink-0"
                strokeWidth={1.9}
                aria-hidden="true"
              />
              <div>
                <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                  {title}
                </h3>
                <p className="text-muted-foreground mt-2 text-[0.875rem] leading-relaxed">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <Section tone="ink" density="tight" aria-labelledby="features-cta">
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="features-cta" className="text-display-3 max-w-xl">
              See it against your own data.
            </h2>
            <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed opacity-70">
              Fourteen days, every module, no card. Import a customer list and
              judge it on that rather than on this page.
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
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
