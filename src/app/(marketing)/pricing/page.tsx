import Link from 'next/link';
import type { Metadata } from 'next';
import { Check, ArrowRight, ChevronDown, Sparkles } from 'lucide-react';
import { Container, Section, Eyebrow, buttonClass } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';

export const metadata: Metadata = {
  title: 'Pricing — NextMav',
  description:
    'Flat monthly pricing by team size. Every available module on every plan. Fourteen days free, no card.',
};

/**
 * The uploaded project's Pricing page, ported.
 *
 * Dark page hero, three plan cards with a "Most popular" badge and ticked
 * features, a full comparison table, an FAQ accordion, closing CTA — the
 * upload's sections and class names, so `pages.css` applies as written.
 *
 * ── What changed, and why ────────────────────────────────────────────────
 *
 * **The prices are this product's, not the upload's.** The upload prints
 * "$12 per user / month", which was invented — real pricing is still open as
 * CONTENT-NEEDED #5. These three (flat monthly by team size) are the ones
 * already agreed here, and the unit is spelled out because "$29 /month" above
 * "up to 5 people" reads as flat-rate to some people and per-seat to others,
 * and at 25 people the difference between those readings is $79 against $1,975.
 *
 * **Two rows are gone from the comparison.** The upload gates "SSO & session
 * management" and "Multi-organization support" behind Enterprise. There is no
 * SSO in this codebase, and it is reliably the first thing an enterprise buyer
 * asks about — the claim most certain to be tested, on the plan where being
 * caught costs the most. Session management exists and is on every plan.
 *
 * **The accordion is `<details>`, not React state.** Keyboard-operable,
 * announced as a disclosure, findable by the browser's own in-page search, and
 * it costs no `'use client'` — so this page still prerenders static. The
 * upload's is a `<button>` with no `aria-expanded` and no `aria-controls`.
 */

const PLANS = [
  {
    name: 'Starter',
    desc: 'A small team putting its first process somewhere permanent.',
    price: '$29',
    unit: 'per month, flat',
    seats: 'Up to 5 people',
    featured: false,
    features: [
      'Every available module',
      '500 CRM contacts, 10 projects',
      'Real-time updates and search',
      'Data export from every module',
      '5 GB of file storage',
      'Email support',
    ],
    cta: 'Start free',
    href: '/signup',
  },
  {
    name: 'Professional',
    desc: 'A company running most of its operations in one place.',
    price: '$79',
    unit: 'per month, flat',
    seats: 'Up to 25 people',
    featured: true,
    features: [
      'Everything in Starter, without the record limits',
      'Custom fields and workflows',
      'Full audit trail, readable in-product',
      'Role-based permissions per module',
      '50 GB of file storage',
      'Priority support',
    ],
    cta: 'Start free',
    href: '/signup',
  },
  {
    name: 'Enterprise',
    desc: 'Larger deployments, procurement, and a contract to sign.',
    price: 'Custom',
    unit: 'annual agreement',
    seats: 'Unlimited people',
    featured: false,
    features: [
      'Everything in Professional',
      'Unlimited storage and records',
      'A named account manager',
      'Onboarding and migration support',
      'A written availability commitment',
      'Security review and DPA',
    ],
    cta: 'Talk to us',
    href: '/contact',
  },
];

type Cell = string | boolean;

const COMPARE: { group: string; rows: { label: string; values: [Cell, Cell, Cell] }[] }[] = [
  {
    group: 'Scale',
    rows: [
      { label: 'People', values: ['5', '25', 'Unlimited'] },
      { label: 'CRM contacts', values: ['500', 'Unlimited', 'Unlimited'] },
      { label: 'Projects', values: ['10', 'Unlimited', 'Unlimited'] },
      { label: 'File storage', values: ['5 GB', '50 GB', 'Unlimited'] },
    ],
  },
  {
    group: 'Modules',
    rows: [
      // Every module on every plan. Gating whole departments behind a tier is
      // how a "system of record" becomes a system of record for the part of the
      // company that could afford it.
      { label: 'CRM, Projects, Calendar', values: [true, true, true] },
      { label: 'People, Finance, Inventory', values: [true, true, true] },
      { label: 'Communication, Support', values: [true, true, true] },
      { label: 'Client portal', values: [true, true, true] },
    ],
  },
  {
    group: 'Platform',
    rows: [
      { label: 'Role-based permissions', values: [true, true, true] },
      { label: 'Row-level tenant isolation', values: [true, true, true] },
      { label: 'Session policy & revocation', values: [true, true, true] },
      { label: 'Real-time updates', values: [true, true, true] },
      { label: 'Data export', values: [true, true, true] },
      { label: 'Audit trail', values: [false, true, true] },
      { label: 'Custom fields and workflows', values: [false, true, true] },
    ],
  },
  {
    group: 'Support',
    rows: [
      { label: 'Email support', values: [true, true, true] },
      { label: 'Priority response', values: [false, true, true] },
      { label: 'Named account manager', values: [false, false, true] },
      { label: 'Onboarding & migration', values: [false, false, true] },
    ],
  },
];

const FAQS = [
  {
    q: 'Is the trial limited?',
    a: 'No. Fourteen days with every available module and no card. We would rather you found out in week one that it does not fit than in month three.',
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
    a: 'No, and this is a deliberate design decision rather than a missing feature. Your branding appears throughout your client portal, invoices and exports — the things your customers see. The application your team signs into stays NextMav, so support conversations start from the same screen for everyone.',
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
        <Check size={18} className="nm-compare-yes" aria-hidden="true" />
        <span className="nm-sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <span className="nm-compare-no" aria-hidden="true">
          —
        </span>
        <span className="nm-sr-only">Not included</span>
      </>
    );
  }
  return <span className="nm-mono">{value}</span>;
}

export default function PricingPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            Pricing that scales with{' '}
            <span className="nm-serif">your organization.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            Priced by team size, not by module. Every plan includes the same
            connected architecture — no feature silos, no bolt-ons, and no
            department locked behind a tier.
          </p>
          <div className="nm-page-hero-actions">
            <Link href="/signup" className={buttonClass('primary', 'lg')}>
              Get started <ArrowRight size={16} />
            </Link>
            <Link href="/contact" className={buttonClass('secondary', 'lg', 'nm-btn-dark-secondary')}>
              Talk to sales
            </Link>
          </div>
        </Container>
      </section>

      <Section aria-labelledby="plans">
        <Container>
          <h2 id="plans" className="nm-sr-only">
            Plans
          </h2>
          <div className="nm-pricing-grid">
            {PLANS.map((plan) => (
              <ScrollReveal key={plan.name}>
                <div className={`nm-price-card ${plan.featured ? 'nm-price-card-featured' : ''}`}>
                  {plan.featured && (
                    <div className="nm-price-card-badge">
                      <Sparkles size={12} />
                      Most popular
                    </div>
                  )}
                  <div className="nm-price-card-name">{plan.name}</div>
                  <div className="nm-price-card-desc">{plan.desc}</div>
                  <div className="nm-price-card-amount">
                    <span className="nm-price-card-amount-val">{plan.price}</span>
                    <span className="nm-price-card-amount-unit">{plan.unit}</span>
                  </div>
                  <div className="nm-price-card-desc" style={{ marginTop: 'calc(-1 * var(--nm-space-2))' }}>
                    {plan.seats}
                  </div>
                  <div className="nm-price-card-features">
                    {plan.features.map((feature) => (
                      <span key={feature} className="nm-price-card-feature">
                        <Check size={16} className="nm-price-card-check" aria-hidden="true" />
                        {feature}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={plan.href}
                    className={buttonClass(
                      plan.featured ? 'primary' : 'secondary',
                      'lg',
                      'nm-price-card-cta nm-auth-submit',
                    )}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </ScrollReveal>
            ))}
          </div>
          <p
            className="nm-lead"
            style={{ textAlign: 'center', marginTop: 'var(--nm-space-8)', fontSize: 'var(--nm-text-sm)' }}
          >
            Fourteen days free on any plan. No card, and nothing held back during
            the trial.
          </p>
        </Container>
      </Section>

      <Section className="nm-pricing-compare" aria-labelledby="compare">
        <Container>
          <ScrollReveal className="nm-pricing-compare-head">
            <Eyebrow>Compare plans</Eyebrow>
            <h2 id="compare" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
              Everything included,{' '}
              <span className="nm-text-gradient">side by side.</span>
            </h2>
          </ScrollReveal>
          <ScrollReveal>
            {/* Scrolls inside its own container rather than making the page
                scroll sideways on a phone. */}
            <div className="nm-compare-table-wrap">
              <table className="nm-compare-table">
                <caption className="nm-sr-only">
                  Feature comparison across the Starter, Professional and
                  Enterprise plans
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="nm-compare-th-label">
                      Capability
                    </th>
                    <th scope="col" className="nm-compare-th">
                      Starter
                    </th>
                    <th scope="col" className="nm-compare-th nm-compare-th-featured">
                      Professional
                    </th>
                    <th scope="col" className="nm-compare-th">
                      Enterprise
                    </th>
                  </tr>
                </thead>
                {COMPARE.map((group) => (
                  <tbody key={group.group}>
                    <tr>
                      <th scope="colgroup" colSpan={4} className="nm-compare-td-label">
                        <span className="nm-section-num">{group.group}</span>
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className="nm-compare-td-label">
                          {row.label}
                        </th>
                        <td className="nm-compare-td">
                          <CellValue value={row.values[0]} />
                        </td>
                        <td className="nm-compare-td nm-compare-td-featured">
                          <CellValue value={row.values[1]} />
                        </td>
                        <td className="nm-compare-td">
                          <CellValue value={row.values[2]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </ScrollReveal>
        </Container>
      </Section>

      <Section className="nm-pricing-faq" aria-labelledby="faq">
        <Container width="narrow">
          <ScrollReveal className="nm-pricing-faq-head">
            <Eyebrow>FAQ</Eyebrow>
            <h2 id="faq" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
              Questions, <span className="nm-serif">answered.</span>
            </h2>
          </ScrollReveal>
          <div className="nm-faq">
            {FAQS.map((faq, i) => (
              <ScrollReveal key={faq.q}>
                {/* The first is open on load: an accordion that is entirely
                    closed reads as an empty page, and the trial question is the
                    one most people came for. */}
                <details className="nm-faq-item" open={i === 0}>
                  <summary className="nm-faq-q">
                    <span>{faq.q}</span>
                    <ChevronDown size={18} className="nm-faq-chevron" aria-hidden="true" />
                  </summary>
                  <div className="nm-faq-a-wrap">
                    <p className="nm-faq-a">{faq.a}</p>
                  </div>
                </details>
              </ScrollReveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="nm-closing" size="lg" aria-labelledby="pricing-cta">
        <div className="nm-closing-bg">
          <div className="nm-closing-glow" />
          <div className="nm-grid-bg nm-grid-bg-dot" />
        </div>
        <Container width="narrow">
          <ScrollReveal className="nm-closing-inner">
            <h2 id="pricing-cta" className="nm-display-lg nm-closing-title">
              Start free.{' '}
              <span className="nm-serif nm-text-gradient">Upgrade when ready.</span>
            </h2>
            <p className="nm-lead-lg nm-closing-lead">
              No credit card required. The full platform is one upgrade away, and
              your data comes back out whenever you ask.
            </p>
            <div className="nm-closing-actions">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Get started <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className={buttonClass('secondary', 'lg', 'nm-btn-dark-secondary')}>
                Talk to sales
              </Link>
            </div>
          </ScrollReveal>
        </Container>
      </Section>
    </>
  );
}
