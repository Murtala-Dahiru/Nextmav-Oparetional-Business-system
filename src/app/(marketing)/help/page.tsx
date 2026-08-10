import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Mail,
  MessageSquare,
  Activity,
  BookOpen,
  ArrowUpRight,
} from 'lucide-react';
import { Container, Eyebrow, Section } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
import { LIVE_CAPABILITIES } from '@/components/marketing/capabilities';
import { SUPPORT_EMAIL } from '@/lib/public-contact';

export const metadata: Metadata = {
  title: 'Help centre — NextMav',
  description:
    'How to get an answer about NextMav: support, the documentation, and what the platform covers today.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Help centre
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was here ───────────────────────────────────────────────────────
 *
 *  A knowledge base for a knowledge base that does not exist. Specifically:
 *
 *    · **118 articles**, counted precisely — "12 articles", "24 articles",
 *      "22 articles" — across eight categories. None of them exist.
 *    · **Six "popular articles" with view counts.** "Configuring SSO with
 *      SAML 2.0 — 7.2k views". Every one linked to `href="#"`. A view count is
 *      a particularly bad fabrication because it is a claim about other
 *      customers, not just about the product.
 *    · **"Our support team is available 24/7."** A service-level commitment,
 *      on a marketing page, that nothing backs.
 *    · **A "Live Chat" button with no handler**, beside an "Email Support"
 *      button with no handler.
 *    · **A search field** over a body of zero articles, which returns nothing
 *      for every query anybody will ever type into it.
 *    · Eight category tints — emerald, sky, violet, amber, rose, orange, teal,
 *      fuchsia — none of them from the palette.
 *
 *  The article counts are the giveaway. Nobody invents "9 articles" for a
 *  category that has content; you invent it for one that does not, because a
 *  round number would look invented. The precision is the tell.
 *
 *  ── What replaced it ────────────────────────────────────────────────────
 *
 *  The pattern `/blog` already established here: an honest page beats a
 *  convincing one, and an empty state with a next action costs a visitor five
 *  seconds while a fabrication costs the credibility of every other page.
 *
 *  So this page answers the question somebody actually arrives with — "how do
 *  I get an answer" — with the three routes that genuinely work today, and
 *  then says what the platform covers so a reader can tell whether their
 *  question is even in scope. The capability list is not written for this
 *  page: it is `LIVE_CAPABILITIES`, the same vetted source the landing,
 *  features and solutions pages read from, so it cannot drift from what the
 *  product actually ships.
 *
 *  The search field is gone rather than restyled. A control that looks like it
 *  works and returns nothing is worse than its own absence — and removing it
 *  took the last piece of state off the page, so this is a server component
 *  again and prerenders static, which is what the marketing layout's note asks
 *  every page here to be.
 *
 *  When articles exist, this page grows a search field and a category index.
 *  Tracked in `CONTENT-NEEDED.md`.
 */

const routes = [
  {
    icon: Mail,
    label: 'Email support',
    value: SUPPORT_EMAIL,
    href: `mailto:${SUPPORT_EMAIL}`,
    desc: 'For customers with a technical problem. Include your organisation name and, if you have one, the request id shown on the error.',
  },
  {
    icon: MessageSquare,
    label: 'Talk to us',
    value: 'Contact form',
    href: '/contact',
    desc: 'Evaluating the platform, or a question that is not a fault. Goes to the same people.',
  },
  {
    icon: Activity,
    label: 'System status',
    value: 'Incident policy',
    href: '/status',
    desc: 'How we communicate when a shared component is affected, and what to include when you report something.',
  },
];

export default function HelpCenterPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Help centre</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            How to get an <span className="nm-serif">answer.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            The written guides are still being put together. Until they are
            here, these are the three routes that will actually get you a reply
            — and below them, what the platform covers today.
          </p>
        </Container>
      </section>

      {/* ── The three routes that work ───────────────────────────────────── */}
      <Section aria-labelledby="routes">
        <Container width="narrow">
          <ScrollReveal>
            <h2 id="routes" className="nm-heading">
              Getting in touch
            </h2>
          </ScrollReveal>

          <ScrollReveal delay={1}>
            <div className="nm-contact-channels" style={{ marginTop: 'var(--nm-space-8)' }}>
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

      {/* ── What the platform covers ─────────────────────────────────────── */}
      <Section
        size="sm"
        aria-labelledby="covers"
        className="nm-section-surface"
      >
        <Container>
          <ScrollReveal>
            <h2 id="covers" className="nm-heading">
              What the platform covers
            </h2>
            <p className="nm-help-lede">
              {/*
                No article counts. The honest version of "how much is there" is
                the list of what the product does, which is a fact rather than
                an inventory of documents nobody has written.
              */}
              Every area below is live today. If your question is about one of
              them, support can answer it — if it is about something not listed,
              the answer is probably &ldquo;not yet&rdquo;, and{' '}
              <Link href="/features" className="nm-link-accent">
                the features page
              </Link>{' '}
              says which of those are planned.
            </p>
          </ScrollReveal>

          <div className="nm-help-grid">
            {LIVE_CAPABILITIES.map((capability, i) => (
              <ScrollReveal
                key={capability.id}
                delay={(Math.min(i, 4) % 3) as 0 | 1 | 2}
              >
                <div className="nm-card nm-help-card">
                  <capability.icon
                    size={18}
                    aria-hidden="true"
                    style={{ color: 'var(--nm-accent)' }}
                  />
                  <h3 className="nm-help-card-title">{capability.name}</h3>
                  <p className="nm-help-card-body">{capability.summary}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Documentation ────────────────────────────────────────────────── */}
      <Section size="sm" aria-labelledby="docs">
        <Container width="narrow">
          <ScrollReveal>
            <div className="nm-card-inset nm-help-docs">
              <span className="nm-contact-channel-icon" aria-hidden="true">
                <BookOpen size={18} />
              </span>
              <div>
                <h2 id="docs" className="nm-help-docs-title">
                  Looking for the technical detail?
                </h2>
                <p className="nm-help-docs-body">
                  The documentation covers how the modules fit together, the
                  data model, and the API.
                </p>
                <Link
                  href="/docs"
                  className="nm-arrow-link"
                  style={{ marginTop: 'var(--nm-space-4)' }}
                >
                  Read the documentation
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </Container>
      </Section>
    </>
  );
}
