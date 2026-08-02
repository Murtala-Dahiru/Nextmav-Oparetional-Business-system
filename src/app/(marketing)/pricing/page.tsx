import Link from 'next/link';
import type { Metadata } from 'next';
import { Check, Minus, ArrowUpRight } from 'lucide-react';
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

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <Check className="text-brand mx-auto size-4" strokeWidth={2.4} aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus className="text-muted-foreground/40 mx-auto size-4" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

export default function PricingPage() {
  return (
    <>
      <Container className="pt-16 pb-4 text-center sm:pt-24">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-5">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="text-display-1 text-balance-hero">
            Priced by team size, not by module.
          </h1>
          <p className="text-muted-foreground text-lede text-pretty-body">
            Every plan includes all eight modules. You are not buying access to
            departments one at a time.
          </p>
        </Reveal>
      </Container>

      {/* ── Plans ────────────────────────────────────────────────────────── */}
      <Container className="py-12 sm:py-16">
        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.05} className="h-full">
              <div
                className={cn(
                  'flex h-full flex-col rounded-2xl border p-7',
                  plan.featured
                    ? // Weight, not scale. The old card used `scale-[1.02]`,
                      // which blurs text on non-retina displays and lifts the
                      // card out of the grid's baseline so all three headings
                      // stop aligning.
                      'border-ink bg-surface ring-ink shadow-sm ring-1'
                    : 'border-hairline',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[1.0625rem] font-semibold tracking-[-0.02em]">
                    {plan.name}
                  </h2>
                  {plan.featured && (
                    <span className="bg-ink text-ink-fg rounded-full px-2.5 py-1 text-[0.6875rem] font-medium">
                      Most teams
                    </span>
                  )}
                </div>

                <p className="text-muted-foreground mt-2 text-[0.875rem] leading-relaxed">
                  {plan.description}
                </p>

                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-[2.25rem] font-semibold tracking-[-0.035em] tabular-nums">
                    {plan.price}
                  </span>
                  <span className="text-muted-foreground text-[0.875rem]">
                    {plan.unit}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-[0.8125rem]">
                  {plan.seats}
                </p>

                <Button
                  asChild
                  variant={plan.featured ? 'cta' : 'ctaOutline'}
                  size="xl"
                  className="mt-6 w-full"
                >
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>

                <ul className="border-hairline mt-7 space-y-3 border-t pt-6">
                  {plan.includes.map((item) => (
                    <li key={item} className="flex gap-2.5 text-[0.875rem] leading-relaxed">
                      <Check
                        className="text-brand mt-[0.28rem] size-3.5 shrink-0"
                        strokeWidth={2.6}
                        aria-hidden="true"
                      />
                      <span className="text-foreground/85">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="text-muted-foreground mt-8 text-center text-[0.875rem]">
            Fourteen days free on any plan. No card, and nothing held back
            during the trial.
          </p>
        </Reveal>
      </Container>

      {/* ── Comparison ───────────────────────────────────────────────────── */}
      <Section tone="surface" aria-labelledby="compare">
        <SectionHeading
          id="compare"
          eyebrow="In detail"
          title="What differs between the plans."
          align="center"
        />

        <Reveal className="mt-12">
          {/* The wide table scrolls inside its own container rather than
              making the page scroll sideways on a phone. */}
          <div className="border-hairline bg-background overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[36rem] text-[0.875rem]">
              <caption className="sr-only">
                Feature comparison across the Starter, Professional and
                Enterprise plans
              </caption>
              <thead>
                <tr className="border-hairline border-b">
                  <th scope="col" className="text-muted-foreground px-5 py-3.5 text-left font-medium">
                    Feature
                  </th>
                  {['Starter', 'Professional', 'Enterprise'].map((name) => (
                    <th
                      key={name}
                      scope="col"
                      className={cn(
                        'px-5 py-3.5 text-center font-semibold',
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
                      className="border-hairline text-muted-foreground border-y px-5 py-2 text-left text-[0.75rem] font-semibold tracking-[0.04em] uppercase"
                    >
                      {group.group}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.name} className="border-hairline border-b last:border-b-0">
                      <th scope="row" className="text-foreground/85 px-5 py-3 text-left font-normal">
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

      {/* ── Questions ────────────────────────────────────────────────────── */}
      <Section aria-labelledby="faq">
        <SectionHeading
          id="faq"
          eyebrow="Before you decide"
          title="The questions that actually matter."
        />

        <div className="divide-hairline mt-12 grid divide-y">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={Math.min(i, 4) * 0.03}>
              <div className="grid gap-3 py-6 md:grid-cols-[0.8fr_1.2fr] md:gap-12">
                <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                  {f.q}
                </h3>
                <p className="text-muted-foreground text-pretty-body text-[0.9375rem] leading-relaxed">
                  {f.a}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="ink" density="tight" aria-labelledby="pricing-cta">
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="pricing-cta" className="text-display-3 max-w-xl">
              Still not sure it fits?
            </h2>
            <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed opacity-70">
              Tell us what you run today. If the answer is that you should not
              move yet, we will say so.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
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
