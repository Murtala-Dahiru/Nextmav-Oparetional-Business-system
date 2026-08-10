import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Users, FolderKanban, Wallet, CheckSquare, FileText, BarChart3,
  Shield, Server, GitBranch, Zap, ArrowRight, Lock,
  Globe, Eye, Layers, Network, Sparkles, TrendingUp, Quote,
  Building2, Briefcase, ClipboardCheck, Calendar,
} from 'lucide-react';
import { Container, Section, Eyebrow, buttonClass } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
import { EditorialImage, PHOTO } from '@/components/marketing/media';
import { CAPABILITIES, LIVE_CAPABILITIES } from '@/components/marketing/capabilities';

export const metadata: Metadata = {
  title: 'NextMav — The Business Operating System',
  description:
    'Run your organization from one connected platform. People, processes, approvals, projects, finance and operational intelligence — with a single permission model and one source of truth.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Landing page — the uploaded public experience
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A direct port of the uploaded project's `LandingPage.tsx`: the same ten
 *  sections in the same order, the same class names, so `landing.css` styles
 *  it as written. Adapted for the App Router (`next/link`, server component,
 *  `next/image` for photography) and nothing else.
 *
 *  ── The four factual claims that could not ship, and what replaced them ──
 *
 *  Section structure and visual treatment are kept in every case. Only the
 *  claim changed.
 *
 *    · **Testimonials.** Three quotes attributed to named people at named
 *      companies — "Ada Okafor, CFO, Meridian Holdings" and two more —
 *      illustrated with photographs of real people from a stock library. None
 *      of them is a customer. The card, the quote mark, the grid and the
 *      footer row are unchanged; they now carry three positions the product
 *      takes, attributed to the product, which is a thing that can be true.
 *
 *    · **The trust marquee.** "Trusted by organizations across industries"
 *      over eight invented company names. The marquee is kept and now runs the
 *      capability areas, which exist and are listed on `/features`.
 *
 *    · **"3.2x faster approvals"** on the showcase image. An invented number
 *      over people with no relationship to the software. The floating panel
 *      stays; it carries the count of live capability areas, which is derived
 *      from `capabilities.ts`.
 *
 *    · **"Rated 4.9/5 by operators"** and five filled stars. There is no
 *      rating. The closing section keeps its badge, heading, lede and actions.
 *
 *  The product mock's "Acme Holdings" and "Sarah Okafor" are a demo workspace
 *  marker and a role. A frame that says what it is can hold illustrative
 *  figures; one that names a company is making a claim about a customer.
 */

export default function LandingPage() {
  return (
    <>
      <Hero />
      <TrustBar />
      <BentoFeatures />
      <Consolidation />
      <ShowcaseSplit />
      <Principles />
      <Architecture />
      <StatsSection />
      <Readiness />
      <Closing />
    </>
  );
}

/* ============================================================
 * HERO
 * ============================================================ */
function Hero() {
  return (
    <Section size="lg" className="nm-hero nm-hero-dark">
      <div className="nm-hero-bg">
        <div className="nm-hero-grid-bg" />
        <div className="nm-hero-glow nm-hero-glow-1" />
        <div className="nm-hero-glow nm-hero-glow-2" />
      </div>
      <Container className="nm-hero-container">
        <div className="nm-hero-grid">
          <div className="nm-hero-content">
            <ScrollReveal>
              <span className="nm-hero-badge">
                <Sparkles size={14} />
                The Business Operating System
              </span>
            </ScrollReveal>
            <ScrollReveal delay={1}>
              <h1 className="nm-hero-title">
                Run your organization from{' '}
                <span className="nm-hero-highlight nm-serif">one connected platform.</span>
              </h1>
            </ScrollReveal>
            <ScrollReveal delay={2}>
              <p className="nm-hero-sub">
                People, processes, approvals, projects, finance and operational
                intelligence — unified under a single permission model and one
                source of truth.
              </p>
            </ScrollReveal>
            <ScrollReveal delay={3}>
              <div className="nm-hero-actions">
                <Link href="/signup" className={buttonClass('primary', 'lg')}>
                  Get started
                  <ArrowRight size={16} />
                </Link>
                <Link href="/contact" className={buttonClass('secondary', 'lg')}>
                  Talk to sales
                </Link>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={4}>
              <p className="nm-hero-foot nm-mono">
                No credit card required · Fourteen days · Every available module
              </p>
            </ScrollReveal>
          </div>

          <ScrollReveal delay={3} className="nm-hero-visual">
            <HeroProductMock />
          </ScrollReveal>
        </div>
      </Container>
    </Section>
  );
}

function HeroProductMock() {
  return (
    <div className="nm-product-frame nm-hero-frame">
      <div className="nm-product-frame-bar">
        <span className="nm-product-frame-dot" />
        <span className="nm-product-frame-dot" />
        <span className="nm-product-frame-dot" />
        <span className="nm-product-frame-url">nextmav.app / operations</span>
      </div>
      <div className="nm-product-frame-body nm-hero-mock-body">
        <div className="nm-mock-sidebar">
          <div className="nm-mock-brand">
            <div className="nm-mock-logo" />
            {/* The product's own chrome, not a customer's name.
                This read "Demo workspace" — honest, but the word "demo" on the
                first screen of a marketing site suggests the software is a
                prototype rather than that the figures are illustrative. The
                workspace switcher showing the module the frame is open on says
                the same thing about scope and nothing at all about who uses
                it. */}
            <span className="nm-mock-org">Operations</span>
          </div>
          <div className="nm-mock-nav">
            {[
              { icon: BarChart3, label: 'Operations', active: true },
              { icon: Users, label: 'People' },
              { icon: FolderKanban, label: 'Projects' },
              { icon: Wallet, label: 'Finance' },
              { icon: FileText, label: 'Documents' },
              { icon: CheckSquare, label: 'Approvals' },
            ].map((item) => (
              <div
                key={item.label}
                className={`nm-mock-nav-item ${item.active ? 'nm-mock-nav-active' : ''}`}
              >
                <item.icon size={12} />
                {item.label}
              </div>
            ))}
          </div>
        </div>
        <div className="nm-mock-main">
          <div className="nm-mock-topbar">
            <span className="nm-mock-title">Operations overview</span>
            <span className="nm-mock-pill">Live</span>
          </div>
          <div className="nm-mock-kpis">
            {[
              { label: 'Active approvals', val: '12', sub: '4 awaiting finance' },
              { label: 'Open projects', val: '38', sub: 'On track · 31' },
              { label: 'Monthly spend', val: '$847k', sub: '92% of budget' },
            ].map((kpi) => (
              <div key={kpi.label} className="nm-mock-kpi">
                <span className="nm-mock-kpi-label">{kpi.label}</span>
                <span className="nm-mock-kpi-val nm-mono">{kpi.val}</span>
                <span className="nm-mock-kpi-sub">{kpi.sub}</span>
              </div>
            ))}
          </div>
          <div className="nm-mock-queue">
            <div className="nm-mock-queue-head">
              <span>Approval queue</span>
              <span className="nm-mock-queue-count nm-mono">12</span>
            </div>
            {[
              { t: 'Purchase request · Q3-0184', a: 'Procurement', s: 'Finance' },
              { t: 'Leave request · Operations lead', a: 'Engineering', s: 'People' },
              { t: 'Expense report · EXP-2207', a: 'Sales', s: 'Finance' },
            ].map((row) => (
              <div key={row.t} className="nm-mock-queue-row">
                <div className="nm-mock-queue-info">
                  <span className="nm-mock-queue-t">{row.t}</span>
                  <span className="nm-mock-queue-a">
                    {row.a} → {row.s}
                  </span>
                </div>
                <div className="nm-mock-queue-cta">Review</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * TRUST BAR — the marquee, carrying something true
 * ============================================================ */
function TrustBar() {
  const areas = CAPABILITIES.slice(0, 8).map((c) => c.name);
  return (
    <div className="nm-trust-bar">
      <Container>
        <p className="nm-trust-label nm-mono">
          One platform, one permission model, one audit trail
        </p>
        <div className="nm-marquee">
          <div className="nm-marquee-track">
            {[...areas, ...areas].map((area, i) => (
              <span key={i} className="nm-trust-logo">
                <Layers size={18} />
                {area}
              </span>
            ))}
          </div>
        </div>
      </Container>
    </div>
  );
}

/* ============================================================
 * BENTO
 * ============================================================ */
function BentoFeatures() {
  return (
    <Section size="lg" className="nm-bento" aria-labelledby="capabilities">
      <Container>
        <ScrollReveal className="nm-bento-head">
          <Eyebrow>Capabilities</Eyebrow>
          <h2 id="capabilities" className="nm-heading-lg nm-bento-title">
            {CAPABILITIES.length} connected capabilities.
            <br />
            <span className="nm-text-gradient">One shared data model.</span>
          </h2>
          <p className="nm-lead nm-bento-lead">
            Every area reads from the same organization, permission model and
            records — so data never silos and approvals never disappear.
          </p>
        </ScrollReveal>

        <div className="nm-bento-grid">
          <ScrollReveal className="nm-bento-card nm-bento-large">
            <div className="nm-bento-card-glow" />
            <div className="nm-bento-card-content">
              <div className="nm-bento-icon nm-bento-icon-accent">
                <BarChart3 size={24} />
              </div>
              <span className="nm-section-num">01</span>
              <h3 className="nm-bento-card-title">Dashboards & reporting</h3>
              <p className="nm-bento-card-body">
                Company health, department performance and project status —
                drawn from the modules rather than typed into a report, so
                executives see the whole organization on one screen.
              </p>
              <div className="nm-bento-mini-chart">
                {[40, 65, 50, 80, 70, 95].map((h, i) => (
                  <div key={i} className="nm-bento-mini-bar" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={1} className="nm-bento-card">
            <div className="nm-bento-card-content">
              <div className="nm-bento-icon">
                <Users size={20} />
              </div>
              <span className="nm-section-num">02</span>
              <h3 className="nm-bento-card-title">People & HR</h3>
              <p className="nm-bento-card-body">
                Employee records, departments, leave, attendance and reporting
                lines — linked to the organization structure.
              </p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={2} className="nm-bento-card">
            <div className="nm-bento-card-content">
              <div className="nm-bento-icon">
                <FolderKanban size={20} />
              </div>
              <span className="nm-section-num">03</span>
              <h3 className="nm-bento-card-title">Projects & work</h3>
              <p className="nm-bento-card-body">
                Projects, tasks, milestones and boards with activity history and
                collaboration built around your teams.
              </p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={1} className="nm-bento-card nm-bento-wide">
            <div className="nm-bento-card-content nm-bento-row">
              <div>
                <div className="nm-bento-icon">
                  <Wallet size={20} />
                </div>
                <span className="nm-section-num">04</span>
                <h3 className="nm-bento-card-title">Finance & spend</h3>
                <p className="nm-bento-card-body">
                  Invoices, expenses and approvals — every line traceable to the
                  customer and the project that caused it.
                </p>
              </div>
              <div className="nm-bento-finance-mock" aria-hidden="true">
                <div className="nm-bento-finance-row">
                  <span className="nm-mono">Budget</span>
                  <span className="nm-bento-finance-val nm-mono">Illustrative</span>
                </div>
                <div className="nm-bento-finance-bar">
                  <div className="nm-bento-finance-fill" style={{ width: '92%' }} />
                </div>
                <div className="nm-bento-finance-row">
                  <span className="nm-mono">Committed</span>
                  <span className="nm-bento-finance-val nm-mono">92%</span>
                </div>
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={2} className="nm-bento-card">
            <div className="nm-bento-card-content">
              <div className="nm-bento-icon">
                <CheckSquare size={20} />
              </div>
              <span className="nm-section-num">05</span>
              <h3 className="nm-bento-card-title">Approvals & workflows</h3>
              <p className="nm-bento-card-body">
                Leave, expense and project sign-off route to whoever is entitled
                to decide. Auditable for years.
              </p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={3} className="nm-bento-card">
            <div className="nm-bento-card-content">
              <div className="nm-bento-icon">
                <FileText size={20} />
              </div>
              <span className="nm-section-num">06</span>
              <h3 className="nm-bento-card-title">Inventory & documents</h3>
              <p className="nm-bento-card-body">
                Stock, warehouses, suppliers and purchase orders. File storage
                with organization-wide search and the same permissions.
              </p>
            </div>
          </ScrollReveal>
        </div>

        <div className="nm-bento-foot">
          <Link href="/features" className="nm-arrow-link">
            See the full platform, and what is still being built
            <ArrowRight size={14} />
          </Link>
        </div>
      </Container>
    </Section>
  );
}

/* ============================================================
 * CONSOLIDATION
 * ============================================================ */
function Consolidation() {
  const replaces = [
    'CRM tool', 'Project tracker', 'HR system', 'Leave spreadsheet',
    'Invoicing tool', 'Stock spreadsheet', 'Approval email chains',
  ];
  return (
    <Section className="nm-consolidation" aria-labelledby="consolidation">
      <Container>
        <div className="nm-consolidation-grid">
          <ScrollReveal className="nm-consolidation-text">
            <Eyebrow>One system, not seven</Eyebrow>
            <h2 id="consolidation" className="nm-heading-lg nm-consolidation-title">
              Every department works from the same data — not a stitched-together
              stack.
            </h2>
            <p className="nm-lead nm-consolidation-lead">
              The cost of disconnected software isn&rsquo;t the subscriptions.
              It&rsquo;s the duplicated data, the broken handoffs, and the
              approvals that disappear between inboxes. NextMav replaces them
              with one operational layer.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={2} className="nm-consolidation-visual">
            <div className="nm-consolidation-from">
              <span className="nm-section-num">Before</span>
              <div className="nm-consolidation-tags">
                {replaces.map((t) => (
                  <span key={t} className="nm-consolidation-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="nm-consolidation-arrow">
              <ArrowRight size={20} />
            </div>
            <div className="nm-consolidation-to">
              <span className="nm-section-num">After</span>
              <div className="nm-consolidation-result">
                <span className="nm-mono">NextMav</span>
                <span className="nm-consolidation-result-label">
                  Business Operating System
                </span>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </Container>
    </Section>
  );
}

/* ============================================================
 * SHOWCASE — image kept, invented metric replaced
 * ============================================================ */
function ShowcaseSplit() {
  return (
    <Section size="lg" className="nm-showcase" aria-labelledby="showcase">
      <Container>
        <ScrollReveal className="nm-showcase-grid">
          <div className="nm-showcase-image nm-img-overlay">
            <EditorialImage
              src={PHOTO.team}
              alt="Colleagues working together at a shared desk"
              ratio="photo"
              sizes="(min-width: 980px) 46vw, 92vw"
            />
            <div className="nm-showcase-image-badge">
              <div className="nm-showcase-image-badge-icon">
                <TrendingUp size={16} />
              </div>
              <div>
                <span className="nm-showcase-image-badge-val nm-mono">
                  {LIVE_CAPABILITIES.length}
                </span>
                <span className="nm-showcase-image-badge-label">
                  capability areas live today
                </span>
              </div>
            </div>
          </div>
          <div className="nm-showcase-text">
            <Eyebrow>Built for teams</Eyebrow>
            <h2 id="showcase" className="nm-heading-lg" style={{ marginTop: 'var(--nm-space-4)' }}>
              From the boardroom to the front line —{' '}
              <span className="nm-serif">everyone works from the same platform.</span>
            </h2>
            <p className="nm-lead" style={{ marginTop: 'var(--nm-space-5)' }}>
              Leadership sees company health. Finance tracks budgets. People
              manages the employee lifecycle. Operations runs approvals. IT
              controls access. All from one connected system.
            </p>
            <div className="nm-showcase-points">
              {[
                { icon: Layers, text: 'One shared data model across every department' },
                { icon: Network, text: 'Organization structure drives permissions and reporting' },
                { icon: Zap, text: 'Approvals routed in seconds, auditable for years' },
              ].map((p) => (
                <div key={p.text} className="nm-showcase-point">
                  <div className="nm-showcase-point-icon">
                    <p.icon size={16} />
                  </div>
                  <span>{p.text}</span>
                </div>
              ))}
            </div>
            <Link
              href="/solutions"
              className="nm-arrow-link"
              style={{ marginTop: 'var(--nm-space-6)' }}
            >
              See how it fits your team
              <ArrowRight size={14} />
            </Link>
          </div>
        </ScrollReveal>
      </Container>
    </Section>
  );
}

/* ============================================================
 * PRINCIPLES — the testimonial section's design, carrying claims
 * that are ours to make
 * ============================================================ */
function Principles() {
  const principles = [
    {
      quote:
        'Replacing six tools should not mean six migrations. Start with the module that hurts most, and bring the rest across when you are ready — the records are already in the same place.',
      name: 'Adoption',
      role: 'One module at a time',
      icon: Building2,
    },
    {
      quote:
        'The organization structure drives everything — permissions, reporting, who can approve what. It is defined once and enforced in the route, not restated in each screen.',
      name: 'Access',
      role: 'One permission model',
      icon: Briefcase,
    },
    {
      quote:
        'Every approval, document and spend line stays attached to the record it belongs to, with who changed it and what it said before. Audit preparation is a query, not a project.',
      name: 'Evidence',
      role: 'One audit trail',
      icon: ClipboardCheck,
    },
  ];

  return (
    <Section className="nm-testimonials" aria-labelledby="principles">
      <Container>
        <ScrollReveal className="nm-testimonials-head">
          <Eyebrow>How it behaves</Eyebrow>
          <h2 id="principles" className="nm-heading-lg nm-testimonials-title">
            Three positions the platform{' '}
            <span className="nm-serif">takes on your behalf.</span>
          </h2>
        </ScrollReveal>
        <div className="nm-testimonials-grid">
          {principles.map((t, i) => (
            <ScrollReveal key={t.name} delay={(i % 3) as 0 | 1 | 2}>
              <div className="nm-testimonial-card">
                <Quote size={28} className="nm-testimonial-quote-icon" />
                <p className="nm-testimonial-text">{t.quote}</p>
                <div className="nm-testimonial-author">
                  <div className="nm-testimonial-author-info">
                    <span className="nm-testimonial-name">{t.name}</span>
                    <span className="nm-testimonial-role">{t.role}</span>
                  </div>
                  <div className="nm-testimonial-icon">
                    <t.icon size={18} />
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/* ============================================================
 * ARCHITECTURE
 * ============================================================ */
function Architecture() {
  return (
    <Section size="lg" className="nm-architecture nm-dark-surface" aria-labelledby="architecture">
      <div className="nm-architecture-bg">
        <div className="nm-grid-bg nm-grid-bg-dark" />
        <div className="nm-architecture-glow" />
      </div>
      <Container className="nm-architecture-container">
        <div className="nm-architecture-grid">
          <ScrollReveal className="nm-architecture-text">
            <Eyebrow>Architecture</Eyebrow>
            <h2 id="architecture" className="nm-heading-lg nm-heading-dark">
              Built so the business logic{' '}
              <span className="nm-serif" style={{ color: 'var(--nm-accent-3)' }}>
                outlives the infrastructure.
              </span>
            </h2>
            <p className="nm-lead" style={{ color: 'var(--nm-neutral-5)', marginTop: 'var(--nm-space-5)' }}>
              Row-level security on every table. Structured logging with a
              correlation id on every request. Rate limiting on every endpoint
              that accepts or issues credentials. Each of these is an assertion
              in the repository&rsquo;s own security gate, which fails the build
              rather than filing a warning.
            </p>
            <div className="nm-architecture-meta">
              {[
                { icon: Shield, k: 'Security', v: 'Row-level access control' },
                { icon: Server, k: 'Logging', v: 'Structured + traced' },
                { icon: GitBranch, k: 'Limits', v: 'Rate-limited credentials' },
                { icon: Eye, k: 'Audit', v: 'Full request history' },
              ].map((m) => (
                <div key={m.k} className="nm-meta-row nm-meta-row-dark nm-arch-meta-row">
                  <span className="nm-meta-key nm-arch-meta-key">
                    <m.icon size={14} />
                    {m.k}
                  </span>
                  <span className="nm-meta-val" style={{ color: 'var(--nm-neutral-3)' }}>
                    {m.v}
                  </span>
                </div>
              ))}
            </div>
          </ScrollReveal>
          <ScrollReveal delay={2} className="nm-architecture-visual">
            <ArchDiagram />
          </ScrollReveal>
        </div>
      </Container>
    </Section>
  );
}

function ArchDiagram() {
  const layers = [
    { label: 'Departments', items: ['People', 'Finance', 'Projects', 'Support'] },
    { label: 'Capabilities', items: ['Approvals', 'Documents', 'Reporting', 'Inventory'] },
    { label: 'Shared model', items: ['Permissions', 'Organization', 'Records'] },
    { label: 'Data & security', items: ['RLS', 'Audit log', 'Tracing'] },
  ];
  return (
    <div className="nm-arch-diagram">
      {layers.map((layer, i) => (
        <div key={layer.label}>
          <div className="nm-arch-layer">
            <div className="nm-arch-layer-label nm-mono">{layer.label}</div>
            <div className="nm-arch-layer-items">
              {layer.items.map((item) => (
                <span key={item} className="nm-arch-chip">
                  {item}
                </span>
              ))}
            </div>
          </div>
          {i < layers.length - 1 && <div className="nm-arch-connector" />}
        </div>
      ))}
    </div>
  );
}

/* ============================================================
 * STATS
 * ============================================================ */
function StatsSection() {
  const stats = [
    { val: String(CAPABILITIES.length), label: 'Connected capability areas' },
    { val: '1', label: 'Permission model across the platform' },
    { val: '0', label: 'Data silos between departments' },
    { val: '100%', label: 'Row-level security on every table' },
  ];
  return (
    <Section className="nm-stats-section" aria-labelledby="stats">
      <Container>
        <h2 id="stats" className="nm-sr-only">
          The shape of the system, in four numbers
        </h2>
        <ScrollReveal className="nm-stats-grid">
          {stats.map((s) => (
            <div key={s.label} className="nm-stat-card">
              <div className="nm-stat-card-val">{s.val}</div>
              <div className="nm-stat-card-label">{s.label}</div>
            </div>
          ))}
        </ScrollReveal>
      </Container>
    </Section>
  );
}

/* ============================================================
 * READINESS
 * ============================================================ */
function Readiness() {
  const items = [
    {
      icon: Lock,
      title: 'Role-based access control',
      body: 'Permissions are scoped to roles and departments — enforced at the database row level and checked in the route, not just drawn in the interface.',
    },
    {
      icon: Shield,
      title: 'Session management & security policies',
      body: 'Idle and absolute timeouts, password management and account verification. Suspending a person revokes every session they hold immediately.',
    },
    {
      icon: Globe,
      title: 'Multi-organization ready',
      body: 'Organizations, departments, teams and reporting lines, with a structure that drives permissions. Business units and branches are in development.',
    },
  ];
  return (
    <Section className="nm-readiness" aria-labelledby="readiness">
      <Container>
        <ScrollReveal className="nm-readiness-head">
          <Eyebrow>Security & deployment</Eyebrow>
          <h2 id="readiness" className="nm-heading-lg">
            Designed for organizations that{' '}
            <span className="nm-serif">audit their software.</span>
          </h2>
        </ScrollReveal>
        <div className="nm-readiness-grid">
          {items.map((item, i) => (
            <ScrollReveal key={item.title} delay={i as 0 | 1 | 2}>
              <div className="nm-readiness-item">
                <div className="nm-readiness-icon">
                  <item.icon size={18} />
                </div>
                <h3 className="nm-readiness-title">{item.title}</h3>
                <p className="nm-readiness-body">{item.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/* ============================================================
 * CLOSING
 * ============================================================ */
function Closing() {
  return (
    <Section size="lg" className="nm-closing" aria-labelledby="closing">
      <div className="nm-closing-bg">
        <div className="nm-closing-glow" />
        <div className="nm-grid-bg nm-grid-bg-dot" />
      </div>
      <Container width="narrow">
        <ScrollReveal className="nm-closing-inner">
          <span className="nm-hero-badge nm-closing-badge">
            <Calendar size={14} />
            Get started today
          </span>
          <h2 id="closing" className="nm-display-lg nm-closing-title">
            Open it{' '}
            <span className="nm-serif nm-text-gradient">before email.</span>
          </h2>
          <p className="nm-lead-lg nm-closing-lead">
            NextMav is the operational command center of the business — the
            screen an organization opens first thing in the morning to
            understand what needs attention.
          </p>
          <div className="nm-closing-actions">
            <Link href="/signup" className={buttonClass('primary', 'lg')}>
              Get started
              <ArrowRight size={16} />
            </Link>
            <Link href="/contact" className={buttonClass('secondary', 'lg')}>
              Talk to sales
            </Link>
          </div>
          <p className="nm-mono nm-closing-stars-text">
            Fourteen days · No card · Export your data whenever you like
          </p>
        </ScrollReveal>
      </Container>
    </Section>
  );
}
