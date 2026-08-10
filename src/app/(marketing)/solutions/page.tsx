import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight, Crown, Wallet, HeartHandshake, Settings, ClipboardList,
  ShieldCheck, Layers, Check,
} from 'lucide-react';
import { Container, Section, Eyebrow, buttonClass } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
import { EditorialImage, PHOTO } from '@/components/marketing/media';
import { CAPABILITIES, LIVE_CAPABILITIES } from '@/components/marketing/capabilities';

export const metadata: Metadata = {
  title: 'Solutions — NextMav',
  description:
    'One platform, six perspectives. Each role sees what matters to them, with access scoped by the organization structure and enforced at the database.',
};

/**
 * The uploaded project's Solutions page, ported — dark hero, six role cards,
 * a full-bleed photographic band with organization types, a figures strip, an
 * implementation split with photography, closing CTA.
 *
 * ── The figures strip ────────────────────────────────────────────────────
 *
 * The upload's version reads "3.2x faster approval cycles", "7→1 tools
 * consolidated" and "100% audit-ready operations". The first is a performance
 * claim about customers who do not exist, and the third is a compliance claim
 * with no auditor behind it. The strip is kept — it is a good piece of
 * composition — carrying three things that are true about the software.
 *
 * "Our team handles data migration and onboarding" became a statement about
 * what the Enterprise plan includes, which is what the pricing page already
 * commits to, rather than a promise about a services organisation.
 */

const ROLES = [
  {
    title: 'For CEOs & Founders',
    icon: Crown,
    body: 'See the health of your company on one screen. Understand where attention is needed, where spending is trending, and which approvals are blocking progress.',
    points: ['Executive dashboards', 'Company-wide KPIs', 'Approval oversight', 'Department performance'],
  },
  {
    title: 'For CFOs & Finance teams',
    icon: Wallet,
    body: 'Track budgets, approve expenses and monitor department spending — every line traceable to the customer and project that caused it.',
    points: ['Budget tracking', 'Expense approvals', 'Invoicing & ageing', 'Financial reporting'],
  },
  {
    title: 'For HR Managers',
    icon: HeartHandshake,
    body: 'Manage the employee lifecycle — profiles, departments, reporting lines, leave, attendance and documents — from one connected record.',
    points: ['Employee profiles', 'Leave & balances', 'Attendance', 'Onboarding & offboarding'],
  },
  {
    title: 'For Operations Directors',
    icon: ClipboardList,
    body: 'Run operations from a command center. Approvals, projects and stock — routed, tracked and auditable across every department.',
    points: ['Approval routing', 'Project oversight', 'Inventory & suppliers', 'Activity history'],
  },
  {
    title: 'For Project Managers',
    icon: Settings,
    body: 'Deliver projects with boards, milestones and team collaboration — with activity history and full context attached to every task.',
    points: ['Boards & milestones', 'Time tracking', 'Team collaboration', 'Client sign-off'],
  },
  {
    title: 'For IT & Administrators',
    icon: ShieldCheck,
    body: 'Control access with role-based permissions, manage sessions, enforce security policies and maintain the organization structure that drives the platform.',
    points: ['Role-based access control', 'Session management', 'Security policies', 'Audit trail'],
  },
];

const ORG_TYPES = [
  'Small businesses',
  'Growing companies',
  'Mid-sized organizations',
  'Large enterprises',
  'Government agencies',
  'NGOs',
  'Educational institutions',
  'Healthcare organizations',
];

const FIGURES = [
  { icon: Layers, val: String(CAPABILITIES.length), label: 'connected capability areas' },
  { icon: Check, val: '1', label: 'permission model across all of them' },
  { icon: ShieldCheck, val: '100%', label: 'of tables under row-level security' },
];

export default function SolutionsPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Solutions</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            Built for every role that{' '}
            <span className="nm-serif">runs the organization.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            From the CEO monitoring company health to the HR manager onboarding a
            new hire — each person works from the same platform, with access
            scoped to their role.
          </p>
        </Container>
      </section>

      <Section aria-labelledby="roles">
        <Container>
          <ScrollReveal className="nm-solutions-head">
            <Eyebrow>By role</Eyebrow>
            <h2 id="roles" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
              One platform,{' '}
              <span className="nm-text-gradient">six perspectives.</span>
            </h2>
            <p className="nm-lead" style={{ marginTop: 'var(--nm-space-5)', maxWidth: 560 }}>
              Each role sees what matters to them — and nothing they
              shouldn&rsquo;t. Permissions are scoped by the organization
              structure and enforced at the database level.
            </p>
          </ScrollReveal>
          <div className="nm-role-grid">
            {ROLES.map((role, i) => (
              <ScrollReveal key={role.title} delay={(i % 2) as 0 | 1}>
                <div className="nm-role-card">
                  <div className="nm-role-card-glow" />
                  <div className="nm-role-card-head">
                    <div className="nm-role-icon">
                      <role.icon size={20} />
                    </div>
                    <h3 className="nm-role-card-title">{role.title}</h3>
                  </div>
                  <p className="nm-role-card-body">{role.body}</p>
                  <div className="nm-role-card-points">
                    {role.points.map((point) => (
                      <span key={point} className="nm-role-card-point">
                        <Check size={12} aria-hidden="true" />
                        {point}
                      </span>
                    ))}
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </Container>
      </Section>

      <ScrollReveal>
        <Section className="nm-solutions-image nm-dark-surface" aria-labelledby="orgs">
          <div className="nm-solutions-image-bg">
            <EditorialImage
              src={PHOTO.workshop}
              alt="Colleagues working together around a table"
              tone="deep"
              sizes="100vw"
            />
            <div className="nm-solutions-image-overlay" />
          </div>
          <Container className="nm-solutions-image-content">
            <Eyebrow>Organizations we build for</Eyebrow>
            <h2
              id="orgs"
              className="nm-heading-lg nm-heading-dark"
              style={{ marginTop: 'var(--nm-space-4)', maxWidth: 520 }}
            >
              From small teams to{' '}
              <span className="nm-serif" style={{ color: 'var(--nm-accent-3)' }}>
                complex enterprises.
              </span>
            </h2>
            <p
              className="nm-lead"
              style={{ color: 'var(--nm-neutral-5)', marginTop: 'var(--nm-space-5)', maxWidth: 480 }}
            >
              The platform scales from a ten-person team to a multi-unit
              organization — the same capabilities, the same permission model,
              the same connected data.
            </p>
            <div className="nm-solutions-orgs">
              {ORG_TYPES.map((type) => (
                <span key={type} className="nm-solutions-org">
                  {type}
                </span>
              ))}
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <ScrollReveal>
        <Section className="nm-solutions-stats" aria-labelledby="figures">
          <Container>
            <h2 id="figures" className="nm-sr-only">
              The shape of the platform
            </h2>
            <div className="nm-solutions-stats-grid">
              {FIGURES.map((f) => (
                <div key={f.label} className="nm-solutions-stat">
                  <div className="nm-solutions-stat-icon">
                    <f.icon size={20} />
                  </div>
                  <span className="nm-solutions-stat-val">{f.val}</span>
                  <span className="nm-solutions-stat-label">{f.label}</span>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <ScrollReveal>
        <Section className="nm-solutions-partnership" aria-labelledby="implementation">
          <Container>
            <div className="nm-solutions-partnership-grid">
              <div className="nm-solutions-partnership-image nm-img-overlay">
                <EditorialImage
                  src={PHOTO.meeting}
                  alt="Two people shaking hands across a table"
                  sizes="(min-width: 980px) 46vw, 92vw"
                />
              </div>
              <div className="nm-solutions-partnership-text">
                <Eyebrow>Implementation</Eyebrow>
                <h2
                  id="implementation"
                  className="nm-heading-lg"
                  style={{ marginTop: 'var(--nm-space-4)' }}
                >
                  Start with one department,{' '}
                  <span className="nm-serif">not the whole company.</span>
                </h2>
                <p className="nm-lead" style={{ marginTop: 'var(--nm-space-5)' }}>
                  Import contacts, employees, products and projects from CSV, and
                  turn modules on in the order that suits you — the order matters
                  more than the import. Enterprise agreements include onboarding
                  and migration support and a named account manager.
                </p>
                <p className="nm-lead" style={{ marginTop: 'var(--nm-space-4)', fontSize: 'var(--nm-text-sm)' }}>
                  {LIVE_CAPABILITIES.length} capability areas are available today.
                </p>
                <Link
                  href="/contact"
                  className="nm-arrow-link"
                  style={{ marginTop: 'var(--nm-space-6)' }}
                >
                  Talk to us about onboarding
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </Container>
        </Section>
      </ScrollReveal>

      <Section className="nm-closing" size="lg" aria-labelledby="solutions-cta">
        <div className="nm-closing-bg">
          <div className="nm-closing-glow" />
          <div className="nm-grid-bg nm-grid-bg-dot" />
        </div>
        <Container width="narrow">
          <ScrollReveal className="nm-closing-inner">
            <h2 id="solutions-cta" className="nm-display-lg nm-closing-title">
              See how it fits{' '}
              <span className="nm-serif nm-text-gradient">your organization.</span>
            </h2>
            <div className="nm-closing-actions">
              <Link href="/contact" className={buttonClass('primary', 'lg')}>
                Talk to sales <ArrowRight size={16} />
              </Link>
              <Link href="/features" className={buttonClass('secondary', 'lg', 'nm-btn-dark-secondary')}>
                Explore platform
              </Link>
            </div>
          </ScrollReveal>
        </Container>
      </Section>
    </>
  );
}
