import Link from 'next/link';
import type { Metadata } from 'next';
import { Mail, MessageSquare, Radio, ArrowUpRight } from 'lucide-react';
import { Container, Eyebrow, Section } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';
import { SUPPORT_EMAIL } from '@/lib/public-contact';

export const metadata: Metadata = {
  title: 'System status — NextMav',
  description:
    'How NextMav communicates incidents, and where to reach us while a public status feed is being built.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  System status
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this was the most dangerous page on the site ────────────────────
 *
 *  A status page is the one document on a website that is supposed to be
 *  machine truth. It is the page a buyer's security review opens, the page an
 *  existing customer refreshes at nine in the morning when something is slow,
 *  and the page nobody reads as marketing. Fabricating it is categorically
 *  worse than fabricating a testimonial.
 *
 *  What was here:
 *
 *    · **Six services with invented uptime figures** — 99.99%, 99.98%, 100% —
 *      across 30, 60 and 90-day windows, rendered as progress bars to two
 *      decimal places. An uptime figure is an availability claim, and a
 *      precise one is a claim somebody can hold you to.
 *    · **Four complete incidents** with issued identifiers (INC-2847,
 *      INC-2841, INC-2835, INC-2829), severities, durations and minute-by-
 *      minute update logs written in the voice of an on-call engineer.
 *    · **A service showing "Degraded Performance" right now.** The page
 *      claimed a live incident that was not happening.
 *    · Every incident dated **January 2024**. Set against any recent date, a
 *      status page whose newest entry is two years old does not read as
 *      "stable" — it reads as abandoned. The fabrication was decaying into a
 *      different, worse lie the longer it sat there.
 *
 *  ── Why not simply delete the route ─────────────────────────────────────
 *
 *  Three surfaces link here: the footer's sibling pages `/blog` and `/help`,
 *  and the application's command palette. A 404 reached from your own
 *  navigation is worse than an honest page, and for an enterprise buyer the
 *  absence of any status commitment is itself an answer.
 *
 *  ── What it says instead ────────────────────────────────────────────────
 *
 *  There is no monitoring pipeline publishing to this page, so it does not
 *  claim one. It states that plainly, then does the useful thing a status page
 *  does when it has no feed: it tells you exactly how you will find out, and
 *  how to tell us.
 *
 *  Nothing below is a service-level commitment. "We post before support can
 *  answer individually" is a description of a communication order, not an
 *  availability percentage or a response-time guarantee — and there is
 *  deliberately no number anywhere on this page.
 *
 *  A real feed is tracked in `CONTENT-NEEDED.md`. When it exists, the section
 *  order here is already the right one: current state, then history, then how
 *  to reach a person.
 */

const reaching = [
  {
    icon: Mail,
    label: 'Report a problem',
    value: SUPPORT_EMAIL,
    href: `mailto:${SUPPORT_EMAIL}`,
    desc: 'The fastest route if something is broken for you. Include your organisation name and the request id shown on the error — every response carries one, and it identifies the exact request in our logs.',
  },
  {
    icon: MessageSquare,
    label: 'Everything else',
    value: 'Contact form',
    href: '/contact',
    desc: 'Questions about reliability, architecture or what we would do in a given failure — rather than something that is failing now.',
  },
];

const communication = [
  {
    title: 'You will not have to ask first',
    body: 'When we know a shared component is affected, saying so comes before working through individual reports. A customer who has already written in should not be the way anybody finds out.',
  },
  {
    title: 'Every error carries a request id',
    body: 'It is generated in the proxy and attached to the response. Quoting it turns "the app was slow this morning" into a single request we can look up.',
  },
  {
    title: 'What we will not do',
    body: 'Publish an availability figure we are not measuring, or an incident history we have not had. When the feed is live it will be generated, not written.',
  },
];

export default function StatusPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>System status</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            No live feed <span className="nm-serif">yet.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            We are not publishing automated availability data, so this page does
            not pretend to. Here is how you will hear about an incident, and how
            to tell us about one.
          </p>
        </Container>
      </section>

      {/* ── The statement ────────────────────────────────────────────────── */}
      <Section aria-labelledby="state">
        <Container width="narrow">
          <ScrollReveal>
            <div className="nm-status-note">
              <span className="nm-status-note-icon" aria-hidden="true">
                <Radio size={18} />
              </span>
              <div>
                <h2 id="state" className="nm-status-note-title">
                  This page reports nothing automatically
                </h2>
                <p className="nm-status-note-body">
                  A status page is only worth reading if it is generated by the
                  thing it describes. Ours is not connected to one yet, so it
                  shows no service list, no uptime percentage and no incident
                  history — rather than showing invented ones. If you need a
                  reliability commitment in writing before a purchase, ask, and
                  you will get an answer about what exists rather than a
                  dashboard.
                </p>
              </div>
            </div>
          </ScrollReveal>
        </Container>
      </Section>

      {/* ── How incidents are communicated ───────────────────────────────── */}
      <Section
        size="sm"
        aria-labelledby="communication"
        className="nm-section-surface"
      >
        <Container>
          <ScrollReveal>
            <h2 id="communication" className="nm-heading">
              How we handle it when something breaks
            </h2>
          </ScrollReveal>

          <div className="nm-status-grid">
            {communication.map(({ title, body }, i) => (
              <ScrollReveal key={title} delay={(i + 1) as 1 | 2 | 3}>
                <div className="nm-card nm-status-card">
                  <span className="nm-section-num">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="nm-status-card-title">{title}</h3>
                  <p className="nm-status-card-body">{body}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Reaching a person ────────────────────────────────────────────── */}
      <Section aria-labelledby="reach">
        <Container width="narrow">
          <ScrollReveal>
            <h2 id="reach" className="nm-heading">
              Reaching us
            </h2>
          </ScrollReveal>

          <ScrollReveal delay={1}>
            <div
              className="nm-contact-channels"
              style={{ marginTop: 'var(--nm-space-8)' }}
            >
              {reaching.map(({ icon: Icon, label, value, href, desc }) => (
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
