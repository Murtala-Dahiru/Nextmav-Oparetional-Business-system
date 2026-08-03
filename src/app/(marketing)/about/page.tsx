import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal, RevealGroup } from '@/components/marketing/reveal';

export const metadata: Metadata = {
  title: 'About — NextMav',
  description:
    'Why NextMav exists, what it refuses to do, and how to tell whether it is built the way we say it is.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  About
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this page contained ─────────────────────────────────────────────
 *
 *  Six executives who do not exist, attributed to companies that do:
 *
 *    Sarah Chen        Co-Founder & CEO   "Former VP of Product at Salesforce"
 *    Marcus Williams   Co-Founder & CTO   "Ex-Principal Engineer at AWS"
 *    Elena Rodriguez   VP of Design       "Previously led design at Figma"
 *    James Park        VP of Engineering  "Former Engineering Director at Stripe"
 *    Aisha Patel       Head of CS         …
 *    David Kim         Head of Sales      "Scaled revenue from $0 to $50M"
 *
 *  Plus a founding date (2021), a headcount claim (10,000 teams), an uptime
 *  figure, a task counter and a review score — none of which anybody measured.
 *
 *  The blog then announced Sarah Chen as the new *CTO*, contradicting this
 *  page, where she was CEO. Two pages of invented facts that could not even
 *  agree with each other.
 *
 *  This is the page a cautious buyer opens to decide whether there is a real
 *  company behind the software. Filling it with fiction is not a placeholder
 *  strategy — it is the worst possible use of the one page whose entire
 *  purpose is credibility.
 *
 *  ── What replaces it ─────────────────────────────────────────────────────
 *
 *  Everything here is either a *position* (which cannot be false, only
 *  disagreed with) or a *checkable property of the software*. No people, no
 *  dates, no counts. When there are real names to publish they go in the
 *  section this page deliberately leaves empty — see CONTENT-NEEDED.md #2.
 *
 *  A short honest About beats a populated fictional one. It is also, oddly,
 *  more persuasive: a page that says "here is what we refuse to do, go and
 *  check" reads as a company with an opinion, and a wall of stock headshots
 *  reads as a template.
 */

/**
 * Positions, not claims.
 *
 * Each of these is a design decision visible in the product, so a reader can
 * verify the belief by using the software rather than by trusting the page.
 */
const beliefs = [
  {
    title: 'Integration is not the same as agreement.',
    body: 'Connecting six tools with webhooks makes them exchange copies faster. It does not make them agree — it distributes the disagreement more efficiently. A record either has one home or it has several versions.',
  },
  {
    title: 'Permissions belong in the server, not the sidebar.',
    body: 'Hiding a menu item is presentation. We check authorisation in the route, so a request that should not succeed does not succeed — whether it came from our interface or from anything else.',
  },
  {
    title: 'You should be able to leave.',
    body: 'Structured export from every module, on every plan, including the trial, without asking us. Software that is difficult to leave is difficult to trust, and lock-in is a substitute for being good enough to keep.',
  },
  {
    title: 'The product should look the same for everyone.',
    body: 'Your branding belongs on what your customers see — your portal, your invoices, your exports. The application your team signs into stays ours, so two people from different companies can compare screens and be looking at the same software.',
  },
];

/**
 * Refusals.
 *
 * More informative than a feature list, because anybody will tell you what
 * their software does. What a company has decided *not* to build tells you
 * what it will still be in two years.
 */
const refusals = [
  {
    title: 'We don’t white-label the application.',
    body: 'It has been asked for and it is a deliberate no. It is enforced in the build, not just in a document — a check fails if the application shell reads tenant branding.',
  },
  {
    title: 'We don’t publish numbers we haven’t measured.',
    body: 'This site carries no customer count, no uptime percentage and no compliance badge, because we would have to be able to show you the evidence for each one.',
  },
  {
    title: 'We don’t gate departments behind price tiers.',
    body: 'Every plan includes all eight modules. A system of record for the part of the company that could afford it is not a system of record.',
  },
  {
    title: 'We don’t lock the door on your data.',
    body: 'Pass a plan limit and we tell you. Nothing stops working, nothing is deleted, and nobody is locked out of their own records over a billing threshold.',
  },
];

export default function AboutPage() {
  return (
    <>
      {/* ── Opening ──────────────────────────────────────────────────────── */}
      <Container className="pt-16 pb-4 sm:pt-24">
        <div className="max-w-[44rem]">
          <Reveal>
            <Eyebrow>About</Eyebrow>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-display-1 text-balance-hero mt-5">
              Most business software disagrees with itself.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="text-muted-foreground text-lede text-pretty-body mt-6 space-y-5">
              <p>
                A company of sixty people typically runs a CRM, a project tool, a
                spreadsheet for leave, an accounting package and a chat app. Each
                one is competent. Together they hold four versions of the same
                customer, spelled four ways, and no two of them agree on what was
                promised or what was delivered.
              </p>
              <p className="text-foreground">
                NextMav exists because that problem is structural, and the usual
                answer — another integration — treats the symptom.
              </p>
            </div>
          </Reveal>
        </div>
      </Container>

      {/* ── Beliefs ──────────────────────────────────────────────────────── */}
      <Section aria-labelledby="beliefs">
        <SectionHeading
          id="beliefs"
          eyebrow="What we think"
          title="Four opinions the product is built around."
          description="Each is a decision you can see in the software, not a value statement. Disagree with any of them and this probably isn’t the right tool for you."
        />

        <RevealGroup
          className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2"
          step={0.05}
        >
          {beliefs.map((b, i) => (
            <div key={b.title} className="border-hairline border-t pt-5">
              <span
                aria-hidden="true"
                className="text-muted-foreground/50 font-mono text-[0.75rem] tabular-nums"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 text-[1.0625rem] font-semibold tracking-[-0.02em]">
                {b.title}
              </h3>
              <p className="text-muted-foreground mt-2.5 text-[0.9375rem] leading-relaxed">
                {b.body}
              </p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Refusals ─────────────────────────────────────────────────────── */}
      <Section tone="surface" aria-labelledby="refusals">
        <SectionHeading
          id="refusals"
          eyebrow="What we won’t do"
          title="The commitments that are harder to make."
          description="Anybody will tell you what their software does. What a company has decided not to build is the better predictor of what it will be in two years."
        />

        <RevealGroup className="mt-12 grid gap-x-12 gap-y-9 md:grid-cols-2" step={0.05}>
          {refusals.map((r) => (
            <div key={r.title}>
              <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                {r.title}
              </h3>
              <p className="text-muted-foreground mt-2 text-[0.875rem] leading-relaxed">
                {r.body}
              </p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── The honest gap ───────────────────────────────────────────────── */}
      <Section width="prose" density="tight" aria-labelledby="numbers">
        <Reveal>
          <Eyebrow>Worth saying plainly</Eyebrow>
          <h2 id="numbers" className="text-display-3 mt-5">
            You’ll notice there are no numbers on this site.
          </h2>
          <div className="text-muted-foreground mt-5 space-y-4 text-[0.9375rem] leading-relaxed">
            <p>
              No customer count, no uptime percentage, no compliance badge, no
              logo strip. Not because they would be unflattering, but because we
              would want to be able to hand you the evidence for each one, and
              a figure printed without evidence is just a figure.
            </p>
            <p className="text-foreground">
              What we would rather you do is open a trial and check the claims
              that matter: that permissions hold when you test them, that the
              audit trail says who changed what, and that your data comes back
              out in a form you can use. Those are verifiable in an afternoon,
              which is more than can be said for a customer count.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <Section tone="ink" density="tight" aria-labelledby="about-cta">
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="about-cta" className="text-display-3 max-w-xl">
              Judge it on the software.
            </h2>
            <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed opacity-70">
              Fourteen days, every module, no card. Import a real customer list
              and see whether any of this holds up.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button asChild variant="onInk" size="xl">
              <Link href="/signup">
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="ghost"
              className="text-ink-fg hover:bg-ink-fg/10 hover:text-ink-fg"
            >
              <Link href="/contact">
                Ask us something
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
