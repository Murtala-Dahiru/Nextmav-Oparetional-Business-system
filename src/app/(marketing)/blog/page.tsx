import Link from 'next/link';
import type { Metadata } from 'next';
import { BookOpen, Activity, LifeBuoy, ArrowUpRight } from 'lucide-react';
import { Container, Eyebrow, Section } from '@/components/marketing/section';
import { Reveal } from '@/components/marketing/reveal';

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
 *  This is also the pattern the rest of the product should use. An empty state
 *  is a designed screen with a reason and a next action — not a centred grey
 *  sentence apologising for itself.
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
      <Container className="pt-16 pb-4 sm:pt-24">
        <div className="max-w-[44rem]">
          <Reveal>
            <Eyebrow>Writing</Eyebrow>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-display-1 text-balance-hero mt-5">
              Nothing published yet.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-muted-foreground text-lede text-pretty-body mt-6">
              When there is something worth reading — how a module is built, why
              a decision went the way it did, what broke and what we changed —
              it will be here. Until then this page would rather be empty than
              padded.
            </p>
          </Reveal>
        </div>
      </Container>

      {/* ── The empty state proper ───────────────────────────────────────── */}
      <Container className="py-10 sm:py-14">
        <Reveal>
          <div className="border-hairline bg-surface rounded-2xl border px-6 py-14 text-center sm:px-12">
            <div
              className="bg-background ring-hairline mx-auto grid size-12 place-items-center rounded-xl ring-1"
              aria-hidden="true"
            >
              <BookOpen className="text-brand size-5" strokeWidth={1.8} />
            </div>
            <h2 className="mt-5 text-[1.125rem] font-semibold tracking-[-0.02em]">
              No posts, rather than filler
            </h2>
            <p className="text-muted-foreground mx-auto mt-2.5 max-w-md text-[0.9375rem] leading-relaxed">
              If there is something you would find genuinely useful written up —
              a migration you are weighing, a permission model you are trying to
              reproduce — tell us and we will write that one first.
            </p>
            <Link
              href="/contact"
              className="text-foreground mt-6 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium underline decoration-[1.5px] underline-offset-[4px] hover:no-underline"
            >
              Suggest a topic
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </Container>

      {/* ── Where to go instead ──────────────────────────────────────────── */}
      <Section tone="surface" density="tight" aria-labelledby="meanwhile">
        <Reveal>
          <h2 id="meanwhile" className="text-display-3">
            In the meantime
          </h2>
        </Reveal>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {meanwhile.map(({ icon: Icon, title, body, href }, i) => (
            <Reveal key={title} delay={i * 0.05}>
              <Link
                href={href}
                className="border-hairline bg-background hover:border-hairline-strong block h-full rounded-xl border p-5 transition-colors"
              >
                <Icon
                  className="text-brand size-[1.0625rem]"
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
                <h3 className="mt-3 text-[0.9375rem] font-semibold tracking-[-0.01em]">
                  {title}
                </h3>
                <p className="text-muted-foreground mt-1.5 text-[0.875rem] leading-relaxed">
                  {body}
                </p>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
