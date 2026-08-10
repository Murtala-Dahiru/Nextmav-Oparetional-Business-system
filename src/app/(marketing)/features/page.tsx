import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Layers, Network, Zap, Check } from 'lucide-react';
import { Container, Section, Eyebrow, buttonClass } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
import { EditorialImage, PHOTO } from '@/components/marketing/media';
import {
  CAPABILITIES,
  LIVE_CAPABILITIES,
  STATUS_LABEL,
} from '@/components/marketing/capabilities';

export const metadata: Metadata = {
  title: 'Platform — NextMav',
  description:
    'Sixteen capability areas on one shared data model, with a unified permission model and one source of truth — and each area’s status stated plainly.',
};

/**
 * The uploaded project's Features page, ported.
 *
 * Same sections in the same order — dark page hero, a "how it works" split with
 * photography and three pillars, the capability grid, a dark architecture band
 * with an image, closing CTA — using its class names so `pages.css` applies as
 * written.
 *
 * ── The one substantive change ───────────────────────────────────────────
 *
 * The upload lists twelve capabilities as though all twelve shipped. Seven of
 * them describe software that does not exist here. Rather than delete them —
 * which made the product look smaller than it is — every card carries its
 * status, and the set is drawn from `capabilities.ts`, which is also what the
 * landing page and the company page count from.
 *
 * A published roadmap is the normal artefact for enterprise software; it is how
 * a buyer plans a rollout. What is not acceptable is a features page that reads
 * as a promise a trial cannot keep.
 */

const PILLARS = [
  {
    icon: Layers,
    title: 'One shared data model',
    body: 'Every capability reads from the same organization, permission model and records. Data never silos between modules, because there are no modules to silo between.',
  },
  {
    icon: Network,
    title: 'Org-driven permissions',
    body: 'Roles, departments and reporting lines drive what each person sees and can act on — enforced at the database row level and checked in the route, not drawn in the UI.',
  },
  {
    icon: Zap,
    title: 'Connected workflows',
    body: 'Approvals route across departments automatically. A leave request reaches the person entitled to decide it, and the decision stays attached to the record.',
  },
];

const ARCH_POINTS = [
  'Row-level security on every table',
  'Structured logging & request tracing',
  'Rate limiting on every credential endpoint',
  'Sessions that can be revoked immediately',
];

export default function FeaturesPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Platform</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            {CAPABILITIES.length} capability areas.{' '}
            <span className="nm-serif">One shared data model.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            Every department works from the same platform — a unified permission
            model, shared workflows and a single source of truth. No integrations
            to maintain, no data to reconcile. {LIVE_CAPABILITIES.length} areas are
            available today; the rest say exactly where they stand.
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

      <ScrollReveal>
        <Section className="nm-features-showcase" aria-labelledby="how">
          <Container>
            <div className="nm-features-showcase-grid">
              <div className="nm-features-showcase-image nm-img-overlay">
                <EditorialImage
                  src={PHOTO.analytics}
                  alt="A wall of screens showing charts and operational readouts"
                  sizes="(min-width: 980px) 46vw, 92vw"
                />
              </div>
              <div className="nm-features-showcase-text">
                <Eyebrow>How it works</Eyebrow>
                <h2 id="how" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
                  One platform where{' '}
                  <span className="nm-serif">everything connects.</span>
                </h2>
                <p className="nm-lead" style={{ marginTop: 'var(--nm-space-5)' }}>
                  Most organizations stitch together seven or more tools. NextMav
                  replaces them with one operational layer — where every approval,
                  document, spend line and person is linked through the same
                  organization structure.
                </p>
                <div className="nm-features-pillars">
                  {PILLARS.map((p) => (
                    <div key={p.title} className="nm-features-pillar">
                      <div className="nm-features-pillar-icon">
                        <p.icon size={18} />
                      </div>
                      <div>
                        <span className="nm-features-pillar-title">{p.title}</span>
                        <p className="nm-features-pillar-body">{p.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <Section className="nm-features-caps" aria-labelledby="capabilities">
        <Container>
          <ScrollReveal className="nm-features-caps-head">
            <Eyebrow>Capabilities</Eyebrow>
            <h2 id="capabilities" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
              The full platform,{' '}
              <span className="nm-text-gradient">area by area.</span>
            </h2>
            <p className="nm-lead" style={{ marginTop: 'var(--nm-space-5)', maxWidth: 560 }}>
              Each card says whether it is available today, partly available, or
              still being built — because a rollout has to be planned against
              something real.
            </p>
          </ScrollReveal>
          <div className="nm-cap-grid">
            {CAPABILITIES.map((cap, i) => (
              <ScrollReveal key={cap.id} delay={(i % 3) as 0 | 1 | 2}>
                <div className="nm-cap-card">
                  <div className="nm-cap-card-head">
                    <div className="nm-cap-icon">
                      <cap.icon size={20} />
                    </div>
                    <span className="nm-section-num">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="nm-cap-title">{cap.name}</h3>
                  <p className="nm-cap-body">{cap.summary}</p>
                  {cap.note && (
                    <p
                      className="nm-cap-body"
                      style={{
                        marginTop: 'var(--nm-space-3)',
                        borderLeft: '2px solid var(--nm-border-strong)',
                        paddingLeft: 'var(--nm-space-3)',
                        fontSize: 'var(--nm-text-xs)',
                      }}
                    >
                      {cap.note}
                    </p>
                  )}
                  <div className="nm-cap-tags">
                    {cap.tags.map((tag) => (
                      <span key={tag} className="nm-cap-tag">
                        {tag}
                      </span>
                    ))}
                    <span
                      className="nm-cap-tag"
                      style={
                        cap.status === 'live'
                          ? { borderColor: 'var(--nm-accent-3)', color: 'var(--nm-accent-6)' }
                          : undefined
                      }
                    >
                      {STATUS_LABEL[cap.status]}
                    </span>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </Container>
      </Section>

      <ScrollReveal>
        <Section className="nm-features-arch nm-dark-surface" aria-labelledby="architecture">
          <div className="nm-features-arch-bg">
            <div className="nm-grid-bg nm-grid-bg-dark" />
            <div className="nm-features-arch-glow" />
          </div>
          <Container className="nm-features-arch-container">
            <div className="nm-features-arch-grid">
              <div className="nm-features-arch-text">
                <Eyebrow>Architecture</Eyebrow>
                <h2
                  id="architecture"
                  className="nm-heading-lg nm-heading-dark"
                  style={{ marginTop: 'var(--nm-space-4)', maxWidth: 460 }}
                >
                  Built so the business logic{' '}
                  <span className="nm-serif" style={{ color: 'var(--nm-accent-3)' }}>
                    outlives the infrastructure.
                  </span>
                </h2>
                <p
                  className="nm-lead"
                  style={{ color: 'var(--nm-neutral-5)', marginTop: 'var(--nm-space-5)' }}
                >
                  Row-level security on every table. Structured logging and request
                  tracing. Rate limiting on every endpoint that accepts or issues
                  credentials. Each is a named assertion in the repository&rsquo;s
                  own security gate, which fails the build rather than filing a
                  warning.
                </p>
                <div className="nm-features-arch-points">
                  {ARCH_POINTS.map((point) => (
                    <div key={point} className="nm-features-arch-point">
                      <Check size={16} />
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="nm-features-arch-image nm-img-overlay">
                <EditorialImage
                  src={PHOTO.engineering}
                  alt="Source code on a dark screen"
                  tone="deep"
                  sizes="(min-width: 980px) 44vw, 92vw"
                />
              </div>
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <Section className="nm-closing" size="lg" aria-labelledby="features-cta">
        <div className="nm-closing-bg">
          <div className="nm-closing-glow" />
          <div className="nm-grid-bg nm-grid-bg-dot" />
        </div>
        <Container width="narrow">
          <ScrollReveal className="nm-closing-inner">
            <h2 id="features-cta" className="nm-display-lg nm-closing-title">
              One platform.{' '}
              <span className="nm-serif nm-text-gradient">Not sixteen tabs.</span>
            </h2>
            <p className="nm-lead-lg nm-closing-lead">
              Start with the capabilities you need today. The rest are there when
              your organization grows into them.
            </p>
            <div className="nm-closing-actions">
              <Link href="/signup" className={buttonClass('primary', 'lg')}>
                Get started <ArrowRight size={16} />
              </Link>
              <Link href="/pricing" className={buttonClass('secondary', 'lg', 'nm-btn-dark-secondary')}>
                See pricing
              </Link>
            </div>
          </ScrollReveal>
        </Container>
      </Section>
    </>
  );
}
