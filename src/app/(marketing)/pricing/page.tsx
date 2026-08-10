import Link from 'next/link';
import type { Metadata } from 'next';
import { Check, Minus, ArrowUpRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal } from '@/components/marketing/reveal';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Pricing — NextMav',
  description:
    'Flat monthly pricing by team size. Every module on every plan. Fourteen days free, no card.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Pricing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Two things the old page sold that do not exist ───────────────────────
 *
 *  **"White-label options"**, listed under Enterprise. This product is
 *  deliberately not white-label, and not by omission — `lib/platform.ts`,
 *  `components/layout/platform-mark.tsx` and `lib/org-settings.ts` each
 *  document the boundary at length, `security:check` fails the build if the
 *  application shell reads tenant branding, and migration 0021 went through
 *  and *removed* the two settings (`show_logo_in_sidebar`, `login_message`)
 *  that would have made it possible. The pricing page was selling the one
 *  capability the architecture is explicitly built to refuse.
 *
 *  **"SSO / SAML"**, listed under Enterprise and given its own row in the
 *  comparison table. There is no SSO or SAML anywhere in the codebase. It is
 *  also, reliably, the first thing an enterprise buyer asks about — so it was
 *  the claim most certain to be tested, on the plan where being caught costs
 *  the most.
 *
 *  Both are gone. A pricing page is the most literal document on a website:
 *  everything on it is read as a term of the agreement, and a feature listed
 *  beside a price is a thing somebody has paid for.
 *
 *  ── The strikethrough list ───────────────────────────────────────────────
 *
 *  Starter carried three items rendered in `line-through` grey — "No HR
 *  module", "No advanced automations", "No custom fields". Telling the
 *  cheapest customer what they are not getting, in the moment they are
 *  deciding to buy, is a strange use of the only space on the page they are
 *  reading closely. What each plan does include is stated positively; the
 *  differences live in the comparison table, where somebody has gone
 *  specifically to find them.
 *
 *  ── On the prices themselves ─────────────────────────────────────────────
 *
 *  Unchanged — $29, $79, custom. They are a commercial decision, not a design
 *  one. What changed is that the page now says what they buy: the old page
 *  showed "$29 /month" above "Up to 5 team members", which reads as flat-rate
 *  to some people and per-seat to others, and the difference between those two
 *  readings at 25 people is $79 against $1,975.
 */

const plans = [
  {
    name: 'Starter',
    price: '$29',
    unit: 'per month, flat',
    seats: 'Up to 5 people',
    description: 'A small team putting its first process somewhere permanent.',
    includes: [
      'All eight modules',
      '500 CRM contacts, 10 projects',
      'Real-time updates and search',
      'Data export from every module',
      '5 GB of file storage',
      'Email support',
    ],
    cta: 'Start free',
    href: '/signup',
    featured: false,
  },
  {
    name: 'Professional',
    price: '$79',
    unit: 'per month, flat',
    seats: 'Up to 25 people',
    description: 'A company running most of its operations in one place.',
    includes: [
      'Everything in Starter, without the record limits',
      'Custom fields and workflows',
      'Full audit trail, readable in-product',
      'Role-based permissions per module',
      '50 GB of file storage',
      'Priority support',
    ],
    cta: 'Start free',
    href: '/signup',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    unit: 'annual agreement',
    seats: 'Unlimited people',
    description: 'Larger deployments, procurement, and a contract to sign.',
    includes: [
      'Everything in Professional',
      'Unlimited storage and records',
      'A named account manager',
      'Onboarding and migration support',
      'A written availability commitment',
      'Security review and DPA',
    ],
    cta: 'Talk to us',
    href: '/contact',
    featured: false,
  },
];

type Cell = string | boolean;

const comparison: { group: string; rows: { name: string; values: [Cell, Cell, Cell] }[] }[] = [
  {
    group: 'Scale',
    rows: [
      { name: 'People', values: ['5', '25', 'Unlimited'] },
      { name: 'CRM contacts', values: ['500', 'Unlimited', 'Unlimited'] },
      { name: 'Projects', values: ['10', 'Unlimited', 'Unlimited'] },
      { name: 'File storage', values: ['5 GB', '50 GB', 'Unlimited'] },
    ],
  },
  {
    group: 'Modules',
    rows: [
      // Every module on every plan. Gating whole departments behind a tier is
      // how a "system of record" becomes a system of record for the part of
      // the company that could afford it.
      { name: 'CRM, Projects, Calendar', values: [true, true, true] },
      { name: 'People, Finance, Inventory', values: [true, true, true] },
      { name: 'Communication, Support', values: [true, true, true] },
      { name: 'Client portal', values: [true, true, true] },
    ],
  },
  {
    group: 'Platform',
    rows: [
      { name: 'Role-based permissions', values: [true, true, true] },
      { name: 'Row-level tenant isolation', values: [true, true, true] },
      { name: 'Real-time updates', values: [true, true, true] },
      { name: 'Data export', values: [true, true, true] },
      { name: 'Audit trail', values: [false, true, true] },
      { name: 'Custom fields and workflows', values: [false, true, true] },
    ],
  },
  {
    group: 'Working with us',
    rows: [
      { name: 'Support', values: ['Email', 'Priority', 'Named contact'] },
      { name: 'Onboarding help', values: [false, false, true] },
      { name: 'Availability commitment', values: [false, false, true] },
      { name: 'Security review and DPA', values: [false, false, true] },
    ],
  },
];

/**
 * The questions that actually decide the purchase.
 *
 * None of these were answered anywhere on the old site. Two of them —
 * what happens at the seat limit, and what happens to the data if you leave —
 * are the ones a careful buyer asks first and the ones a pricing page most
 * often avoids.
 */
const faqs = [
  {
    q: 'Is the trial limited?',
    a: 'No. Fourteen days with every module and no card. We would rather you found out in week one that it does not fit than in month three.',
  },
  {
    q: 'What happens when we pass a plan’s limit?',
    a: 'Nothing stops working and nothing is deleted. We tell you, and you move up when you are ready. Locking a company out of its own records over a billing threshold is not a business we want to be in.',
  },
  {
    q: 'Can we get our data out?',
    a: 'Structured export from every module, at any time, without asking us — on every plan, including the trial. It is listed as a feature because plenty of software does not do it, not because it should be remarkable.',
  },
  {
    q: 'Do you support SSO or SAML?',
    a: 'Not yet, and we would rather say so here than in a procurement call. If it is a requirement, tell us — it changes what we build next, and we will be straight with you about timing.',
  },
  {
    q: 'Can we white-label it for our customers?',
    a: 'No, and this is a deliberate design decision rather than a missing feature. Your branding appears throughout your client portal, invoices and exports — the things your customers see. The application your team signs into stays NextMav, so that support conversations start from the same screen for everyone.',
  },
  {
    q: 'How do we move off our current tools?',
    a: 'Import contacts, employees, products and projects from CSV. For anything more involved, talk to us before you start — the order you turn modules on in matters more than the import itself.',
  },
];

/**
 * On every plan, so it does not need saying three times.
 *
 * Six identical lines repeated across three cards is most of what makes a
 * pricing grid unreadable — the eye cannot find the differences because the
 * similarities are taking up the same space. Pulling them into one strip lets
 * each card carry only what distinguishes it, and states the page's actual
 * argument in one place: you are not buying departments one at a time.
 */
const everyPlan = [
  'All eight core modules',
  'Role-based permissions',
  'Row-level tenant isolation',
  'Real-time updates',
  'Data export from every module',
  'Fourteen days free, no card',
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <Check className="text-copy mx-auto size-4" strokeWidth={2.4} aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus className="text-n-6 mx-auto size-4" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

export default function PricingPage() {
  return (
    <>
      <Container className="pt-band pb-pair text-center sm:pt-[6rem]">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-pair">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="text-display-1 text-balance-hero">
            Priced by team size, not by module.
          </h1>
          <p className="text-copy-2 text-lede text-pretty-body mt-2">
            Every plan includes all eight core modules. You are not buying access
            to departments one at a time.
          </p>
        </Reveal>
      </Container>

      {/* ── Plans ────────────────────────────────────────────────────────── */}
      <Container className="py-block">
        <div className="grid gap-comp md:grid-cols-3">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.05} className="h-full">
              <div
                className={cn(
                  'rounded-surface relative flex h-full flex-col border p-comp sm:p-7',
                  plan.featured
                    ? // Weight, not scale. The old card used `scale-[1.02]`,
                      // which blurs text on non-retina displays and lifts the
                      // card out of the grid's baseline so all three headings
                      // stop aligning.
                      'border-ink bg-surface ring-ink shadow-e2 ring-1'
                    : 'border-hairline shadow-e1 bg-background',
                )}
              >
                {/* A rule along the top edge of the featured card. A second,
                    silent signal beside the ring and the badge — the plan a
                    reader is meant to land on should not depend on noticing a
                    one-pixel border colour. */}
                {plan.featured && (
                  <span
                    aria-hidden="true"
                    className="bg-ink absolute inset-x-0 top-0 h-[3px] rounded-t-[inherit]"
                  />
                )}

                <div className="flex items-center justify-between gap-pair">
                  <h2 className="text-title">{plan.name}</h2>
                  {plan.featured && (
                    <span className="bg-ink text-ink-fg text-label rounded-full px-2.5 py-1">
                      Most teams
                    </span>
                  )}
                </div>

                <p className="text-copy-2 text-body-sm mt-label">{plan.description}</p>

                <div className="mt-comp flex items-baseline gap-1.5">
                  <span className="text-display-2 tabular-nums">{plan.price}</span>
                  <span className="text-copy-2 text-body-sm">{plan.unit}</span>
                </div>
                <p className="text-copy-3 text-caption mt-1">{plan.seats}</p>

                <Button
                  asChild
                  variant={plan.featured ? 'cta' : 'ctaOutline'}
                  size="xl"
                  className="mt-comp w-full"
                >
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>

                <ul className="border-hairline mt-comp space-y-pair border-t pt-comp">
                  {plan.includes.map((item) => (
                    <li key={item} className="text-body-sm flex gap-pair">
                      {/* Tertiary, not accent. Eighteen accent ticks across
                          three cards is a texture; the accent budget on this
                          page is spent on nothing at all, which is correct —
                          the featured plan is carried by ink. */}
                      <Check
                        className="text-copy-3 mt-[0.3rem] size-3.5 shrink-0"
                        strokeWidth={2.6}
                        aria-hidden="true"
                      />
                      <span className="text-copy">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>

      {/* ── On every plan ────────────────────────────────────────────────
          The page's actual argument, stated once instead of three times. */}
      <Section tone="surface" density="interrupt" aria-labelledby="every-plan">
        <div className="grid gap-comp lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-block">
          <Reveal>
            <Eyebrow>On every plan</Eyebrow>
            <h2 id="every-plan" className="text-display-3 mt-pair">
              Nothing is held back by tier.
            </h2>
            <p className="text-copy-2 text-body-sm mt-row">
              Gating whole departments behind a price is how a system of record
              becomes a system of record for the part of the company that could
              afford it.
            </p>
          </Reveal>

          <div className="grid gap-x-block gap-y-pair sm:grid-cols-2 lg:pt-1">
            {everyPlan.map((item, i) => (
              <Reveal key={item} delay={Math.min(i, 5) * 0.03}>
                <div className="border-hairline text-body-sm flex items-center gap-pair border-b py-pair">
                  <Check
                    className="text-copy-3 size-3.5 shrink-0"
                    strokeWidth={2.6}
                    aria-hidden="true"
                  />
                  <span className="text-copy">{item}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Comparison ───────────────────────────────────────────────────── */}
      <Section aria-labelledby="compare">
        <SectionHeading
          id="compare"
          eyebrow="In detail"
          title="What differs between the plans."
          align="center"
        />

        <Reveal className="mt-group">
          {/* The wide table scrolls inside its own container rather than
              making the page scroll sideways on a phone. */}
          <div className="border-hairline bg-background rounded-surface shadow-e1 overflow-x-auto border">
            <table className="text-body-sm w-full min-w-[36rem]">
              <caption className="sr-only">
                Feature comparison across the Starter, Professional and
                Enterprise plans
              </caption>
              <thead>
                <tr className="border-hairline border-b">
                  <th scope="col" className="text-copy-3 text-label px-5 py-3.5 text-left uppercase">
                    Feature
                  </th>
                  {['Starter', 'Professional', 'Enterprise'].map((name) => (
                    <th
                      key={name}
                      scope="col"
                      className={cn(
                        'text-title px-5 py-3.5 text-center',
                        name === 'Professional' && 'bg-surface',
                      )}
                    >
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>

              {comparison.map((group) => (
                <tbody key={group.group}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={4}
                      className="border-hairline text-copy-3 text-label bg-surface-2 border-y px-5 py-2 text-left uppercase"
                    >
                      {group.group}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.name} className="border-hairline border-b last:border-b-0">
                      <th scope="row" className="text-copy px-5 py-3 text-left font-normal">
                        {row.name}
                      </th>
                      {row.values.map((value, i) => (
                        <td
                          key={i}
                          className={cn(
                            'px-5 py-3 text-center',
                            i === 1 && 'bg-surface font-medium',
                          )}
                        >
                          <CellValue value={value} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Reveal>
      </Section>

      {/* ── Questions ────────────────────────────────────────────────────
          A disclosure list, migrated from the second uploaded project — at six
          questions with answers this long, a flat list makes the reader scroll
          past five things they did not ask to reach the one they did.

          Built on `<details>` rather than on state. It is keyboard-operable,
          announced correctly as a disclosure, and findable by the browser's own
          in-page search with no `aria-expanded` to keep in sync — and it costs
          no `'use client'`, so this page stays static. The upload's version is
          a `<button>` with none of that wiring.

          The first is open on load: an accordion that is entirely closed reads
          as an empty page, and the trial question is the one most people came
          for. */}
      <Section tone="surface" aria-labelledby="faq">
        <SectionHeading
          id="faq"
          eyebrow="Before you decide"
          title="The questions that actually matter."
        />

        <div className="divide-hairline border-hairline mt-group divide-y border-y">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={Math.min(i, 4) * 0.03}>
              <details className="group" open={i === 0} name="pricing-faq">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-comp py-comp [&::-webkit-details-marker]:hidden">
                  <h3 className="text-title">{f.q}</h3>
                  <ChevronDown
                    className="text-copy-3 size-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="text-copy-2 text-body text-pretty-body pb-comp max-w-[46rem]">
                  {f.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="ink" density="interrupt" aria-labelledby="pricing-cta">
        <div className="flex flex-col items-start gap-group md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="pricing-cta" className="text-display-2 text-balance-hero max-w-xl">
              Still not sure it fits?
            </h2>
            <p className="text-copy-on-ink-2 text-body mt-pair max-w-lg">
              Tell us what you run today. If the answer is that you should not
              move yet, we will say so.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-pair">
            <Button asChild variant="onInk" size="xl">
              <Link href="/contact">
                Talk to us
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="ghost"
              className="text-ink-fg hover:bg-ink-fg/10 hover:text-ink-fg"
            >
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
