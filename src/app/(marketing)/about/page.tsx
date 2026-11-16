import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Network, ShieldCheck, Eye } from "lucide-react";
import {
  Container,
  Section,
  Eyebrow,
  buttonClass,
} from "@/components/public/ui";

export const metadata: Metadata = {
  title: "About NextMav — Connected by design",
  description:
    "We are building a connected Business Operating System for businesses across Africa and globally. Learn the purpose and principles behind NextMav.",
};
export default function AboutPage() {
  return (
    <>
      <section className="nm-company-intro">
        <Container>
          <Eyebrow>About NextMav</Eyebrow>
          <div className="nm-company-head">
            <h1>
              Good work deserves
              <br />
              <span>a connected business.</span>
            </h1>
            <div>
              <p>
                We are building the Business Operating System for organizations
                across Africa and globally.
              </p>
              <p>
                Our purpose is straightforward: give the people running a
                business a shared place to understand the work, take
                responsibility and move it forward.
              </p>
            </div>
          </div>
          <div className="nm-company-statement">
            <span className="nm-mono">OUR CONVICTION</span>
            <p>
              A business is connected.
              <br />
              Its software should be, too.
            </p>
            <div
              className="nm-company-threads"
              aria-label="Customers, people, delivery and operations connected through one shared workspace"
            >
              <span>Customers</span>
              <span>People</span>
              <strong>One shared workspace</strong>
              <span>Delivery</span>
              <span>Operations</span>
            </div>
          </div>
        </Container>
      </section>
      <Section aria-labelledby="purpose">
        <Container>
          <div className="nm-editorial-heading">
            <div>
              <Eyebrow>The problem we care about</Eyebrow>
              <h2 id="purpose" className="nm-heading-lg">
                The work between
                <br />
                the tools.
              </h2>
            </div>
            <div className="nm-company-prose">
              <p>
                A customer becomes a project. A project needs people, decisions
                and resources. An invoice needs the context of the work behind
                it.
              </p>
              <p>
                When these records live in separate systems, teams spend time
                reconstructing what the business already knows. NextMav brings
                those operational foundations into one platform.
              </p>
              <p>
                We believe clarity comes from shared context: who owns the work,
                what has changed and what needs attention next.
              </p>
            </div>
          </div>
        </Container>
      </Section>
      <Section className="nm-company-principles" aria-labelledby="principles">
        <Container>
          <Eyebrow>How we build</Eyebrow>
          <h2 id="principles" className="nm-heading-lg">
            Principles with practical consequences.
          </h2>
          <div className="nm-company-principle-list">
            {[
              {
                icon: Network,
                title: "Connected by design",
                body: "Customer records, projects, finance and team communication share an organizational foundation. The connections belong in the product, not in a spreadsheet someone maintains on the side.",
              },
              {
                icon: ShieldCheck,
                title: "Access is part of the foundation",
                body: "Roles and departments shape what people can see and do. Organization boundaries are enforced beyond the interface, so the visible screen is not the only line of protection.",
              },
              {
                icon: Eye,
                title: "Clarity about what exists",
                body: "We publish capability statuses and distinguish the working platform from our plans. An evaluation should begin with a clear view of what your team can use today.",
              },
            ].map((p, i) => (
              <article key={p.title}>
                <span className="nm-mono">0{i + 1}</span>
                <p.icon size={24} strokeWidth={1.5} />
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
        </Container>
      </Section>
      <Section aria-labelledby="direction">
        <Container>
          <div className="nm-editorial-heading">
            <div>
              <Eyebrow>Where we are going</Eyebrow>
              <h2 id="direction" className="nm-heading-lg">
                A shared foundation.
                <br />A more relevant starting point.
              </h2>
            </div>
            <div className="nm-company-prose">
              <p>
                The existing platform connects everyday business capabilities.
                Our longer-term direction is to make that foundation more
                relevant to the way different businesses operate.
              </p>
              <p>
                Industry presets and configuration are planned. Today, you can
                explore the existing modules and create a standard workspace.
              </p>
              <Link href="/features" className="nm-arrow-link">
                See the product and its availability <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </Container>
      </Section>
      <section className="nm-next-step">
        <Container>
          <Eyebrow>Get to know the platform</Eyebrow>
          <div>
            <h2>
              See what connected work
              <br />
              could look like for your team.
            </h2>
            <Link href="/features" className={buttonClass("primary", "lg")}>
              Explore NextMav <ArrowRight size={16} />
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}
