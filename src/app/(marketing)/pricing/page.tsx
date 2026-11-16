import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ChevronDown } from "lucide-react";
import {
  Container,
  Section,
  Eyebrow,
  buttonClass,
} from "@/components/public/ui";

export const metadata: Metadata = {
  title: "Pricing — NextMav",
  description:
    "Explore the proposed NextMav plans. Pricing, limits and commercial terms are provisional; self-service billing is not available.",
};
const PLANS = [
  {
    name: "Starter",
    label: "A focused starting point",
    amount: "$29",
    size: "Proposed for up to 5 people",
    description: "For a small team organizing its first shared workspace.",
  },
  {
    name: "Professional",
    label: "A broader team workspace",
    amount: "$79",
    size: "Proposed for up to 25 people",
    description: "For teams bringing everyday operations together.",
  },
  {
    name: "Enterprise",
    label: "A considered rollout",
    amount: "Discuss",
    size: "Scope and terms to be agreed",
    description: "For organizations evaluating a broader deployment.",
  },
];
const FAQS = [
  {
    q: "Can I purchase a plan here?",
    a: "Paid subscriptions are not available for purchase yet. The monthly figures are provisional; currency, tax treatment, usage limits and final commercial terms need confirmation before any commitment.",
  },
  {
    q: "Is there a fourteen-day trial?",
    a: "There is no active fourteen-day trial policy. Creating an account does not purchase a plan or start a paid subscription.",
  },
  {
    q: "What can I evaluate today?",
    a: "The product page labels each capability as available, partly available or planned. Industry presets and a configurable workflow engine are not part of current onboarding.",
  },
  {
    q: "Do you support SSO or SAML?",
    a: "SSO and SAML are not implemented. Include these requirements in your evaluation before committing to a rollout.",
  },
  {
    q: "What about larger deployments?",
    a: "Seat limits, storage allowances, migration services, support response times and availability commitments need agreed commercial terms. They are not guaranteed by the proposed plan names.",
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="nm-page-hero nm-pricing-hero">
        <Container>
          <div className="nm-pricing-intro">
            <div>
              <Eyebrow>Pricing / proposed plans</Eyebrow>
              <h1 className="nm-page-hero-title">
                Start with the work.
                <br />
                <span className="nm-serif">Plan for the whole business.</span>
              </h1>
              <p className="nm-page-hero-sub">
                Evaluate the product today. Paid plans and self-service billing
                are still being finalized, so the figures below are provisional.
              </p>
              <div className="nm-page-hero-actions">
                <Link href="/signup" className={buttonClass("primary", "lg")}>
                  Create an account <ArrowRight size={16} />
                </Link>
                <Link
                  href="/contact"
                  className={buttonClass("secondary", "lg")}
                >
                  Discuss your requirements
                </Link>
              </div>
            </div>
            <aside
              className="nm-pricing-evaluation"
              aria-label="Your evaluation path"
            >
              <span className="nm-mono">A clear path to a decision</span>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <h2>Explore the platform</h2>
                    <p>Review the capabilities your team needs.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <h2>Define your scope</h2>
                    <p>Outline people, processes and rollout requirements.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <h2>Agree the terms</h2>
                    <p>Confirm pricing and entitlements before committing.</p>
                  </div>
                </li>
              </ol>
            </aside>
          </div>
        </Container>
      </section>
      <Section aria-labelledby="plans">
        <Container>
          <div className="nm-pricing-plan-heading">
            <div>
              <Eyebrow>Proposed plans</Eyebrow>
              <h2 id="plans" className="nm-heading">
                Find the right starting point.
              </h2>
            </div>
            <p>
              Monthly proposals{" "}
              <span>Annual pricing is not yet confirmed.</span>
            </p>
          </div>
          <div className="nm-pricing-grid nm-pricing-plans">
            {PLANS.map((plan, index) => (
              <article
                key={plan.name}
                className={`nm-price-card ${index === 1 ? "nm-price-emphasis" : ""}`}
              >
                <span className="nm-price-position">
                  0{index + 1} / {plan.label}
                </span>
                <h3 className="nm-price-card-name">{plan.name}</h3>
                <p className="nm-price-card-desc">{plan.description}</p>
                <div className="nm-price-card-amount">
                  <span className="nm-price-card-amount-val">
                    {plan.amount}
                  </span>
                  {plan.amount.startsWith("$") && (
                    <span className="nm-price-card-amount-unit">
                      / month, proposed flat rate
                    </span>
                  )}
                </div>
                <p className="nm-price-card-desc">{plan.size}</p>
                <p className="nm-price-confirmation">
                  Final entitlements to be confirmed.
                </p>
                <Link
                  href="/contact"
                  className={buttonClass(
                    index === 1 ? "primary" : "secondary",
                    "lg",
                    "nm-price-card-cta",
                  )}
                >
                  Discuss requirements <ArrowRight size={16} />
                </Link>
              </article>
            ))}
          </div>
          <div className="nm-pricing-summary">
            <p>
              <strong>One connected product.</strong> Plan-specific feature
              access has not been finalized. The current capability catalogue is
              the reference for what exists today.
            </p>
            <Link href="/features" className="nm-arrow-link">
              Review capabilities <ArrowRight size={15} />
            </Link>
          </div>
          <aside className="nm-roadmap-note">
            <strong>Before you make a purchasing decision</strong>
            <p>
              Currency, tax treatment and final limits require confirmation. No
              checkout or recurring payment is active in the current
              application.
            </p>
          </aside>
        </Container>
      </Section>
      <Section className="nm-pricing-compare" aria-labelledby="compare">
        <Container>
          <Eyebrow>What is confirmed</Eyebrow>
          <h2 id="compare" className="nm-heading-lg">
            Know what is available.
            <br />
            <span className="nm-serif">Agree the terms before rollout.</span>
          </h2>
          <div className="nm-compare-wrap">
            <table className="nm-compare-table nm-commercial-table">
              <caption className="nm-sr-only">
                Proposed plans at a glance. All prices and limits require
                confirmation.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Proposed scope</th>
                  {PLANS.map((plan) => (
                    <th scope="col" key={plan.name}>
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Monthly figure</th>
                  {PLANS.map((plan) => (
                    <td key={plan.name}>{plan.amount}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Team size</th>
                  <td>Up to 5 people</td>
                  <td>Up to 25 people</td>
                  <td>To be agreed</td>
                </tr>
                <tr>
                  <th scope="row">Feature entitlements</th>
                  <td colSpan={3}>
                    Not yet finalized. Confirm access and limits before rollout.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Purchasing</th>
                  <td colSpan={3}>
                    Self-service paid subscriptions are not available.
                  </td>
                </tr>
              </tbody>
            </table>
            <table className="nm-compare-table">
              <caption className="nm-sr-only">
                Current availability and proposed commercial terms
              </caption>
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Current position</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Existing business modules",
                    "See the published capability statuses on the product page.",
                  ],
                  [
                    "Workspace creation",
                    "Available through the current signup and onboarding flow.",
                  ],
                  [
                    "Seat and storage limits",
                    "Proposed, not enforced as paid-plan entitlements.",
                  ],
                  [
                    "Industry configuration and automation",
                    "Planned; no industry setup is provisioned at signup.",
                  ],
                  [
                    "Migration services, SLA and dedicated support",
                    "Require confirmation and an agreement.",
                  ],
                  [
                    "Annual billing",
                    "No confirmed annual prices or billing controls.",
                  ],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link className="nm-arrow-link" href="/features">
            See what is available <ArrowRight size={16} />
          </Link>
        </Container>
      </Section>
      <Section aria-labelledby="pricing-faq">
        <Container width="narrow">
          <Eyebrow>Before you start</Eyebrow>
          <h2 id="pricing-faq" className="nm-heading-lg">
            Questions, answered.
          </h2>
          <div className="nm-faq-list">
            {FAQS.map((faq, i) => (
              <details key={faq.q} className="nm-faq-item" open={i === 0}>
                <summary className="nm-faq-question">
                  {faq.q}
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p className="nm-faq-answer">{faq.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
