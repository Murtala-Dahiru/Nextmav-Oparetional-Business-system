import Link from 'next/link';
import type { Metadata } from 'next';
import {
  FileText,
  ShieldCheck,
  Database,
  Layers,
  ScrollText,
  LifeBuoy,
  MessageSquare,
  ArrowUpRight,
} from 'lucide-react';
import { Container, Eyebrow, Section } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
import { SUPPORT_EMAIL } from '@/lib/public-contact';

export const metadata: Metadata = {
  title: 'Documentation — NextMav',
  description:
    'How NextMav is put together — the permission model, tenant isolation and the shared record — while the written reference is being prepared.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Documentation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was here ───────────────────────────────────────────────────────
 *
 *  A complete API reference for an API that does not exist, for a company that
 *  no longer exists. Seventeen references to **NexusCorp**, the previous
 *  product name, across ten code blocks a reader could copy and run:
 *
 *    · `npm install @nexuscorp/sdk` — an SDK that was never published, offered
 *      in npm, yarn and bun flavours with a copy button on each.
 *    · `https://api.nexuscorp.io/v1` as the base URL — a domain this company
 *      does not own, which means the one instruction on the page that a
 *      developer would act on points somewhere we do not control.
 *    · `Authorization: Bearer nc_live_abc123def456` — a credential format
 *      implying an API-key system. There is no API-key table in the schema.
 *    · A full OAuth 2.0 authorization-code flow with token refresh, and a
 *      webhook section covering setup, event types, payload format and retry
 *      logic. None of it is built: no webhooks table, no bearer authentication,
 *      no registered application concept.
 *    · A rate-limit section documenting response headers. Rate limiting is
 *      real — `test:rate-limit` covers it — but it guards the application's
 *      own session-authenticated routes, not a public API anybody can call.
 *
 *  The stale brand is the part that would have been caught eventually. The
 *  copyable install command for a package that does not exist is the part that
 *  wastes a developer's afternoon before they conclude the product is not real.
 *
 *  ── What replaced it ────────────────────────────────────────────────────
 *
 *  NextMav's surface today is the application, reached by signing in. There is
 *  no public API, so this page documents no endpoints — the third page in this
 *  pass to be rebuilt on the principle that an honest empty state costs a
 *  visitor five seconds and a fabrication costs the credibility of every other
 *  page.
 *
 *  What it does instead is answer the question a technical evaluator actually
 *  brings to a docs page before there is a reference to read: how is this
 *  thing built. Each of the four below is a property this product genuinely
 *  has and already states elsewhere on the public surface — they are not
 *  written for this page, and none of them is a roadmap promise.
 *
 *  Deliberately reuses the primitives introduced for `/status` and `/help`
 *  rather than adding a fourth set. Three secondary pages sharing one note,
 *  one card grid and one channel list is what makes them read as one site.
 *
 *  The API reference is tracked in `CONTENT-NEEDED.md`. When there is an API,
 *  this is where it goes.
 */

const architecture = [
  {
    icon: ShieldCheck,
    title: 'One permission model',
    body: 'Roles are defined once and enforced server-side on every request. The same role governs CRM, projects, finance and everything else — there is no per-module permission system to keep in step with the others.',
  },
  {
    icon: Database,
    title: 'Isolation at the database',
    body: 'Tenants are separated by row-level security rather than by a filter in application code. A query that forgets its organisation clause returns nothing, instead of returning somebody else’s data.',
  },
  {
    icon: Layers,
    title: 'One record, every module',
    body: 'A customer in the CRM is the same customer in projects, in finance and in support. Modules read a shared record rather than keeping their own copy and reconciling later.',
  },
  {
    icon: ScrollText,
    title: 'Actions are attributable',
    body: 'Changes are recorded against the person who made them, and every response carries a request id generated in the proxy — so a report can be traced to an exact request.',
  },
];

const routes = [
  {
    icon: LifeBuoy,
    label: 'Help centre',
    value: 'Getting an answer',
    href: '/help',
    desc: 'The three routes that will get you a reply today, and what the platform covers.',
  },
  {
    icon: MessageSquare,
    label: 'Technical questions',
    value: SUPPORT_EMAIL,
    href: `mailto:${SUPPORT_EMAIL}`,
    desc: 'Architecture, data handling, or what an integration would involve. A person answers, which is currently better than the reference would be.',
  },
];

export default function DocsPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Documentation</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            How the system is <span className="nm-serif">put together.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            The written reference is being prepared. What follows is the part
            worth knowing first — the decisions the whole platform is built on,
            and where they show up.
          </p>
        </Container>
      </section>

      {/* ── The honest statement ─────────────────────────────────────────── */}
      <Section aria-labelledby="scope">
        <Container width="narrow">
          <ScrollReveal>
            <div className="nm-status-note">
              <span className="nm-status-note-icon" aria-hidden="true">
                <FileText size={18} />
              </span>
              <div>
                <h2 id="scope" className="nm-status-note-title">
                  There is no public API yet
                </h2>
                <p className="nm-status-note-body">
                  NextMav&rsquo;s surface today is the application itself, reached
                  by signing in. There is no SDK to install, no API key to issue
                  and no webhook to register — so this page documents none of
                  them rather than describing endpoints you cannot call. If an
                  integration is a condition of your evaluation, say so and you
                  will get a straight answer about what is possible now.
                </p>
              </div>
            </div>
          </ScrollReveal>
        </Container>
      </Section>

      {/* ── Architecture ─────────────────────────────────────────────────── */}
      <Section
        size="sm"
        aria-labelledby="architecture"
        className="nm-section-surface"
      >
        <Container>
          <ScrollReveal>
            <h2 id="architecture" className="nm-heading">
              Four decisions the platform is built on
            </h2>
            <p className="nm-help-lede">
              These are properties of the system as it runs today, not a
              roadmap. Each one is the reason a class of problem does not occur
              rather than a feature that has to be configured.
            </p>
          </ScrollReveal>

          {/* Two columns, not the four `/help` uses — these bodies are
              paragraphs, and four across measured 32 characters per line. */}
          <div className="nm-help-grid nm-help-grid-wide">
            {architecture.map(({ icon: Icon, title, body }, i) => (
              <ScrollReveal key={title} delay={((i % 3) + 1) as 1 | 2 | 3}>
                <div className="nm-card nm-help-card">
                  <Icon
                    size={18}
                    aria-hidden="true"
                    style={{ color: 'var(--nm-accent)' }}
                  />
                  <h3 className="nm-help-card-title">{title}</h3>
                  <p className="nm-help-card-body">{body}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Where to go ──────────────────────────────────────────────────── */}
      <Section aria-labelledby="next">
        <Container width="narrow">
          <ScrollReveal>
            <h2 id="next" className="nm-heading">
              In the meantime
            </h2>
          </ScrollReveal>

          <ScrollReveal delay={1}>
            <div
              className="nm-contact-channels"
              style={{ marginTop: 'var(--nm-space-8)' }}
            >
              {routes.map(({ icon: Icon, label, value, href, desc }) => (
                <Link key={label} href={href} className="nm-contact-channel nm-help-route">
                  <span className="nm-contact-channel-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className="nm-contact-channel-content">
                    <span className="nm-contact-channel-label">{label}</span>
                    <span className="nm-contact-channel-val">{value}</span>
                    <span className="nm-contact-channel-desc">{desc}</span>
                  </span>
                  <ArrowUpRight
                    size={16}
                    aria-hidden="true"
                    className="nm-help-route-arrow"
                  />
                </Link>
              ))}
            </div>
          </ScrollReveal>
        </Container>
      </Section>
    </>
  );
}
