import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  Layers,
  Network,
  ShieldCheck,
  Eye,
  Sparkles,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal, RevealGroup } from '@/components/marketing/reveal';
import { EditorialImage, PHOTO } from '@/components/marketing/media';
import { CAPABILITIES, LIVE_CAPABILITIES } from '@/components/marketing/capabilities';

export const metadata: Metadata = {
  title: 'Company — NextMav',
  description:
    'Why NextMav exists: one connected operational layer instead of seven tools that each hold a partial copy of the same company.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Company
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Structure taken wholesale from the uploaded public-experience project:
 *  hero, the problem beside three mission cards, four principles, an
 *  engineering band on a dark surface with a photograph and four figures, and
 *  a closing statement. The page it replaces had no visual content at all.
 *
 *  ── What changed on the way across ───────────────────────────────────────
 *
 *  Three claims in the upload's copy could not be carried:
 *
 *    · "cost centres" as a shipped concept — they are in development, and
 *      `capabilities.ts` says so
 *    · "audit prep goes from weeks to days" — a result claimed on behalf of
 *      customers who have not been asked
 *    · "can migrate to another cloud provider with minimal disruption" — an
 *      assertion about work nobody has done
 *
 *  The figures are drawn from `capabilities.ts` rather than typed in, so the
 *  page cannot drift out of step with the platform page next door.
 */

const missionPoints = [
  {
    icon: Network,
    title: 'Connected by design',
    body: 'Every capability shares the same organization, the same permission model and the same records. There are no integrations to maintain between two halves of your own company.',
  },
  {
    icon: ShieldCheck,
    title: 'Auditable by default',
    body: 'Who changed which record, when, and what it said before — kept as a matter of course rather than switched on for an audit, and readable in the product.',
  },
  {
    icon: Target,
    title: 'Purposeful, not bloated',
    body: 'Each area has to earn its place against the org model everything else already shares. What is built is stated plainly, and so is what is not.',
  },
];

const values = [
  {
    icon: Sparkles,
    title: 'Clarity over complexity',
    body: 'Software that runs an organization should reduce the amount somebody has to hold in their head, not add to it. Every screen, every workflow and every notification should make the work clearer rather than noisier.',
  },
  {
    icon: Layers,
    title: 'One system, not many',
    body: 'Organizations lose time and data at the seams between disconnected tools. The answer is not better integrations between them — it is not having the seam in the first place.',
  },
  {
    icon: ShieldCheck,
    title: 'Security as architecture',
    body: 'Permissions are enforced at the database row level and checked in the route, not drawn in the interface. Built for organizations that will audit the software before they adopt it.',
  },
  {
    icon: Eye,
    title: 'Calm software for serious work',
    body: 'The system a company opens first thing in the morning should never feel anxious, trendy or experimental. It should feel like infrastructure, and it should still feel that way in five years.',
  },
];

/**
 * Derived, not typed. The platform page and this page disagreeing about how
 * many capability areas exist is the kind of small inconsistency a careful
 * reader notices and a careless one is damaged by.
 */
const figures = [
  { val: '100%', label: 'of tables carrying row-level security' },
  { val: '0', label: 'exports needed between departments' },
  { val: String(CAPABILITIES.length), label: 'capability areas, with each one’s status published' },
  { val: '1', label: 'permission model across all of them' },
];

export default function AboutPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="grid-substrate pointer-events-none absolute inset-x-0 top-0 h-[32rem]"
        />
        <Container className="relative pt-band pb-block sm:pt-[6rem]">
          <div className="max-w-[46rem]">
            <Reveal>
              <Eyebrow>Company</Eyebrow>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="text-display-1 text-balance-hero mt-pair">
                We build the operating system for modern organizations.
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-copy-2 text-lede text-pretty-body mt-comp max-w-[38rem]">
                NextMav exists because running an organization should not require
                dozens of disconnected products. One connected platform — shared
                data, shared permissions, shared workflows — is a better way to
                work, and a much easier one to trust.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="mt-group flex flex-wrap items-center gap-pair">
                <Button asChild variant="cta" size="xl">
                  <Link href="/signup">
                    Start free
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="ctaOutline" size="xl">
                  <Link href="/contact">Talk to us</Link>
                </Button>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ── The problem ──────────────────────────────────────────────────── */}
      <Section tone="surface" density="default" aria-labelledby="problem">
        <div className="grid gap-block lg:grid-cols-[1.05fr_1fr] lg:gap-[4rem]">
          <Reveal>
            <Eyebrow>The problem</Eyebrow>
            <h2 id="problem" className="text-display-2 text-balance-hero mt-pair">
              Software sprawl is a tax on every organization.
            </h2>
            <p className="text-copy-2 text-lede text-pretty-body mt-comp">
              Most organizations stitch together seven or more tools to run their
              operations. The cost is not the subscriptions — it is the duplicated
              records, the broken handoffs, the approvals lost between inboxes, and
              the impossibility of seeing the whole company in one place.
            </p>
            <p className="text-copy-2 text-body mt-row">
              NextMav replaces that sprawl with one operational layer, where every
              department works from the same rows under the same permissions.
            </p>
          </Reveal>

          <RevealGroup className="flex flex-col gap-comp" step={0.05}>
            {missionPoints.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="border-hairline bg-background rounded-surface shadow-e1 flex gap-pair border p-comp"
              >
                <Icon
                  className="text-copy-2 mt-0.5 size-[1.125rem] shrink-0"
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-title">{title}</h3>
                  <p className="text-copy-2 text-body-sm mt-label">{body}</p>
                </div>
              </div>
            ))}
          </RevealGroup>
        </div>
      </Section>

      {/* ── Principles ───────────────────────────────────────────────────── */}
      <Section density="default" aria-labelledby="values">
        <SectionHeading
          id="values"
          eyebrow="What we believe"
          title="Principles that shape every decision."
          description="Four positions we have taken deliberately, each of which costs us something and is worth it."
        />

        <RevealGroup
          className="mt-group grid gap-comp md:grid-cols-2"
          itemClassName="h-full"
          step={0.05}
        >
          {values.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              className="border-hairline bg-background rounded-surface hover:border-hairline-strong flex h-full flex-col border p-comp transition-colors sm:p-7"
            >
              <div className="flex items-center gap-pair">
                <span className="text-copy-3 text-label tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Icon className="text-copy-2 size-4" strokeWidth={1.9} aria-hidden="true" />
              </div>
              <h3 className="text-display-3 mt-pair">{title}</h3>
              <p className="text-copy-2 text-body mt-row">{body}</p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Engineering ──────────────────────────────────────────────────
          The upload's dark band, kept — it is the one change of register on
          the page, and the figures belong on it rather than floating in a
          light section of their own. */}
      <Section tone="ink" density="default" aria-labelledby="engineering">
        <div className="grid items-center gap-block lg:grid-cols-[1fr_1fr] lg:gap-[4rem]">
          <Reveal>
            <Eyebrow className="text-copy-on-ink-2">Engineering</Eyebrow>
            <h2 id="engineering" className="text-display-2 text-balance-hero mt-pair">
              Built to be trusted with critical operations.
            </h2>
            <p className="text-copy-on-ink-2 text-lede text-pretty-body mt-comp">
              Row-level security on every table. Structured logging and a
              correlation id on every request. Rate limiting on every endpoint
              that accepts or issues credentials. Sessions that actually end.
            </p>
            <p className="text-body mt-row">
              None of it is a badge. Each is an assertion in the repository’s own
              security gate, which fails the build rather than filing a warning.
            </p>
            <div className="mt-group">
              <Button asChild variant="onInk" size="xl">
                <Link href="/features#platform">
                  See the platform guarantees
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <EditorialImage
              src={PHOTO.architecture}
              alt="A concrete facade in flat daylight, seen from below"
              ratio="photo"
              tone="deep"
              sizes="(min-width: 1024px) 44vw, 92vw"
              className="border-ink-fg/15"
            />
          </Reveal>
        </div>

        <RevealGroup
          className="border-ink-fg/15 mt-open grid gap-comp border-t pt-group sm:grid-cols-2 lg:grid-cols-4"
          step={0.05}
        >
          {figures.map(({ val, label }) => (
            <div key={label}>
              <p className="text-display-2 tabular-nums">{val}</p>
              <p className="text-copy-on-ink-2 text-body-sm mt-label max-w-[16rem]">
                {label}
              </p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <Section tone="surface" density="interrupt" aria-labelledby="about-cta">
        <div className="flex flex-col items-start gap-group md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="about-cta" className="text-display-2 text-balance-hero max-w-[30rem]">
              The platform an organization opens every morning.
            </h2>
            <p className="text-copy-2 text-body mt-pair max-w-lg">
              {LIVE_CAPABILITIES.length} capability areas are available today.
              Start with the one that hurts most.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-pair">
            <Button asChild variant="cta" size="xl">
              <Link href="/signup">
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="ctaOutline" size="xl">
              <Link href="/contact">Talk to us</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
