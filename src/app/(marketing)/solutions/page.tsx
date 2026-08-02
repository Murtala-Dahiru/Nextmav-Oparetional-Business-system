import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section, Container, SectionHeading, Eyebrow } from '@/components/marketing/section';
import { Reveal, RevealGroup } from '@/components/marketing/reveal';

export const metadata: Metadata = {
  title: 'Solutions — NextMav',
  description:
    'How the modules combine for professional services, distribution and internal operations teams, and which one to start with.',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Solutions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this page did not exist ──────────────────────────────────────────
 *
 *  The site had Features and Pricing and nothing between them. Features says
 *  what the software contains; Pricing asks for a decision. Nothing connected
 *  the two — nothing said *this is what it looks like for a business shaped
 *  like yours*, which is the question standing between a curious visitor and a
 *  trial they will actually complete.
 *
 *  ── What this page refuses to be ─────────────────────────────────────────
 *
 *  The industry-page template is well known: nine tiles reading Healthcare,
 *  Manufacturing, Retail, Education, Government, Non-profit, each linking to a
 *  page with the product description and the industry's name substituted in.
 *  It is transparently generated, and every reader who checks two of them
 *  learns there is nothing behind any of them.
 *
 *  Three shapes of business, described honestly, with the modules that carry
 *  the weight named — and, more usefully, where to start. Nobody moves a
 *  company onto new software in one weekend, and pretending otherwise is how
 *  a trial stalls in week two.
 */

const shapes = [
  {
    name: 'Professional services',
    who: 'Consultancies, studios, engineering practices — anyone who sells work rather than goods.',
    problem:
      'The deal, the delivery and the invoice live in three tools, so nobody can say what a client is actually worth until somebody spends a day in spreadsheets.',
    modules: ['CRM', 'Projects', 'Finance', 'People'],
    start:
      'Start with Projects. It is where the disagreement is most expensive, and the CRM becomes obviously worth connecting the first time somebody opens a project from a deal.',
  },
  {
    name: 'Distribution and light manufacturing',
    who: 'Businesses that hold stock, buy from suppliers, and promise delivery dates.',
    problem:
      'Sales promises from one number and the warehouse works from another. The gap is discovered by a customer.',
    modules: ['Inventory', 'CRM', 'Finance', 'Support'],
    start:
      'Start with Inventory and connect the CRM next. Once a deal can see real stock, the promise and the shelf stop disagreeing.',
  },
  {
    name: 'Internal operations',
    who: 'Growing teams where HR, IT and finance requests all arrive in the same overloaded inbox.',
    problem:
      'Requests have no owner and no clock, so the loudest gets handled and the rest are found later, unanswered.',
    modules: ['People', 'Support', 'Communication', 'Calendar'],
    start:
      'Start with People and Support together. Leave requests and internal tickets are the two things everyone in the company touches, so adoption is immediate.',
  },
];

const roles = [
  {
    role: 'Sales',
    gets: 'A pipeline that reflects what delivery can actually take on, and a customer record that does not end at the signature.',
  },
  {
    role: 'Delivery',
    gets: 'Work with owners, dependencies and time against it, arriving with the context the deal already captured.',
  },
  {
    role: 'Finance',
    gets: 'Invoices and expenses attached to the customer and project that produced them, so a figure can be traced rather than defended.',
  },
  {
    role: 'People',
    gets: 'One directory, one leave process, one attendance record — and offboarding that actually removes access.',
  },
  {
    role: 'Leadership',
    gets: 'Figures drawn from the same rows every department is working in, rather than four reports compiled separately and reconciled in a meeting.',
  },
  {
    role: 'IT',
    gets: 'One access model, one audit trail and one vendor, instead of six SaaS admin consoles with six different ideas of what a role is.',
  },
];

export default function SolutionsPage() {
  return (
    <>
      <Container className="pt-16 pb-4 sm:pt-24">
        <div className="max-w-[44rem]">
          <Reveal>
            <Eyebrow>Solutions</Eyebrow>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-display-1 text-balance-hero mt-5">
              Where to start, depending on what you run.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-muted-foreground text-lede text-pretty-body mt-6">
              The same eight modules serve very different businesses. What
              changes is which two you turn on first — and getting that wrong is
              the most common reason a migration stalls.
            </p>
          </Reveal>
        </div>
      </Container>

      {/* ── By shape of business ───────────────────────────────────────── */}
      <Container className="py-10 sm:py-14">
        <div className="divide-hairline divide-y">
          {shapes.map((s) => (
            <Reveal key={s.name} as="article">
              <div className="grid gap-8 py-12 md:grid-cols-[0.9fr_1.1fr] md:gap-16 sm:py-14">
                <div>
                  <h2 className="text-display-3">{s.name}</h2>
                  <p className="text-muted-foreground mt-3 text-[0.9375rem] leading-relaxed">
                    {s.who}
                  </p>
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {s.modules.map((m) => (
                      <li
                        key={m}
                        className="border-hairline text-muted-foreground rounded-full border px-2.5 py-1 text-[0.75rem] font-medium"
                      >
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-[0.8125rem] font-semibold tracking-[0.02em] uppercase opacity-50">
                      What goes wrong today
                    </h3>
                    <p className="text-pretty-body mt-2 text-[0.9375rem] leading-relaxed">
                      {s.problem}
                    </p>
                  </div>
                  <div className="border-brand-line bg-brand-soft rounded-xl border p-5">
                    <h3 className="text-brand text-[0.8125rem] font-semibold tracking-[0.02em] uppercase">
                      Where to start
                    </h3>
                    <p className="text-foreground/80 mt-2 text-[0.9375rem] leading-relaxed">
                      {s.start}
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>

      {/* ── By role ─────────────────────────────────────────────────────── */}
      <Section tone="surface" aria-labelledby="roles">
        <SectionHeading
          id="roles"
          eyebrow="By team"
          title="What each department stops doing."
          description="Adoption fails when a system is worth having for management and a chore for everybody else. This is the answer to “what do I get out of it”, per team."
        />

        <RevealGroup
          className="mt-12 grid gap-x-12 gap-y-8 md:grid-cols-2 lg:grid-cols-3"
          step={0.04}
        >
          {roles.map(({ role, gets }) => (
            <div key={role} className="border-hairline border-t pt-5">
              <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                {role}
              </h3>
              <p className="text-muted-foreground mt-2 text-[0.875rem] leading-relaxed">
                {gets}
              </p>
            </div>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Honest note ─────────────────────────────────────────────────── */}
      <Section density="tight" width="prose" aria-labelledby="not-for">
        <Reveal>
          <Eyebrow>Worth saying</Eyebrow>
          <h2 id="not-for" className="text-display-3 mt-5">
            When this is the wrong tool.
          </h2>
          <div className="text-muted-foreground mt-5 space-y-4 text-[0.9375rem] leading-relaxed">
            <p>
              If one department needs software far deeper than a suite will ever
              go — a trading desk, a clinical record, a shop floor running MES —
              a general system of record will not replace it, and a page that
              claimed otherwise would waste your trial.
            </p>
            <p className="text-foreground">
              The honest version: NextMav is worth adopting when the cost of your
              tools disagreeing exceeds the depth you would give up by
              consolidating. For most companies under a few hundred people, it
              does. Above that, it depends on the department.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="ink" density="tight" aria-labelledby="solutions-cta">
        <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="solutions-cta" className="text-display-3 max-w-xl">
              Not sure which two modules to start with?
            </h2>
            <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed opacity-70">
              Describe what you run today and we will tell you — including if the
              answer is that you should not move yet.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button asChild variant="onInk" size="xl">
              <Link href="/contact">
                Ask us
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="ghost"
              className="text-ink-fg hover:bg-ink-fg/10 hover:text-ink-fg"
            >
              <Link href="/signup">
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
