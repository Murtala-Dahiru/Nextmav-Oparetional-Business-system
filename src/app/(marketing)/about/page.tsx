import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Layers, Network, ShieldCheck, Eye, Sparkles, Target } from 'lucide-react';
import { Container, Section, Eyebrow, buttonClass } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
import { EditorialImage, PHOTO } from '@/components/marketing/media';
import { CAPABILITIES } from '@/components/marketing/capabilities';

export const metadata: Metadata = {
  title: 'Company — NextMav',
  description:
    'Why NextMav exists: one connected operational layer instead of seven tools that each hold a partial copy of the same company.',
};

/**
 * The uploaded project's About page, ported — hero, the problem beside three
 * mission cards, four principle cards, a dark engineering band with photography
 * and four figures, closing statement.
 *
 * Three claims in the upload's copy could not be carried and were rewritten
 * rather than dropped: "cost centres" as a shipped concept (in development, and
 * `capabilities.ts` says so), "audit prep goes from weeks to days" (a result
 * claimed for customers nobody has asked), and "can migrate to another cloud
 * provider with minimal disruption" (an assertion about work nobody has done).
 * Every section they sat in is still here.
 *
 * The figures derive from `capabilities.ts` rather than being typed in, so this
 * page and the platform page cannot drift apart on how many areas exist.
 */

const MISSION_POINTS = [
  {
    icon: Network,
    title: 'Connected by design',
    body: 'Every capability shares the same organization, permission model and records. No integrations to maintain between two halves of your own company.',
  },
  {
    icon: ShieldCheck,
    title: 'Auditable by default',
    body: 'Who changed which record, when, and what it said before — kept as a matter of course rather than switched on for an audit, and readable in the product.',
  },
  {
    icon: Target,
    title: 'Purposeful, not bloated',
    body: 'Each area earns its place against the model everything else already shares. What is built is stated plainly, and so is what is not.',
  },
];

const VALUES = [
  {
    icon: Sparkles,
    title: 'Clarity over complexity',
    body: 'Enterprise software should reduce the amount somebody has to hold in their head, not add to it. Every screen, every workflow and every notification should make the work clearer — not noisier.',
  },
  {
    icon: Layers,
    title: 'One system, not many',
    body: 'Organizations lose time and data at the seams between disconnected tools. The answer is not better integrations between them — it is not having the seam in the first place.',
  },
  {
    icon: ShieldCheck,
    title: 'Security as architecture',
    body: 'Permissions are enforced at the database row level and checked in the route, not drawn in the interface. The platform is designed for organizations that audit their software before adopting it.',
  },
  {
    icon: Eye,
    title: 'Calm software for serious work',
    body: 'Software that runs an organization should never feel anxious, trendy or experimental. It should feel like infrastructure you can trust for years — and still feel that way in five.',
  },
];

const STATS = [
  { val: '100%', label: 'Row-level security on every table' },
  { val: '0', label: 'Data silos between departments' },
  { val: String(CAPABILITIES.length), label: 'Capability areas, each with a published status' },
  { val: '1', label: 'Permission model across the platform' },
];

export default function AboutPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Company</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            We build the operating system{' '}
            <span className="nm-serif">for modern organizations.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            NextMav exists because running an organization shouldn&rsquo;t require
            dozens of disconnected software products. One connected platform —
            with shared data, permissions and workflows — is a better way to work,
            and a much easier one to trust.
          </p>
          <div className="nm-page-hero-actions">
            <Link href="/signup" className={buttonClass('primary', 'lg')}>
              Get started <ArrowRight size={16} />
            </Link>
            <Link href="/contact" className={buttonClass('secondary', 'lg', 'nm-btn-dark-secondary')}>
              Talk to us
            </Link>
          </div>
        </Container>
      </section>

      <ScrollReveal>
        <Section className="nm-about-mission" aria-labelledby="problem">
          <Container>
            <div className="nm-about-mission-grid">
              <div className="nm-about-mission-text">
                <Eyebrow>The problem</Eyebrow>
                <h2 id="problem" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
                  Software sprawl is a{' '}
                  <span className="nm-serif">tax on every organization.</span>
                </h2>
                <p className="nm-lead" style={{ marginTop: 'var(--nm-space-5)' }}>
                  Most organizations stitch together seven or more tools to run
                  their operations. The cost isn&rsquo;t just the subscriptions —
                  it&rsquo;s the duplicated data, the broken handoffs, the
                  approvals lost between inboxes, and the impossibility of seeing
                  the whole organization in one place.
                </p>
                <p className="nm-lead" style={{ marginTop: 'var(--nm-space-4)' }}>
                  NextMav replaces that sprawl with one operational layer. Every
                  department works from the same data, the same permissions and
                  the same workflows — inside one connected system.
                </p>
              </div>
              <div className="nm-about-mission-cards">
                {MISSION_POINTS.map((point) => (
                  <div key={point.title} className="nm-about-mission-card">
                    <div className="nm-about-mission-card-icon">
                      <point.icon size={18} />
                    </div>
                    <div>
                      <span className="nm-about-mission-card-title">{point.title}</span>
                      <p className="nm-about-mission-card-body">{point.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <ScrollReveal>
        <Section className="nm-about-values" aria-labelledby="values">
          <Container>
            <ScrollReveal className="nm-about-values-head">
              <Eyebrow>What we believe</Eyebrow>
              <h2 id="values" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
                Principles that{' '}
                <span className="nm-text-gradient">shape every decision.</span>
              </h2>
            </ScrollReveal>
            <div className="nm-about-values-grid">
              {VALUES.map((value, i) => (
                <ScrollReveal key={value.title} delay={(i % 2) as 0 | 1}>
                  <div className="nm-about-value-card">
                    <div className="nm-about-value-icon">
                      <value.icon size={20} />
                    </div>
                    <h3 className="nm-about-value-title">{value.title}</h3>
                    <p className="nm-about-value-body">{value.body}</p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <ScrollReveal>
        <Section className="nm-about-engineering nm-dark-surface" aria-labelledby="engineering">
          <div className="nm-about-engineering-bg">
            <div className="nm-grid-bg nm-grid-bg-dark" />
            <div className="nm-about-engineering-glow" />
          </div>
          <Container className="nm-about-engineering-container">
            <div className="nm-about-engineering-grid">
              <div className="nm-about-engineering-text">
                <Eyebrow>Engineering</Eyebrow>
                <h2
                  id="engineering"
                  className="nm-heading-lg nm-heading-dark"
                  style={{ marginTop: 'var(--nm-space-4)', maxWidth: 460 }}
                >
                  Built to be trusted with{' '}
                  <span className="nm-serif" style={{ color: 'var(--nm-accent-3)' }}>
                    critical operations.
                  </span>
                </h2>
                <p
                  className="nm-lead"
                  style={{ color: 'var(--nm-neutral-5)', marginTop: 'var(--nm-space-5)' }}
                >
                  Row-level security on every table. Structured logging and a
                  correlation id on every request. Rate limiting on every endpoint
                  that accepts or issues credentials. Sessions that actually end.
                  None of it is a badge — each is an assertion in the
                  repository&rsquo;s own security gate, which fails the build
                  rather than filing a warning.
                </p>
              </div>
              <div className="nm-about-engineering-image nm-img-overlay">
                <EditorialImage
                  src={PHOTO.architecture}
                  alt="A concrete facade in flat daylight, seen from below"
                  tone="deep"
                  sizes="(min-width: 980px) 44vw, 92vw"
                />
              </div>
            </div>
            <div className="nm-about-stats">
              {STATS.map((stat) => (
                <div key={stat.label} className="nm-about-stat">
                  <span className="nm-about-stat-val">{stat.val}</span>
                  <span className="nm-about-stat-label">{stat.label}</span>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <Section className="nm-closing" size="lg" aria-labelledby="about-cta">
        <div className="nm-closing-bg">
          <div className="nm-closing-glow" />
          <div className="nm-grid-bg nm-grid-bg-dot" />
        </div>
        <Container width="narrow">
          <ScrollReveal className="nm-closing-inner">
            <h2 id="about-cta" className="nm-display-lg nm-closing-title">
              We&rsquo;re building the platform{' '}
              <span className="nm-serif nm-text-gradient">
                organizations open every morning.
              </span>
            </h2>
            <div className="nm-closing-actions">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Get started <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className={buttonClass('secondary', 'lg', 'nm-btn-dark-secondary')}>
                Talk to us
              </Link>
            </div>
          </ScrollReveal>
        </Container>
      </Section>
    </>
  );
}
