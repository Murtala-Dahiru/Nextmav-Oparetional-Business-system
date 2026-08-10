import Link from 'next/link';
import type { Metadata } from 'next';
import { BookOpen, Activity, LifeBuoy, ArrowUpRight } from 'lucide-react';
import { Container, Eyebrow, Section } from '@/components/public/ui';
import { ScrollReveal } from '@/components/public/client';

export const metadata: Metadata = {
  title: 'Writing — NextMav',
  description:
    'Notes on building NextMav. Nothing published yet — here is where to look in the meantime.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Writing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was here ───────────────────────────────────────────────────────
 *
 *  Eight articles that do not exist, every one of them linking to `href="#"`,
 *  above a "Load more posts" button with no handler. Among them:
 *
 *    · "NexusCorp Raises $50M Series C to Accelerate Growth" — an invented
 *      funding round, which is the kind of claim a journalist checks in one
 *      search and a due-diligence process checks in a contract.
 *    · "Meet Our New Chief Technology Officer — Sarah Chen", which named the
 *      same person the About page called CEO. Two pages of fiction that could
 *      not keep their own story straight.
 *    · Category filter tabs that worked perfectly, filtering imaginary posts.
 *
 *  Every article card carried a gradient rectangle with an outline icon at 30%
 *  opacity where a hero image would go — eight of them, in eight different
 *  hues, which is the single most recognisable "content coming soon" pattern
 *  on the web.
 *
 *  ── Why an empty state rather than deletion ─────────────────────────────
 *
 *  The page is linked from the footer, and a 404 from your own navigation is
 *  worse than an honest empty page. More to the point: an empty state that
 *  says "nothing yet, here is where to look instead" costs a visitor five
 *  seconds and costs nothing in credibility. Eight fabricated posts cost the
 *  credibility of every other page on the site, because a reader who catches
 *  one starts checking the rest.
 *
 *  ── Why it was rebuilt again ────────────────────────────────────────────
 *
 *  The empty state was right and is kept word for word. What was wrong was
 *  that it was the only page on the site still written in the *previous*
 *  design system — `components/marketing/section`, the application's Tailwind
 *  tokens, `border-hairline`, `bg-surface`, `text-display-1`. Measured against
 *  the rest of the public surface it referenced the new system zero times,
 *  while the landing page referenced it 241 times.
 *
 *  So a reader arriving from `/contact` or `/pricing` — both of which open on
 *  the dark cinematic hero every secondary page uses — landed on a white page
 *  with a different type scale, different card radius and different borders.
 *  Nothing on it looked broken. It simply looked like an older version of the
 *  company, which is the more expensive of the two problems.
 *
 *  The structure below is unchanged. Only the system it is written in is.
 */

const meanwhile = [
  {
    icon: BookOpen,
    title: 'Documentation',
    body: 'How the modules fit together, the data model, and the API.',
    href: '/docs',
  },
  {
    icon: LifeBuoy,
    title: 'Help centre',
    body: 'Practical answers to the questions we are asked most often.',
    href: '/help',
  },
  {
    icon: Activity,
    title: 'System status',
    body: 'Live availability, and the written record of past incidents.',
    href: '/status',
  },
];

export default function BlogPage() {
  return (
    <>
      <section className="nm-page-hero nm-page-hero-dark">
        <div className="nm-page-hero-bg">
          <div className="nm-grid-bg nm-grid-bg-dark" />
          <div className="nm-hero-glow nm-hero-glow-1" />
          <div className="nm-hero-glow nm-hero-glow-2" />
        </div>
        <Container className="nm-page-hero-content">
          <Eyebrow>Writing</Eyebrow>
          <h1 className="nm-page-hero-title nm-page-hero-title-dark">
            Nothing published <span className="nm-serif">yet.</span>
          </h1>
          <p className="nm-page-hero-sub nm-page-hero-sub-dark">
            When there is something worth reading — how a module is built, why a
            decision went the way it did, what broke and what we changed — it
            will be here. Until then this page would rather be empty than
            padded.
          </p>
        </Container>
      </section>

      {/* ── The empty state proper ───────────────────────────────────────── */}
      <Section aria-labelledby="empty">
        <Container width="narrow">
          <ScrollReveal>
            <div className="nm-card-inset" style={{ textAlign: 'center' }}>
              <div className="nm-state">
                <div className="nm-auth-state-icon" aria-hidden="true">
                  <BookOpen size={22} />
                </div>
                <h2 id="empty" className="nm-state-title">
                  No posts, rather than filler
                </h2>
                <p className="nm-state-desc">
                  If there is something you would find genuinely useful written
                  up — a migration you are weighing, a permission model you are
                  trying to reproduce — tell us and we will write that one
                  first.
                </p>
                <Link
                  href="/contact"
                  className="nm-arrow-link"
                  style={{ marginTop: 'var(--nm-space-4)' }}
                >
                  Suggest a topic
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </Container>
      </Section>

      {/* ── Where to go instead ──────────────────────────────────────────── */}
      <Section size="sm" aria-labelledby="meanwhile" className="nm-section-surface">
        <Container>
          <ScrollReveal>
            <h2 id="meanwhile" className="nm-heading">
              In the meantime
            </h2>
          </ScrollReveal>

          <div className="nm-blog-meanwhile">
            {meanwhile.map(({ icon: Icon, title, body, href }, i) => (
              <ScrollReveal key={title} delay={(i + 1) as 1 | 2 | 3}>
                <Link href={href} className="nm-card nm-card-hover nm-blog-meanwhile-card">
                  <Icon
                    size={18}
                    aria-hidden="true"
                    style={{ color: 'var(--nm-accent)' }}
                  />
                  <h3 className="nm-blog-meanwhile-title">{title}</h3>
                  <p className="nm-blog-meanwhile-body">{body}</p>
                </Link>
              </ScrollReveal>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
